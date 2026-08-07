// Pure calendar-grid arithmetic for the month view (#25). No i18n, no
// database, no Svelte — every date in and out is a plain ISO string
// (`YYYY-MM-DD`), always handled at UTC midnight so the grid never shifts
// with the reader's time zone (the same convention `$lib/i18n/format.ts`
// uses for a plain date). Weeks start on Monday: a billing ledger's
// calendar is a work-week tool, and ISO 8601 already settles the question
// instead of branching on locale.

export type CalendarCell = { date: string; inMonth: boolean };

/** The first of the month containing `date` (any ISO date), as `YYYY-MM-01`. */
export function startOfMonth(date: string): string {
	return `${date.slice(0, 7)}-01`;
}

/** `monthStart` (a `YYYY-MM-01`) shifted by `delta` whole months, e.g.
 * `shiftMonth('2024-01-01', -1)` is `'2023-12-01'`. */
export function shiftMonth(monthStart: string, delta: number): string {
	const [year, month] = monthStart.split('-').map(Number);
	const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
	return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** The inclusive `[start, end]` ISO dates of the calendar month containing `monthStart`. */
export function monthRange(monthStart: string): { start: string; end: string } {
	const [year, month] = monthStart.split('-').map(Number);
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return {
		start: monthStart,
		end: `${monthStart.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`
	};
}

/**
 * A Monday-first grid of full weeks covering the month containing
 * `monthStart`, padded with the trailing days of the previous month and
 * the leading days of the next so every week has seven cells — the shape
 * a calendar UI renders directly, one row per week. `inMonth` is `false`
 * for a padding cell, so the caller can grey it out rather than treat it
 * as a real day of the month.
 */
export function buildMonthGrid(monthStart: string): CalendarCell[][] {
	const [year, month] = monthStart.split('-').map(Number);
	const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
	const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

	// getUTCDay(): 0 = Sunday .. 6 = Saturday. Shift so 0 = Monday.
	const leadingDays = (firstOfMonth.getUTCDay() + 6) % 7;
	const gridStart = new Date(firstOfMonth);
	gridStart.setUTCDate(gridStart.getUTCDate() - leadingDays);

	const totalCells = Math.ceil((leadingDays + daysInMonth) / 7) * 7;
	const cells: CalendarCell[] = [];
	for (let i = 0; i < totalCells; i++) {
		const cellDate = new Date(gridStart);
		cellDate.setUTCDate(cellDate.getUTCDate() + i);
		cells.push({
			date: cellDate.toISOString().slice(0, 10),
			inMonth: cellDate.getUTCFullYear() === year && cellDate.getUTCMonth() === month - 1
		});
	}

	const weeks: CalendarCell[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
	return weeks;
}
