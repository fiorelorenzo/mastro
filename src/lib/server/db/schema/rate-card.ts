import { relations } from 'drizzle-orm';
import { date, numeric, pgEnum, pgTable, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { contract } from './contract';

export const rateCardKind = pgEnum('rate_card_kind', [
	'fixed_recurring',
	'daily',
	'hourly',
	'one_off'
]);
export type RateCardKind = (typeof rateCardKind.enumValues)[number];

/** What `amount` is denominated per. */
export const rateUnit = pgEnum('rate_unit', ['hour', 'day', 'month', 'year', 'lump_sum']);
export type RateUnit = (typeof rateUnit.enumValues)[number];

/** How a `fixed_recurring` amount is split into invoices, e.g. an annual fee
 * paid monthly. Meaningless, and forbidden by CHECK, for any other kind. */
export const disbursementPeriod = pgEnum('disbursement_period', [
	'monthly',
	'quarterly',
	'annual',
	'one_time'
]);
export type DisbursementPeriod = (typeof disbursementPeriod.enumValues)[number];

/**
 * A contract's price is not one number. `rate_card` carries whichever
 * number applies for a `kind`, over a validity period, so a rate change at
 * renewal is a new card, not a new contract.
 *
 * Adjacent validity periods (one ending the day before the next starts)
 * resolve unambiguously; overlapping periods are rejected — in the
 * database, by the exclusion constraint in the accompanying custom
 * migration, per AGENTS.md: this is exactly the rule that belongs in SQL,
 * not only in application code.
 */
export const rateCard = pgTable('rate_card', {
	id: id(),
	contractId: uuid('contract_id')
		.notNull()
		.references(() => contract.id, { onDelete: 'restrict' }),
	validFrom: date('valid_from').notNull(),
	// Open (current) card when null.
	validTo: date('valid_to'),
	kind: rateCardKind('kind').notNull(),
	amount: numeric('amount', { precision: 12, scale: 2, mode: 'number' }).notNull(),
	unit: rateUnit('unit').notNull(),
	// A half day at half the fee: [1, 0.5]. Defaults to [1] (no fractions
	// accepted) at the repository layer, never implicitly in the database.
	allowedFractions: numeric('allowed_fractions', { precision: 4, scale: 2, mode: 'number' })
		.array()
		.notNull(),
	// Only meaningful, and only allowed by CHECK, for `hourly`. Validates an
	// entry; it never runs a stopwatch.
	minimumHours: numeric('minimum_hours', { precision: 6, scale: 2, mode: 'number' }),
	disbursementPeriod: disbursementPeriod('disbursement_period'),
	...timestamps()
});

export const rateCardRelations = relations(rateCard, ({ one }) => ({
	contract: one(contract, { fields: [rateCard.contractId], references: [contract.id] })
}));
