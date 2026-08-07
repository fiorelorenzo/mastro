import { expect, test } from 'vitest';
import { recurringFeeOccurrences, type RecurringFeeCard } from './recurring-fee';

const monthlyRetainer: RecurringFeeCard = {
	id: 'card-1',
	validFrom: '2024-01-01',
	validTo: null,
	kind: 'fixed_recurring',
	amount: 1_200,
	unit: 'month',
	allowedFractions: [1],
	minimumHours: null,
	disbursementPeriod: 'monthly'
};

test('a monthly retainer yields one occurrence per month, each priced at the full monthly amount', () => {
	const occurrences = recurringFeeOccurrences(monthlyRetainer, '2024-01-01', '2024-05-01');
	expect(occurrences).toEqual([
		{ date: '2024-01-01', amount: 1_200 },
		{ date: '2024-02-01', amount: 1_200 },
		{ date: '2024-03-01', amount: 1_200 },
		{ date: '2024-04-01', amount: 1_200 }
	]);
});

test('an annual fee paid quarterly yields four occurrences a year, each the quarterly share', () => {
	const quarterly: RecurringFeeCard = {
		...monthlyRetainer,
		amount: 24_000,
		unit: 'year',
		disbursementPeriod: 'quarterly'
	};
	const occurrences = recurringFeeOccurrences(quarterly, '2024-01-01', '2025-01-01');
	expect(occurrences.map((o) => o.date)).toEqual([
		'2024-01-01',
		'2024-04-01',
		'2024-07-01',
		'2024-10-01'
	]);
	expect(occurrences.every((o) => o.amount === 6_000)).toBe(true);
});

test('occurrences before the requested window are skipped, not just their amount zeroed', () => {
	const occurrences = recurringFeeOccurrences(monthlyRetainer, '2024-06-01', '2024-08-01');
	expect(occurrences.map((o) => o.date)).toEqual(['2024-06-01', '2024-07-01']);
});

test('a card that closes stops generating occurrences after its own validTo, inclusive', () => {
	const closed: RecurringFeeCard = { ...monthlyRetainer, validTo: '2024-03-01' };
	const occurrences = recurringFeeOccurrences(closed, '2024-01-01', '2024-12-01');
	expect(occurrences.map((o) => o.date)).toEqual(['2024-01-01', '2024-02-01', '2024-03-01']);
});

test('a card anchored on the 31st clamps onto a shorter month rather than overflowing', () => {
	const card: RecurringFeeCard = { ...monthlyRetainer, validFrom: '2024-01-31' };
	const occurrences = recurringFeeOccurrences(card, '2024-01-01', '2024-05-01');
	// February 2024 has 29 days (a leap year); April has 30.
	expect(occurrences.map((o) => o.date)).toEqual([
		'2024-01-31',
		'2024-02-29',
		'2024-03-31',
		'2024-04-30'
	]);
});

test('a one_time disbursement yields a single occurrence on validFrom, not a monthly march', () => {
	const oneTime: RecurringFeeCard = {
		...monthlyRetainer,
		amount: 24_000,
		unit: 'year',
		disbursementPeriod: 'one_time'
	};
	const occurrences = recurringFeeOccurrences(oneTime, '2024-01-01', '2025-01-01');
	expect(occurrences).toHaveLength(1);
	expect(occurrences[0].date).toBe('2024-01-01');
});

test('a card of any other kind has no recurring schedule', () => {
	const daily: RecurringFeeCard = {
		...monthlyRetainer,
		kind: 'daily',
		allowedFractions: [1, 0.5]
	};
	expect(recurringFeeOccurrences(daily, '2024-01-01', '2025-01-01')).toEqual([]);
});

test('an invalid period is rejected rather than silently yielding nothing', () => {
	expect(() => recurringFeeOccurrences(monthlyRetainer, '2024-05-01', '2024-01-01')).toThrow(
		/invalid period/
	);
});
