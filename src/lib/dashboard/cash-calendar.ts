// Presentation helpers for #58's cash calendar. Pure and universal (no
// server-only imports): the data itself comes from
// `fiscal/forecast.ts`'s `forecastRevenueByMonth` and the marker list
// `+page.server.ts` assembles from `listContractsWithClient` plus
// `fiscal/certainty.ts`'s `irrevocabilityWindowEnd` — nothing here
// recomputes a figure, it only turns already-computed data into words and
// screen positions.

import * as m from '$lib/paraglide/messages';
import type { CertaintyLevel } from '$lib/server/fiscal/certainty';

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
	readonly collected: { readonly amount: number };
	readonly committed: { readonly amount: number };
	readonly projected: { readonly amount: number };
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
