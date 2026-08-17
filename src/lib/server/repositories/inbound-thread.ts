import { and, desc, eq, inArray, max } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { inboundThread } from '$lib/server/db/schema';

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

/** Every archived message, oldest first. The extraction enqueuer (#85)
 * walks these and skips the ones already proposed from; ordering by
 * arrival means the oldest unread message is queued first, which is the
 * order a person would have read them in. */
export async function listInboundThreadsAwaitingExtraction(executor: DbExecutor = db) {
	return executor.select().from(inboundThread).orderBy(inboundThread.receivedAt);
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
