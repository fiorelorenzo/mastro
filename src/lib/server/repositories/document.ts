import { and, eq, inArray } from 'drizzle-orm';
import { readBlob, writeBlob } from '$lib/server/documents/blob-store';
import { db, type DbExecutor } from '$lib/server/db';
import { document, type DocumentOwnerType, type DocumentProvenance } from '$lib/server/db/schema';

export type DocumentRow = typeof document.$inferSelect;

/** Where blobs are written. Read from `process.env` directly, not
 * `$env/dynamic/private`: SvelteKit's dynamic env is a snapshot taken at
 * server start (see `src/lib/server/auth/index.ts`), so a test that wants
 * a throwaway root has to reach `process.env` itself to have any effect. */
function storageRoot(): string {
	return process.env.DOCUMENT_STORAGE_ROOT ?? 'data/documents';
}

const DEFAULT_MAX_DOCUMENT_BYTES = 50 * 1024 * 1024; // 50 MiB

/** The blob store's own ceiling (#306), independent of every caller.
 * `mail/poll.ts` already refuses to buffer an oversized message before
 * this point (`IMAP_MAX_MESSAGE_BYTES`), but that check lives in one
 * caller — this one holds regardless of what a future caller forgets to
 * check first, which is the whole reason step 4 of #306 exists. Read
 * from `process.env` directly, same reasoning as `storageRoot()` above:
 * a test overrides it without a server restart. */
function maxDocumentBytes(): number {
	const raw = process.env.DOCUMENT_MAX_BYTES;
	if (!raw) return DEFAULT_MAX_DOCUMENT_BYTES;
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`DOCUMENT_MAX_BYTES must be a positive number, got: ${raw}`);
	}
	return value;
}

/** Thrown by `storeDocument` when `input.bytes` is over `maxDocumentBytes()`
 * — checked before `writeBlob` ever hashes or writes anything, so an
 * oversized call costs one length check, never a disk write. */
export class DocumentTooLargeError extends Error {
	constructor(size: number, limit: number) {
		super(`document is ${size} bytes, over the ${limit}-byte DOCUMENT_MAX_BYTES limit`);
		this.name = 'DocumentTooLargeError';
	}
}

export type DocumentInput = {
	bytes: Uint8Array;
	mime: string;
	originalName: string;
	provenance: DocumentProvenance;
	// Null only for a first-intake contract PDF (#86): the document is
	// archived before the contract it will belong to exists, and stays
	// unclaimed — `contractId`/`ownerType`/`ownerId` all null together —
	// until `claimDocumentForContract` below points it at the contract
	// accepting its proposal creates.
	contractId: string | null;
	// No default on purpose: the caller must decide, from provenance and
	// contract context, at the moment of ingestion (#49's acceptance).
	confidential: boolean;
	ownerType: DocumentOwnerType | null;
	ownerId: string | null;
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
	const limit = maxDocumentBytes();
	if (input.bytes.byteLength > limit) {
		throw new DocumentTooLargeError(input.bytes.byteLength, limit);
	}
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

/** Batched `getDocument` (#307): every document in `ids`, in one query —
 * the review queue's loaders collect the distinct source document ids
 * across a page of proposals and build an `id -> document` map from this
 * instead of awaiting one query per row. Empty input skips the round
 * trip rather than sending `WHERE id IN ()`, which Postgres rejects. */
export async function getDocuments(ids: readonly string[], executor: DbExecutor = db) {
	if (ids.length === 0) return [];
	return executor.select().from(document).where(inArray(document.id, ids));
}

/**
 * Claims an unclaimed document (#86): points a first-intake document at
 * the contract that accepting its own proposal just created, in the same
 * transaction as that insert. `document_forbid_retrofit`
 * (`drizzle/0052_contract_proposal_first_intake.sql`) is the actual
 * enforcement — it allows `contract_id` to move exactly once, from null,
 * and rejects re-pointing an already-claimed document to a different
 * contract — this function does not re-check that itself.
 */
export async function claimDocumentForContract(
	documentId: string,
	contractId: string,
	executor: DbExecutor = db
) {
	const [row] = await executor
		.update(document)
		.set({ contractId, ownerType: 'contract', ownerId: contractId })
		.where(eq(document.id, documentId))
		.returning();
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

/** The subset of a `document` row every loader hands to `SourceDocument`
 * (`$lib/design/SourceDocument.svelte`) — id, original file name, kind
 * and archive date, `createdAt` serialised the way every loader here
 * already serialises a `Date` column for the client. One function so
 * the several call sites this wave adds (#215: the day, proposal,
 * invoice, expense and contract loaders) agree on the shape rather than
 * each inlining its own pick. */
export function toSourceDocumentValue(doc: {
	id: string;
	originalName: string;
	provenance: DocumentProvenance;
	createdAt: Date;
}) {
	return {
		id: doc.id,
		originalName: doc.originalName,
		provenance: doc.provenance,
		createdAt: doc.createdAt.toISOString()
	};
}
