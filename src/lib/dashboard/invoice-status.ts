// Presentation helper for #234's dashboard money card. Deliberately its
// own scale, not `routes/invoices/status.ts`'s `ageingStatus`: an ageing
// table's job is "how old is this row" (an invoice not yet due reads
// `'good'` there — nothing to do yet). The dashboard's job is "what
// needs a look soon", so a due date inside `DUE_SOON_WINDOW_DAYS` reads
// `'warning'` here even before it is technically late.

import * as m from '$lib/paraglide/messages';
import { formatDays } from '$lib/i18n/format';
import type { StatusLevel } from '$lib/design';

const DUE_SOON_WINDOW_DAYS = 7;

/**
 * The unpaid-invoice badge for the dashboard's "Da incassare" card.
 * `daysLate` is `domain/invoice.ts`'s own `daysLate` — positive once
 * overdue, zero on the due date, negative before it. Overdue bands
 * mirror `routes/invoices/status.ts`'s `ageingStatus` (warning up to a
 * week late, serious up to a month, critical beyond); the only
 * divergence is the not-yet-due case.
 */
export function dashboardInvoiceStatus(daysLate: number): { level: StatusLevel; label: string } {
	if (daysLate === 0) return { level: 'warning', label: m.invoices_status_due_today() };
	if (daysLate > 0) {
		const label = m.invoices_status_overdue({ days: formatDays(daysLate) });
		if (daysLate <= 7) return { level: 'warning', label };
		if (daysLate <= 30) return { level: 'serious', label };
		return { level: 'critical', label };
	}
	const daysUntil = -daysLate;
	const label = m.invoices_status_due_in({ days: formatDays(daysUntil) });
	return daysUntil <= DUE_SOON_WINDOW_DAYS ? { level: 'warning', label } : { level: 'good', label };
}
