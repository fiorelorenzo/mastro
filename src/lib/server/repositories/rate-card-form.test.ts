import { expect, test } from 'vitest';
import { parseRateCardForm } from './rate-card-form';

function formData(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
}

const validDaily = {
	validFrom: '2024-01-01',
	validTo: '',
	kind: 'daily',
	amount: '500',
	unit: 'day',
	allowedFractions: '1, 0.5',
	minimumHours: '',
	disbursementPeriod: ''
};

test('accepts a valid daily rate card and parses allowed fractions', () => {
	const result = parseRateCardForm(formData(validDaily));
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.allowedFractions).toEqual([1, 0.5]);
	expect(result.input.amount).toBe(500);
	expect(result.input.disbursementPeriod).toBeNull();
});

test('requires a disbursement period for a fixed_recurring card', () => {
	const result = parseRateCardForm(
		formData({ ...validDaily, kind: 'fixed_recurring', unit: 'month', disbursementPeriod: '' })
	);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.disbursementPeriod).toBeDefined();
});

test('accepts a fixed_recurring card with its disbursement period', () => {
	const result = parseRateCardForm(
		formData({
			...validDaily,
			kind: 'fixed_recurring',
			unit: 'year',
			disbursementPeriod: 'monthly'
		})
	);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.disbursementPeriod).toBe('monthly');
});

test('ignores minimum_hours for a non-hourly card', () => {
	const result = parseRateCardForm(formData({ ...validDaily, minimumHours: '2' }));
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.minimumHours).toBeNull();
});

test('accepts minimum_hours for an hourly card', () => {
	const result = parseRateCardForm(
		formData({ ...validDaily, kind: 'hourly', unit: 'hour', minimumHours: '2' })
	);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.minimumHours).toBe(2);
});

test('rejects a non-positive amount', () => {
	const result = parseRateCardForm(formData({ ...validDaily, amount: '0' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.amount).toBeDefined();
});

test('rejects an empty allowed_fractions list', () => {
	const result = parseRateCardForm(formData({ ...validDaily, allowedFractions: '' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.allowedFractions).toBeDefined();
});
