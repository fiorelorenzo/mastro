import { and, eq } from 'drizzle-orm';
import { readBlob, writeBlob } from '$lib/server/documents/blob-store';
import { db, type DbExecutor } from '$lib/server/db';
import { document, type DocumentOwnerType, type DocumentProvenance } from '$lib/server/db/schema';

/** Where blobs are written. Read from `process.env` directly, not
 * `$env/dynamic/private`: SvelteKit's dynamic env is a snapshot taken at
 * server start (see `src/lib/server/auth/index.ts`), so a test that wants
 * a throwaway root has to reach `process.env` itself to have any effect. */
function storageRoot(): string {
	return process.env.DOCUMENT_STORAGE_ROOT ?? 'data/documents';
}

export type DocumentInput = {
	bytes: Uint8Array;
	mime: string;
	originalName: string;
	provenance: DocumentProvenance;
	contractId: string;
	// No default on purpose: the caller must decide, from provenance and
	// contract context, at the moment of ingestion (#49's acceptance).
	confidential: boolean;
	ownerType: DocumentOwnerType;
	ownerId: string;
};

/**
 * Archives `input.bytes` and records the reference. Two calls with
 * identical bytes write the blob to disk once (see `writeBlob`) and each
 * insert their own `document` row, so the same file uploaded twice is one
 * copy on disk and two references in Postgres — #49's acceptance, proven
 * end to end in `document.test.ts`.
 *
 * Every function in this module takes an optional `executor`, defaulting
 * to the pool, so a caller — `createApproval` in `repositories/approval.ts`,
 * or a test that wants everything inside one rolled-back transaction — can
 * pass the `tx` from an ambient `db.transaction` instead.
 */
export async function storeDocument(input: DocumentInput, executor: DbExecutor = db) {
	const { hash, size } = await writeBlob(storageRoot(), input.bytes);
	const [row] = await executor
		.insert(document)
		.values({
			hash,
			size,
			mime: input.mime,
			originalName: input.originalName,
			provenance: input.provenance,
			contractId: input.contractId,
			confidential: input.confidential,
			ownerType: input.ownerType,
			ownerId: input.ownerId
		})
		.returning();
	return row;
}

export async function getDocument(id: string, executor: DbExecutor = db) {
	const [row] = await executor.select().from(document).where(eq(document.id, id));
	return row;
}

/** The reverse direction of the polymorphic link: every document currently
 * attached to one owner. */
export async function listDocumentsForOwner(
	ownerType: DocumentOwnerType,
	ownerId: string,
	executor: DbExecutor = db
) {
	return executor
		.select()
		.from(document)
		.where(and(eq(document.ownerType, ownerType), eq(document.ownerId, ownerId)));
}

export async function readDocumentBytes(doc: { hash: string }) {
	return readBlob(storageRoot(), doc.hash);
}

/** Records the id the mirror (#50) published this document under. The
 * immutability trigger (`document_forbid_retrofit`,
 * `0010_document_constraints.sql`) is the only thing that would reject
 * this write, and it explicitly leaves `remote_file_id` mutable — see
 * the comment on that column in `db/schema/document.ts`. Called only by
 * `drive/publish.ts`, after a `MirrorTarget.publish` call actually
 * succeeds; never called with a guess. */
export async function setDocumentRemoteFileId(
	id: string,
	remoteFileId: string,
	executor: DbExecutor = db
) {
	const [row] = await executor
		.update(document)
		.set({ remoteFileId })
		.where(eq(document.id, id))
		.returning();
	return row;
}
