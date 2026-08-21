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
import { parseHeaderBlock, parseReferences } from './headers';
import { resolveSentMailbox } from './imap';
import type { MailDirection } from '$lib/server/db/schema';
import { finishPollProgress, reportPollPhase } from './poll-progress';
import { db, type DbExecutor } from '$lib/server/db';
import {
	attributeByRecipients,
	attributeBySender,
	knownSenderAddresses,
	normaliseAddress,
	reattributeKnownSenders
} from './attribute';
import { storeDocument } from '$lib/server/repositories/document';
import {
	findByMailboxAndMessageId,
	findByMessageId,
	maxImapUidForMailbox,
	recordInboundThread,
	recordSkippedInboundThread
} from '$lib/server/repositories/inbound-thread';
import { recordMailboxPollRun } from '$lib/server/repositories/mailbox-poll-run';
import {
	DEFAULT_IMAP_INBOX_LOOKBACK_DAYS,
	DEFAULT_IMAP_MAX_MESSAGE_BYTES,
	type ImapConfig
} from './config';

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
		// Per attempt, not once before the loop (#405). A mailbox that refuses
		// the connection takes the full backoff ladder to give up - measured
		// at ~18s against a closed port - and a log that says "connecting"
		// once and then nothing for eighteen seconds is indistinguishable
		// from a poll that hung. The attempt number is the difference between
		// "it is stuck" and "it is trying again".
		reportPollPhase('connecting', attempt, maxAttempts);
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
 * What one pass polls: the watched mailbox, nothing else (#394).
 *
 * There used to be a second kind, a contract's own configured folder, where
 * the folder was the attribution. #380 had already made the mailbox the
 * default and the sender the attribution, so the folder was a second answer
 * to one question, and the worse one: it asked a counterparty's mail to
 * arrive pre-sorted, which on the first real client it never did. Sender
 * matching is the only mechanism now.
 */
export type PollTarget = {
	mailbox: string;
	/**
	 * Which way the mail in this mailbox travelled (#409). Defaults to
	 * `inbound`, which is every caller that predates the sent pass.
	 *
	 * The two directions differ in three specific places and nowhere else,
	 * which is why this is a flag on one function rather than a second copy
	 * of it: who the message is attributed by (sender for inbound, recipient
	 * for outbound - both are "the other party"), which addresses being
	 * unknown means the message is not worth a model call, and whether
	 * re-attribution of older rows belongs in the pass at all.
	 */
	direction?: MailDirection;
};

export type MailboxPollResult = {
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
	/**
	 * Messages archived by an earlier pass under an unknown sender that this
	 * pass could finally attribute, because a contact was added in between
	 * (#388). Reported so a poll can say "3 older messages became readable"
	 * rather than leaving the reader to notice the queue grew.
	 */
	recovered: number;
	error: string | null;
};

/**
 * Polls the watched mailbox on an already-connected client. Never throws: a
 * problem with the mailbox (deleted, renamed, permission revoked) is
 * returned as `{ error }` so a caller can record the failure and report it
 * rather than having the pass blow up under it - the same "one failure
 * never stops the rest" shape `publishAllPending` establishes for mirror
 * publishing.
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
	maxMessageBytes: number = DEFAULT_IMAP_MAX_MESSAGE_BYTES,
	lookbackDays: number = DEFAULT_IMAP_INBOX_LOOKBACK_DAYS
): Promise<MailboxPollResult> {
	const mailbox = target.mailbox;
	const direction: MailDirection = target.direction ?? 'inbound';
	const outbound = direction === 'outbound';
	const empty = {
		mailbox,
		handedOff: 0,
		skipped: 0,
		archivedUnknownSender: 0,
		recovered: 0,
		error: null
	};
	try {
		// Re-attribution first, before a single new message is read (#388). A
		// contact added since the last pass makes messages already on disk
		// readable, and it must not depend on anything the mailbox does: an
		// empty mailbox returns early below, and a reader who fixes a contact
		// and presses "check now" is owed the recovery whether or not new mail
		// happens to have arrived.
		//
		// Inbound only (#409). It re-decides attribution from the *sender*, and
		// a message I sent has me as its sender: running it over the sent pass
		// would attribute my own mail to whichever client happens to have my
		// address as a contact, and would do it twice per poll besides.
		const recovered = outbound ? 0 : await reattributeKnownSenders(executor);
		if (!outbound) reportPollPhase('reattributing', recovered);

		const box = await client.mailboxOpen(mailbox);
		const uidValidity = Number(box.uidValidity);
		if (box.exists === 0) {
			reportPollPhase('mailbox_opened', 0);
			return { ...empty, recovered };
		}
		reportPollPhase('mailbox_opened', box.exists);

		// Keyed on the mailbox: it has one UID sequence whoever the messages
		// turn out to belong to.
		const maxUid = await maxImapUidForMailbox(mailbox, uidValidity, executor);
		const from = (maxUid ?? 0) + 1;

		// The addresses the ledger already knows, read once per pass rather
		// than per message.
		const knownSenders = await knownSenderAddresses(executor);

		type KeptMeta = {
			messageId: string | null;
			inReplyTo: string | null;
			referenceIds: string[];
			subject: string | null;
			internalDate: Date;
			/** Null when nothing in the ledger claims this counterparty. */
			contractId: string | null;
			senderAddress: string | null;
			/**
			 * Whether the other party to this message is somebody the ledger
			 * knows: the sender for inbound mail, a recipient for outbound
			 * (#409). It decides `sender_unknown` on the inbound side, and on
			 * the outbound side it is already true by the time a message is
			 * kept - a sent message with no known recipient is only kept when
			 * it answers something archived, and then it is readable anyway.
			 */
			counterpartyKnown: boolean;
		};
		const kept = new Map<number, KeptMeta>();
		let skipped = 0;
		let archivedUnknownSender = 0;

		// A first pass over this mailbox is bounded by date, not by UID 1
		// (#380). `1:*` on an account nobody had polled before archived nine
		// years of mail on a real instance - 21,747 messages, no proposals,
		// 3.7 GB. Once a cursor exists the UID range is the right and cheaper
		// question; before there is one, ask the server for what is recent and
		// let it do the filtering.
		const firstPass = maxUid === null;
		const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
		const recentUids = firstPass
			? ((await client.search({ since }, { uid: true })) as number[] | false) || []
			: [];
		if (firstPass && recentUids.length === 0) {
			reportPollPhase('listing', 0, 0);
			return empty;
		}

		// Counted here rather than derived from `kept.size` afterwards: the
		// listing is the phase a reader is watching, and "seen 40, kept 3" is
		// the sentence that explains why the fetch below is short.
		let seen = 0;
		for await (const message of client.fetch(
			firstPass ? recentUids : `${from}:*`,
			{
				uid: true,
				envelope: true,
				size: true,
				internalDate: true,
				// The two threading headers, read from the message itself rather
				// than from ENVELOPE (#410, #409). ENVELOPE's `In-Reply-To` is
				// whatever the server chooses to report and GreenMail reports
				// nothing at all - measured, with the header plainly present in
				// the message - so a poll that trusted it lost threading against
				// any such server and nobody would have seen why. `References` is
				// not in ENVELOPE on any server. Both come back in this same
				// FETCH, so there is no extra round trip, and having them here
				// rather than after the second fetch is what lets the keep
				// decision below use them.
				headers: ['in-reply-to', 'references']
			},
			{ uid: true }
		)) {
			// The "n:*" gotcha, not a new message. Never applies to the
			// first pass, whose UID list is explicit.
			if (!firstPass && message.uid < from) continue;
			seen += 1;

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
			// What this message answers, and every ancestor above it (#400,
			// #410), from the header block fetched above.
			const headerBytes = Buffer.isBuffer(message.headers) ? message.headers : Buffer.alloc(0);
			const threadingHeaders = parseHeaderBlock(headerBytes);
			const inReplyTo = threadingHeaders.get('in-reply-to')?.trim() ?? null;
			const referenceIds = parseReferences(threadingHeaders.get('references'));
			const uid = message.uid;
			const size = message.size ?? null;

			// Who the counterparty is, and therefore whose message this is. For
			// inbound that is the sender (#394); for a message I sent it is the
			// recipients, because the sender is me (#409). "Nobody knows" stays
			// an accepted answer on both sides.
			const senderAddress = normaliseAddress(message.envelope?.from?.[0]?.address ?? null);
			const recipientAddresses = outbound
				? [
						...(message.envelope?.to ?? []).map((address) => address.address ?? null),
						...(message.envelope?.cc ?? []).map((address) => address.address ?? null)
					]
				: [];
			const counterparties = outbound
				? recipientAddresses.map((address) => normaliseAddress(address))
				: [senderAddress];
			const counterpartyKnown = counterparties.some(
				(address) => !!address && knownSenders.has(address)
			);

			// A reply to something the ledger *cares about* belongs to that
			// conversation whatever its addresses say, and that is the case
			// this whole pass exists for: my "tutto ok, confermo" answers an
			// offer that is already archived. Cheap - one indexed lookup, and
			// only for outbound mail that is a reply at all.
			//
			// "Cares about" is `skip_reason is null`, and the qualifier is the
			// whole point (#409). The inbox archives everything, newsletters
			// included, marking the ones no contract claims `sender_unknown` -
			// so "answers something archived" let my own replies to form
			// notifications into the blob store. Measured on the live instance
			// the day it shipped: 14 of 17 kept sent messages were replies to
			// `sender_unknown` rows, every one of them attributed to nobody,
			// which is exactly the mail this guard exists to keep out.
			const inReplyToRow =
				outbound && inReplyTo ? await findByMessageId(inReplyTo, executor) : null;
			const parent = inReplyToRow?.skipReason === null ? inReplyToRow : null;

			const attributed = outbound
				? ((await attributeByRecipients(counterparties, executor))?.contractId ??
					parent?.contractId ??
					null)
				: counterpartyKnown
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
							senderAddress,
							inReplyTo,
							mailbox,
							direction,
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

			// The cost guard for the sent mailbox (#409), and the one place the
			// two directions differ in what they keep. An inbox is a mailbox
			// somebody else writes to about my work, so #380 archives all of
			// it and lets a contact added later unlock it. A sent mailbox is
			// everything I write to everybody - other clients, other projects,
			// my own life - and archiving that wholesale would put mail no
			// contract has any claim on into this ledger's blob store.
			//
			// So a sent message is kept when it touches the ledger: addressed
			// to a known contact, or answering a message already archived. The
			// rest is recorded as having existed - which is also what advances
			// the UID cursor - and its bytes are never read. The cost is that
			// adding a contact later does not retroactively pull my own old
			// mail in the way `reattributeKnownSenders` does for theirs; the
			// row is there, so a future pass could re-fetch by UID, and until
			// something needs that this stays the conservative side to err on.
			if (outbound && !counterpartyKnown && !parent) {
				await executor.transaction((tx) =>
					recordSkippedInboundThread(
						{
							contractId: null,
							senderAddress,
							inReplyTo,
							mailbox,
							direction,
							imapUidValidity: uidValidity,
							imapUid: uid,
							messageId,
							subject,
							receivedAt: internalDate,
							skipReason: 'recipient_unknown',
							messageSize: size ?? 0
						},
						tx
					)
				);
				skipped += 1;
				continue;
			}

			kept.set(uid, {
				messageId,
				inReplyTo,
				referenceIds,
				subject,
				internalDate,
				contractId: attributed,
				senderAddress,
				counterpartyKnown
			});
		}

		reportPollPhase('listing', kept.size, seen);

		let handedOff = 0;
		if (kept.size > 0) {
			reportPollPhase('fetching', kept.size);
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
							senderAddress: meta.senderAddress,
							inReplyTo: meta.inReplyTo,
							// The ancestry the listing already read (#410), which is
							// what rebuilds a conversation with a hole in it - and
							// the hole is normal, since the middle message of the
							// first real approval here is one I sent.
							referenceIds: meta.referenceIds,
							documentId: archived.id,
							mailbox,
							imapUidValidity: uidValidity,
							imapUid: uid,
							messageId: meta.messageId,
							subject: meta.subject,
							receivedAt: meta.internalDate,
							direction,
							// The cost guard (#380): a message nobody in the ledger
							// sent is kept, and never handed to a model. Marking it
							// here rather than filtering at drain time is what makes
							// the decision visible on the row, and reversible — a
							// contact added later is what changes the answer, which
							// `reattributeKnownSenders` acts on (#388).
							//
							// Inbound only, and the database agrees: a message I sent
							// cannot have an unknown sender, and
							// `inbound_thread_skip_reason_matches_direction` rejects
							// the row that claims otherwise (#409).
							skipReason: outbound || meta.counterpartyKnown ? null : 'sender_unknown'
						},
						tx
					);
				};
				// `executor` may already be a transaction (a test rolling
				// everything back): `PgTransaction` exposes `.transaction()` for
				// exactly this, opening a nested savepoint, so this composes
				// correctly whether `executor` is the pool or an ambient `tx`.
				await executor.transaction(run);
				// A sent message is always readable - it was kept precisely
				// because it touches the ledger - so it counts as handed off
				// rather than as one more address nobody claims (#409).
				if (outbound || meta.counterpartyKnown) handedOff += 1;
				else archivedUnknownSender += 1;
			}
		}

		reportPollPhase('archived', handedOff + archivedUnknownSender);
		return {
			mailbox,
			handedOff,
			skipped,
			archivedUnknownSender,
			recovered,
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
export type PollRunResult = { status: 'success' | 'failure'; mailbox: MailboxPollResult };

/**
 * One full pass over the watched mailbox. Never throws - a connection
 * failure after every retry, or a problem with the mailbox itself, is
 * recorded to `mailbox_poll_run` and returned, never an unhandled rejection
 * (the same "surfaced, not swallowed" contract `publishDocument` already
 * keeps for mirror publishing).
 *
 * There is no "nothing configured" case to skip for: an account with
 * credentials always has a mailbox to watch, which is the whole point of
 * #380 - monitoring should need no setup beyond the credentials. And since
 * #394 there is no second target either: per-contract folders are gone,
 * because attribution by sender answers the same question without asking
 * anyone to file mail, and two mechanisms for one question meant the
 * unused one silently looked like configuration somebody had forgotten.
 */
export async function pollMailboxesOnce(
	imapConfig: ImapConfig,
	options: ConnectRetryOptions = {},
	executor: DbExecutor = db
): Promise<PollRunResult> {
	let client: ImapFlow;
	try {
		client = await connectWithRetry(imapConfig, options);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		await recordMailboxPollRun({ status: 'failure', detail }, executor);
		finishPollProgress('failed');
		return {
			status: 'failure',
			mailbox: {
				mailbox: imapConfig.inboxMailbox,
				handedOff: 0,
				skipped: 0,
				archivedUnknownSender: 0,
				recovered: 0,
				error: detail
			}
		};
	}

	let result: MailboxPollResult;
	try {
		result = await pollMailboxTarget(
			client,
			{ mailbox: imapConfig.inboxMailbox },
			executor,
			imapConfig.maxMessageBytes,
			imapConfig.inboxLookbackDays
		);

		// Then the sent mailbox (#409), on the same connection, because on a
		// contract billed by written confirmation the confirmation is often
		// mine: the client offers a day and asks for an ok, and my reply is
		// the ok. With only their side archived the conversation reads as an
		// offer and a thank-you and proposes nothing - measured, on the first
		// real approval this instance ever saw.
		//
		// Its outcome is deliberately not merged into `result`. The run row and
		// the status strip are about whether the *watched* mailbox is being
		// read, which is what a reader configured and what breaks; a sent pass
		// that fails while the inbox is fine is a smaller fact and must not
		// turn the mailbox red. It is reported through the progress log, and a
		// failure there leaves the inbox's own result untouched.
		if (imapConfig.sentMailbox) {
			const sentTarget = await resolveSentMailbox(client, imapConfig.sentMailbox);
			if (sentTarget) {
				await pollMailboxTarget(
					client,
					{ mailbox: sentTarget, direction: 'outbound' },
					executor,
					imapConfig.maxMessageBytes,
					imapConfig.inboxLookbackDays
				);
			}
		}
	} finally {
		// CLOSE before LOGOUT, not LOGOUT straight from a selected state:
		// observed against the real GreenMail container (not a hypothetical
		// — see the PR description) leaving the last-opened folder briefly
		// unable to accept further commands from another connection
		// (a delete, a human's own mail client) until this one properly
		// returns to the authenticated state first. `.catch` because
		// nothing may be selected at all (the mailbox errored before
		// `mailboxOpen`), which is not itself a failure worth surfacing.
		await client.mailboxClose().catch(() => {});
		await client.logout();
	}

	const status = result.error === null ? 'success' : 'failure';
	const detail = result.error === null ? null : `${result.mailbox}: ${result.error}`;
	await recordMailboxPollRun({ status, detail }, executor);

	// The count a reader cares about at the end is what actually landed, not
	// what the mailbox held: `archived` above already said how many were
	// written, and this closes the log so the client stops asking.
	finishPollProgress(status === 'success' ? 'done' : 'failed', result.handedOff);

	return { status, mailbox: result };
}
