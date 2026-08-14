import { expect, test } from 'vitest';
import { monthRangeForDate } from './dispute-bundle';

test('a mid-month date resolves to the full calendar month it falls in', () => {
	expect(monthRangeForDate('2026-06-15')).toEqual({ from: '2026-06-01', to: '2026-06-30' });
});

test('the first of the month is still the whole month, not a one-day range', () => {
	expect(monthRangeForDate('2026-02-01')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
});

test('December rolls the range into the same year, never into January of the next one', () => {
	expect(monthRangeForDate('2026-12-25')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
});

test('February in a leap year keeps the 29th', () => {
	expect(monthRangeForDate('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
});
