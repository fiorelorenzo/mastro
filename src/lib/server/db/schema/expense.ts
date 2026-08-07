import { relations } from 'drizzle-orm';
import { boolean, date, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { contract } from './contract';
import { invoiceLine } from './invoice';

/**
 * A pre-authorised (or not) expense on a contract (#28). `amount` is
 * `MinorUnits` (integer cents), same convention as `invoice`/`invoice_line`
 * — never a float.
 *
 * `preAuthorised`/`authorisationReference` record whether, and by what
 * written reference, the expense was cleared before it was incurred —
 * `authorisationReference` is freeform (a message date, a clause, an email
 * subject line: whatever the actual proof was), not a foreign key, the
 * same treatment `contract.signedDocumentReference` gives a reference that
 * is evidence rather than a row this schema owns.
 *
 * `reimbursable` is never set by application code: the accompanying custom
 * migration's trigger computes it from `preAuthorised` against the owning
 * contract's `requiresExpensePreAuthorisation`/`expensePolicy` on every
 * insert or update, the same way `work_unit_enforce_state_machine` decides
 * `worked_without_approval` — an expense that fails the check is still
 * recorded, flagged, never silently accepted or rejected outright.
 *
 * The receipt is a `document` owned by this row (`ownerType: 'expense'`,
 * widened onto the existing polymorphic link rather than a parallel
 * column) — see `listDocumentsForOwner`. `invoiceLineId` is where a
 * rebilled expense lands, reusing `invoice_line` exactly as `work_unit`
 * does; the accompanying migration's trigger forbids moving it once set,
 * so an expense already rebilled cannot be rebilled onto a second line.
 */
export const expense = pgTable('expense', {
	id: id(),
	contractId: uuid('contract_id')
		.notNull()
		.references(() => contract.id, { onDelete: 'restrict' }),
	date: date('date').notNull(),
	description: text('description').notNull(),
	amount: integer('amount').notNull(),
	preAuthorised: boolean('pre_authorised').notNull().default(false),
	authorisationReference: text('authorisation_reference'),
	reimbursable: boolean('reimbursable').notNull().default(true),
	invoiceLineId: uuid('invoice_line_id').references(() => invoiceLine.id, {
		onDelete: 'restrict'
	}),
	...timestamps()
});

export const expenseRelations = relations(expense, ({ one }) => ({
	contract: one(contract, { fields: [expense.contractId], references: [contract.id] }),
	invoiceLine: one(invoiceLine, { fields: [expense.invoiceLineId], references: [invoiceLine.id] })
}));
