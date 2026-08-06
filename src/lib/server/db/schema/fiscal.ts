import { sql } from 'drizzle-orm';
import { check, date, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';

/** A profitability-coefficient override tied to an activity code: the
 * taxpayer's own figure, supplied because the pack does not default one. */
export interface ProfitabilityCoefficientOverride {
	readonly activityCode: string;
	readonly rate: number;
}

/**
 * Taxpayer-specific parameters a pack reads but never defaults itself —
 * configuration, not a value baked into the pack. Packs read whichever
 * keys they declare a need for; unrecognised keys are carried through
 * untouched rather than rejected, so one taxpayer's override does not
 * require every pack to know about it.
 */
export interface FiscalProfileOverrides {
	readonly profitabilityCoefficient?: ProfitabilityCoefficientOverride;
	readonly [key: string]: unknown;
}

/**
 * The taxpayer's regime over time. `pack_id`/`pack_version` name a pack
 * registered in `src/lib/server/fiscal/registry.ts`; this table does not
 * reference the registry, since a pack is code shipped with the app, not a
 * row that can be joined against. `valid_to` null means "still current".
 *
 * Two profiles must never cover the same instant. That is enforced by an
 * exclusion constraint this file cannot express — Drizzle has no generated
 * range column or `EXCLUDE` builder — so it lives in a hand-written
 * migration alongside this table's `set_updated_at` trigger.
 */
export const fiscalProfile = pgTable(
	'fiscal_profile',
	{
		id: id(),
		packId: text('pack_id').notNull(),
		packVersion: text('pack_version').notNull(),
		validFrom: date('valid_from', { mode: 'string' }).notNull(),
		validTo: date('valid_to', { mode: 'string' }),
		overrides: jsonb('overrides').$type<FiscalProfileOverrides>().notNull().default({}),
		...timestamps()
	},
	(table) => [
		check(
			'fiscal_profile_valid_range',
			sql`${table.validTo} is null or ${table.validFrom} < ${table.validTo}`
		)
	]
);
