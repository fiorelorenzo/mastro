import { expect, test } from 'vitest';
import {
	previewDayValue,
	previewRateCardPrice,
	previewRatePerUnit,
	quantityModeForCard,
	ratePeriodFor,
	resolveActiveRateCard,
	type RateCardPreview
} from './day-value';

const dailyCard: RateCardPreview = {
	id: 'daily',
	kind: 'daily',
	amount: 700,
	unit: 'day',
	allowedFractions: [1, 0.5],
	disbursementPeriod: null,
	validFrom: '2026-01-01',
	validTo: null
};

const hourlyCard: RateCardPreview = {
	id: 'hourly',
	kind: 'hourly',
	amount: 90,
	unit: 'hour',
	allowedFractions: [],
	disbursementPeriod: null,
	validFrom: '2026-01-01',
	validTo: null
};

const monthlyRetainer: RateCardPreview = {
	id: 'retainer',
	kind: 'fixed_recurring',
	amount: 1800,
	unit: 'month',
	allowedFractions: [],
	disbursementPeriod: 'monthly',
	validFrom: '2026-03-01',
	validTo: null
};

const annualFeePaidQuarterly: RateCardPreview = {
	id: 'annual',
	kind: 'fixed_recurring',
	amount: 24000,
	unit: 'year',
	allowedFractions: [],
	disbursementPeriod: 'quarterly',
	validFrom: '2026-01-01',
	validTo: null
};

const oneOffCard: RateCardPreview = {
	id: 'lump',
	kind: 'one_off',
	amount: 5000,
	unit: 'lump_sum',
	allowedFractions: [],
	disbursementPeriod: null,
	validFrom: '2026-01-01',
	validTo: null
};

test('a daily card prices a full day at the full rate, a half day at half', () => {
	expect(previewRateCardPrice(dailyCard, { fraction: 1 })).toBe(700);
	expect(previewRateCardPrice(dailyCard, { fraction: 0.5 })).toBe(350);
});

test('a daily card previews null, never a throw, for a fraction it does not allow', () => {
	expect(previewRateCardPrice(dailyCard, { fraction: 0.25 })).toBeNull();
});

test('an hourly card prices hours at the hourly rate', () => {
	expect(previewRateCardPrice(hourlyCard, { hours: 3.5 })).toBe(315);
});

test('an hourly card previews null for zero or negative hours', () => {
	expect(previewRateCardPrice(hourlyCard, { hours: 0 })).toBeNull();
});

test('a flat monthly retainer is unchanged by monthly disbursement', () => {
	expect(previewRateCardPrice(monthlyRetainer, {})).toBe(1800);
});

test('an annual fee paid quarterly yields the quarterly share, not the annual figure', () => {
	expect(previewRateCardPrice(annualFeePaidQuarterly, {})).toBe(6000);
});

test('a one-off card previews the lump sum regardless of occurrence', () => {
	expect(previewRateCardPrice(oneOffCard, {})).toBe(5000);
});

test('resolveActiveRateCard picks the card whose range contains the date', () => {
	const cards = [
		{ ...dailyCard, id: 'a', validFrom: '2026-01-01', validTo: '2026-06-30' },
		{ ...dailyCard, id: 'b', validFrom: '2026-07-01', validTo: null }
	];
	expect(resolveActiveRateCard(cards, '2026-03-15')?.id).toBe('a');
	expect(resolveActiveRateCard(cards, '2026-07-01')?.id).toBe('b');
});

test('resolveActiveRateCard finds nothing before the first card starts', () => {
	expect(resolveActiveRateCard([dailyCard], '2025-12-31')).toBeNull();
});

test('quantityModeForCard is hours only for an hourly card, day-fraction for everything else including no card', () => {
	expect(quantityModeForCard(hourlyCard)).toBe('hours');
	expect(quantityModeForCard(dailyCard)).toBe('day-fraction');
	expect(quantityModeForCard(monthlyRetainer)).toBe('day-fraction');
	expect(quantityModeForCard(null)).toBe('day-fraction');
});

test('ratePeriodFor names what a card is denominated per, null when the amount is already the whole of it', () => {
	expect(ratePeriodFor(dailyCard)).toBe('day');
	expect(ratePeriodFor(hourlyCard)).toBe('hour');
	expect(ratePeriodFor(monthlyRetainer)).toBe('month');
	expect(ratePeriodFor(annualFeePaidQuarterly)).toBe('quarter');
	expect(ratePeriodFor(oneOffCard)).toBeNull();
	expect(ratePeriodFor({ ...monthlyRetainer, disbursementPeriod: 'one_time' })).toBeNull();
});

test('previewRatePerUnit prices exactly one canonical unit — a full day, an hour, one disbursement', () => {
	expect(previewRatePerUnit(dailyCard)).toBe(700);
	expect(previewRatePerUnit(hourlyCard)).toBe(90);
	expect(previewRatePerUnit(monthlyRetainer)).toBe(1800);
	expect(previewRatePerUnit(oneOffCard)).toBe(5000);
});

test('previewDayValue resolves the active card and prices the given quantity in one call', () => {
	const preview = previewDayValue([dailyCard], '2026-08-13', 0.5);
	expect(preview).not.toBeNull();
	expect(preview?.card.id).toBe('daily');
	expect(preview?.mode).toBe('day-fraction');
	expect(preview?.amount).toBe(350);
});

test('previewDayValue is null, not a crash, when no card covers the date', () => {
	expect(previewDayValue([dailyCard], '2025-01-01', 1)).toBeNull();
});

test('previewDayValue carries an unpriced (null) amount without losing which card was active', () => {
	const preview = previewDayValue([dailyCard], '2026-08-13', 0.25);
	expect(preview?.card.id).toBe('daily');
	expect(preview?.amount).toBeNull();
});
