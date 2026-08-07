import * as m from '$lib/paraglide/messages';
import { formatDays } from '$lib/i18n/format';
import type { StatusLevel } from '$lib/design';

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
