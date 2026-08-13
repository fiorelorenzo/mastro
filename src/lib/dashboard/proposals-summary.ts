// Presentation helper for #234's attention queue: the "pending
// proposals" row summarises every pending work_unit proposal into one
// sentence ("17 August (1 day) and 18 August (0.5 days)") without a
// second fiscal calculation — `date`/`quantity` are read straight off
// each proposal's own `proposedFields`, the same two JSON keys
// `repositories/proposal.ts`'s `workUnitInputFromFields` already trusts
// once a proposal is accepted.

import { formatDate, formatDays } from '$lib/i18n/format';
import type { Locale } from '$lib/paraglide/runtime';

export interface PendingProposalDay {
	readonly date: string;
	readonly quantity: number;
}

/** Reads `date`/`quantity` off one proposal's `proposedFields`, or `null`
 * when the shape is not the one a `'work_unit'` proposal always carries
 * — defensive, not because a producer should ever write anything else
 * (`createProposal` already validates this at write time). */
export function pendingProposalDay(
	proposedFields: Record<string, unknown>
): PendingProposalDay | null {
	const { date, quantity } = proposedFields;
	if (typeof date !== 'string' || typeof quantity !== 'number') return null;
	return { date, quantity };
}

/** "17 August (1 day) and 18 August (0.5 days)" — every pending
 * proposal's own day and quantity, ascending by date, joined the way
 * `Intl.ListFormat` joins any locale's list (never a hand-rolled "and"),
 * the same rule every other formatter in `$lib/i18n/format` follows. */
export function pendingProposalsSummary(
	days: readonly PendingProposalDay[],
	locale: Locale
): string {
	const parts = [...days]
		.sort((a, b) => a.date.localeCompare(b.date))
		.map((day) => `${formatDate(day.date, locale)} (${formatDays(day.quantity, locale)})`);
	return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(parts);
}
