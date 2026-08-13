import { expect, test } from 'vitest';
import { buildMonthGrid } from './month-grid';
import {
	buildCalendarCells,
	summarizeMonth,
	weeksWithEntries,
	type CalendarEntry
} from './calendar-cells';

function entry(
	overrides: Partial<CalendarEntry> & Pick<CalendarEntry, 'id' | 'date' | 'state'>
): CalendarEntry {
	return {
		quantity: 1,
		amount: null,
		currency: null,
		contractLabel: 'Acme — Framework 2026',
		...overrides
	};
}

test('buildCalendarCells attaches nothing to a date the entry map has no key for', () => {
	const weeks = buildMonthGrid('2026-08-01');
	const cells = buildCalendarCells(weeks, new Map());
	const aCell = cells.flat().find((cell) => cell.date === '2026-08-17')!;
	expect(aCell.entries).toEqual([]);
	expect(aCell.primaryState).toBeUndefined();
	expect(aCell.quantity).toBe(0);
	expect(aCell.valueByCurrency.size).toBe(0);
});

test('buildCalendarCells sums quantity and value across two entries landing on the same date', () => {
	const weeks = buildMonthGrid('2026-08-01');
	const entriesByDate = new Map([
		[
			'2026-08-17',
			[
				entry({
					id: 'a',
					date: '2026-08-17',
					state: 'proposed',
					quantity: 1,
					amount: 700,
					currency: 'EUR'
				}),
				entry({
					id: 'b',
					date: '2026-08-17',
					state: 'approved',
					quantity: 0.5,
					amount: 350,
					currency: 'EUR'
				})
			]
		]
	]);
	const cells = buildCalendarCells(weeks, entriesByDate);
	const cell = cells.flat().find((c) => c.date === '2026-08-17')!;
	expect(cell.entries).toHaveLength(2);
	expect(cell.quantity).toBe(1.5);
	expect(cell.valueByCurrency.get('EUR')).toBe(1050);
});

test('buildCalendarCells keeps a value total per currency rather than merging them', () => {
	const weeks = buildMonthGrid('2026-08-01');
	const entriesByDate = new Map([
		[
			'2026-08-17',
			[
				entry({ id: 'a', date: '2026-08-17', state: 'approved', amount: 700, currency: 'EUR' }),
				entry({ id: 'b', date: '2026-08-17', state: 'approved', amount: 900, currency: 'USD' })
			]
		]
	]);
	const cells = buildCalendarCells(weeks, entriesByDate);
	const cell = cells.flat().find((c) => c.date === '2026-08-17')!;
	expect(cell.valueByCurrency.get('EUR')).toBe(700);
	expect(cell.valueByCurrency.get('USD')).toBe(900);
});

test('buildCalendarCells picks the most attention-needing state when a date carries several entries', () => {
	const weeks = buildMonthGrid('2026-08-01');
	const entriesByDate = new Map([
		[
			'2026-08-17',
			[
				entry({ id: 'a', date: '2026-08-17', state: 'paid' }),
				entry({ id: 'b', date: '2026-08-17', state: 'worked_without_approval' }),
				entry({ id: 'c', date: '2026-08-17', state: 'approved' })
			]
		]
	]);
	const cells = buildCalendarCells(weeks, entriesByDate);
	const cell = cells.flat().find((c) => c.date === '2026-08-17')!;
	expect(cell.primaryState).toBe('worked_without_approval');
});

test('buildCalendarCells leaves inMonth/date untouched for a padding cell with no entries', () => {
	const weeks = buildMonthGrid('2026-08-01');
	const cells = buildCalendarCells(weeks, new Map());
	const padding = cells[0][0];
	expect(padding.date).toBe('2026-07-27');
	expect(padding.inMonth).toBe(false);
	expect(padding.entries).toEqual([]);
});

test('weeksWithEntries keeps only weeks carrying at least one entry, in order', () => {
	const weeks = buildMonthGrid('2026-08-01'); // 6 weeks: Jul27, Aug3, Aug10, Aug17, Aug24, Aug31
	const entriesByDate = new Map([
		['2026-08-04', [entry({ id: 'a', date: '2026-08-04', state: 'approved' })]],
		['2026-08-18', [entry({ id: 'b', date: '2026-08-18', state: 'proposed' })]]
	]);
	const cells = buildCalendarCells(weeks, entriesByDate);
	const nonEmpty = weeksWithEntries(cells);
	expect(nonEmpty).toHaveLength(2);
	expect(nonEmpty[0].some((cell) => cell.date === '2026-08-04')).toBe(true);
	expect(nonEmpty[1].some((cell) => cell.date === '2026-08-18')).toBe(true);
});

test('weeksWithEntries drops a month with nothing recorded entirely', () => {
	const weeks = buildMonthGrid('2026-08-01');
	const cells = buildCalendarCells(weeks, new Map());
	expect(weeksWithEntries(cells)).toEqual([]);
});

test('summarizeMonth sums approved and proposed quantity separately from worked', () => {
	const entries: CalendarEntry[] = [
		entry({ id: 'a', date: '2026-08-03', state: 'approved', quantity: 1 }),
		entry({ id: 'b', date: '2026-08-04', state: 'approved', quantity: 1 }),
		entry({ id: 'c', date: '2026-08-17', state: 'proposed', quantity: 1 }),
		entry({ id: 'd', date: '2026-08-18', state: 'proposed', quantity: 0.5 }),
		entry({ id: 'e', date: '2026-08-01', state: 'worked', quantity: 2 })
	];
	const totals = summarizeMonth(entries);
	expect(totals.approvedDays).toBe(2);
	expect(totals.proposedDays).toBe(1.5);
	expect(totals.workedDays).toBe(2);
});

test('summarizeMonth counts worked, invoiced, paid, disputed and unbillable toward workedDays but not rejected/revoked/proposed/approved', () => {
	const entries: CalendarEntry[] = [
		entry({ id: 'a', date: '2026-08-01', state: 'worked', quantity: 1 }),
		entry({ id: 'b', date: '2026-08-02', state: 'worked_without_approval', quantity: 1 }),
		entry({ id: 'c', date: '2026-08-03', state: 'invoiced', quantity: 1 }),
		entry({ id: 'd', date: '2026-08-04', state: 'paid', quantity: 1 }),
		entry({ id: 'e', date: '2026-08-05', state: 'disputed', quantity: 1 }),
		entry({ id: 'f', date: '2026-08-06', state: 'unbillable', quantity: 1 }),
		entry({ id: 'g', date: '2026-08-07', state: 'rejected', quantity: 1 }),
		entry({ id: 'h', date: '2026-08-08', state: 'revoked', quantity: 1 }),
		entry({ id: 'i', date: '2026-08-09', state: 'proposed', quantity: 1 }),
		entry({ id: 'j', date: '2026-08-10', state: 'approved', quantity: 1 })
	];
	expect(summarizeMonth(entries).workedDays).toBe(6);
});

test('summarizeMonth sums value across every priced entry regardless of state, grouped by currency, and skips unpriced entries', () => {
	const entries: CalendarEntry[] = [
		entry({ id: 'a', date: '2026-08-03', state: 'approved', amount: 700, currency: 'EUR' }),
		entry({ id: 'b', date: '2026-08-17', state: 'proposed', amount: 350, currency: 'EUR' }),
		entry({ id: 'c', date: '2026-08-20', state: 'worked', amount: null, currency: null })
	];
	const totals = summarizeMonth(entries);
	expect(totals.valueByCurrency.get('EUR')).toBe(1050);
	expect(totals.valueByCurrency.size).toBe(1);
});

test('summarizeMonth returns zeros and an empty value map for an empty month', () => {
	const totals = summarizeMonth([]);
	expect(totals).toEqual({
		approvedDays: 0,
		proposedDays: 0,
		workedDays: 0,
		valueByCurrency: new Map()
	});
});
