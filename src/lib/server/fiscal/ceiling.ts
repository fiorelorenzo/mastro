// The ceiling engine (#36). One evaluator, `evaluateCeiling`, for every
// `Ceiling` regardless of `origin` — that is the acceptance test for
// AGENTS.md invariant 2: a pack ceiling and a contract ceiling coexist and
// run through the same code path, never two parallel evaluators that
// could drift apart. `ceilingFromContractRow` is the other half: it
// normalises a persisted contract ceiling into the exact same `Ceiling`
// shape a pack declares, so the evaluator never needs to know which
// origin it is looking at.

import type { LabelBundle } from './label';
import type { LegalText } from '$lib/legal/legal-text';
import {
	fiscalYearBounds,
	fiscalYearOf,
	type Ceiling,
	type CeilingAlertLevel,
	type CeilingBasis,
	type CeilingLimit,
	type CeilingMeasure,
	type FiscalYearDefinition,
	type MinorUnits
} from './pack';
import { sumLedger, type LedgerBasis, type LedgerRow } from './ledger';

const CALENDAR_YEAR: FiscalYearDefinition = { startMonth: 1, startDay: 1 };

function addDaysIso(date: string, days: number): string {
	const parsed = new Date(`${date}T00:00:00Z`);
	parsed.setUTCDate(parsed.getUTCDate() + days);
	return parsed.toISOString().slice(0, 10);
}

export interface CeilingPeriod {
	readonly from: string;
	readonly to: string;
}

/**
 * The `[from, to)` window `basis` resets over, containing `asOfDate`. The
 * `_calendar_year` bases use the plain calendar year; `contractStartsOn`
 * is required for `cash_received_contract_year` — the contract's own
 * start date becomes the anniversary the reset anchors to, reusing
 * `fiscalYearOf`/`fiscalYearBounds` exactly as a jurisdiction pack's own
 * `fiscalYear` would (a contract-year ceiling is, structurally, a
 * fiscal-year definition with no country behind it). Both those functions
 * return an inclusive `[start, end]`; every period in `fiscal/` is
 * half-open, so `end` is pushed one day to become the exclusive `to`.
 */
export function ceilingPeriod(
	basis: CeilingBasis,
	asOfDate: string,
	contractStartsOn?: string
): CeilingPeriod {
	let definition: FiscalYearDefinition;
	if (basis === 'cash_received_contract_year') {
		if (contractStartsOn === undefined) {
			throw new Error(
				`a 'cash_received_contract_year' ceiling needs the contract it belongs to, none was supplied`
			);
		}
		const anchor = new Date(`${contractStartsOn}T00:00:00Z`);
		definition = { startMonth: anchor.getUTCMonth() + 1, startDay: anchor.getUTCDate() };
	} else {
		definition = CALENDAR_YEAR;
	}
	const year = fiscalYearOf(definition, asOfDate);
	const bounds = fiscalYearBounds(definition, year);
	return { from: bounds.start, to: addDaysIso(bounds.end, 1) };
}

/** Which ledger reading a ceiling's own basis reads — a one-to-one map
 * onto `fiscal/ledger.ts`'s `LedgerBasis`, kept here rather than folded
 * into `CeilingBasis` itself because a ceiling's basis also carries the
 * reset period (calendar vs. contract year), which `LedgerBasis` does
 * not. */
function ledgerBasisOf(basis: CeilingBasis): LedgerBasis {
	return basis === 'invoiced_calendar_year' ? 'accrual' : 'cash';
}

export interface EvaluatedCeiling {
	readonly ceiling: Ceiling;
	readonly period: CeilingPeriod;
	/** The perimeter's own revenue in the period, `MinorUnits` for either
	 * measure — for `percentage_share` this is the one client's actual
	 * revenue, not a ratio. */
	readonly currentValue: MinorUnits;
	/** The ceiling expressed as a `MinorUnits` cap: `ceiling.value` itself
	 * for `absolute_amount`, or the perimeter-independent total times
	 * `ceiling.value` for `percentage_share` — so `currentValue` and
	 * `limitValue` are always directly comparable, whichever measure
	 * produced them. */
	readonly limitValue: MinorUnits;
	readonly usageRatio: number;
	readonly crossed: boolean;
	readonly activeAlertLevels: readonly CeilingAlertLevel[];
}

/**
 * `ceiling` evaluated against `rows` as of `asOfDate` — the one function
 * every ceiling, pack or contract, absolute or share, runs through.
 * `contractStartsOn` is only read when `ceiling.basis` is
 * `'cash_received_contract_year'`; every other basis ignores it.
 *
 * `rows` is the full, unfiltered ledger: this function does its own
 * perimeter filtering (`ceiling.perimeter`) rather than trusting a caller
 * to have pre-filtered it identically for both origins — that filtering
 * is exactly the part two hand-written evaluators would be most likely to
 * drift apart on.
 */
export function evaluateCeiling(
	ceiling: Ceiling,
	rows: readonly LedgerRow[],
	asOfDate: string,
	contractStartsOn?: string
): EvaluatedCeiling {
	const period = ceilingPeriod(ceiling.basis, asOfDate, contractStartsOn);
	const basis = ledgerBasisOf(ceiling.basis);

	const perimeter = ceiling.perimeter;
	const perimeterRows =
		perimeter.kind === 'client' ? rows.filter((row) => row.clientId === perimeter.clientId) : rows;
	const currentValue = sumLedger(perimeterRows, basis, period.from, period.to).amount;

	const limitValue =
		ceiling.measure === 'absolute_amount'
			? ceiling.value
			: Math.round(sumLedger(rows, basis, period.from, period.to).amount * ceiling.value);

	const usageRatio = limitValue === 0 ? 0 : currentValue / limitValue;

	return {
		ceiling,
		period,
		currentValue,
		limitValue,
		usageRatio,
		// `usageRatio`, not a raw comparison: with a zero `limitValue` (a
		// percentage-share ceiling whose denominator revenue is itself
		// zero — #40) `usageRatio` is deliberately floored at 0 above
		// rather than left as NaN, so a ceiling with nothing yet to
		// measure reads as not crossed. `currentValue >= limitValue` said
		// the opposite (0 >= 0) and reported every such ceiling crossed
		// from the first instant of the fiscal year, before a single
		// invoice existed to measure it against.
		crossed: usageRatio >= 1,
		activeAlertLevels: ceiling.alertLevels.filter((level) => usageRatio >= level.ratio)
	};
}

/** The columns a persisted contract ceiling row carries — see
 * `db/schema/ceiling.ts`. There is no `perimeter` column: a contract
 * ceiling's client is always the contract's own, read through the join in
 * `repositories/ceiling.ts`'s `listCeilingsWithContract`, never
 * duplicated here where it could drift from it. */
export interface ContractCeilingRow {
	readonly code: string;
	readonly label: LabelBundle;
	readonly legalBasis: LegalText | null;
	readonly measure: CeilingMeasure;
	readonly absoluteValueMinorUnits: number | null;
	readonly shareRatio: number | null;
	readonly basis: CeilingBasis;
	readonly alertLevels: readonly CeilingAlertLevel[];
	readonly consequence: LabelBundle;
}

/**
 * A persisted contract ceiling row, normalised into the same `Ceiling`
 * shape a pack declares (#36's "reconcile that declaration with the
 * record rather than inventing a parallel shape"). `clientId` is the
 * owning contract's own — AGENTS.md invariant 2's "a clause capping one
 * client's share of your income belongs to the contract": a contract
 * ceiling's perimeter is always that one client, never `all_clients`.
 */
export function ceilingFromContractRow(row: ContractCeilingRow, clientId: string): Ceiling {
	const limit: CeilingLimit =
		row.measure === 'absolute_amount'
			? { measure: 'absolute_amount', value: row.absoluteValueMinorUnits as MinorUnits }
			: { measure: 'percentage_share', value: row.shareRatio as number };
	return {
		id: row.code,
		origin: 'contract',
		label: row.label,
		legalBasis: row.legalBasis ?? undefined,
		basis: row.basis,
		perimeter: { kind: 'client', clientId },
		alertLevels: row.alertLevels,
		consequence: row.consequence,
		...limit
	};
}
