import { and, asc, desc, eq, isNull } from 'drizzle-orm';
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

/** Every document not yet mirrored — what a future scheduled publish run
 * would work through, oldest first. */
export async function listUnmirroredDocuments(executor: DbExecutor = db) {
	return executor
		.select()
		.from(document)
		.where(isNull(document.remoteFileId))
		.orderBy(asc(document.createdAt));
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
