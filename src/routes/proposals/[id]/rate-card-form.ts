import type { ExtractedRateCard } from '$lib/server/agent/contract-extraction';

/**
 * One rate card, read back from the review screen's own submission (#354).
 *
 * Colocated and tested rather than private to `+page.server.ts`, because
 * every field `proposalValidationError` can refuse about a card is read
 * here, and the state that made this module necessary was the opposite of
 * a cosmetic gap: a card carrying `minimumHours` on a `'daily'` kind is
 * refused by the validator *and* by the database's own
 * `rate_card_minimum_hours_only_for_hourly` CHECK, and the screen rendered
 * the cards as a read-only table, so the proposal could not be accepted
 * through the interface at all. There was no sequence of clicks that
 * cleared it.
 *
 * `card` supplies the fallback for anything the form did not carry, so a
 * decided proposal - whose inputs render disabled and therefore submit
 * nothing - round-trips unchanged instead of collapsing to defaults.
 */
export function rateCardFromForm(
	card: ExtractedRateCard,
	index: number,
	formData: FormData
): ExtractedRateCard {
	const read = (name: string) => String(formData.get(`rateCards.${index}.${name}`) ?? '').trim();

	// No `kind` for this index means the screen never rendered the card, so
	// this submission says nothing about it and the extraction stands. The
	// distinction matters because absent and empty are different answers
	// below: an empty `minimumHours` is a reviewer clearing it, an absent
	// one is a form that never asked. Without this, a decided proposal
	// re-read through here would quietly lose the very fields the ledger
	// keeps as evidence.
	if (!formData.has(`rateCards.${index}.kind`)) return card;

	const kind = (read('kind') || card.kind) as ExtractedRateCard['kind'];
	const amount = read('amount');
	const allowedFractions = read('allowedFractions');
	const minimumHours = read('minimumHours');
	const disbursementPeriod = read('disbursementPeriod');
	const validTo = read('validTo');

	return {
		validFrom: read('validFrom') || card.validFrom,
		validTo: validTo === '' ? null : validTo,
		kind,
		amount: amount === '' ? card.amount : Number(amount),
		unit: (read('unit') || card.unit) as ExtractedRateCard['unit'],
		allowedFractions:
			allowedFractions === '' ? card.allowedFractions : parseFractions(allowedFractions),
		// Null, never zero, for an absent value: zero is a legal minimum on
		// an hourly card, so the two cannot share a representation. Gating
		// on `kind` is what lets a reviewer clear the refused combination by
		// switching kinds, which is the whole point of the screen change -
		// otherwise a `disbursementPeriod` the form no longer renders would
		// keep arriving and keep being refused.
		minimumHours: kind === 'hourly' && minimumHours !== '' ? Number(minimumHours) : null,
		disbursementPeriod:
			kind === 'fixed_recurring' && disbursementPeriod !== ''
				? (disbursementPeriod as ExtractedRateCard['disbursementPeriod'])
				: null
	};
}

/**
 * `1, 0.5` as the reviewer types it. A part that is not a number is
 * dropped rather than becoming `NaN`: the validator's own
 * `rate_card_allowed_fractions_present` then refuses the empty array and
 * names the field, which reads as "this is wrong" instead of a card
 * silently carrying a `NaN` no constraint can describe.
 */
function parseFractions(raw: string): number[] {
	return raw
		.split(',')
		.map((part) => Number(part.trim()))
		.filter((value) => !Number.isNaN(value));
}
