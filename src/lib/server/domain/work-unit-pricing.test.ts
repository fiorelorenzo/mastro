import { expect, test } from 'vitest';
import { priceWorkUnitOnDate } from './work-unit-pricing';

const dailyCard = {
	id: 'card-1',
	validFrom: '2024-01-01',
	validTo: '2024-05-31',
	kind: 'daily' as const,
	amount: 600,
	unit: 'day',
	allowedFractions: [1, 0.5],
	minimumHours: null,
	disbursementPeriod: null
};

const hourlyCard = {
	id: 'card-2',
	validFrom: '2024-06-01',
	validTo: null,
	kind: 'hourly' as const,
	amount: 90,
	unit: 'hour',
	allowedFractions: [1],
	minimumHours: 2,
	disbursementPeriod: null
};

test('prices a full day against the daily card in force on that date', () => {
	expect(priceWorkUnitOnDate({ date: '2024-03-10', quantity: 1 }, [dailyCard])).toBe(600);
});

test('prices a half day against the daily card in force on that date', () => {
	expect(priceWorkUnitOnDate({ date: '2024-03-10', quantity: 0.5 }, [dailyCard])).toBe(300);
});

test('resolves the card whose validity period actually covers the date, not just the first one', () => {
	expect(priceWorkUnitOnDate({ date: '2024-07-01', quantity: 3 }, [dailyCard, hourlyCard])).toBe(
		270
	);
});

test('returns null when no rate card covers the date', () => {
	expect(priceWorkUnitOnDate({ date: '2023-12-31', quantity: 1 }, [dailyCard])).toBeNull();
});

test('returns null, rather than throwing, when the quantity is not an allowed fraction', () => {
	expect(priceWorkUnitOnDate({ date: '2024-03-10', quantity: 0.25 }, [dailyCard])).toBeNull();
});

test('a fixed_recurring card ignores quantity entirely, same as priceRateCard itself', () => {
	const retainer = {
		id: 'card-3',
		validFrom: '2024-01-01',
		validTo: null,
		kind: 'fixed_recurring' as const,
		amount: 1200,
		unit: 'month',
		allowedFractions: [1],
		minimumHours: null,
		disbursementPeriod: 'monthly' as const
	};
	expect(priceWorkUnitOnDate({ date: '2024-03-10', quantity: 1 }, [retainer])).toBe(1200);
});
