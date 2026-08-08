import type { MinorUnits } from '$lib/money';
import { relations, sql } from 'drizzle-orm';
import { check, date, integer, numeric, pgTable, unique, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { contract } from './contract';

/**
 * An explicit, human-entered belief about what happens after a contract's
 * own known term ends (#39): the irrevocability window for a contract
 * with no end date, or the contract's own `ends_on` for one that has a
 * fixed term. Beyond that point the system has no history to infer from,
 * so it does not — this row is the recorded assumption, never a default
 * the engine invents (see `fiscal/certainty.ts`'s
 * `renewalAssumptionContribution`).
 *
 * One per contract (`contract_renewal_assumption_contract_id_unique`):
 * the row IS the current assumption, edited in place rather than
 * versioned, since it names a belief held today, not a fact that was ever
 * true. Optional — a contract with no row here projects nothing beyond
 * its known term, which is the acceptance test #39 is built around.
 *
 * All three columns are required together: a probability with no
 * horizon, or a horizon with no volume, is not a usable assumption, and
 * AGENTS.md invariant 3 ("agents propose, humans confirm") means this
 * number is the human's own estimate — the schema does not default any
 * part of it.
 */
export const contractRenewalAssumption = pgTable(
	'contract_renewal_assumption',
	{
		id: id(),
		contractId: uuid('contract_id')
			.notNull()
			.references(() => contract.id, { onDelete: 'cascade' }),
		// 0–1. The practitioner's own estimate that the contract continues
		// past its known term.
		probability: numeric('probability', { precision: 5, scale: 4, mode: 'number' }).notNull(),
		// MinorUnits: total revenue expected across the whole horizon below
		// if the contract does renew — spread across it by
		// `fiscal/certainty.ts`'s `renewalAssumptionContribution`, day by
		// day, never a second hand-rolled rate.
		expectedVolumeMinorUnits: integer('expected_volume_minor_units').$type<MinorUnits>().notNull(),
		// Inclusive: the last date this assumption still projects revenue
		// for. Required — an assumption with no horizon would forecast
		// forever, exactly the guess #39 exists to rule out.
		horizonEndsOn: date('horizon_ends_on').notNull(),
		...timestamps()
	},
	(table) => [
		unique('contract_renewal_assumption_contract_id_unique').on(table.contractId),
		check(
			'contract_renewal_assumption_probability_range',
			sql`${table.probability} >= 0 and ${table.probability} <= 1`
		),
		check(
			'contract_renewal_assumption_volume_non_negative',
			sql`${table.expectedVolumeMinorUnits} >= 0`
		)
	]
);

export const contractRenewalAssumptionRelations = relations(
	contractRenewalAssumption,
	({ one }) => ({
		contract: one(contract, {
			fields: [contractRenewalAssumption.contractId],
			references: [contract.id]
		})
	})
);
