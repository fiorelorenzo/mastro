import { expect, test } from 'vitest';
import { parseCeilingForm } from './ceiling-form';

const CONTRACT_ID = '00000000-0000-0000-0000-0000000000c1';

function formData(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
}

const validAbsolute = {
	code: 'acme-share-cap',
	label: "Acme's share of my income",
	measure: 'absolute_amount',
	absoluteValue: '50000',
	percentageValue: '',
	basis: 'cash_received_calendar_year',
	consequence: 'Stop invoicing Acme once reached.'
};

test('accepts an absolute-amount ceiling and drops the unused percentage field', () => {
	const result = parseCeilingForm(formData(validAbsolute), 'EUR', CONTRACT_ID);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.measure).toBe('absolute_amount');
	if (result.input.measure !== 'absolute_amount') throw new Error('expected absolute');
	expect(result.input.value).toBe(5_000_000);
	expect(result.input.label).toEqual({ en: validAbsolute.label, it: validAbsolute.label });
	expect(result.input.legalBasis).toBeNull();
	expect(result.input.alertLevels).toEqual([]);
});

test('accepts a percentage-share ceiling, converting 0-100 input to a 0-1 ratio', () => {
	const result = parseCeilingForm(
		formData({
			...validAbsolute,
			measure: 'percentage_share',
			absoluteValue: '',
			percentageValue: '30'
		}),
		'EUR',
		CONTRACT_ID
	);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.measure).toBe('percentage_share');
	if (result.input.measure !== 'percentage_share') throw new Error('expected percentage');
	expect(result.input.value).toBe(0.3);
});

test('rejects a percentage share outside 0-100', () => {
	const over = parseCeilingForm(
		formData({
			...validAbsolute,
			measure: 'percentage_share',
			absoluteValue: '',
			percentageValue: '150'
		}),
		'EUR',
		CONTRACT_ID
	);
	expect(over.ok).toBe(false);
	if (over.ok) throw new Error('expected errors');
	expect(over.errors.percentageValue).toBeDefined();

	const zero = parseCeilingForm(
		formData({
			...validAbsolute,
			measure: 'percentage_share',
			absoluteValue: '',
			percentageValue: '0'
		}),
		'EUR',
		CONTRACT_ID
	);
	expect(zero.ok).toBe(false);
	if (zero.ok) throw new Error('expected errors');
	expect(zero.errors.percentageValue).toBeDefined();
});

test('rejects a non-positive absolute amount', () => {
	const result = parseCeilingForm(
		formData({ ...validAbsolute, absoluteValue: '0' }),
		'EUR',
		CONTRACT_ID
	);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.absoluteValue).toBeDefined();
});

test('rejects an invalid basis', () => {
	const result = parseCeilingForm(
		formData({ ...validAbsolute, basis: 'not-a-real-basis' }),
		'EUR',
		CONTRACT_ID
	);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.basis).toBeDefined();
});

test('requires a code, a label and a consequence', () => {
	const result = parseCeilingForm(
		formData({ ...validAbsolute, code: '', label: '', consequence: '' }),
		'EUR',
		CONTRACT_ID
	);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.code).toBeDefined();
	expect(result.errors.label).toBeDefined();
	expect(result.errors.consequence).toBeDefined();
});
