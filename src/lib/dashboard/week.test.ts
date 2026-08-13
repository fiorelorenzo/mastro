import { expect, test } from 'vitest';
import { minorUnits } from '$lib/money';
import { monthBounds, summarizeWorkUnitsByState, weekDates } from './week';

test('weekDates returns the Monday-first week containing the reference date', () => {
	// 2026-08-13 is a Thursday.
	expect(weekDates('2026-08-13')).toEqual([
		'2026-08-10',
		'2026-08-11',
		'2026-08-12',
		'2026-08-13',
		'2026-08-14',
		'2026-08-15',
		'2026-08-16'
	]);
});

test('weekDates handles a Sunday reference (the week it belongs to precedes it)', () => {
	expect(weekDates('2026-08-16')).toEqual(weekDates('2026-08-13'));
});

test("weekDates handles a Monday reference (it is the week's own first day)", () => {
	expect(weekDates('2026-08-10')[0]).toBe('2026-08-10');
});

test('weekDates crosses a month boundary correctly', () => {
	// 2026-08-31 is a Monday; the week runs to 2026-09-06.
	expect(weekDates('2026-08-31')).toEqual([
		'2026-08-31',
		'2026-09-01',
		'2026-09-02',
		'2026-09-03',
		'2026-09-04',
		'2026-09-05',
		'2026-09-06'
	]);
});

test('monthBounds returns the first and last day of the reference month', () => {
	expect(monthBounds('2026-08-13')).toEqual({ start: '2026-08-01', end: '2026-08-31' });
	// February in a non-leap year.
	expect(monthBounds('2026-02-01')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
});

test('summarizeWorkUnitsByState filters by state and aggregates count/days/value/dates', () => {
	const rows = [
		{ date: '2026-08-04', state: 'approved', quantity: 1, amount: minorUnits(70_000) },
		{ date: '2026-08-03', state: 'approved', quantity: 1, amount: minorUnits(70_000) },
		{ date: '2026-08-01', state: 'worked', quantity: 1, amount: minorUnits(70_000) }
	];
	const stat = summarizeWorkUnitsByState(rows, ['approved']);
	expect(stat.count).toBe(2);
	expect(stat.totalDays).toBe(2);
	expect(stat.valueMinorUnits).toBe(140_000);
	// Ascending despite the input order.
	expect(stat.sampleDates).toEqual(['2026-08-03', '2026-08-04']);
});

test('summarizeWorkUnitsByState with no matches returns a zeroed, empty stat', () => {
	const stat = summarizeWorkUnitsByState([], ['approved']);
	expect(stat).toEqual({ count: 0, totalDays: 0, valueMinorUnits: 0, sampleDates: [] });
});
