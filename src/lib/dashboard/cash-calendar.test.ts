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

test('#235: an awkward maximum (the reported 5985,00 / 3492,50 bug) ticks on round euros', () => {
	// max*1.1 on a real month total used to land on exactly this kind of
	// number. Nice ticks cover the same range in round major-unit steps.
	const ticks = cashCalendarYTicks(598_500);
	expect(ticks[0]).toBe(0);
	// Every tick is a round number of major units (a whole multiple of
	// 100 minor units), never a fraction like 3492,50.
	for (const tick of ticks) expect(tick % 100).toBe(0);
	expect(Math.max(...ticks)).toBeGreaterThanOrEqual(598_500);
});
