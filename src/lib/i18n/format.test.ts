import { expect, test } from 'vitest';
import { minorUnits } from '$lib/money';
import {
	formatAmount,
	formatDate,
	formatDateTime,
	formatDays,
	formatMinorUnits,
	formatNumber,
	formatPercent
} from './format';

test('the same figure renders with each locale’s own decimal separator', () => {
	expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
	expect(formatNumber(1234.5, 'it')).toBe('1234,5');
});

test('a bigger figure also renders with each locale’s own thousands separator', () => {
	// Italian groups by thousands only from the fifth digit on (CLDR "min2"),
	// which is why the case above alone would not exercise it: a genuine
	// property of the locale, not an oversight in this test.
	expect(formatNumber(12_345.5, 'en')).toBe('12,345.5');
	expect(formatNumber(12_345.5, 'it')).toBe('12.345,5');
});

test('an amount places the currency symbol and separators per locale, never a concatenated symbol', () => {
	expect(formatAmount(12_345.5, 'EUR', 'en')).toBe('€12,345.50');
	expect(formatAmount(12_345.5, 'EUR', 'it')).toBe('12.345,50\u00a0€');
});

test('a minor-units amount converts using the currency\u2019s own decimal digits, never a hardcoded /100', () => {
	expect(formatMinorUnits(minorUnits(1_234_550), 'EUR', 'en')).toBe(
		formatAmount(12_345.5, 'EUR', 'en')
	);
	// Japanese yen has zero minor-unit digits: the stored integer already is
	// the major-unit amount, unlike EUR's cents.
	expect(formatMinorUnits(minorUnits(1234), 'JPY', 'en')).toBe(formatAmount(1234, 'JPY', 'en'));
});

test('a day quantity pluralizes per locale instead of appending a hand-rolled "s"', () => {
	expect(formatDays(1, 'en')).toBe('1 day');
	expect(formatDays(3, 'en')).toBe('3 days');
	expect(formatDays(1, 'it')).toBe('1 giorno');
	expect(formatDays(3, 'it')).toBe('3 giorni');
});

test('a percentage renders through Intl, not a hand-rolled multiply-by-100-and-suffix', () => {
	expect(formatPercent(0.04, 'en')).toBe('4%');
	expect(formatPercent(0.04, 'it')).toBe('4%');
});

test('a date renders in the locale’s own order', () => {
	expect(formatDate('2024-03-01', 'en')).toBe('Mar 1, 2024');
	expect(formatDate('2024-03-01', 'it')).toBe('1 mar 2024');
});

test('a date given as an ISO calendar day never shifts to the adjacent day', () => {
	// A naive `new Date('2024-03-01')` parse plus a timezone-naive formatter
	// is exactly how a date display drifts by one day for readers west of
	// UTC; both the UTC read and the UTC format above guard against it.
	expect(formatDate('2024-01-01', 'en')).toBe('Jan 1, 2024');
	expect(formatDate('2024-12-31', 'en')).toBe('Dec 31, 2024');
});

test('a timestamp renders with locale-appropriate date and time, in the reader’s own time zone, not fixed to UTC like a calendar day', () => {
	// Unlike formatDate above, a timestamp such as "data saved at" (#61) has
	// to say how long ago that was for the person looking at it, so the
	// expectation here is computed against the environment's own resolved
	// zone instead of a hardcoded clock reading that would be flaky across
	// machines in different time zones.
	const instant = new Date('2024-03-01T14:32:00Z');
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const expectedEn = new Intl.DateTimeFormat('en', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone
	}).format(instant);
	const expectedIt = new Intl.DateTimeFormat('it', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone
	}).format(instant);

	expect(formatDateTime(instant, 'en')).toBe(expectedEn);
	expect(formatDateTime('2024-03-01T14:32:00Z', 'it')).toBe(expectedIt);
});

test('a Date and its equivalent ISO instant string format identically', () => {
	const instant = new Date('2024-06-15T09:05:00Z');
	expect(formatDateTime(instant, 'en')).toBe(formatDateTime('2024-06-15T09:05:00Z', 'en'));
});
