import type { DisbursementPeriod, RateCardKind } from '$lib/server/db/schema/rate-card';

/** Whole cycles (in months) a `fixed_recurring` amount and its
 * `disbursement_period` cover, used only to relate the two: a monthly
 * disbursement of an annual amount pays out `12 / 1 = 12` times a year, a
 * flat monthly retainer (amount already denominated monthly, disbursed
 * monthly) pays out `1 / 1 = 1` time, i.e. unchanged. */
const UNIT_MONTHS: Partial<Record<'month' | 'year', number>> = { month: 1, year: 12 };
/** Exported for `domain/recurring-fee.ts`, which needs to know how often
 * a `fixed_recurring` card disburses in order to step through its
 * occurrences — never a second copy of this table. */
export const DISBURSEMENT_MONTHS: Record<DisbursementPeriod, number> = {
	monthly: 1,
	quarterly: 3,
	annual: 12,
	one_time: 1
};

export type RateCardPricing = {
	kind: RateCardKind;
	amount: number;
	unit: string;
	allowedFractions: number[];
	minimumHours: number | null;
	disbursementPeriod: DisbursementPeriod | null;
};

/**
 * The amount actually owed for one occurrence of a rate card's billing
 * event.
 *
 * `fixed_recurring`: `amount` is the fee for one full `unit` cycle (e.g. a
 * year, for an annual fee); the result is the share of it owed at each
 * `disbursementPeriod` — an annual fee of X paid monthly yields `X / 12`.
 *
 * `daily`: `amount` is the full-day rate; `fraction` must be one of
 * `allowedFractions` (e.g. `1` for a full day, `0.5` for a half day) and
 * the result is `amount * fraction`.
 *
 * `hourly`: `amount` is the per-hour rate; the result is `amount * hours`.
 * `minimumHours` is not applied here — see `validateHours` — because it
 * validates an entry, it does not silently inflate one.
 *
 * `one_off`: `amount` is the lump sum, unconditionally.
 */
export function priceRateCard(
	card: RateCardPricing,
	occurrence: { fraction: number } | { hours: number } | Record<string, never> = {}
): number {
	switch (card.kind) {
		case 'fixed_recurring': {
			const unitMonths = UNIT_MONTHS[card.unit as 'month' | 'year'];
			if (unitMonths === undefined) {
				throw new Error(`fixed_recurring rate card has an unsupported unit: ${card.unit}`);
			}
			if (!card.disbursementPeriod) {
				throw new Error('fixed_recurring rate card is missing its disbursement period');
			}
			const periodsPerCycle = unitMonths / DISBURSEMENT_MONTHS[card.disbursementPeriod];
			return roundToCents(card.amount / periodsPerCycle);
		}
		case 'daily': {
			const fraction = 'fraction' in occurrence ? occurrence.fraction : undefined;
			if (fraction === undefined) throw new Error('daily rate card requires a fraction to price');
			if (!card.allowedFractions.includes(fraction)) {
				throw new Error(`fraction ${fraction} is not allowed by this rate card`);
			}
			return roundToCents(card.amount * fraction);
		}
		case 'hourly': {
			const hours = 'hours' in occurrence ? occurrence.hours : undefined;
			if (hours === undefined) throw new Error('hourly rate card requires hours to price');
			return roundToCents(card.amount * hours);
		}
		case 'one_off':
			return roundToCents(card.amount);
	}
}

/** Validates an hourly entry against the card's `minimumHours`, never
 * adjusting it: the entry is either accepted or rejected. */
export function validateHours(card: Pick<RateCardPricing, 'minimumHours'>, hours: number): boolean {
	if (card.minimumHours === null) return true;
	return hours >= card.minimumHours;
}

function roundToCents(amount: number): number {
	return Math.round(amount * 100) / 100;
}

export type RateCardValidity = { id: string; validFrom: string; validTo: string | null };

/**
 * Which rate card, among a contract's cards, is in force on `date`.
 * `validFrom`/`validTo` are both inclusive; a null `validTo` means the card
 * is still open. Assumes the caller's cards obey the database's exclusion
 * constraint (no two cards on the same contract overlap) — with that held,
 * at most one card ever matches, so the result is unambiguous by
 * construction; this function does not itself re-validate non-overlap.
 */
export function resolveRateCard<T extends RateCardValidity>(cards: T[], date: string): T | null {
	return (
		cards.find(
			(card) => card.validFrom <= date && (card.validTo === null || date <= card.validTo)
		) ?? null
	);
}
