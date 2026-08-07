import {
	priceRateCard,
	resolveRateCard,
	type RateCardPricing,
	type RateCardValidity
} from './rate-card';

export type PriceableRateCard = RateCardValidity & RateCardPricing;

/**
 * The amount one day is worth, resolved against whichever of `rateCards`
 * is in force on `workUnit.date` (`resolveRateCard`) and priced through
 * `priceRateCard` — never a second copy of that arithmetic (#25's "priced
 * through the existing rate-card functions rather than a new copy of that
 * logic"). `workUnit.quantity` is read as a day fraction for a `daily`
 * card and as hours for an `hourly` one, mirroring `priceRateCard`'s own
 * contract; a `fixed_recurring`/`one_off` card ignores it entirely, the
 * same as the card itself does.
 *
 * `null` when no card covers the date, or when the card rejects the
 * quantity outright (e.g. a `daily` card whose `allowedFractions` does
 * not include it): a day the calendar cannot honestly price is shown as
 * unpriced, never guessed at.
 */
export function priceWorkUnitOnDate(
	workUnit: { date: string; quantity: number },
	rateCards: PriceableRateCard[]
): number | null {
	const card = resolveRateCard(rateCards, workUnit.date);
	if (!card) return null;

	const occurrence: { fraction: number } | { hours: number } | Record<string, never> =
		card.kind === 'daily'
			? { fraction: workUnit.quantity }
			: card.kind === 'hourly'
				? { hours: workUnit.quantity }
				: {};

	try {
		return priceRateCard(card, occurrence);
	} catch {
		return null;
	}
}
