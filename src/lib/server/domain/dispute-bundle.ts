/**
 * The pure arithmetic behind #214's evidence bundle: which register period
 * a disputed day's own register entry is read against.
 */

/**
 * The calendar month containing `dateIso`, as an inclusive `[from, to]`
 * range — calendar-aligned (the 1st to the last day of the month the day
 * itself falls in), not a rolling 30 days, so the figure matches whatever
 * register a client would independently pull for the same month
 * (`buildRegister`, `repositories/register.ts`).
 */
export function monthRangeForDate(dateIso: string): { from: string; to: string } {
	const [year, month] = dateIso.split('-').map(Number);
	const from = new Date(Date.UTC(year, month - 1, 1));
	const to = new Date(Date.UTC(year, month, 0));
	return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
