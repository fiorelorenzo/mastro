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
import { attributeBySender, knownSenderAddresses, normaliseAddress } from './attribute';
import { storeDocument } from '$lib/server/repositories/document';
import {
	findByMailboxAndMessageId,
	maxImapUidForMailbox,
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

/**
 * What one pass polls: either a contract's own configured folder, where the
 * folder itself is the attribution, or the shared mailbox (#380), where a
 * message's contract is worked out from its sender or left unknown.
 */
export type PollTarget =
	{ kind: 'contract'; contractId: string; mailbox: string } | { kind: 'inbox'; mailbox: string };

export type ContractFolderResult = {
	/** Null for the shared mailbox: its messages are attributed per message. */
	contractId: string | null;
	mailbox: string;
	/** Archived and queued for extraction. */
	handedOff: number;
	// Oversized messages (#306) recorded but never archived — surfaced
	// separately from `handedOff` so a caller reporting "N archived, M
	// skipped" (the mail page's poll-now action, #343) never has to
	// re-derive it from `inbound_thread` itself.
	skipped: number;
	/**
	 * Archived but deliberately not extracted, because the sender matches no
	 * known client contact (#380). Counted apart from `skipped`, which means
	 * the bytes were refused: these messages are kept, they simply cost
	 * nothing to keep. A poll that reports 40 of these and 2 handed off is
	 * describing a normal inbox, not a failure.
	 */
	archivedUnknownSender: number;
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
 * (`maxImapUidForMailbox`, scoped to the mailbox's *current*
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
export async function pollMailboxTarget(
	client: ImapFlow,
	target: PollTarget,
	executor: DbExecutor = db,
	maxMessageBytes: number = DEFAULT_IMAP_MAX_MESSAGE_BYTES
): Promise<ContractFolderResult> {
	const mailbox = target.mailbox;
	const folderContractId = target.kind === 'contract' ? target.contractId : null;
	const empty = {
		contractId: folderContractId,
		mailbox,
		handedOff: 0,
		skipped: 0,
		archivedUnknownSender: 0,
		error: null
	};
	try {
		const box = await client.mailboxOpen(mailbox);
		const uidValidity = Number(box.uidValidity);
		if (box.exists === 0) return empty;

		// Keyed on the mailbox, not the contract (#380): a shared mailbox has
		// one UID sequence whoever the messages turn out to belong to, and a
		// contract folder is a mailbox nobody else polls, so the same key is
		// correct for both.
		const maxUid = await maxImapUidForMailbox(mailbox, uidValidity, executor);
		const from = (maxUid ?? 0) + 1;

		// The addresses the ledger already knows, read once per pass rather
		// than per message. Only consulted for the shared mailbox: a message
		// in a contract's own folder was filed there by a human, which is a
		// stronger statement than any address match.
		const knownSenders =
			target.kind === 'inbox' ? await knownSenderAddresses(executor) : new Set<string>();

		type KeptMeta = {
			messageId: string | null;
			subject: string | null;
			internalDate: Date;
			/** Null when nothing in the ledger claims this sender. */
			contractId: string | null;
			senderKnown: boolean;
		};
		const kept = new Map<number, KeptMeta>();
		let skipped = 0;
		let archivedUnknownSender = 0;

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
				const already = await findByMailboxAndMessageId(mailbox, messageId, executor);
				if (already) continue;
			}

			const internalDate =
				message.internalDate instanceof Date
					? message.internalDate
					: new Date(message.internalDate ?? Date.now());
			const subject = message.envelope?.subject ?? null;
			const uid = message.uid;
			const size = message.size ?? null;

			// Who it is from, and therefore whose it is. A contract folder
			// answers both by construction; the shared mailbox asks the
			// envelope, and accepts "nobody knows" as an answer.
			const senderAddress =
				target.kind === 'inbox'
					? normaliseAddress(message.envelope?.from?.[0]?.address ?? null)
					: null;
			const senderKnown =
				target.kind === 'contract' || (!!senderAddress && knownSenders.has(senderAddress));
			const attributed =
				target.kind === 'contract'
					? folderContractId
					: senderKnown
						? ((await attributeBySender(senderAddress, executor))?.contractId ?? null)
						: null;

			if (size !== null && size > maxMessageBytes) {
				// #306, invariant 4: the bytes are what get dropped, on
				// purpose — this message never enters `kept`, so the second
				// fetch below never asks for its `source` — but the arrival
				// itself is still recorded, with the reason and the size
				// this listing already reported.
				await executor.transaction((tx) =>
					recordSkippedInboundThread(
						{
							contractId: attributed,
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

			kept.set(uid, { messageId, subject, internalDate, contractId: attributed, senderKnown });
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
					// evidences. Unattributed (#380): owned by nobody yet, the
					// same unclaimed state #86's founding contract PDF sits in
					// until an accept claims it.
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
							contractId: meta.contractId,
							confidential: true,
							ownerType: meta.contractId ? 'contract' : null,
							ownerId: meta.contractId
						},
						tx
					);
					await recordInboundThread(
						{
							contractId: meta.contractId,
							documentId: archived.id,
							mailbox,
							imapUidValidity: uidValidity,
							imapUid: uid,
							messageId: meta.messageId,
							subject: meta.subject,
							receivedAt: meta.internalDate,
							// The cost guard (#380): a message nobody in the ledger
							// sent is kept, and never handed to a model. Marking it
							// here rather than filtering at drain time is what makes
							// the decision visible on the row, and reversible — a
							// contact added later is what changes the answer.
							skipReason: meta.senderKnown ? null : 'sender_unknown'
						},
						tx
					);
				};
				// `executor` may already be a transaction (a test rolling
				// everything back): `PgTransaction` exposes `.transaction()` for
				// exactly this, opening a nested savepoint, so this composes
				// correctly whether `executor` is the pool or an ambient `tx`.
				await executor.transaction(run);
				if (meta.senderKnown) handedOff += 1;
				else archivedUnknownSender += 1;
			}
		}

		return {
			contractId: folderContractId,
			mailbox,
			handedOff,
			skipped,
			archivedUnknownSender,
			error: null
		};
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { ...empty, error: detail };
	}
}

/**
 * A pass either ran or failed to connect. There is no longer a "nothing
 * configured" outcome (#380): credentials imply a mailbox to watch, so the
 * only way to poll nothing is to have no credentials, which `imapConfigFromEnv`
 * refuses before any of this is reached.
 */
export type PollRunResult = { status: 'success' | 'failure'; folders: ContractFolderResult[] };

/**
 * One full pass: the shared mailbox (#380), plus every contract that has a
 * folder of its own (#84). Never throws — a connection failure after every
 * retry, or a per-folder problem, is recorded to `mailbox_poll_run` and
 * returned, never an unhandled rejection (the same "surfaced, not swallowed"
 * contract `publishDocument` already keeps for mirror publishing).
 *
 * There is no longer a "nothing configured" case to skip for: an account with
 * credentials always has a mailbox to watch, which is the whole point of
 * #380 — monitoring should need no setup beyond the credentials. Per-contract
 * folders remain supported and are polled in addition, for an account that
 * does file client mail into folders; a message in one of those is attributed
 * by the folder, which is a human's own filing and a stronger statement than
 * any address match.
 */
export async function pollMailboxesOnce(
	imapConfig: ImapConfig,
	options: ConnectRetryOptions = {},
	executor: DbExecutor = db
): Promise<PollRunResult> {
	const folderTargets = await listContractsWithMailFolder(executor);

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
		folders.push(
			await pollMailboxTarget(
				client,
				{ kind: 'inbox', mailbox: imapConfig.inboxMailbox },
				executor,
				imapConfig.maxMessageBytes
			)
		);
		for (const target of folderTargets) {
			// mailFolder is non-null by construction (listContractsWithMailFolder
			// filters on it), narrowed here only for TypeScript. Skipped when it
			// names the mailbox already polled above, so a contract that mapped
			// INBOX itself does not get every message twice.
			if (!target.mailFolder || target.mailFolder === imapConfig.inboxMailbox) continue;
			folders.push(
				await pollMailboxTarget(
					client,
					{ kind: 'contract', contractId: target.id, mailbox: target.mailFolder },
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
