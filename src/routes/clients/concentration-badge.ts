// The client list's own concentration badge (#242): a `Badge` next to a
// client's revenue share, but only when their own contract cap is near or
// over — comfortably under it is not worth a badge on every row, unlike
// `$lib/dashboard/ceiling.ts`'s `ceilingStatus`, which always returns a
// level (including 'good') for the dashboard's own always-visible meter.
// Severity and copy both come straight off the evaluated ceiling's own
// alert levels, the same source `ceilingStatus` reads — never a second
// threshold invented here.
import { getLocale } from '$lib/paraglide/runtime';
import type { BadgeVariant } from '$lib/design/badge-variants';
import type { EvaluatedCeiling } from '$lib/server/fiscal/ceiling';

export interface ConcentrationBadge {
	readonly variant: BadgeVariant;
	readonly label: string;
}

/** `null` when there is no cap, or the client's share has not reached its
 *  first alert level yet — the row shows the plain share figure alone. */
export function concentrationBadge(cap: EvaluatedCeiling | null): ConcentrationBadge | null {
	if (!cap || cap.activeAlertLevels.length === 0) return null;
	const locale = getLocale();
	const reached = cap.activeAlertLevels.at(-1)!;
	return {
		variant: cap.crossed ? 'critical' : 'warning',
		label: reached.label[locale]
	};
}
