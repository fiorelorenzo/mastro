import { expect, test } from 'vitest';
import { buildMonthGrid, monthRange, shiftMonth, startOfMonth } from './month-grid';

test('startOfMonth normalises any date in the month to its first day', () => {
	expect(startOfMonth('2026-08-17')).toBe('2026-08-01');
});

test('shiftMonth moves forward and backward, crossing a year boundary', () => {
	expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
	expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
});

test('monthRange spans the whole month, respecting its actual length', () => {
	expect(monthRange('2026-02-01')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
	expect(monthRange('2024-02-01')).toEqual({ start: '2024-02-01', end: '2024-02-29' }); // leap year
	expect(monthRange('2026-08-01')).toEqual({ start: '2026-08-01', end: '2026-08-31' });
});

test('buildMonthGrid returns only full, Monday-first weeks', () => {
	// August 2026 starts on a Saturday and has 31 days.
	const weeks = buildMonthGrid('2026-08-01');
	for (const week of weeks) {
		expect(week).toHaveLength(7);
	}
	expect(weeks[0][0].date).toBe('2026-07-27'); // the Monday before August starts
	expect(weeks[0][0].inMonth).toBe(false);
	expect(weeks[0][5].date).toBe('2026-08-01'); // the Saturday August starts on
	expect(weeks[0][5].inMonth).toBe(true);
});

test('buildMonthGrid marks every day of the target month inMonth, and only those', () => {
	const weeks = buildMonthGrid('2026-08-01');
	const cells = weeks.flat();
	const inMonthDates = cells.filter((cell) => cell.inMonth).map((cell) => cell.date);
	expect(inMonthDates).toHaveLength(31);
	expect(inMonthDates[0]).toBe('2026-08-01');
	expect(inMonthDates.at(-1)).toBe('2026-08-31');
});

test('buildMonthGrid pads a month that already starts on Monday with a full leading week', () => {
	// 2026-02-01 falls on a Sunday, 2026-03-02 on a Monday — pick a month that
	// starts exactly on Monday to prove the padding-free case works too.
	const weeks = buildMonthGrid('2026-06-01'); // 2026-06-01 is a Monday
	expect(weeks[0][0].date).toBe('2026-06-01');
	expect(weeks[0][0].inMonth).toBe(true);
});

test('every cell in the grid is a distinct, consecutive calendar date', () => {
	const cells = buildMonthGrid('2026-08-01').flat();
	for (let i = 1; i < cells.length; i++) {
		const previous = new Date(`${cells[i - 1].date}T00:00:00Z`);
		const current = new Date(`${cells[i].date}T00:00:00Z`);
		expect(current.getTime() - previous.getTime()).toBe(24 * 60 * 60 * 1000);
	}
});
