// Aggregation helpers for #234's "this week" strip: a Monday-first week
// of dates for the mini calendar, month bounds for the backlog stat
// tiles, and the aggregation itself (count / total days / value) over
// work units `+page.server.ts` already priced via `priceWorkUnitOnDate`
// — the same function `day/calendar`'s own loader uses — never a second
// fiscal calculation.

import { sumMinorUnits, type MinorUnits } from '$lib/money';

export interface PricedWorkUnit {
	readonly date: string;
	readonly state: string;
	readonly quantity: number;
	readonly amount: MinorUnits;
}

export interface BacklogStat {
	readonly count: number;
	readonly totalDays: number;
	readonly valueMinorUnits: MinorUnits;
	/** Ascending, distinct dates — the stat tile's own "which days" sub-text. */
	readonly sampleDates: readonly string[];
}

/** Every row whose `state` is one of `states`, summarised: the count,
 * total day-fraction and value a stat tile shows, plus which dates it
 * covers so the sub-text can name them rather than only count them. */
export function summarizeWorkUnitsByState(
	rows: readonly PricedWorkUnit[],
	states: readonly string[]
): BacklogStat {
	const matches = rows.filter((row) => states.includes(row.state));
	const dates = [...new Set(matches.map((row) => row.date))].sort();
	return {
		count: matches.length,
		totalDays: matches.reduce((sum, row) => sum + row.quantity, 0),
		valueMinorUnits: sumMinorUnits(matches.map((row) => row.amount)),
		sampleDates: dates
	};
}

/** The Monday-first week of ISO dates (`YYYY-MM-DD`) containing
 * `referenceIso`, UTC-anchored like every other date computation in this
 * codebase (`fiscal/ceiling.ts`'s and `fiscal/certainty.ts`'s own
 * `addDaysIso`). */
export function weekDates(referenceIso: string): readonly string[] {
	const reference = new Date(`${referenceIso}T00:00:00Z`);
	const weekday = reference.getUTCDay(); // 0 (Sunday) .. 6 (Saturday)
	const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
	const monday = new Date(reference);
	monday.setUTCDate(monday.getUTCDate() + mondayOffset);
	return Array.from({ length: 7 }, (_, index) => {
		const day = new Date(monday);
		day.setUTCDate(day.getUTCDate() + index);
		return day.toISOString().slice(0, 10);
	});
}

/** The inclusive `[start, end]` ISO-date bounds of the calendar month
 * `referenceIso` falls in. */
export function monthBounds(referenceIso: string): {
	readonly start: string;
	readonly end: string;
} {
	const [year, month] = referenceIso.split('-').map(Number);
	const start = `${year}-${String(month).padStart(2, '0')}-01`;
	const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
	return { start, end };
}
