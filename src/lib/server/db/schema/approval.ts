import { relations } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { noticeChannel } from './client';
import { contract } from './contract';
import { document } from './document';

/**
 * How an approval came to exist: typed by a human reading the mailbox
 * (`manual`), or by the ACP runner proposing an interpretation that a
 * human then confirmed (`agent`, invariant 3 — the runner itself never
 * writes here). `proposalReference` is a `proposal.id` (#83,
 * `db/schema/proposal.ts`), kept as data here rather than a foreign key,
 * the same way `document.ownerId` is: nothing in this table's own
 * lifecycle depends on that row still existing.
 */
export type ApprovalOrigin = { kind: 'manual' } | { kind: 'agent'; proposalReference: string };

/**
 * Evidence, not a form a human fills in (#22). `documentId` is the
 * archived original (`.eml` or PDF, see `document`) this approval
 * interprets; `excerpt` is the verbatim text the interpretation rests on.
 * Immutable after creation — enforced by a trigger in the accompanying
 * custom migration, not by convention: a correction is a new approval,
 * never an edit.
 *
 * The days it covers are not a column here: they are `work_unit` rows
 * whose `approvalId` points back at this row, read from the other side —
 * one approval can cover several days, of different quantities, without
 * this table changing shape.
 */
export const approval = pgTable('approval', {
	id: id(),
	contractId: uuid('contract_id')
		.notNull()
		.references(() => contract.id, { onDelete: 'restrict' }),
	channel: noticeChannel('channel').notNull(),
	sender: text('sender').notNull(),
	receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
	// Present for email (the Message-ID header); absent for a channel with
	// no equivalent, e.g. certified mail.
	messageId: text('message_id'),
	documentId: uuid('document_id')
		.notNull()
		.references(() => document.id, { onDelete: 'restrict' }),
	excerpt: text('excerpt').notNull(),
	origin: jsonb('origin').$type<ApprovalOrigin>().notNull(),
	...timestamps()
});

export const approvalRelations = relations(approval, ({ one }) => ({
	contract: one(contract, { fields: [approval.contractId], references: [contract.id] }),
	document: one(document, { fields: [approval.documentId], references: [document.id] })
}));
