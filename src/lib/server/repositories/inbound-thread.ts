import { and, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import {
	clientContact,
	document,
	inboundThread,
	proposal,
	type InboundThreadSkipReason
} from '$lib/server/db/schema';

export type InboundThreadRow = typeof inboundThread.$inferSelect;
export type InboundThreadInput = {
	/** Null when the sender matched nothing the ledger knows (#380). */
	contractId: string | null;
	documentId: string;
	mailbox: string;
	imapUidValidity: number;
	imapUid: number;
	messageId: string | null;
	subject: string | null;
	/**
	 * The `From` address, normalised, or null when the envelope carried none
	 * (#394). Recorded whether or not it matched anything: an address nobody
	 * knows is exactly the one a human needs to see, and it is what makes a
	 * contact added later able to unblock this row (#388).
	 */
	senderAddress: string | null;
	receivedAt: Date;
	/**
	 * `'sender_unknown'` for a message archived but deliberately not queued
	 * for extraction (#380). Null - the default - is the ordinary hand-off.
	 * `'oversized'` never appears here: those never reach this function,
	 * because their bytes were refused before being fetched.
	 */
	skipReason?: Extract<InboundThreadSkipReason, 'sender_unknown'> | null;
};

/**
 * Hands one message off (#84): archiving it as a `document` and writing
 * this row together is the entire hand-off, so `mail/poll.ts` always
 * calls this inside the same transaction as `storeDocument`. `onConflict
 * DoNothing` is the last-resort safety net behind the pre-insert checks
 * `poll.ts`'s mailbox pass already does (`findByMailboxAndMessageId`, the
 * UID high-water mark) — either unique index in the accompanying custom
 * migration firing here means a concurrent or repeated pass raced this
 * one, not a bug in the caller's own bookkeeping.
 */
export async function recordInboundThread(input: InboundThreadInput, executor: DbExecutor = db) {
	const [row] = await executor
		.insert(inboundThread)
		.values(input)
		.onConflictDoNothing()
		.returning();
	return row ?? null;
}

/** The fields `poll.ts` records for a message it chose *not* to buffer
 * whole (#306: `message.size` from the IMAP listing exceeded
 * `IMAP_MAX_MESSAGE_BYTES`, checked before `source` was ever fetched).
 * No `documentId` — nothing was archived — which is exactly what
 * `inbound_thread_archived_shape` (the table's own `check()`) requires
 * alongside a non-null `skipReason`/`messageSize`. */
export type InboundThreadSkipInput = {
	/** Null when the sender matched nothing the ledger knows (#380). */
	contractId: string | null;
	mailbox: string;
	imapUidValidity: number;
	imapUid: number;
	messageId: string | null;
	subject: string | null;
	/** As `InboundThreadInput.senderAddress` (#394): recorded even here, so
	 * an oversized message from an unknown address is visible alongside the
	 * rest rather than being the one shape nobody can account for. */
	senderAddress: string | null;
	receivedAt: Date;
	/** Only `'oversized'` reaches here: it is the reason the bytes are absent. */
	skipReason: Extract<InboundThreadSkipReason, 'oversized'>;
	messageSize: number;
};

/** `recordInboundThread`'s counterpart for a skipped message (#306):
 * invariant 4 means the arrival is still recorded even though the bytes
 * are not, so this writes the same row shape minus `documentId`, which
 * stays null. Same `onConflictDoNothing` safety net, same reasoning —
 * `poll.ts` still checks the UID high-water mark and
 * `findByMailboxAndMessageId` first; either unique index firing here
 * means a concurrent or repeated pass raced this one, not a bug in the
 * caller's own bookkeeping. */
export async function recordSkippedInboundThread(
	input: InboundThreadSkipInput,
	executor: DbExecutor = db
) {
	const [row] = await executor
		.insert(inboundThread)
		.values({ ...input, documentId: null, archived: false })
		.onConflictDoNothing()
		.returning();
	return row ?? null;
}

/** #308: the extraction enqueuer's own query, bounded so one scheduler
 * tick costs one query regardless of backlog size instead of "every row
 * the table has ever accumulated". "Awaiting" is a left join against
 * `proposal` filtered to `proposal.id IS NULL`: a thread whose document
 * already has at least one proposal has been extracted, whatever the
 * queue file on disk says, so this excludes it rather than handing the
 * enqueuer the same already-done row on every future tick. That is also
 * what makes repeated calls advance: once a tick's batch is drained and
 * its proposals written (`/api/agent/run` always drains before it
 * enqueues), the next call's anti-join no longer matches those rows and
 * surfaces the next oldest ones instead, so nothing behind a large
 * backlog starves on a fixed-size page. Ordering by arrival means the
 * oldest unread message is queued first, the order a person would have
 * read them in. The enqueuer's own idempotency check against
 * `proposal` (`listProposalsForDocuments`) still runs per batch on top
 * of this — this filter is a bound on what gets fetched, not a
 * replacement for the check that decides what gets enqueued. */
export const DEFAULT_EXTRACTION_BATCH_LIMIT = 200;

/** `listInboundThreadsAwaitingExtraction`'s own narrower row: every row it
 * returns is `archived = true` by construction — the query below filters
 * on it — and `inbound_thread_archived_shape` (the table's own `check()`)
 * guarantees `documentId` is never null for such a row. Narrowed once, at
 * the query boundary, rather than asking every reader (`enqueue.ts`) to
 * re-assert a fact the database already enforces. */
export type ArchivedInboundThreadRow = InboundThreadRow & { documentId: string };

export async function listInboundThreadsAwaitingExtraction(
	limit = DEFAULT_EXTRACTION_BATCH_LIMIT,
	executor: DbExecutor = db
): Promise<ArchivedInboundThreadRow[]> {
	const rows = await executor
		.select({ thread: inboundThread })
		.from(inboundThread)
		.leftJoin(proposal, eq(proposal.documentId, inboundThread.documentId))
		.where(
			and(
				eq(inboundThread.archived, true),
				isNull(proposal.id),
				// The cost guard (#380). A message archived with
				// `sender_unknown` is kept and never handed to a model, so
				// watching a whole mailbox does not mean paying for every
				// newsletter in it. Enforced here, at the one query the drain
				// reads, rather than at each caller: this is the only door into
				// extraction, so it is the only place the guard can be
				// forgotten - and it cannot be forgotten here.
				isNull(inboundThread.skipReason)
			)
		)
		.orderBy(inboundThread.receivedAt)
		.limit(limit);
	// `inbound_thread_archived_shape` is what actually guarantees this,
	// not a runtime check here — see the type's own doc comment.
	return rows.map((row) => row.thread as ArchivedInboundThreadRow);
}

/** The thread one archived message belongs to (#85). The drain needs its
 * `receivedAt`: every relative date in the message resolves against when
 * it was sent, which is a fact of the envelope rather than anything a
 * model should be asked to guess. */
export async function getInboundThreadForDocument(documentId: string, executor: DbExecutor = db) {
	const [row] = await executor
		.select()
		.from(inboundThread)
		.where(eq(inboundThread.documentId, documentId));
	return row ?? null;
}

/** Batched `getInboundThreadForDocument` (#307): every thread whose
 * source document is in `documentIds`, in one query — the review queue's
 * loaders collect the distinct document ids across a page of proposals
 * and build a `documentId -> thread` map from this instead of awaiting
 * one query per row's source document. Empty input skips the round trip
 * rather than sending `WHERE document_id IN ()`, which Postgres rejects. */
export async function getInboundThreadsForDocuments(
	documentIds: readonly string[],
	executor: DbExecutor = db
) {
	if (documentIds.length === 0) return [];
	return executor
		.select()
		.from(inboundThread)
		.where(inArray(inboundThread.documentId, documentIds));
}

/** The high-water mark `pollContractFolder` fetches from: every UID at or
 * below this, for this contract's *current* `UIDVALIDITY`, has already
 * been handed off. `null` means nothing has ever been recorded for this
 * contract under this generation — either the very first poll, or a
 * generation this contract has not seen before (a `UIDVALIDITY` bump),
 * and both cases are handled identically: start from UID 1. */
export async function maxImapUidForMailbox(
	mailbox: string,
	imapUidValidity: number,
	executor: DbExecutor = db
): Promise<number | null> {
	const [row] = await executor
		.select({ maxUid: max(inboundThread.imapUid) })
		.from(inboundThread)
		.where(
			and(eq(inboundThread.mailbox, mailbox), eq(inboundThread.imapUidValidity, imapUidValidity))
		);
	return row?.maxUid ?? null;
}

/** The `UIDVALIDITY`-bump safety net: a message already handed off under
 * an earlier generation still carries the same `Message-ID`, so this is
 * checked regardless of which generation `maxImapUidForMailbox` says is
 * current. `null` when the candidate message has no `Message-ID` header
 * at all — nothing to check against, the UID-based cursor is this
 * message's only protection.
 *
 * Keyed on the mailbox rather than the contract (#380), matching the
 * unique index: a Message-ID is unique within one mailbox's history, and
 * a message in a shared mailbox may have no contract at all. */
export async function findByMailboxAndMessageId(
	mailbox: string,
	messageId: string,
	executor: DbExecutor = db
) {
	const [row] = await executor
		.select()
		.from(inboundThread)
		.where(and(eq(inboundThread.mailbox, mailbox), eq(inboundThread.messageId, messageId)));
	return row ?? null;
}

/** Every thread handed off for one contract, newest first — used by
 * tests, and by whichever producer (#85) eventually reads pending rows
 * to invoke the runner (#82). */
export async function listInboundThreadsForContract(contractId: string, executor: DbExecutor = db) {
	return executor
		.select()
		.from(inboundThread)
		.where(eq(inboundThread.contractId, contractId))
		.orderBy(desc(inboundThread.receivedAt));
}

/** Recent skipped messages for one contract (#306), newest first — the
 * mail UI's own read: an operator scanning `/mail/contracts/[id]` for
 * "did we lose something" needs the ones this contract's poll chose not
 * to archive, each carrying `skipReason`/`messageSize` so the page can
 * render a reason a human can act on. Bounded the same way
 * `listInboundThreadsAwaitingExtraction` is — a settings page, not an
 * unbounded audit log. */
export const DEFAULT_SKIPPED_INBOUND_LIMIT = 50;

export async function listSkippedInboundThreadsForContract(
	contractId: string,
	limit = DEFAULT_SKIPPED_INBOUND_LIMIT,
	executor: DbExecutor = db
) {
	return executor
		.select()
		.from(inboundThread)
		.where(and(eq(inboundThread.contractId, contractId), eq(inboundThread.archived, false)))
		.orderBy(desc(inboundThread.receivedAt))
		.limit(limit);
}

/**
 * A row written before `sender_address` existed (#394): 407 of them on the
 * live instance, 405 from mail. `scripts/backfill-sender-address.ts` reads
 * each one's archived `From` header off disk and writes it here — see that
 * script's own header for why this cannot come from IMAP again.
 *
 * Left-joined to `document` rather than inner-joined: a row skipped as
 * `oversized` (#306) has no `documentId` at all, and `documentHash` comes
 * back null for it the same way it does for a row whose `documentId` points
 * at a document row that, for whatever reason, no longer resolves. Either
 * way there is nothing on disk to read, which is a fact the backfill script
 * counts rather than something this query decides.
 */
export type InboundThreadMissingSenderAddress = {
	id: string;
	documentId: string | null;
	documentHash: string | null;
};

export async function listInboundThreadsMissingSenderAddress(
	executor: DbExecutor = db
): Promise<InboundThreadMissingSenderAddress[]> {
	return executor
		.select({
			id: inboundThread.id,
			documentId: inboundThread.documentId,
			documentHash: document.hash
		})
		.from(inboundThread)
		.leftJoin(document, eq(document.id, inboundThread.documentId))
		.where(isNull(inboundThread.senderAddress));
}

/** Writes the address `scripts/backfill-sender-address.ts` recovered for
 * one row. Never called with null — a row the script could not recover an
 * address for is simply left alone, still selected by
 * `listInboundThreadsMissingSenderAddress` on the next run, which is what
 * makes the script idempotent without this function needing to know why a
 * previous attempt failed. */
export async function setInboundThreadSenderAddress(
	id: string,
	senderAddress: string,
	executor: DbExecutor = db
) {
	await executor.update(inboundThread).set({ senderAddress }).where(eq(inboundThread.id, id));
}

/**
 * The panel `/mail` exists for now (#394): every distinct `sender_address`
 * that wrote to the watched mailbox and matched no `client_contact`, so a
 * human can see what the product used to hide entirely. This is what would
 * have shown `leo@visumlabs.com` next to a contact recorded as
 * `leonardo@visumlabs.com` on the live instance, instead of 407 archived
 * messages nothing pointed at.
 *
 * Grouped by `senderAddress` rather than listed per message: an operator
 * needs "which addresses are being refused", not a scrollable duplicate of
 * every newsletter drop from the same list-unsubscribe sender. `null`
 * addresses (a row archived before that column existed, #394's own
 * migration) group into one row rather than one per message, for the same
 * reason - the UI names that row "unreadable" instead of pretending every
 * one is a different unknown sender.
 *
 * `lastSubject` is the subject of the *most recent* message for that
 * sender, not an aggregate - `array_agg(... order by received_at desc)` and
 * take the first element is the plain way to get a row-specific column out
 * of a `GROUP BY` in Postgres without a second query or a window function
 * spread across the whole file. Bounded the same way
 * `listSkippedInboundThreadsForContract` is: an instance can accumulate
 * thousands of refused newsletters, and this is a diagnostic panel, not an
 * unbounded audit log.
 */
export const DEFAULT_UNKNOWN_SENDER_LIMIT = 50;

export type UnknownSenderRow = {
	senderAddress: string | null;
	messageCount: number;
	lastReceivedAt: Date;
	lastSubject: string | null;
	/**
	 * Whether some contact you already have sits at this address's own
	 * domain. That is the strongest signal there is that this is a client
	 * writing from a second address rather than a newsletter, and it is
	 * evidence rather than a guess: the domain is already in the ledger.
	 */
	domainKnown: boolean;
};

export async function listUnknownSenderAddresses(
	limit = DEFAULT_UNKNOWN_SENDER_LIMIT,
	executor: DbExecutor = db
): Promise<UnknownSenderRow[]> {
	// `domainKnown` compares the part after the `@` against every contact
	// email's domain. Cheap: `client_contact` is a small table, and this
	// runs once per group rather than once per message.
	const domainKnown = sql<boolean>`exists (
		select 1 from ${clientContact}
		where split_part(${clientContact.email}, '@', 2) = split_part(${inboundThread.senderAddress}, '@', 2)
	)`.mapWith(Boolean);

	return (
		executor
			.select({
				senderAddress: inboundThread.senderAddress,
				messageCount: sql<number>`count(*)`.mapWith(Number),
				lastReceivedAt: sql<Date>`max(${inboundThread.receivedAt})`.mapWith(
					(value: string) => new Date(value)
				),
				lastSubject: sql<
					string | null
				>`(array_agg(${inboundThread.subject} order by ${inboundThread.receivedAt} desc))[1]`,
				domainKnown
			})
			.from(inboundThread)
			.where(and(eq(inboundThread.archived, true), eq(inboundThread.skipReason, 'sender_unknown')))
			.groupBy(inboundThread.senderAddress)
			// Recency was the first ordering here and it was wrong, in a way only
			// real data showed: on the live instance 133 distinct addresses had
			// written, and the one address that mattered - a client's, differing
			// from the recorded contact by `leo@` against `leonardo@` - ranked
			// **57th** by recency, outside this limit entirely. The panel built to
			// surface it would not have surfaced it. So: addresses at a domain
			// already in the ledger first, then by how much they wrote, and only
			// then by recency. A newsletter that arrived this morning is not more
			// interesting than a client who wrote eight times last week.
			.orderBy(
				sql`${domainKnown} desc`,
				sql`count(*) desc`,
				sql`max(${inboundThread.receivedAt}) desc`
			)
			.limit(limit)
	);
}
