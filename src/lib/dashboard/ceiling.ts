// Presentation helpers for #57's ceiling meter. Pure and universal: the
// figures themselves come from `fiscal/ceiling-status.ts`'s
// `evaluateActiveCeilings` and `fiscal/forecast.ts`'s `forecastRevenue`,
// assembled server-side in `+page.server.ts`. Nothing here recomputes a
// figure — it only turns the ceiling's own `basis` and alert levels into
// words and a status.

import * as m from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
import { formatMinorUnits, formatPercent } from '$lib/i18n/format';
import type { StatusLevel } from '$lib/design';
import type { CeilingAlertLevel, CeilingBasis } from '$lib/server/fiscal/pack';
import type { LabelBundle } from '$lib/server/fiscal/label';
import type { MinorUnits } from '$lib/money';
import type { RenewalAssumptionContribution } from './renewal-assumption';

/** One hero ceiling meter, the shape `+page.server.ts` returns per active
 * whole-practice ceiling. */
export interface CeilingView {
	readonly id: string;
	readonly label: LabelBundle;
	readonly basis: CeilingBasis;
	readonly periodFrom: string;
	readonly periodTo: string;
	readonly currentValue: MinorUnits;
	readonly limitValue: MinorUnits;
	readonly usageRatio: number;
	readonly crossed: boolean;
	readonly alertLevels: readonly CeilingAlertLevel[];
	readonly activeAlertLevels: readonly CeilingAlertLevel[];
	readonly consequence: LabelBundle;
	readonly projectedEnd: MinorUnits;
	/** #127: every recorded renewal assumption that actually contributed
	 * to `projectedEnd` over `[today, periodTo)` — empty when none did,
	 * never omitted, so the year-end projection note can disclose exactly
	 * what it silently includes. */
	readonly assumptions: readonly RenewalAssumptionContribution[];
}

/** Which accounting basis produced the figure, said in words — #57's own
 * acceptance bullet. `CeilingBasis` has exactly these three members
 * (`fiscal/pack.ts`); a fourth would fail this switch at compile time. */
export function ceilingBasisWords(basis: CeilingBasis): string {
	switch (basis) {
		case 'cash_received_calendar_year':
			return m.dashboard_ceiling_basis_cash_calendar_year();
		case 'invoiced_calendar_year':
			return m.dashboard_ceiling_basis_invoiced_calendar_year();
		case 'cash_received_contract_year':
			return m.dashboard_ceiling_basis_cash_contract_year();
	}
}

/** The meter's status, never colour alone: `level` always ships with the
 * `label` that explains it, read straight off the ceiling's own alert
 * levels rather than a threshold invented in this component. Crossed
 * (`usageRatio >= 1`) is `'critical'`; any lesser active alert level
 * (e.g. the flat-rate regime's 80%/90% "approaching" threshold) is
 * `'warning'`; nothing active is `'good'`. */
export function ceilingStatus(view: CeilingView): { level: StatusLevel; label: string } {
	const locale = getLocale();
	if (view.crossed) {
		const reached = view.activeAlertLevels.at(-1);
		return {
			level: 'critical',
			label: reached ? reached.label[locale] : m.dashboard_ceiling_status_crossed()
		};
	}
	if (view.activeAlertLevels.length > 0) {
		return { level: 'warning', label: view.activeAlertLevels.at(-1)!.label[locale] };
	}
	return { level: 'good', label: m.dashboard_ceiling_status_ok() };
}

/** Minimal shape `selectGoverningCeilingIds` needs — deliberately
 * narrower than `fiscal/ceiling.ts`'s `EvaluatedCeiling`, so this stays a
 * pure, universal function testable with no fiscal engine in the loop;
 * `+page.server.ts` maps `EvaluatedCeiling[]` onto it. */
export interface GroupableCeiling {
	readonly id: string;
	readonly basis: CeilingBasis;
	readonly limitValue: MinorUnits;
	readonly crossed: boolean;
}

/**
 * #234: "one ceiling card, not two duplicates." `it-flat-rate.ts`'s
 * soft/hard pair (and any future pack that repeats the shape) share a
 * `basis` — the same cash figure, two different limits, two different
 * consequences — and used to render as two visually identical sibling
 * cards (`ceilingBasisWords`'s own doc comment, `+page.server.ts`
 * before this fix). Grouped by basis, the *governing* limit in each
 * group is the tightest one not yet crossed — the next consequence
 * actually in play — falling back to the loosest (worst-case) one once
 * every limit in a group is already crossed, since a crossed soft
 * ceiling says nothing about whether the hard one has also gone. Every
 * other origin (a contract's own client-share cap, `perimeter.kind ===
 * 'client'`) is unaffected: each keeps its own distinct basis+client
 * pairing and never groups with another.
 */
export function selectGoverningCeilingIds(
	ceilings: readonly GroupableCeiling[]
): ReadonlySet<string> {
	const byBasis = new Map<CeilingBasis, GroupableCeiling[]>();
	for (const ceiling of ceilings) {
		const group = byBasis.get(ceiling.basis);
		if (group) group.push(ceiling);
		else byBasis.set(ceiling.basis, [ceiling]);
	}
	const governing = new Set<string>();
	for (const group of byBasis.values()) {
		const sorted = [...group].sort((a, b) => a.limitValue - b.limitValue);
		const chosen = sorted.find((ceiling) => !ceiling.crossed) ?? sorted[sorted.length - 1];
		governing.add(chosen.id);
	}
	return governing;
}

// The fiscal engine carries no currency of its own — see `+page.server.ts`'s
// header comment; every dashboard widget reads EUR.
const CURRENCY = 'EUR';

/**
 * The projection note's own status, never a flat footnote (#235): before
 * this, `.projection-note` was always the same muted, small text whether
 * the projected year-end figure was 8% of the ceiling or 190% of it —
 * the one sentence that says "here is where this is headed" read like a
 * footnote in every case, including a projected breach. Evaluated
 * against `projectedEnd` rather than `currentValue` (that is
 * `ceilingStatus`'s job): `'critical'` once the *projection* would cross
 * the limit, `'warning'` once it would cross any lesser alert level
 * (e.g. the 80% "approaching" threshold), `'good'` otherwise.
 */
export function ceilingProjectionStatus(view: CeilingView): { level: StatusLevel; label: string } {
	const locale = getLocale();
	const ratio = view.limitValue > 0 ? view.projectedEnd / view.limitValue : 0;
	const amount = formatMinorUnits(view.projectedEnd, CURRENCY, locale);
	const percent = formatPercent(ratio, locale);
	if (ratio >= 1) {
		return {
			level: 'critical',
			label: m.dashboard_ceiling_projection_crossed({ amount, percent })
		};
	}
	if (view.alertLevels.some((level) => ratio >= level.ratio)) {
		return {
			level: 'warning',
			label: m.dashboard_ceiling_projection_approaching({ amount, percent })
		};
	}
	return { level: 'good', label: m.dashboard_ceiling_projection_on_track({ amount, percent }) };
}
