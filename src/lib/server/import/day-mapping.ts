// #48: proposes which already-recorded days an imported invoice line
// billed, for a day-rate contract. Pure — no database access, so it is
// tested the same way `dedup.ts` and `client-match.ts` are — because the
// decision to actually move a day to `invoiced` never lives here:
// invariant 3 ("agents propose, humans confirm") means this function may
// only ever suggest `workUnitIds`, and `persist.ts` only links the days a
// human accepted, exactly like the manual invoice form's `workUnitIds`
// checkboxes already work (#26).
//
// The reasoning a proposal must show (#48's acceptance) is exactly its
// three non-id fields: the period the picked days span, how many there
// are, and the amount they price to next to what the document itself
// states — never hidden inside an accept/reject boolean.

import { resolveRateCard } from '$lib/server/domain/rate-card';
import { priceWorkUnitOnDate, type PriceableRateCard } from '$lib/server/domain/work-unit-pricing';
import type { MinorUnits } from '$lib/money';

export interface DayMappingCandidateDay {
	readonly id: string;
	/** ISO date. */
	readonly date: string;
	readonly quantity: number;
}

export interface DayMappingProposal {
	readonly workUnitIds: readonly string[];
	/** ISO dates, inclusive — the span the picked days actually cover, never
	 * guessed from the document's free-text description. */
	readonly periodStart: string;
	readonly periodEnd: string;
	readonly dayCount: number;
	/** What the picked days price to against the contract's own rate card,
	 * in the invoice's currency's minor unit. */
	readonly proposedAmount: MinorUnits;
	/** The line's own stated amount, carried alongside so the caller never
	 * has to zip the proposal back up with the line to show the two side by
	 * side. */
	readonly lineAmount: MinorUnits;
	readonly amountMatches: boolean;
}

// `quantity` on both a work unit and an invoice line survives a round trip
// through `numeric` columns and decimal-string parsing; this tolerance
// absorbs the residue of that without treating a genuinely short match as
// complete.
const QUANTITY_EPSILON = 1e-6;

/**
 * Proposes which of `eligibleDays` this line billed. Only ever proposes a
 * *complete* match: the picked days' own quantities must sum to exactly
 * the line's billed quantity (within floating-point rounding), taking the
 * oldest eligible days first and never one dated after the invoice's own
 * issue date — a day worked after the invoice that is supposed to have
 * billed it cannot be what it billed. A partial or ambiguous match (too
 * few eligible days, or no combination that sums exactly) proposes
 * nothing rather than guessing a subset: the reviewer is left to link days
 * by hand, exactly as an invoice entered manually already allows (#26).
 *
 * `null` when the contract's rate card in force on the invoice's issue
 * date is not `daily` — this is specifically the day-rate proposal #48
 * asks for, not a generic quantity-matcher for hourly or fixed-fee
 * contracts, which bill by a period or a lump sum a set of days cannot
 * stand in for.
 */
export function proposeDayMapping(
	line: { readonly quantity: number; readonly amount: MinorUnits },
	issueDate: string,
	eligibleDays: readonly DayMappingCandidateDay[],
	// Not `readonly`: matches `resolveRateCard`/`priceWorkUnitOnDate`'s own
	// signature in `domain/rate-card.ts`/`domain/work-unit-pricing.ts`,
	// which this function calls straight through.
	rateCards: PriceableRateCard[]
): DayMappingProposal | null {
	const card = resolveRateCard(rateCards, issueDate);
	if (!card || card.kind !== 'daily') return null;

	const candidates = eligibleDays
		.filter((day) => day.date <= issueDate)
		.toSorted((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

	const picked: DayMappingCandidateDay[] = [];
	let runningQuantity = 0;
	for (const day of candidates) {
		if (runningQuantity >= line.quantity - QUANTITY_EPSILON) break;
		picked.push(day);
		runningQuantity += day.quantity;
	}

	if (picked.length === 0) return null;
	if (Math.abs(runningQuantity - line.quantity) > QUANTITY_EPSILON) return null;

	const proposedAmount = picked.reduce((sum, day) => {
		const price = priceWorkUnitOnDate(day, rateCards);
		// `priceRateCard` already rounds to cents before returning; `* 100`
		// only needs `Math.round` to clear the odd floating-point residue
		// that arithmetic on a decimal amount leaves behind (e.g. `219.99…97`).
		return sum + (price === null ? 0 : Math.round(price * 100));
	}, 0);

	const dates = picked.map((day) => day.date);
	return {
		workUnitIds: picked.map((day) => day.id),
		periodStart: dates.reduce((min, date) => (date < min ? date : min)),
		periodEnd: dates.reduce((max, date) => (date > max ? date : max)),
		dayCount: picked.length,
		proposedAmount,
		lineAmount: line.amount,
		amountMatches: proposedAmount === line.amount
	};
}
