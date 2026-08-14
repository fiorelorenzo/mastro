import { relations, sql } from 'drizzle-orm';
import { boolean, check, integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
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
 * column rather than a Postgres enum — the same reasoning as
 * `document.ownerType` (see that file's doc comment): widening the list is
 * a metadata-only change that touches no existing row — unlike
 * `ALTER TYPE ... ADD VALUE`, whose new value cannot even be used inside
 * the transaction that adds it. `expense` was added in #28 and `invoice`
 * in #44, each once the table it points at existed to validate against:
 * for an invoice, the structured document an import parses and any PDF
 * attached alongside it (a re-issue, a scan of the signed original) both
 * land here, owned by the invoice they evidence. See the accompanying
 * custom migrations for the constraint and the trigger that validates
 * `ownerId` actually exists for `ownerType`.
 */
export type DocumentOwnerType = 'contract' | 'approval' | 'expense' | 'invoice';

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
 *
 * `contractId`/`ownerType`/`ownerId` are nullable together, and only
 * together (#86): a contract's own founding PDF has no contract row yet
 * to be scoped by or owned by — that row is what accepting the proposal
 * this document backs creates. Such a document is genuinely unclaimed
 * from the moment it is archived until that accept happens; the
 * accompanying custom migration's CHECK enforces that all three are null
 * or none are, and widens the immutability trigger to allow exactly one
 * further transition: `contractId` moving from null to the contract the
 * accept just created (never from one contract to another). Every other
 * document — everything mail-polled, folder-imported or uploaded against
 * a contract that already exists — still has both set from the moment it
 * is archived, unchanged from before.
 */
export const document = pgTable(
	'document',
	{
		id: id(),
		hash: text('hash').notNull(),
		mime: text('mime').notNull(),
		size: integer('size').notNull(),
		originalName: text('original_name').notNull(),
		provenance: documentProvenance('provenance').notNull(),
		contractId: uuid('contract_id').references(() => contract.id, { onDelete: 'restrict' }),
		confidential: boolean('confidential').notNull(),
		ownerType: text('owner_type').$type<DocumentOwnerType>(),
		ownerId: uuid('owner_id'),
		// Populated once the drive mirror (#50, out of scope here) publishes a
		// copy; null until then, and the only evidentiary-adjacent column the
		// immutability trigger lets a later write touch.
		remoteFileId: text('remote_file_id'),
		...timestamps()
	},
	(table) => [
		check(
			'document_unclaimed_together',
			sql`(${table.contractId} is null and ${table.ownerType} is null and ${table.ownerId} is null)
				or (${table.contractId} is not null and ${table.ownerType} is not null and ${table.ownerId} is not null)`
		)
	]
);

export const documentRelations = relations(document, ({ one }) => ({
	contract: one(contract, { fields: [document.contractId], references: [contract.id] })
}));
