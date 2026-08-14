import type { MinorUnits } from '$lib/money';
import { relations, sql } from 'drizzle-orm';
import { check, date, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { invoice } from './invoice';

/**
 * One payment against an invoice (#212). An invoice's paid state is
 * *derived* from the sum of its rows here rather than stored as a single
 * date — a client who pays half is a second row away from a client who
 * pays the rest, not an unrepresentable state the old `invoice.paid_on`
 * (a plain nullable date, removed by this migration) could never hold.
 *
 * `amount` is always positive: a partial payment is still money received,
 * and a refund (never modelled — nothing in this codebase issues one) would
 * be its own kind of row, not a negative payment silently netting one out.
 * `method`/`reference` are freeform, the same "whatever the actual proof
 * was, never a foreign key into something this schema does not own"
 * treatment `expense.authorisationReference` already gives evidence that
 * is not itself a row this schema owns.
 *
 * `src/lib/server/domain/invoice.ts`'s `computeInvoiceBalance` is the one
 * place a total plus this table's rows become "paid / remaining /
 * settled" — every reader (the ageing list, the ledger, the dunning
 * draft, the invoice screens, the dashboard, the seed) goes through it or
 * through `repositories/invoice.ts`'s own wrapping of it, never a second,
 * ad hoc sum.
 */
export const payment = pgTable(
	'payment',
	{
		id: id(),
		invoiceId: uuid('invoice_id')
			.notNull()
			.references(() => invoice.id, { onDelete: 'cascade' }),
		amount: integer('amount').$type<MinorUnits>().notNull(),
		date: date('date').notNull(),
		method: text('method'),
		reference: text('reference'),
		...timestamps()
	},
	(table) => [check('payment_amount_positive', sql`${table.amount} > 0`)]
);

export const paymentRelations = relations(payment, ({ one }) => ({
	invoice: one(invoice, { fields: [payment.invoiceId], references: [invoice.id] })
}));
