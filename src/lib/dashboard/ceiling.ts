// Presentation helpers for #57's ceiling meter. Pure and universal: the
// figures themselves come from `fiscal/ceiling-status.ts`'s
// `evaluateActiveCeilings` and `fiscal/forecast.ts`'s `forecastRevenue`,
// assembled server-side in `+page.server.ts`. Nothing here recomputes a
// figure — it only turns the ceiling's own `basis` and alert levels into
// words and a status.

import * as m from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
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
