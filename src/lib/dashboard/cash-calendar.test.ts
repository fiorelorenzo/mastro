import { expect, test } from 'vitest';
import { cashCalendarYTicks } from './cash-calendar';

test('the y axis never repeats a tick, however flat the data is', () => {
	// An instance with no ledger at all: the scale collapses and there is
	// exactly one meaningful tick. Three identical ones used to blank the
	// whole dashboard on first login (#143), because the axis keys its
	// ticks by label and Svelte refuses a duplicate key mid-hydration.
	expect(cashCalendarYTicks(0)).toEqual([0]);
	expect(cashCalendarYTicks(1)).toEqual([0, 1]);

	// A real range still gets its three, ascending.
	expect(cashCalendarYTicks(100_000)).toEqual([0, 50_000, 100_000]);

	// An odd range rounds to whole minor units rather than producing two
	// ticks that would print identically.
	const odd = cashCalendarYTicks(3);
	expect(odd).toEqual([...new Set(odd)]);
	expect(odd).toEqual([...odd].sort((a, b) => a - b));
});
