// Presentation helpers for #58's cash calendar. Pure and universal (no
// server-only imports): the data itself comes from
// `fiscal/forecast.ts`'s `forecastRevenueByMonth` and the marker list
// `+page.server.ts` assembles from `listContractsWithClient` plus
// `fiscal/certainty.ts`'s `irrevocabilityWindowEnd` — nothing here
// recomputes a figure, it only turns already-computed data into words and
// screen positions.

import * as m from '$lib/paraglide/messages';
import { niceTicks } from '$lib/design/charts/ticks';
import type { CertaintyLevel } from '$lib/server/fiscal/certainty';
import { minorUnits, type MinorUnits } from '$lib/money';

export type CashCalendarMarkerKind = 'contract_expiry' | 'renewal_window' | 'irrevocability_edge';

/** One contractual date inside the rolling window — an expiry, a
 * renewal-notice window opening, or the edge of a contract's own
 * irrevocability window. */
export interface CashCalendarMarker {
	readonly date: string;
	readonly kind: CashCalendarMarkerKind;
	readonly contractId: string;
	readonly clientName: string;
	readonly contractTitle: string;
}

/** One calendar month's certainty breakdown, as `forecastRevenueByMonth`
 * returns it. */
export interface CashCalendarMonth {
	readonly month: string;
	readonly collected: { readonly amount: MinorUnits };
	readonly committed: { readonly amount: MinorUnits };
	readonly projected: { readonly amount: MinorUnits };
}

export function markerLabel(marker: CashCalendarMarker): string {
	switch (marker.kind) {
		case 'contract_expiry':
			return m.dashboard_cash_calendar_marker_expiry({
				client: marker.clientName,
				contract: marker.contractTitle
			});
		case 'renewal_window':
			return m.dashboard_cash_calendar_marker_renewal_window({
				client: marker.clientName,
				contract: marker.contractTitle
			});
		case 'irrevocability_edge':
			return m.dashboard_cash_calendar_marker_irrevocability_edge({
				client: marker.clientName,
				contract: marker.contractTitle
			});
	}
}

/** The design system's certainty ramp is keyed by a generic three-tier
 * ordinal vocabulary (`committed` darkest, `projected` mid, `pipeline`
 * palest — see `$lib/design/palette.ts`), fixed before the fiscal layer's
 * own `CertaintyLevel` names landed. This is the one place the two
 * vocabularies meet: fiscal `'collected'` (cash already in hand, the most
 * solid layer) reads the design system's darkest step, fiscal
 * `'committed'` the middle step, and fiscal `'projected'` the palest —
 * ordered by solidity on both sides, even though the level named
 * `'committed'` differs between them. */
export const CASH_CALENDAR_TIER = {
	collected: 'committed',
	committed: 'projected',
	projected: 'pipeline'
} as const satisfies Record<CertaintyLevel, 'committed' | 'projected' | 'pipeline'>;

/**
 * The y-axis tick values for a cash calendar, in minor units, ascending and
 * **distinct** and, per #235, *round*.
 *
 * Distinct is the whole point. The chart used to take `[0, yMax / 2, yMax]`
 * literally, and on an instance with no ledger yet `yMax` collapses to 1
 * minor unit, so all three ticks formatted to the same currency string. The
 * axis keys its ticks by label, Svelte refused the duplicate, hydration
 * aborted, and the dashboard rendered as a blank page for every new
 * instance on its first login (#143). Half of a one-unit range is also not
 * a tick anybody wants to read.
 *
 * Round is #235's own fix: the same `[0, yMax / 2, yMax]` produced ticks
 * like `5985,00 €` and `3492,50 €` on real data — three numbers nobody
 * can hold in their head on a chart whose entire job is reading a shape
 * at a glance. `niceTicks` (the design system's generic nice-number
 * helper) runs in *major* currency units — nice steps mean nice euros
 * (`100`, `500`, `1 000`, …), not nice cents — then converts back to
 * `MinorUnits`. This assumes 100 minor units per major unit, the same
 * EUR-only simplification every dashboard widget already makes (see
 * `+page.server.ts`'s header comment).
 */
const MINOR_UNITS_PER_MAJOR = 100;

export function cashCalendarYTicks(yMax: number): readonly MinorUnits[] {
	if (yMax <= 0) return [minorUnits(0)];
	const majorTicks = niceTicks(yMax / MINOR_UNITS_PER_MAJOR, 3);
	const ticks = majorTicks.map((tick) => Math.round(tick * MINOR_UNITS_PER_MAJOR));
	return [...new Set(ticks)].sort((a, b) => a - b).map((tick) => minorUnits(tick));
}
