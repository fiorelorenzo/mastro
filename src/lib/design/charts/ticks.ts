// A "nice number" axis-tick helper (#235, cross-cutting ask from the
// 2026-08-13 dashboard review): every chart with a continuous axis gets
// round ticks for free, rather than each chart reinventing
// `[0, max / 2, max]` — the bug that produced ticks at `5985,00` and
// `3492,50` on the cash calendar, because `top` was `round(max * 1.1)`
// and everything else fell out of dividing that arbitrary number in
// half. This file is universal (no server import, no currency, no
// locale): it turns a plain numeric range into round numeric ticks.
// Currency-aware wrapping (minor units, EUR's cents) belongs to the
// caller — see `dashboard/cash-calendar.ts`'s `cashCalendarYTicks`.

/**
 * Rounds `value` to the nearest "nice" leading digit — 1, 2, 5 or 10 times
 * a power of ten. `round: true` picks the nearest of those (used for a
 * tick *step*, where landing close to the actual value matters more than
 * covering it); `round: false` picks the smallest one at or above `value`
 * (used for the overall *range*, which must not under-cover the data).
 * The classic algorithm (Sparks, "Nice Numbers for Graph Labels"), the
 * same one d3-array's `tickStep` is built on.
 */
function niceNumber(value: number, round: boolean): number {
	if (value <= 0) return 0;
	const exponent = Math.floor(Math.log10(value));
	const fraction = value / 10 ** exponent;
	let niceFraction: number;
	if (round) {
		niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
	} else {
		niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
	}
	return niceFraction * 10 ** exponent;
}

/**
 * Ascending, round ticks from `0` to at least `max` — `[0, 3000, 6000]`
 * for a `max` of `5985`, never `[0, 3492.5, 5985]`. `tickCount` is the
 * number of ticks *requested*; the actual step is rounded to a nice
 * number, so the returned array can run one short or one long of it.
 * `max <= 0` (an instance with no data yet) returns the single tick
 * `[0]` — half of nothing is still not a tick anybody reads.
 */
export function niceTicks(max: number, tickCount = 3): readonly number[] {
	if (max <= 0) return [0];
	const roughStep = niceNumber(max, false) / Math.max(1, tickCount - 1);
	const step = niceNumber(roughStep, true);
	const niceMax = Math.ceil(max / step) * step;
	const ticks: number[] = [];
	for (let value = 0; value <= niceMax + step / 2; value += step) {
		// Guards against float drift from repeated `+=` (e.g. `0.1 + 0.2`)
		// producing a tick that prints with a spurious trailing digit.
		ticks.push(Number(value.toFixed(10)));
	}
	return ticks;
}
