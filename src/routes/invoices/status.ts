import * as m from '$lib/paraglide/messages';
import { formatDays } from '$lib/i18n/format';
import type { BadgeVariant, StatusLevel } from '$lib/design';
import type { InvoiceTransmissionStatus } from '$lib/server/db/schema';

/**
 * The ageing chip for an unpaid invoice (#29). Never colour alone: `level`
 * always carries its own icon/shape via `StatusIndicator`, and `label`
 * always states the figure in words, not just the colour's meaning.
 *
 * `daysLate` is `domain/invoice.ts`'s `daysLate` — negative before the due
 * date, zero on it, positive after. The three positive bands (due today,
 * within a week, beyond) are a presentational choice made here, not a rule
 * the domain layer encodes: the domain only knows "late" and "how much".
 */
export function ageingStatus(daysLate: number): { level: StatusLevel; label: string } {
	if (daysLate < 0)
		return { level: 'good', label: m.invoices_status_due_in({ days: formatDays(-daysLate) }) };
	if (daysLate === 0) return { level: 'warning', label: m.invoices_status_due_today() };
	if (daysLate <= 7)
		return { level: 'warning', label: m.invoices_status_overdue({ days: formatDays(daysLate) }) };
	if (daysLate <= 30)
		return { level: 'serious', label: m.invoices_status_overdue({ days: formatDays(daysLate) }) };
	return { level: 'critical', label: m.invoices_status_overdue({ days: formatDays(daysLate) }) };
}

/**
 * Which ageing band an unpaid invoice's row belongs to in the list (#238) —
 * a different axis from {@link ageingStatus}'s severity: severity says how
 * urgent a row is, a band says how soon relative to its due date, so
 * "overdue by 3 days" (severity `warning`, same as "due today") and "due in
 * 3 days" (severity `good`) land in different bands even though neither is
 * `critical`. The mockup draws three of the four (its seed data never
 * populates `overdue`, a real instance will); all four exist so an invoice
 * overdue by, say, 15 days is never miscounted into "due soon".
 */
export type AgeingBandKey = 'overdue_critical' | 'overdue' | 'due_soon' | 'not_due_soon';

/** Most urgent first — the order the list renders bands in. */
export const AGEING_BAND_KEYS: readonly AgeingBandKey[] = [
	'overdue_critical',
	'overdue',
	'due_soon',
	'not_due_soon'
];

export function ageingBandKey(daysLate: number): AgeingBandKey {
	if (daysLate > 30) return 'overdue_critical';
	if (daysLate > 0) return 'overdue';
	if (daysLate >= -7) return 'due_soon';
	return 'not_due_soon';
}

const AGEING_BAND_LABEL: Readonly<Record<AgeingBandKey, () => string>> = {
	overdue_critical: () => m.invoices_band_overdue_critical(),
	overdue: () => m.invoices_band_overdue(),
	due_soon: () => m.invoices_band_due_soon(),
	not_due_soon: () => m.invoices_band_not_due_soon()
};

export function ageingBandLabel(key: AgeingBandKey): string {
	return AGEING_BAND_LABEL[key]();
}

/**
 * The status badge for one invoice row wherever it renders — the ageing
 * list's Status column and the detail page's header alike (#238, #239).
 * Paid is its own branch, never a fifth ageing band: `daysLate` stops
 * mattering the instant `settledOn` is set (#212 — a partly paid invoice
 * is not yet settled, and stays in the ordinary ageing bands for
 * whatever it still owes), the same reasoning the detail page's own
 * `statusLabel` already used before this moved here to be the one place
 * both screens read it from.
 */
export function invoiceStatus(
	daysLate: number,
	settledOn: string | null
): { level: StatusLevel; label: string } {
	if (settledOn !== null) return { level: 'good', label: m.invoice_day_status_paid() };
	return ageingStatus(daysLate);
}

/**
 * The transmission-status badge for the invoice detail page's own block
 * (#261) — `BadgeVariant`, not `StatusLevel`: `generated` and
 * `transmitted` are informational stages, not a two-tone
 * good/bad reading like ageing, so they need `neutral`/`info` on top of
 * the `good`/`critical` `StatusLevel` scale already covers for
 * `accepted`/`rejected`.
 */
const TRANSMISSION_STATUS_VARIANT: Readonly<Record<InvoiceTransmissionStatus, BadgeVariant>> = {
	generated: 'neutral',
	transmitted: 'info',
	accepted: 'good',
	rejected: 'critical'
};

const TRANSMISSION_STATUS_LABEL: Readonly<Record<InvoiceTransmissionStatus, () => string>> = {
	generated: () => m.invoice_transmission_status_generated(),
	transmitted: () => m.invoice_transmission_status_transmitted(),
	accepted: () => m.invoice_transmission_status_accepted(),
	rejected: () => m.invoice_transmission_status_rejected()
};

export function transmissionStatusBadge(status: InvoiceTransmissionStatus): {
	variant: BadgeVariant;
	label: string;
} {
	return {
		variant: TRANSMISSION_STATUS_VARIANT[status],
		label: TRANSMISSION_STATUS_LABEL[status]()
	};
}
