import { expect, test } from 'vitest';
import type { ExtractedRateCard } from '$lib/server/agent/contract-extraction';
import { rateCardFromForm } from './rate-card-form';

/**
 * The card the live instance actually produced (#354): an agent read a
 * daily contract and filled `minimumHours` anyway, which the validator
 * refuses (`only_for_kind`) and the database refuses
 * (`rate_card_minimum_hours_only_for_hourly`).
 */
const REFUSED: ExtractedRateCard = {
	validFrom: '2026-08-03',
	validTo: null,
	kind: 'daily',
	amount: 500,
	unit: 'day',
	allowedFractions: [1, 0.5],
	minimumHours: 8,
	disbursementPeriod: null
};

function submission(entries: Record<string, string>): FormData {
	const formData = new FormData();
	for (const [name, value] of Object.entries(entries)) formData.set(name, value);
	return formData;
}

/** Every field the screen renders for one card, index 0. */
function fullSubmission(card: ExtractedRateCard, overrides: Record<string, string> = {}): FormData {
	return submission({
		'rateCards.0.validFrom': card.validFrom,
		'rateCards.0.validTo': card.validTo ?? '',
		'rateCards.0.kind': card.kind,
		'rateCards.0.amount': String(card.amount),
		'rateCards.0.unit': card.unit,
		'rateCards.0.allowedFractions': card.allowedFractions.join(', '),
		'rateCards.0.minimumHours': card.minimumHours === null ? '' : String(card.minimumHours),
		'rateCards.0.disbursementPeriod': card.disbursementPeriod ?? '',
		...overrides
	});
}

test('clearing the field the validator refused produces an acceptable card', () => {
	const card = rateCardFromForm(
		REFUSED,
		0,
		fullSubmission(REFUSED, { 'rateCards.0.minimumHours': '' })
	);

	expect(card.minimumHours).toBeNull();
	expect(card.kind).toBe('daily');
	expect(card.amount).toBe(500);
	expect(card.allowedFractions).toEqual([1, 0.5]);
});

test('switching to the kind that allows the field keeps it', () => {
	const card = rateCardFromForm(
		REFUSED,
		0,
		fullSubmission(REFUSED, { 'rateCards.0.kind': 'hourly', 'rateCards.0.unit': 'hour' })
	);

	expect(card).toMatchObject({ kind: 'hourly', unit: 'hour', minimumHours: 8 });
});

test('a kind-specific field the form no longer renders does not survive the switch', () => {
	const recurring: ExtractedRateCard = {
		...REFUSED,
		kind: 'fixed_recurring',
		unit: 'month',
		minimumHours: null,
		disbursementPeriod: 'monthly'
	};

	// Switching kinds hides the disbursement select, so the browser submits
	// nothing for it - and the stale value must not be resurrected from
	// `card`, or the next submit is refused for the same reason as the last.
	const card = rateCardFromForm(
		recurring,
		0,
		submission({
			'rateCards.0.validFrom': recurring.validFrom,
			'rateCards.0.kind': 'daily',
			'rateCards.0.amount': '500',
			'rateCards.0.unit': 'day',
			'rateCards.0.allowedFractions': '1'
		})
	);

	expect(card.disbursementPeriod).toBeNull();
	expect(card.kind).toBe('daily');
});

test('zero is a minimum an hourly card can carry, and is not read as absent', () => {
	const hourly: ExtractedRateCard = { ...REFUSED, kind: 'hourly', unit: 'hour', minimumHours: 4 };

	const card = rateCardFromForm(
		hourly,
		0,
		fullSubmission(hourly, { 'rateCards.0.minimumHours': '0' })
	);

	expect(card.minimumHours).toBe(0);
});

test('a submission that carries nothing round-trips the card unchanged', () => {
	// A decided proposal renders every input disabled, so the browser
	// submits none of them; the accept path still rebuilds the card.
	expect(rateCardFromForm(REFUSED, 0, new FormData())).toEqual(REFUSED);
});

test('an emptied validity end is null, not the previous date', () => {
	const closed: ExtractedRateCard = { ...REFUSED, validTo: '2026-12-31' };

	const card = rateCardFromForm(closed, 0, fullSubmission(closed, { 'rateCards.0.validTo': '' }));

	expect(card.validTo).toBeNull();
});

test('each card reads its own inputs', () => {
	const formData = submission({
		'rateCards.0.amount': '500',
		'rateCards.0.kind': 'daily',
		'rateCards.1.amount': '90',
		'rateCards.1.kind': 'hourly',
		'rateCards.1.unit': 'hour',
		'rateCards.1.minimumHours': '4'
	});

	expect(rateCardFromForm(REFUSED, 0, formData).amount).toBe(500);
	expect(rateCardFromForm(REFUSED, 1, formData)).toMatchObject({
		amount: 90,
		kind: 'hourly',
		minimumHours: 4
	});
});

test('fractions are read as the reviewer types them', () => {
	const card = rateCardFromForm(
		REFUSED,
		0,
		fullSubmission(REFUSED, { 'rateCards.0.allowedFractions': '1, 0.5, 0.25' })
	);

	expect(card.allowedFractions).toEqual([1, 0.5, 0.25]);
});
