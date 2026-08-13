// Pure preview pricing for the day-entry form's "Vale" figure (#236): what
// the currently selected contract, date and quantity are worth, before the
// day is ever saved. Duplicates the two pricing primitives from
// `$lib/server/domain/rate-card.ts` (`resolveRateCard`, `priceRateCard`)
// rather than importing them — the same reason `../work-unit-state.ts`/
// `$lib/design/day-state-badge.ts` duplicate their own enums: this module
// ships to the client, and `$lib/server` cannot be bundled into client
// code. No i18n, no database, no Svelte — same contract as
// `../calendar/calendar-cells.ts`, so this stays unit-testable without a
// component renderer.

export type RateCardPreviewKind = 'fixed_recurring' | 'daily' | 'hourly' | 'one_off';
export type RateCardPreviewUnit = 'hour' | 'day' | 'month' | 'year' | 'lump_sum';
export type RateCardPreviewDisbursement = 'monthly' | 'quarterly' | 'annual' | 'one_time';

/** The subset of a `rate_card` row the day-entry form needs to preview a
 *  price — every load already has this via `listRateCards`. */
export type RateCardPreview = {
	id: string;
	kind: RateCardPreviewKind;
	amount: number;
	unit: RateCardPreviewUnit;
	allowedFractions: number[];
	disbursementPeriod: RateCardPreviewDisbursement | null;
	validFrom: string;
	validTo: string | null;
};

const UNIT_MONTHS: Partial<Record<RateCardPreviewUnit, number>> = { month: 1, year: 12 };
const DISBURSEMENT_MONTHS: Record<RateCardPreviewDisbursement, number> = {
	monthly: 1,
	quarterly: 3,
	annual: 12,
	one_time: 1
};

function roundToCents(amount: number): number {
	return Math.round(amount * 100) / 100;
}

/** Mirrors `resolveRateCard`: the card among `cards` whose validity range
 *  contains `date`, or `null` when none does. */
export function resolveActiveRateCard(
	cards: readonly RateCardPreview[],
	date: string
): RateCardPreview | null {
	return (
		cards.find(
			(card) => card.validFrom <= date && (card.validTo === null || date <= card.validTo)
		) ?? null
	);
}

/** Mirrors `priceRateCard`, `null` in place of a thrown error for an
 *  occurrence the card cannot price (a fraction outside
 *  `allowedFractions`, a card missing what `fixed_recurring` needs) — a
 *  preview that cannot honestly price something is unpriced, never a
 *  crash mid-keystroke. */
export function previewRateCardPrice(
	card: RateCardPreview,
	occurrence: { fraction: number } | { hours: number } | Record<string, never>
): number | null {
	switch (card.kind) {
		case 'fixed_recurring': {
			const unitMonths = UNIT_MONTHS[card.unit];
			if (unitMonths === undefined || !card.disbursementPeriod) return null;
			const periodsPerCycle = unitMonths / DISBURSEMENT_MONTHS[card.disbursementPeriod];
			return roundToCents(card.amount / periodsPerCycle);
		}
		case 'daily': {
			const fraction = 'fraction' in occurrence ? occurrence.fraction : undefined;
			if (fraction === undefined || !card.allowedFractions.includes(fraction)) return null;
			return roundToCents(card.amount * fraction);
		}
		case 'hourly': {
			const hours = 'hours' in occurrence ? occurrence.hours : undefined;
			if (hours === undefined || hours <= 0) return null;
			return roundToCents(card.amount * hours);
		}
		case 'one_off':
			return roundToCents(card.amount);
	}
}

/** Which quantity control the form shows: the full/half segmented control
 *  for everything priced by the day (or not priced by quantity at all —
 *  `fixed_recurring`/`one_off` still record a day-fraction for tracking,
 *  same as before this form dropped its freeform field), or a plain hours
 *  entry for an hourly rate card, the one kind a full/half toggle cannot
 *  represent. */
export type QuantityMode = 'day-fraction' | 'hours';

export function quantityModeForCard(card: RateCardPreview | null): QuantityMode {
	return card?.kind === 'hourly' ? 'hours' : 'day-fraction';
}

function occurrenceForQuantity(
	mode: QuantityMode,
	quantity: number
): { fraction: number } | { hours: number } {
	return mode === 'hours' ? { hours: quantity } : { fraction: quantity };
}

/** The period a rate card's own amount is denominated per, for the "€X /
 *  {period}" hint next to a contract's name — `null` when the amount is
 *  already the whole of what is owed (`one_off`, or a `fixed_recurring`
 *  card disbursed `one_time`), so no "per" reads honestly. */
export type RatePeriod = 'hour' | 'day' | 'month' | 'quarter' | 'year';

export function ratePeriodFor(card: RateCardPreview): RatePeriod | null {
	if (card.kind === 'daily') return 'day';
	if (card.kind === 'hourly') return 'hour';
	if (card.kind === 'one_off') return null;
	switch (card.disbursementPeriod) {
		case 'monthly':
			return 'month';
		case 'quarterly':
			return 'quarter';
		case 'annual':
			return 'year';
		default:
			return null;
	}
}

/** The rate to show next to a contract's name before any date is even
 *  picked: one canonical unit of whatever `card` bills in — a full day, an
 *  hour, one disbursement — priced through the same `previewRateCardPrice`
 *  the live "Vale" figure uses, never a second read of `card.amount`. */
export function previewRatePerUnit(card: RateCardPreview): number | null {
	const occurrence: { fraction: number } | { hours: number } | Record<string, never> =
		card.kind === 'daily' ? { fraction: 1 } : card.kind === 'hourly' ? { hours: 1 } : {};
	return previewRateCardPrice(card, occurrence);
}

export type DayValuePreview = {
	card: RateCardPreview;
	mode: QuantityMode;
	/** `null` when `card` cannot honestly price `quantity` (see
	 *  `previewRateCardPrice`). */
	amount: number | null;
};

/** The form's live "Vale" figure: resolves which of `cards` is active on
 *  `date`, then prices `quantity` against it. `null` when no card covers
 *  `date` at all — an honestly unpriced day, same as `priceWorkUnitOnDate`
 *  returns server-side. */
export function previewDayValue(
	cards: readonly RateCardPreview[],
	date: string,
	quantity: number
): DayValuePreview | null {
	const card = resolveActiveRateCard(cards, date);
	if (!card) return null;
	const mode = quantityModeForCard(card);
	return { card, mode, amount: previewRateCardPrice(card, occurrenceForQuantity(mode, quantity)) };
}
