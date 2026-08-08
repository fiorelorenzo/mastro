// #48. `proposeDayMapping` is pure, tested with hand-built rate cards and
// candidate days rather than a real database — the repository layer
// (`persist.ts`) is what actually reads eligible days and rate cards.
import { expect, test } from 'vitest';
import { minorUnits } from '$lib/money';
import { proposeDayMapping, type DayMappingCandidateDay } from './day-mapping';

const dailyCard = {
	id: 'card-1',
	validFrom: '2024-01-01',
	validTo: null,
	kind: 'daily' as const,
	amount: 600,
	unit: 'day',
	allowedFractions: [1, 0.5],
	minimumHours: null,
	disbursementPeriod: null
};

const hourlyCard = {
	id: 'card-2',
	validFrom: '2024-01-01',
	validTo: null,
	kind: 'hourly' as const,
	amount: 90,
	unit: 'hour',
	allowedFractions: [1],
	minimumHours: 2,
	disbursementPeriod: null
};

function day(id: string, date: string, quantity = 1): DayMappingCandidateDay {
	return { id, date, quantity };
}

test('picks the oldest eligible days first, up to the line quantity, with the reasoning fields filled in', () => {
	const days = [day('d1', '2024-03-01'), day('d2', '2024-03-04'), day('d3', '2024-03-10')];
	const proposal = proposeDayMapping(
		{ quantity: 2, amount: minorUnits(120000) },
		'2024-03-15',
		days,
		[dailyCard],
		'EUR'
	);
	expect(proposal).toEqual({
		workUnitIds: ['d1', 'd2'],
		periodStart: '2024-03-01',
		periodEnd: '2024-03-04',
		dayCount: 2,
		proposedAmount: 120000,
		lineAmount: 120000,
		amountMatches: true
	});
});

test('amountMatches is false when the rate-card price disagrees with the document, but the proposal still stands', () => {
	const days = [day('d1', '2024-03-01')];
	const proposal = proposeDayMapping(
		{ quantity: 1, amount: minorUnits(55000) },
		'2024-03-15',
		days,
		[dailyCard],
		'EUR'
	);
	expect(proposal).not.toBeNull();
	expect(proposal?.proposedAmount).toBe(60000);
	expect(proposal?.lineAmount).toBe(55000);
	expect(proposal?.amountMatches).toBe(false);
});

test('half-day and full-day quantities combine to an exact match', () => {
	const days = [day('d1', '2024-03-01', 0.5), day('d2', '2024-03-02', 1)];
	const proposal = proposeDayMapping(
		{ quantity: 1.5, amount: minorUnits(90000) },
		'2024-03-15',
		days,
		[dailyCard],
		'EUR'
	);
	expect(proposal?.workUnitIds).toEqual(['d1', 'd2']);
	expect(proposal?.dayCount).toBe(2);
});

test('proposes nothing when there are not enough eligible days to reach the line quantity', () => {
	const days = [day('d1', '2024-03-01')];
	const proposal = proposeDayMapping(
		{ quantity: 3, amount: minorUnits(180000) },
		'2024-03-15',
		days,
		[dailyCard],
		'EUR'
	);
	expect(proposal).toBeNull();
});

test('proposes nothing when the running total overshoots without ever landing on the exact quantity', () => {
	const days = [day('d1', '2024-03-01'), day('d2', '2024-03-02')];
	// No combination of whole days sums to 1.5.
	const proposal = proposeDayMapping(
		{ quantity: 1.5, amount: minorUnits(90000) },
		'2024-03-15',
		days,
		[dailyCard],
		'EUR'
	);
	expect(proposal).toBeNull();
});

test('never picks a day dated after the invoice issue date', () => {
	const days = [day('d1', '2024-03-01'), day('d2', '2024-04-01')];
	const proposal = proposeDayMapping(
		{ quantity: 2, amount: minorUnits(120000) },
		'2024-03-15',
		days,
		[dailyCard],
		'EUR'
	);
	expect(proposal).toBeNull();
});

test('proposes nothing for a contract whose rate card in force on the issue date is not daily', () => {
	const days = [day('d1', '2024-03-01')];
	const proposal = proposeDayMapping(
		{ quantity: 1, amount: minorUnits(60000) },
		'2024-03-15',
		days,
		[hourlyCard],
		'EUR'
	);
	expect(proposal).toBeNull();
});

test('proposes nothing when no rate card covers the issue date at all', () => {
	const days = [day('d1', '2024-03-01')];
	const proposal = proposeDayMapping(
		{ quantity: 1, amount: minorUnits(60000) },
		'2023-03-15',
		days,
		[dailyCard],
		'EUR'
	);
	expect(proposal).toBeNull();
});

test('resolves the rate card in force on the issue date, not the first one in the list', () => {
	const oldCard = { ...dailyCard, id: 'card-old', validFrom: '2023-01-01', validTo: '2023-12-31' };
	const days = [day('d1', '2024-03-01')];
	const proposal = proposeDayMapping(
		{ quantity: 1, amount: minorUnits(60000) },
		'2024-03-15',
		days,
		[oldCard, hourlyCard],
		'EUR'
	);
	// The card in force on 2024-03-15 is hourly, not the old daily one.
	expect(proposal).toBeNull();
});

test('prices a day in a zero-decimal currency without a hardcoded hundred-scale', () => {
	// JPY's minor unit equals its major unit (scale 1): a ¥600/day rate
	// card prices one day to 600, not the 60000 a hardcoded `* 100` would
	// produce — the same hardcoded scale #164, #179 and #184 keep finding.
	const days = [day('d1', '2024-03-01')];
	const proposal = proposeDayMapping(
		{ quantity: 1, amount: minorUnits(600) },
		'2024-03-15',
		days,
		[dailyCard],
		'JPY'
	);
	expect(proposal).not.toBeNull();
	expect(proposal?.proposedAmount).toBe(600);
	expect(proposal?.amountMatches).toBe(true);
});
