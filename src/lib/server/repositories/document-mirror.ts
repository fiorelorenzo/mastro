import { and, asc, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import {
	client,
	contract,
	document,
	documentMirrorRun,
	type DocumentMirrorRunStatus
} from '$lib/server/db/schema';

/**
 * A document plus the client its contract belongs to — everything
 * `drive/publish.ts` needs to resolve a `MirrorFolder`
 * (`drive/folder.ts`) and publish, in one query so it runs inside a
 * caller's own transaction (`executor`) instead of a second, separate
 * connection that would not see an uncommitted document yet.
 */
export async function getDocumentMirrorContext(documentId: string, executor: DbExecutor = db) {
	const [row] = await executor
		.select({ document, clientLegalName: client.legalName })
		.from(document)
		.innerJoin(contract, eq(document.contractId, contract.id))
		.innerJoin(client, eq(contract.clientId, client.id))
		.where(eq(document.id, documentId));
	return row ?? null;
}

/** Every document not yet mirrored *and* attributable — what a future
 * scheduled publish run would work through, oldest first.
 *
 * A document whose `contract_id` is still null is not "unmirrored", it is
 * "not yet attributable": `contract_id` was made nullable on purpose
 * (#380) for the window between a message arriving and someone claiming
 * it, and `getDocumentMirrorContext` below already requires a contract
 * through its `innerJoin` to resolve a client folder to publish into.
 * Before this fix the queue did not share that requirement, so it handed
 * the publisher documents it could structurally never place — every one
 * of them failed with "document <id> not found" and the job reported
 * `partial_failure` forever (#393). The filter belongs here, in the
 * queue, rather than only in the publisher: a document with no contract
 * is not a candidate to try and fail, it is not a candidate at all, and
 * the caller should never see it offered. `countUnattributedPendingDocuments`
 * below is what keeps this exclusion countable instead of merely making
 * documents disappear. */
export const DEFAULT_MIRROR_BATCH_LIMIT = 100;

export async function listUnmirroredDocuments(
	limit = DEFAULT_MIRROR_BATCH_LIMIT,
	executor: DbExecutor = db
) {
	return executor
		.select()
		.from(document)
		.where(and(isNull(document.remoteFileId), isNotNull(document.contractId)))
		.orderBy(asc(document.createdAt))
		.limit(limit);
}

/** How many documents are sitting unmirrored *because* nothing has
 * attributed them yet — the count `listUnmirroredDocuments` above
 * silently excludes. Exposed so a caller (the publish route, a future
 * dashboard) can report this as a named, expected state rather than
 * leaving those documents merely missing from every count: "0 failed"
 * must not read as "everything is fine" when 407 documents are stuck
 * waiting for a human to attribute them. */
export async function countUnattributedPendingDocuments(executor: DbExecutor = db) {
	const [row] = await executor
		.select({ value: count() })
		.from(document)
		.where(and(isNull(document.remoteFileId), isNull(document.contractId)));
	return row?.value ?? 0;
}

export type MirrorRunInput = {
	documentId: string;
	status: DocumentMirrorRunStatus;
	detail: string | null;
};

/** Records one publish attempt. This is the only thing that makes a
 * failed publish visible instead of an unhandled rejection nobody sees —
 * see the doc comment on `document_mirror_run`
 * (`db/schema/document-mirror.ts`) for the alert-engine query shape #74
 * is meant to run against it. */
export async function recordMirrorRun(input: MirrorRunInput, executor: DbExecutor = db) {
	const [row] = await executor
		.insert(documentMirrorRun)
		.values({ documentId: input.documentId, status: input.status, detail: input.detail })
		.returning();
	return row;
}

/** The most recent run for a document, or `null` if it has never been
 * attempted — used by tests, and by whatever eventually builds #74's
 * feed to show a human the last thing that happened for one document. */
export async function getLatestMirrorRun(documentId: string, executor: DbExecutor = db) {
	const [row] = await executor
		.select()
		.from(documentMirrorRun)
		.where(eq(documentMirrorRun.documentId, documentId))
		.orderBy(desc(documentMirrorRun.createdAt));
	return row ?? null;
}

/** Unacknowledged failures, newest first — #74's own alert-engine query
 * (see `document_mirror_run`'s doc comment), exposed here so #74 has a
 * tested function to call instead of hand-writing the query again. */
export async function listUnacknowledgedMirrorFailures(executor: DbExecutor = db) {
	return executor
		.select()
		.from(documentMirrorRun)
		.where(and(eq(documentMirrorRun.status, 'failure'), isNull(documentMirrorRun.acknowledgedAt)))
		.orderBy(desc(documentMirrorRun.createdAt));
}
