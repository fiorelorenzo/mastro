// The disbursement schedule of a `fixed_recurring` rate card, expanded
// into individual dated occurrences (#38: committed and projected
// recurring fees both start from this). Priced through `priceRateCard`
// alone — this file adds no second copy of that arithmetic, the same rule
// `work-unit-pricing.ts`'s own header comment states for a single day.

import {
	DISBURSEMENT_MONTHS,
	priceRateCard,
	type RateCardPricing,
	type RateCardValidity
} from './rate-card';

export type RecurringFeeCard = RateCardValidity & RateCardPricing;

export interface RecurringFeeOccurrence {
	readonly date: string;
	/** Major currency units (EUR), the same unit `priceRateCard` itself
	 * returns — never converted here. A caller that needs `MinorUnits`
	 * converts once, at its own boundary (`fiscal/forecast.ts`), the same
	 * rule every other caller of `priceRateCard`/`priceWorkUnitOnDate`
	 * already follows. */
	readonly amount: number;
}

/** `date` shifted by `months` calendar months, clamping the day to the
 * target month's own last day — the same rule `computeDueDate`
 * (`domain/contract.ts`) uses for `day_of_month` terms, so a card anchored
 * on the 31st steps onto the 30th of a 30-day month rather than
 * overflowing into the month after. */
function addMonthsIso(date: string, months: number): string {
	const parsed = new Date(`${date}T00:00:00Z`);
	const totalMonths = parsed.getUTCFullYear() * 12 + parsed.getUTCMonth() + months;
	const year = Math.floor(totalMonths / 12);
	const month = totalMonths % 12;
	const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	return new Date(Date.UTC(year, month, Math.min(parsed.getUTCDate(), lastDayOfMonth)))
		.toISOString()
		.slice(0, 10);
}

/**
 * Every disbursement date of a `fixed_recurring` card landing in `[from,
 * to)`, each priced once through `priceRateCard`. Occurrences start at
 * `card.validFrom` and repeat every `DISBURSEMENT_MONTHS[disbursementPeriod]`
 * months, clipped to `card.validTo` (inclusive, matching `resolveRateCard`'s
 * own convention) when the card itself closes. `'one_time'` yields at most
 * one occurrence, on `validFrom` itself, rather than a monthly march. Any
 * other `kind` has no recurring schedule and yields nothing.
 *
 * `[from, to)`, half-open, matching every period in `src/lib/server/fiscal/`
 * — the only caller of this function today (`fiscal/certainty.ts` and
 * `fiscal/forecast.ts`).
 */
export function recurringFeeOccurrences(
	card: RecurringFeeCard,
	from: string,
	to: string
): readonly RecurringFeeOccurrence[] {
	if (card.kind !== 'fixed_recurring') return [];
	if (from >= to) throw new Error(`invalid period: from (${from}) must be before to (${to})`);
	if (!card.disbursementPeriod) {
		throw new Error('fixed_recurring rate card is missing its disbursement period');
	}

	const amount = priceRateCard(card);

	if (card.disbursementPeriod === 'one_time') {
		return card.validFrom >= from && card.validFrom < to ? [{ date: card.validFrom, amount }] : [];
	}

	const cycleMonths = DISBURSEMENT_MONTHS[card.disbursementPeriod];
	const occurrences: RecurringFeeOccurrence[] = [];
	// Stepped from `validFrom` by `step * cycleMonths`, never from the
	// previous occurrence: a card anchored on the 31st must land on the
	// 31st of every month that has one, not drift onto the 29th forever
	// once February's clamp shortens the running date.
	for (let step = 0; ; step += 1) {
		const date = addMonthsIso(card.validFrom, step * cycleMonths);
		if (date >= to || (card.validTo !== null && date > card.validTo)) break;
		if (date >= from) occurrences.push({ date, amount });
	}
	return occurrences;
}
