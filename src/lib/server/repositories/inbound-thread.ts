import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { inboundThread, proposal, type InboundThreadSkipReason } from '$lib/server/db/schema';

export type InboundThreadRow = typeof inboundThread.$inferSelect;
export type InboundThreadInput = {
	contractId: string;
	documentId: string;
	mailbox: string;
	imapUidValidity: number;
	imapUid: number;
	messageId: string | null;
	subject: string | null;
	receivedAt: Date;
};

/**
 * Hands one message off (#84): archiving it as a `document` and writing
 * this row together is the entire hand-off, so `mail/poll.ts` always
 * calls this inside the same transaction as `storeDocument`. `onConflict
 * DoNothing` is the last-resort safety net behind the pre-insert checks
 * `pollContractFolder` already does (`findByContractAndMessageId`, the
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
	contractId: string;
	mailbox: string;
	imapUidValidity: number;
	imapUid: number;
	messageId: string | null;
	subject: string | null;
	receivedAt: Date;
	skipReason: InboundThreadSkipReason;
	messageSize: number;
};

/** `recordInboundThread`'s counterpart for a skipped message (#306):
 * invariant 4 means the arrival is still recorded even though the bytes
 * are not, so this writes the same row shape minus `documentId`, which
 * stays null. Same `onConflictDoNothing` safety net, same reasoning —
 * `pollContractFolder` still checks the UID high-water mark and
 * `findByContractAndMessageId` first; either unique index firing here
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
		.where(and(eq(inboundThread.archived, true), isNull(proposal.id)))
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
export async function maxImapUidForContract(
	contractId: string,
	imapUidValidity: number,
	executor: DbExecutor = db
): Promise<number | null> {
	const [row] = await executor
		.select({ maxUid: max(inboundThread.imapUid) })
		.from(inboundThread)
		.where(
			and(
				eq(inboundThread.contractId, contractId),
				eq(inboundThread.imapUidValidity, imapUidValidity)
			)
		);
	return row?.maxUid ?? null;
}

/** The `UIDVALIDITY`-bump safety net: a message already handed off under
 * an earlier generation still carries the same `Message-ID`, so this is
 * checked regardless of which generation `maxImapUidForContract` says is
 * current. `null` when the candidate message has no `Message-ID` header
 * at all — nothing to check against, the UID-based cursor is this
 * message's only protection. */
export async function findByContractAndMessageId(
	contractId: string,
	messageId: string,
	executor: DbExecutor = db
) {
	const [row] = await executor
		.select()
		.from(inboundThread)
		.where(and(eq(inboundThread.contractId, contractId), eq(inboundThread.messageId, messageId)));
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
