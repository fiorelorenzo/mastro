// Pure logic for turning a `month-grid.ts` grid into what the calendar page
// actually renders (#221): which day carries which entries, what a cell is
// worth, and which weeks are worth a phone reader's screen space at all. No
// i18n, no database, no Svelte — same contract as `month-grid.ts`, so this
// stays unit-testable without a component renderer.

import { dayCountsTowardDays, mostAttentionNeedingState } from '../work-unit-state';
import type { WorkUnitStateValue } from '../work-unit-state';
import type { CalendarCell } from './month-grid';

/** One day's work unit, already priced and labelled — the shape
 *  `+page.server.ts` already builds for the flat entry list, reused here
 *  rather than invented twice. */
export type CalendarEntry = {
	id: string;
	date: string;
	state: WorkUnitStateValue;
	quantity: number;
	/** `null` when no rate card covers the date — see `priceWorkUnitOnDate`. */
	amount: number | null;
	currency: string | null;
	contractLabel: string;
};

export type CalendarDayCell = CalendarCell & {
	entries: readonly CalendarEntry[];
	/** The state to lead the cell's badge with — `undefined` for a day that
	 *  carries nothing, so the caller never has to fake a state for an empty
	 *  cell. */
	primaryState: WorkUnitStateValue | undefined;
	/** Total quantity across every entry on this date. Not itself a day
	 *  count: a contract can be priced hourly, in which case this is hours
	 *  (see `priceWorkUnitOnDate`) — render it as a bare number, not with
	 *  `formatDays`. */
	quantity: number;
	/** Total priced value across every entry on this date, grouped by
	 *  currency: rarely more than one entry deep, but two contracts landing
	 *  a day on the same date can carry different currencies. */
	valueByCurrency: ReadonlyMap<string, number>;
};

function sumValueByCurrency(entries: readonly CalendarEntry[]): ReadonlyMap<string, number> {
	const totals = new Map<string, number>();
	for (const entry of entries) {
		if (entry.amount === null || entry.currency === null) continue;
		totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + entry.amount);
	}
	return totals;
}

/**
 * `weeks` (from `buildMonthGrid`) with each cell's own day's entries folded
 * in, keyed by `entriesByDate` (ISO date → the entries on it, as
 * `+page.server.ts` already groups them). A date the map has no entry for
 * renders as an empty cell.
 */
export function buildCalendarCells(
	weeks: readonly (readonly CalendarCell[])[],
	entriesByDate: ReadonlyMap<string, readonly CalendarEntry[]>
): CalendarDayCell[][] {
	return weeks.map((week) =>
		week.map((cell) => {
			const entries = entriesByDate.get(cell.date) ?? [];
			return {
				...cell,
				entries,
				primaryState:
					entries.length > 0
						? mostAttentionNeedingState(entries.map((entry) => entry.state))
						: undefined,
				quantity: entries.reduce((sum, entry) => sum + entry.quantity, 0),
				valueByCurrency: sumValueByCurrency(entries)
			};
		})
	);
}

/**
 * Only the weeks that carry at least one entry — the phone agenda's feed
 * (#221): a dense list of what actually happened, not a table dump of every
 * day the month contains. A week with nothing in it, padding included, is
 * dropped outright rather than rendered as an empty section.
 */
export function weeksWithEntries(
	weeks: readonly (readonly CalendarDayCell[])[]
): CalendarDayCell[][] {
	return weeks
		.filter((week) => week.some((cell) => cell.entries.length > 0))
		.map((week) => [...week]);
}

export type MonthTotals = {
	/** Sum of quantity for days still in `approved` — confirmed, not yet worked. */
	approvedDays: number;
	/** Sum of quantity for days still in `proposed` — not yet confirmed. */
	proposedDays: number;
	/** Sum of quantity for days that actually happened, whatever their
	 *  eventual billing outcome — the same definition `dayCountsTowardDays`
	 *  already gives the rest of the product (excludes `proposed`/
	 *  `approved`, which have not happened yet, and `rejected`/`revoked`,
	 *  which turned out not to). */
	workedDays: number;
	/** Every priced entry in the month, regardless of state, grouped by
	 *  currency — what the month is worth, matching the sum of every cell's
	 *  own displayed value. */
	valueByCurrency: ReadonlyMap<string, number>;
};

/** The month header's four stats (#221). */
export function summarizeMonth(entries: readonly CalendarEntry[]): MonthTotals {
	let approvedDays = 0;
	let proposedDays = 0;
	let workedDays = 0;
	const valueByCurrency = new Map<string, number>();
	for (const entry of entries) {
		if (entry.state === 'approved') approvedDays += entry.quantity;
		if (entry.state === 'proposed') proposedDays += entry.quantity;
		if (dayCountsTowardDays(entry.state)) workedDays += entry.quantity;
		if (entry.amount !== null && entry.currency !== null) {
			valueByCurrency.set(
				entry.currency,
				(valueByCurrency.get(entry.currency) ?? 0) + entry.amount
			);
		}
	}
	return { approvedDays, proposedDays, workedDays, valueByCurrency };
}
