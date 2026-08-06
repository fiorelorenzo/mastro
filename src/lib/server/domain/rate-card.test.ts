import { expect, test } from 'vitest';
import { priceRateCard, resolveRateCard, validateHours } from './rate-card';

const annualFeePaidMonthly = {
	kind: 'fixed_recurring' as const,
	amount: 24000,
	unit: 'year',
	allowedFractions: [1],
	minimumHours: null,
	disbursementPeriod: 'monthly' as const
};

test('an annual fee of X paid monthly yields the monthly amount', () => {
	expect(priceRateCard(annualFeePaidMonthly)).toBe(2000);
});

test('a flat monthly retainer (amount already denominated monthly) is unchanged by monthly disbursement', () => {
	const retainer = { ...annualFeePaidMonthly, amount: 1800, unit: 'month' };
	expect(priceRateCard(retainer)).toBe(1800);
});

test('an annual fee paid quarterly yields the quarterly amount', () => {
	const quarterly = { ...annualFeePaidMonthly, disbursementPeriod: 'quarterly' as const };
	expect(priceRateCard(quarterly)).toBe(6000);
});

const dailyCard = {
	kind: 'daily' as const,
	amount: 600,
	unit: 'day',
	allowedFractions: [1, 0.5],
	minimumHours: null,
	disbursementPeriod: null
};

test('a daily card prices a full day at the full rate', () => {
	expect(priceRateCard(dailyCard, { fraction: 1 })).toBe(600);
});

test('a daily card prices a half day at half the rate', () => {
	expect(priceRateCard(dailyCard, { fraction: 0.5 })).toBe(300);
});

test('a daily card rejects a fraction it does not allow', () => {
	expect(() => priceRateCard(dailyCard, { fraction: 0.25 })).toThrow();
});

const hourlyCard = {
	kind: 'hourly' as const,
	amount: 90,
	unit: 'hour',
	allowedFractions: [1],
	minimumHours: 2,
	disbursementPeriod: null
};

test('an hourly card prices hours worked at the hourly rate', () => {
	expect(priceRateCard(hourlyCard, { hours: 3 })).toBe(270);
});

test('validateHours accepts an entry at or above the minimum', () => {
	expect(validateHours(hourlyCard, 2)).toBe(true);
	expect(validateHours(hourlyCard, 3)).toBe(true);
});

test('validateHours rejects an entry below the minimum without adjusting it', () => {
	expect(validateHours(hourlyCard, 1)).toBe(false);
});

const oneOffCard = {
	kind: 'one_off' as const,
	amount: 5000,
	unit: 'lump_sum',
	allowedFractions: [1],
	minimumHours: null,
	disbursementPeriod: null
};

test('a one-off card prices the lump sum', () => {
	expect(priceRateCard(oneOffCard)).toBe(5000);
});

test('resolveRateCard picks the card whose range contains the date', () => {
	const cards = [
		{ id: 'a', validFrom: '2024-01-01', validTo: '2024-06-30' },
		{ id: 'b', validFrom: '2024-07-01', validTo: null }
	];
	expect(resolveRateCard(cards, '2024-03-15')?.id).toBe('a');
	expect(resolveRateCard(cards, '2024-06-30')?.id).toBe('a');
	expect(resolveRateCard(cards, '2024-07-01')?.id).toBe('b');
	expect(resolveRateCard(cards, '2025-01-01')?.id).toBe('b');
});

test('resolveRateCard finds nothing before the first card starts', () => {
	const cards = [{ id: 'a', validFrom: '2024-01-01', validTo: null }];
	expect(resolveRateCard(cards, '2023-12-31')).toBeNull();
});

test('adjacent periods resolve unambiguously on both sides of the boundary', () => {
	const cards = [
		{ id: 'a', validFrom: '2024-01-01', validTo: '2024-06-30' },
		{ id: 'b', validFrom: '2024-07-01', validTo: '2024-12-31' }
	];
	const juneEnd = resolveRateCard(cards, '2024-06-30');
	const julyStart = resolveRateCard(cards, '2024-07-01');
	expect(juneEnd?.id).toBe('a');
	expect(julyStart?.id).toBe('b');
	expect(juneEnd).not.toBe(julyStart);
});
