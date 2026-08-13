import { expect, test } from 'vitest';
import { selectGoverningCeilingIds, type GroupableCeiling } from './ceiling';
import { minorUnits } from '$lib/money';

// it-flat-rate.ts's own shape: two ceilings, one basis, different limits.
const SOFT: GroupableCeiling = {
	id: 'soft',
	basis: 'cash_received_calendar_year',
	limitValue: minorUnits(8_500_000),
	crossed: false
};
const HARD: GroupableCeiling = {
	id: 'hard',
	basis: 'cash_received_calendar_year',
	limitValue: minorUnits(10_000_000),
	crossed: false
};

test('#234: a basis shared by two ceilings collapses to one governing id — the tighter, uncrossed one', () => {
	expect(selectGoverningCeilingIds([SOFT, HARD])).toEqual(new Set(['soft']));
	// Order in the input does not change the outcome.
	expect(selectGoverningCeilingIds([HARD, SOFT])).toEqual(new Set(['soft']));
});

test('once the tighter limit is crossed, the looser one governs instead', () => {
	expect(selectGoverningCeilingIds([{ ...SOFT, crossed: true }, HARD])).toEqual(new Set(['hard']));
});

test('once every limit in a group is crossed, the loosest (worst-case) one still governs', () => {
	expect(
		selectGoverningCeilingIds([
			{ ...SOFT, crossed: true },
			{ ...HARD, crossed: true }
		])
	).toEqual(new Set(['hard']));
});

test('ceilings on different bases never group — each keeps its own card', () => {
	const other: GroupableCeiling = {
		id: 'other',
		basis: 'invoiced_calendar_year',
		limitValue: minorUnits(1),
		crossed: false
	};
	expect(selectGoverningCeilingIds([SOFT, HARD, other])).toEqual(new Set(['soft', 'other']));
});

test('a single ceiling with no sibling is its own governing id', () => {
	expect(selectGoverningCeilingIds([SOFT])).toEqual(new Set(['soft']));
});

test('no ceilings produces no governing ids', () => {
	expect(selectGoverningCeilingIds([])).toEqual(new Set());
});
