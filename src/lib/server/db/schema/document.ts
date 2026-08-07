import { relations } from 'drizzle-orm';
import { boolean, integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { contract } from './contract';

export const documentProvenance = pgEnum('document_provenance', [
	'folder_import',
	'mail',
	'upload',
	'generated'
]);
export type DocumentProvenance = (typeof documentProvenance.enumValues)[number];

/**
 * Who or what a document is evidence for. A plain, CHECK-constrained text
 * column rather than a Postgres enum, on purpose: widening a CHECK
 * constraint's allowed list when a new owner lands is a metadata-only
 * change that touches no existing row — unlike `ALTER TYPE ... ADD VALUE`,
 * whose new value cannot even be used inside the transaction that adds it.
 * `invoice` was added in #44, once the `invoice` table (#26) existed to
 * validate it against: the structured document an import parses and any
 * PDF attached alongside it (a re-issue, a scan of the signed original)
 * both land here, owned by the invoice they evidence. `expense` does not
 * exist yet and stays out of this list until it does. See the
 * accompanying custom migration for the constraint and the trigger that
 * validates `ownerId` actually exists for `ownerType`.
 */
export type DocumentOwnerType = 'contract' | 'approval' | 'invoice';

/**
 * Content-addressed storage on disk (`src/lib/server/documents/blob-store.ts`),
 * metadata here (#49). `hash` is the sha256 of the bytes: it gives both
 * deduplication — identical bytes are never written to disk twice, see
 * `storeDocument` in `src/lib/server/repositories/document.ts` — and an
 * integrity check. Several `document` rows can share one `hash`, each its
 * own reference with its own owner, provenance and original name: "the
 * same file uploaded twice is one copy [on disk] and two references
 * [rows]" is the acceptance this table exists to satisfy.
 *
 * `ownerType`/`ownerId` is the polymorphic link to the entity a document
 * evidences (see `DocumentOwnerType`). `contractId` is a separate,
 * always-present column: every document belongs to a contract for scoping
 * even when what it specifically evidences is an approval, not the
 * contract itself.
 *
 * `confidential` is required, with no default, and no repository function
 * ever changes it after creation: the decision is made once, by the
 * caller, at ingestion time, from provenance and contract context — never
 * retrofitted (#49's acceptance). The accompanying custom migration adds a
 * trigger enforcing that every column here except `ownerType`, `ownerId`
 * and `remoteFileId` is immutable once written, so that rule cannot be
 * bypassed by a future write path either.
 */
export const document = pgTable('document', {
	id: id(),
	hash: text('hash').notNull(),
	mime: text('mime').notNull(),
	size: integer('size').notNull(),
	originalName: text('original_name').notNull(),
	provenance: documentProvenance('provenance').notNull(),
	contractId: uuid('contract_id')
		.notNull()
		.references(() => contract.id, { onDelete: 'restrict' }),
	confidential: boolean('confidential').notNull(),
	ownerType: text('owner_type').notNull().$type<DocumentOwnerType>(),
	ownerId: uuid('owner_id').notNull(),
	// Populated once the drive mirror (#50, out of scope here) publishes a
	// copy; null until then, and the only evidentiary-adjacent column the
	// immutability trigger lets a later write touch.
	remoteFileId: text('remote_file_id'),
	...timestamps()
});

export const documentRelations = relations(document, ({ one }) => ({
	contract: one(contract, { fields: [document.contractId], references: [contract.id] })
}));
