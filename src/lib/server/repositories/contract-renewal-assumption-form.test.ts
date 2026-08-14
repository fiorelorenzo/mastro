import { expect, test } from 'vitest';
import { parseRenewalAssumptionForm } from './contract-renewal-assumption-form';

const CONTRACT_ID = '00000000-0000-0000-0000-0000000000c2';

function formData(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
}

const valid = {
	probability: '70',
	expectedVolume: '12000',
	horizonEndsOn: '2027-12-31'
};

test('converts a 0-100 probability to the 0-1 ratio the table stores', () => {
	const result = parseRenewalAssumptionForm(formData(valid), 'EUR', CONTRACT_ID);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.probability).toBe(0.7);
	expect(result.input.expectedVolumeMinorUnits).toBe(1_200_000);
	expect(result.input.horizonEndsOn).toBe('2027-12-31');
});

test('accepts the boundary probabilities 0 and 100', () => {
	const zero = parseRenewalAssumptionForm(
		formData({ ...valid, probability: '0' }),
		'EUR',
		CONTRACT_ID
	);
	expect(zero.ok).toBe(true);
	if (!zero.ok) throw new Error('expected ok');
	expect(zero.input.probability).toBe(0);

	const hundred = parseRenewalAssumptionForm(
		formData({ ...valid, probability: '100' }),
		'EUR',
		CONTRACT_ID
	);
	expect(hundred.ok).toBe(true);
	if (!hundred.ok) throw new Error('expected ok');
	expect(hundred.input.probability).toBe(1);
});

test('rejects a probability outside 0-100', () => {
	const result = parseRenewalAssumptionForm(
		formData({ ...valid, probability: '150' }),
		'EUR',
		CONTRACT_ID
	);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.probability).toBeDefined();
});

test('rejects a negative expected volume', () => {
	const result = parseRenewalAssumptionForm(
		formData({ ...valid, expectedVolume: '-1' }),
		'EUR',
		CONTRACT_ID
	);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.expectedVolume).toBeDefined();
});

test('accepts an expected volume of zero — a renewal with no further billing assumed', () => {
	const result = parseRenewalAssumptionForm(
		formData({ ...valid, expectedVolume: '0' }),
		'EUR',
		CONTRACT_ID
	);
	expect(result.ok).toBe(true);
});

test('rejects an invalid horizon date', () => {
	const result = parseRenewalAssumptionForm(
		formData({ ...valid, horizonEndsOn: 'soon' }),
		'EUR',
		CONTRACT_ID
	);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.horizonEndsOn).toBeDefined();
});
