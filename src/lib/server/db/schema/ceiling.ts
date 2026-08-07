import { relations, sql } from 'drizzle-orm';
import {
	check,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	text,
	unique,
	uuid
} from 'drizzle-orm/pg-core';
import type { LegalText } from '$lib/legal/legal-text';
import type { LabelBundle } from '$lib/server/fiscal/label';
import type { CeilingAlertLevel, CeilingBasis, CeilingMeasure } from '$lib/server/fiscal/pack';
import { id, timestamps } from '../columns';
import { contract } from './contract';

/**
 * Mirrors `CeilingMeasure` in `$lib/server/fiscal/pack.ts` — the
 * discriminant `Ceiling`'s `measure`/`value` union carries. `satisfies`
 * fails the build if the two ever drift.
 */
const ceilingMeasureValues = [
	'absolute_amount',
	'percentage_share'
] as const satisfies readonly CeilingMeasure[];
export const ceilingMeasure = pgEnum('ceiling_measure', ceilingMeasureValues);

/** Mirrors `CeilingBasis` in `$lib/server/fiscal/pack.ts`, same reason. */
const ceilingBasisValues = [
	'cash_received_calendar_year',
	'invoiced_calendar_year',
	'cash_received_contract_year'
] as const satisfies readonly CeilingBasis[];
export const ceilingBasis = pgEnum('ceiling_basis', ceilingBasisValues);

/**
 * A revenue ceiling a contract itself imposes (#36) — AGENTS.md invariant
 * 2's "a clause capping one client's share of your income belongs to the
 * contract and survives any change of regime." Only ever `'contract'`
 * origin rows land here: a pack ceiling stays code-declared on
 * `FiscalPack.ceilings`, precisely so switching a fiscal profile changes
 * which ones apply with no code change (see `fiscal/ceiling.ts`'s module
 * comment) — persisting it here as well would duplicate that declaration
 * and let the two drift.
 *
 * There is no `perimeter`/`client_id` column: a contract ceiling's client
 * is always the owning contract's own (`repositories/ceiling.ts`'s
 * `listCeilingsWithContract` joins it), never a separate value that could
 * disagree with it.
 *
 * `measure` decides which of `absolute_value_minor_units` / `share_ratio`
 * is populated — enforced by `ceiling_value_matches_measure` in the
 * accompanying custom migration, the same conditional-column pattern
 * `contract.renewal_notice_days` already uses for `renewal_type`.
 */
export const ceiling = pgTable(
	'ceiling',
	{
		id: id(),
		contractId: uuid('contract_id')
			.notNull()
			.references(() => contract.id, { onDelete: 'restrict' }),
		// A stable slug, unique per contract — what `Ceiling.id` reads once
		// normalised (`ceilingFromContractRow`), the same role a pack
		// ceiling's own `id` plays.
		code: text('code').notNull(),
		label: jsonb('label').$type<LabelBundle>().notNull(),
		legalBasis: jsonb('legal_basis').$type<LegalText>(),
		measure: ceilingMeasure('measure').notNull(),
		absoluteValueMinorUnits: integer('absolute_value_minor_units'),
		shareRatio: numeric('share_ratio', { precision: 5, scale: 4, mode: 'number' }),
		basis: ceilingBasis('basis').notNull(),
		alertLevels: jsonb('alert_levels').$type<readonly CeilingAlertLevel[]>().notNull().default([]),
		consequence: jsonb('consequence').$type<LabelBundle>().notNull(),
		...timestamps()
	},
	(table) => [
		unique('ceiling_contract_code_unique').on(table.contractId, table.code),
		check(
			'ceiling_value_matches_measure',
			sql`(${table.measure} = 'absolute_amount' and ${table.absoluteValueMinorUnits} is not null and ${table.shareRatio} is null)
				or (${table.measure} = 'percentage_share' and ${table.shareRatio} is not null and ${table.absoluteValueMinorUnits} is null)`
		),
		check(
			'ceiling_absolute_value_non_negative',
			sql`${table.absoluteValueMinorUnits} is null or ${table.absoluteValueMinorUnits} >= 0`
		),
		check(
			'ceiling_share_ratio_range',
			sql`${table.shareRatio} is null or (${table.shareRatio} > 0 and ${table.shareRatio} <= 1)`
		)
	]
);

export const ceilingRelations = relations(ceiling, ({ one }) => ({
	contract: one(contract, { fields: [ceiling.contractId], references: [contract.id] })
}));
