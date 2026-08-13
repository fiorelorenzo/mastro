import { expect, test } from 'vitest';
import { niceTicks } from './ticks';

test('a zero range collapses to the single tick zero, never a repeated one', () => {
	expect(niceTicks(0)).toEqual([0]);
	expect(niceTicks(-5)).toEqual([0]);
});

test('a round max produces the exact steps a person would pick by hand', () => {
	expect(niceTicks(1000, 3)).toEqual([0, 500, 1000]);
	expect(niceTicks(100_000, 3)).toEqual([0, 50_000, 100_000]);
});

test('an awkward max — the bug this replaces — lands on round steps, not the raw range halved', () => {
	// The reported defect: max*1.1 landing on 5985 used to tick at
	// 5985 and 2992.5. Nice ticks cover the same range in round steps.
	const ticks = niceTicks(5985, 3);
	expect(ticks[0]).toBe(0);
	expect(ticks.every((tick) => Number.isInteger(tick / 1000) || Number.isInteger(tick / 500))).toBe(
		true
	);
	expect(Math.max(...ticks)).toBeGreaterThanOrEqual(5985);
});

test('every tick is ascending and distinct', () => {
	for (const max of [1, 3, 7, 42, 999, 5985, 349_250, 1_000_000]) {
		const ticks = niceTicks(max, 3);
		expect(ticks).toEqual([...new Set(ticks)]);
		expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
		expect(Math.max(...ticks)).toBeGreaterThanOrEqual(max);
	}
});

test('tickCount is a request, not a guarantee, but stays close to it', () => {
	const ticks = niceTicks(10_000, 5);
	expect(ticks.length).toBeGreaterThanOrEqual(3);
	expect(ticks.length).toBeLessThanOrEqual(7);
});
