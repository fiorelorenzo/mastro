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
	type FiscalYearDefinition
} from './pack';
import { NO_MINOR_UNITS, scaleMinorUnits, sumMinorUnits, type MinorUnits } from '$lib/money';
import {
	sumLedger,
	sumLedgerAcrossPeriods,
	type LedgerBasis,
	type LedgerPeriod,
	type LedgerRow
} from './ledger';

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
 * The regime a **pack** ceiling belongs to, when the caller knows it
 * (`fiscal/ceiling-status.ts` does; a pure unit test evaluating one
 * declaration in isolation does not, and does not need to).
 *
 * A pack ceiling measures only what its own regime recognised (#336,
 * decided on the #324 spike). Its reset period is a whole fiscal year,
 * but a `fiscal_profile` boundary can fall inside that year, and the
 * revenue on the far side of the boundary belonged to a different
 * regime's cap — a cap that, per AGENTS.md invariant 2, no longer exists.
 * Summing the whole year regardless would charge this regime for revenue
 * it never governed.
 *
 * `periods` is the resolved sub-periods over the ceiling's own window
 * (`resolveFiscalPackOverRange`), and `packId` says which of them is
 * this ceiling's own. Attribution then reuses `sumLedgerAcrossPeriods`
 * rather than re-deriving it: that function already reads each
 * sub-period under the pack that governed it and, where the origin pack
 * declares `unresolvedRevenue: 'carries_forward'`, keeps a payment that
 * arrives after the boundary attributed to the pack that issued the
 * invoice. That is exactly what Legge 190/2014 comma 72 requires of the
 * Italian flat-rate regime, and it is why the fix is a different
 * summation rather than a date filter: clipping by payment date alone
 * would hand a pre-boundary invoice's later payment to the new regime.
 *
 * A contract ceiling never receives this: a clause capping one client's
 * share of income follows the counterparty, not the money, and survives
 * any change of regime (invariant 2).
 */
export interface CeilingRegime {
	readonly packId: string;
	readonly periods: readonly LedgerPeriod[];
}

/** `periods` clipped to `[from, to)`, dropping the ones that fall wholly
 * outside it, so a ceiling's own window is what gets measured rather than
 * the whole range the periods were resolved over. */
function clipPeriods(
	periods: readonly LedgerPeriod[],
	from: string,
	to: string
): readonly LedgerPeriod[] {
	return periods
		.filter((period) => period.from < to && period.to > from)
		.map((period) => ({
			...period,
			from: period.from > from ? period.from : from,
			to: period.to < to ? period.to : to
		}));
}

/** What `regime`'s own pack recognised out of `rows` over the ceiling's
 * window — the sum of every sub-figure `sumLedgerAcrossPeriods` attributed
 * to that pack, carry-forward figures included, since those carry the
 * origin pack's id precisely so this reading is possible. */
function regimeAttributedAmount(
	rows: readonly LedgerRow[],
	regime: CeilingRegime,
	from: string,
	to: string
): MinorUnits {
	const periods = clipPeriods(regime.periods, from, to);
	if (periods.length === 0) return NO_MINOR_UNITS;
	const figure = sumLedgerAcrossPeriods(rows, periods);
	return sumMinorUnits(
		figure.subFigures.filter((sub) => sub.packId === regime.packId).map((sub) => sub.amount)
	);
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
 *
 * `regime` narrows a **pack** ceiling to what its own regime recognised;
 * see {@link CeilingRegime}. Omitted, or given for a contract ceiling,
 * the whole period is summed under the ceiling's own basis, which is the
 * only correct reading for a contract clause and the historical one for
 * every caller that has no profile to resolve.
 */
export function evaluateCeiling(
	ceiling: Ceiling,
	rows: readonly LedgerRow[],
	asOfDate: string,
	contractStartsOn?: string,
	regime?: CeilingRegime
): EvaluatedCeiling {
	const period = ceilingPeriod(ceiling.basis, asOfDate, contractStartsOn);
	const basis = ledgerBasisOf(ceiling.basis);
	const regimeAware = regime !== undefined && ceiling.origin === 'pack';

	const perimeter = ceiling.perimeter;
	const perimeterRows =
		perimeter.kind === 'client' ? rows.filter((row) => row.clientId === perimeter.clientId) : rows;
	const measure = (subject: readonly LedgerRow[]): MinorUnits =>
		regimeAware
			? regimeAttributedAmount(subject, regime, period.from, period.to)
			: sumLedger(subject, basis, period.from, period.to).amount;
	const currentValue = measure(perimeterRows);

	const limitValue =
		ceiling.measure === 'absolute_amount'
			? ceiling.value
			: scaleMinorUnits(
					// Denominator and numerator are measured the same way, or
					// the share would compare one regime's revenue against
					// every regime's.
					measure(rows),
					// `ceiling.value` here is a share such as 0.35 — a pack
					// literal, or read off `share_ratio numeric(5,4)`
					// (`db/schema/ceiling.ts`), never more precise than four
					// decimal digits — so basis points (over 10,000) round-trip
					// it exactly, with no fractional scalar ever multiplying
					// the revenue amount itself (#323).
					Math.round(ceiling.value * 10_000),
					10_000
				);

	const usageRatio = limitValue === 0 ? 0 : currentValue / limitValue;

	return {
		ceiling,
		period,
		currentValue,
		limitValue,
		usageRatio,
		// `currentValue >= limitValue` directly would say a zero limit
		// with zero revenue against it (a percentage-share ceiling whose
		// denominator revenue is itself zero — #40) is crossed, since
		// `0 >= 0`: every such ceiling reads crossed from the first
		// instant of its own period, before a single invoice exists to
		// measure it against, with no alert level ever active to agree
		// (`usageRatio` is deliberately floored at 0 for the same zero
		// limit, to keep it finite for display). But a zero limit is not
		// always an unmeasured ratio — an `absolute_amount` ceiling of 0
		// is a legal row too, and there `usageRatio`'s floor cannot be
		// reused: it would report revenue against a zero cap as not
		// crossed, the opposite defect. So this is not `usageRatio >= 1`
		// either, that inherits the same floor — a zero limit is crossed
		// exactly when there is any revenue to measure against it at all.
		crossed: limitValue === 0 ? currentValue > 0 : currentValue >= limitValue,
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
	readonly absoluteValueMinorUnits: MinorUnits | null;
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
			? { measure: 'absolute_amount', value: row.absoluteValueMinorUnits! }
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
