// IMAP polling (#84), the ingestion half of epic #15's "document or
// thread -> ACP agent -> proposed diff -> human review -> applied". Pulls
// new mail per contract's configured folder/label, archives each raw
// message as a `document` (#49) and a row in `inbound_thread` — that row
// *is* the hand-off; see its own doc comment (`db/schema/inbound-
// thread.ts`) for the boundary with the runner (#82), which never reads
// this table or any other directly. Extends the IMAP client already
// built for the Sent-folder append (#72, `mail/imap.ts`) rather than
// standing up a second IMAP stack, and follows `document_mirror_run` and
// `backup_run`'s own run-recording shape for `mailbox_poll_run` (#84's
// own instruction: reuse that pattern, don't invent a third).
//
// Nothing here schedules a pass on its own — the same "future worker
// process" gap `drive/publish.ts` and `alerts/dispatch.ts` already carry
// (AGENTS.md). `pollMailboxesOnce` is the one pass a cron-driven call
// (`/api/mail/poll`, mirroring `/api/alerts/run/[job]`) or that worker
// invokes; "picked up within the configured interval" is the interval of
// whichever caller invokes this, the same way #74/#75's push/digest
// interval lives in a crontab entry, never in this repository.
import { ImapFlow } from 'imapflow';
import { db, type DbExecutor } from '$lib/server/db';
import { listContractsWithMailFolder } from '$lib/server/repositories/contract';
import { storeDocument } from '$lib/server/repositories/document';
import {
	findByContractAndMessageId,
	maxImapUidForContract,
	recordInboundThread,
	recordSkippedInboundThread
} from '$lib/server/repositories/inbound-thread';
import { recordMailboxPollRun } from '$lib/server/repositories/mailbox-poll-run';
import { DEFAULT_IMAP_MAX_MESSAGE_BYTES, type ImapConfig } from './config';

/** Connection retry/backoff (#84's "a provider outage is retried with
 * backoff"): exponential, capped at `CONNECT_MAX_ATTEMPTS` tries total
 * (the first attempt plus `CONNECT_MAX_ATTEMPTS - 1` retries — `500ms,
 * 1s, 2s, 4s` between the five default attempts) before the whole pass
 * gives up and surfaces a failure. Fixed constants rather than env
 * configuration, like `alerts/thresholds.ts`: how patient this feature
 * is with its own provider is not something a self-hoster tunes per
 * deployment. */
export const CONNECT_MAX_ATTEMPTS = 5;
export const CONNECT_BACKOFF_BASE_MS = 500;

function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

export type ConnectRetryOptions = {
	maxAttempts?: number;
	backoffBaseMs?: number;
	/** Injectable so tests exercise every retry without the wall-clock
	 * wait — the same reasoning `mail-send-form.test.ts` and friends use
	 * for injectable clocks elsewhere in this codebase. */
	delay?: (ms: number) => Promise<void>;
};

/**
 * Connects to `config`'s account, retrying with exponential backoff on
 * failure — a fresh `ImapFlow` per attempt, since a client that failed to
 * connect cannot be reused (`connect()` refuses a second call on the same
 * instance). Throws the last error once every attempt is exhausted;
 * `pollMailboxesOnce` is what turns that into a recorded, surfaced
 * failure rather than an unhandled rejection.
 */
export async function connectWithRetry(
	config: ImapConfig,
	options: ConnectRetryOptions = {}
): Promise<ImapFlow> {
	const maxAttempts = options.maxAttempts ?? CONNECT_MAX_ATTEMPTS;
	const backoffBaseMs = options.backoffBaseMs ?? CONNECT_BACKOFF_BASE_MS;
	const delay = options.delay ?? sleep;

	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const client = new ImapFlow({
			host: config.host,
			port: config.port,
			secure: config.secure,
			auth: { user: config.user, pass: config.password },
			logger: false
		});
		try {
			await client.connect();
			return client;
		} catch (error) {
			lastError = error;
			if (attempt < maxAttempts) await delay(backoffBaseMs * 2 ** (attempt - 1));
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export type ContractFolderResult = {
	contractId: string;
	mailbox: string;
	handedOff: number;
	// Oversized messages (#306) recorded but never archived — surfaced
	// separately from `handedOff` so a caller reporting "N archived, M
	// skipped" (the mail page's poll-now action, #343) never has to
	// re-derive it from `inbound_thread` itself.
	skipped: number;
	error: string | null;
};

/**
 * Polls one contract's folder on an already-connected client. Never
 * throws: a problem with this one folder (deleted, renamed, permission
 * revoked) is returned as `{ error }` so `pollMailboxesOnce` can keep
 * going with every other contract's folder on the same pass — the same
 * "one failure never stops the rest" shape `publishAllPending` already
 * establishes for mirror publishing.
 *
 * The incremental fetch is UID-ranged from the durable cursor
 * (`maxImapUidForContract`, scoped to the mailbox's *current*
 * `UIDVALIDITY` — see `inbound_thread`'s own doc comment for why that
 * scoping is what makes a `UIDVALIDITY` bump safe). IMAP's own `n:*`
 * gotcha — a `UID FETCH` range past every existing UID is defined as
 * covering the highest-UID message anyway, per RFC 3501's sequence-range
 * rules — is filtered out explicitly below rather than trusted to return
 * nothing.
 *
 * Two sequential fetches, deliberately never nested (#306). The first
 * asks for `envelope`/`size`/`internalDate` only — never `source` — and
 * decides, per message, whether it is over `maxMessageBytes`; a skipped
 * message is recorded right there, since that is a Postgres write, not
 * an IMAP command, and costs nothing to do mid-loop. The kept UIDs are
 * only fetched with `source` afterwards, in one bulk second FETCH, once
 * the first has fully finished: `ImapFlow` serializes commands on one
 * connection, so issuing a second FETCH while still iterating the first
 * one's `for await` — as an earlier version of this function did, one
 * `fetchOne` per kept message — deadlocks the connection rather than
 * queuing behind it, because the outer command never finishes while this
 * loop is blocked awaiting the inner one. A message that gets skipped is
 * never in the second fetch's UID list at all, which is what actually
 * keeps it from ever being buffered whole.
 */
export async function pollContractFolder(
	client: ImapFlow,
	row: { id: string; mailFolder: string },
	executor: DbExecutor = db,
	maxMessageBytes: number = DEFAULT_IMAP_MAX_MESSAGE_BYTES
): Promise<ContractFolderResult> {
	const mailbox = row.mailFolder;
	try {
		const box = await client.mailboxOpen(mailbox);
		const uidValidity = Number(box.uidValidity);
		if (box.exists === 0)
			return { contractId: row.id, mailbox, handedOff: 0, skipped: 0, error: null };

		const maxUid = await maxImapUidForContract(row.id, uidValidity, executor);
		const from = (maxUid ?? 0) + 1;

		type KeptMeta = { messageId: string | null; subject: string | null; internalDate: Date };
		const kept = new Map<number, KeptMeta>();
		let skipped = 0;

		for await (const message of client.fetch(
			`${from}:*`,
			{ uid: true, envelope: true, size: true, internalDate: true },
			{ uid: true }
		)) {
			if (message.uid < from) continue; // the "n:*" gotcha, not a new message

			const messageId = message.envelope?.messageId ?? null;
			if (messageId) {
				// The UIDVALIDITY-bump safety net: this exact message may
				// already have been handed off under an earlier generation,
				// which the UID cursor above cannot see since it is scoped to
				// the current one.
				const already = await findByContractAndMessageId(row.id, messageId, executor);
				if (already) continue;
			}

			const internalDate =
				message.internalDate instanceof Date
					? message.internalDate
					: new Date(message.internalDate ?? Date.now());
			const subject = message.envelope?.subject ?? null;
			const uid = message.uid;
			const size = message.size ?? null;

			if (size !== null && size > maxMessageBytes) {
				// #306, invariant 4: the bytes are what get dropped, on
				// purpose — this message never enters `kept`, so the second
				// fetch below never asks for its `source` — but the arrival
				// itself is still recorded, with the reason and the size
				// this listing already reported.
				await executor.transaction((tx) =>
					recordSkippedInboundThread(
						{
							contractId: row.id,
							mailbox,
							imapUidValidity: uidValidity,
							imapUid: uid,
							messageId,
							subject,
							receivedAt: internalDate,
							skipReason: 'oversized',
							messageSize: size
						},
						tx
					)
				);
				skipped += 1;
				continue;
			}

			kept.set(uid, { messageId, subject, internalDate });
		}

		let handedOff = 0;
		if (kept.size > 0) {
			for await (const message of client.fetch(
				[...kept.keys()],
				{ uid: true, source: true },
				{ uid: true }
			)) {
				const meta = kept.get(message.uid);
				if (!meta || !Buffer.isBuffer(message.source)) continue;
				const source = message.source;
				const uid = message.uid;

				const run = async (tx: DbExecutor) => {
					// Owned by the contract itself, not by an `approval` that does
					// not exist yet — the same starting owner `createApproval`
					// (`repositories/approval.ts`) gives a freshly archived
					// original before anything downstream decides what it
					// evidences.
					const archived = await storeDocument(
						{
							bytes: source,
							mime: 'message/rfc822',
							// Not `messageId`: that header is chosen entirely by the
							// sender (#300) and `originalName` both feeds a zip
							// entry path (`dispute-bundle/zip.ts`) and renders
							// as-is in the proposals queue UI. The verbatim
							// header still gets recorded, below, in
							// `inbound_thread.messageId` — that column is the
							// evidence; this one is only ever a display name
							// built from fields this process controls.
							originalName: `uid-${uid}@${mailbox}.eml`,
							provenance: 'mail',
							contractId: row.id,
							confidential: true,
							ownerType: 'contract',
							ownerId: row.id
						},
						tx
					);
					await recordInboundThread(
						{
							contractId: row.id,
							documentId: archived.id,
							mailbox,
							imapUidValidity: uidValidity,
							imapUid: uid,
							messageId: meta.messageId,
							subject: meta.subject,
							receivedAt: meta.internalDate
						},
						tx
					);
				};
				// `executor` may already be a transaction (a test rolling
				// everything back): `PgTransaction` exposes `.transaction()` for
				// exactly this, opening a nested savepoint, so this composes
				// correctly whether `executor` is the pool or an ambient `tx`.
				await executor.transaction(run);
				handedOff += 1;
			}
		}

		return { contractId: row.id, mailbox, handedOff, skipped, error: null };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { contractId: row.id, mailbox, handedOff: 0, skipped: 0, error: detail };
	}
}

export type PollRunResult =
	| { status: 'skipped'; reason: 'no folders configured'; folders: [] }
	| { status: 'success' | 'failure'; folders: ContractFolderResult[] };

/**
 * One full pass over every contract with a mail folder configured
 * (#84's "poll a configured IMAP folder or label per contract"). Never
 * throws — a connection failure after every retry, or a per-folder
 * problem, is recorded to `mailbox_poll_run` and returned, never an
 * unhandled rejection (the same "surfaced, not swallowed" contract
 * `publishDocument` already keeps for mirror publishing).
 *
 * Nothing is attempted, and no run row is written, when no contract has
 * a folder configured — the same "genuinely nothing, ever" shape
 * `mirrorConfigFromEnv`'s absent-configuration path keeps: an instance
 * that has not opted into mail ingestion yet should not accumulate empty
 * "success" rows every time a cron entry ticks.
 */
export async function pollMailboxesOnce(
	imapConfig: ImapConfig,
	options: ConnectRetryOptions = {},
	executor: DbExecutor = db
): Promise<PollRunResult> {
	const targets = await listContractsWithMailFolder(executor);
	if (targets.length === 0)
		return { status: 'skipped', reason: 'no folders configured', folders: [] };

	let client: ImapFlow;
	try {
		client = await connectWithRetry(imapConfig, options);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		await recordMailboxPollRun({ status: 'failure', detail }, executor);
		return { status: 'failure', folders: [] };
	}

	const folders: ContractFolderResult[] = [];
	try {
		for (const target of targets) {
			// mailFolder is non-null by construction (listContractsWithMailFolder
			// filters on it), narrowed here only for TypeScript.
			if (!target.mailFolder) continue;
			folders.push(
				await pollContractFolder(
					client,
					{ id: target.id, mailFolder: target.mailFolder },
					executor,
					imapConfig.maxMessageBytes
				)
			);
		}
	} finally {
		// CLOSE before LOGOUT, not LOGOUT straight from a selected state:
		// observed against the real GreenMail container (not a hypothetical
		// — see the PR description) leaving the last-opened folder briefly
		// unable to accept further commands from another connection
		// (a delete, a human's own mail client) until this one properly
		// returns to the authenticated state first. `.catch` because
		// nothing may be selected at all (every folder errored before
		// `mailboxOpen`), which is not itself a failure worth surfacing.
		await client.mailboxClose().catch(() => {});
		await client.logout();
	}

	const failures = folders.filter((folder) => folder.error !== null);
	const status = failures.length > 0 ? 'failure' : 'success';
	const detail =
		failures.length > 0
			? failures
					.map((folder) => `${folder.mailbox} (contract ${folder.contractId}): ${folder.error}`)
					.join('; ')
			: null;
	await recordMailboxPollRun({ status, detail }, executor);

	return { status, folders };
}
