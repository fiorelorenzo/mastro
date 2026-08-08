// Presentation helper for #127: a renewal assumption's own figures, shown
// next to any projected total it contributed to (#39's "never a projected
// number that silently contains an assumption with no way to see it").
// The figures themselves come from `fiscal/forecast.ts`'s
// `forecastRenewalAssumptions`, called once per projection window in
// `+page.server.ts` — nothing here recomputes a contribution, it only
// turns the pairing that function already returns into words, shared by
// `CeilingMeter.svelte` (the year-end projection note) and
// `CashCalendarChart.svelte` (the projected tier's own disclosure) so the
// two screens read an assumption's parameters in the same sentence.

import * as m from '$lib/paraglide/messages';
import { formatDate, formatMinorUnits, formatPercent } from '$lib/i18n/format';
import type { MinorUnits } from '$lib/money';

/** One contract's recorded renewal assumption, paired with the figure it
 * contributed to the projection window a screen is showing — the same
 * shape `fiscal/forecast.ts`'s `forecastRenewalAssumptions` returns, with
 * `contribution` renamed to make clear it is already scoped to that
 * screen's own window rather than some other one. */
export interface RenewalAssumptionContribution {
	readonly contractId: string;
	readonly contractTitle: string;
	readonly probability: number;
	readonly expectedVolumeMinorUnits: MinorUnits;
	readonly horizonEndsOn: string;
	readonly contributionMinorUnits: MinorUnits;
}

// See `+page.server.ts`'s own header comment: the fiscal engine carries
// no currency of its own, so every figure here is read as EUR, the same
// simplification every other dashboard widget already makes.
const CURRENCY = 'EUR';

/** "Acme Corp renewal: 60% likely, up to €12,000.00, through 31 Dec
 * 2026." — one line per contributing contract, the exact sentence #39
 * asks for wherever a projected figure that could include it is shown. */
export function renewalAssumptionLine(view: RenewalAssumptionContribution): string {
	return m.dashboard_assumption_line({
		contract: view.contractTitle,
		probability: formatPercent(view.probability),
		volume: formatMinorUnits(view.expectedVolumeMinorUnits, CURRENCY),
		horizon: formatDate(view.horizonEndsOn)
	});
}
