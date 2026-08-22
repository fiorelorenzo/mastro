import { expect, test } from 'vitest';
import { minorUnits } from '$lib/money';
import {
	formatAmount,
	formatBytes,
	formatDate,
	formatDateTime,
	formatDays,
	formatDuration,
	formatHours,
	formatMinorUnits,
	formatNumber,
	formatPercent,
	formatWeekRange
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

test('an hours quantity pluralizes per locale, the hourly-rate-card sibling of formatDays', () => {
	expect(formatHours(1, 'en')).toBe('1 hour');
	expect(formatHours(3.5, 'en')).toBe('3.5 hours');
	expect(formatHours(1, 'it')).toBe('1 ora');
	expect(formatHours(3.5, 'it')).toBe('3,5 ore');
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

test('a full ISO instant renders as its UTC calendar day, not a RangeError', () => {
	// #436: this appended `T00:00:00Z` unconditionally, so an instant became
	// `'…T10:16:03.465ZT00:00:00Z'`, an Invalid Date, and Intl threw
	// `RangeError: date value is not finite` rather than returning anything
	// odd a caller might notice. Two alert details carry an instant off a
	// timestamp column, so the weekly digest 500'd for as long as either
	// alert was active. The type said `string` and meant "date-only string".
	expect(formatDate('2026-08-21T10:16:03.465Z', 'en')).toBe('Aug 21, 2026');
	expect(formatDate('2026-08-21T10:16:03.465Z', 'it')).toBe('21 ago 2026');
	// Read in UTC like a calendar day, not in the reader's zone: an instant
	// late on the 21st UTC must not render as the 22nd for a reader east of
	// it, the same guarantee the calendar-day case above has.
	expect(formatDate('2026-08-21T23:59:59.999Z', 'en')).toBe('Aug 21, 2026');
	expect(formatDate('2026-08-21T00:00:00.000Z', 'en')).toBe('Aug 21, 2026');
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

// ICU's own range separator is U+2013 flanked by U+2009 thin spaces (not the
// plain space every other formatter in this file uses) whenever the two
// dates differ — invisible in a diff, so do not "clean up" the spacing
// around the dash below by hand.
test('a week range reads compactly within one month, in each locale’s own day/month order', () => {
	expect(formatWeekRange('2026-08-03', '2026-08-09', 'en')).toBe('August 3 – 9');
	expect(formatWeekRange('2026-08-03', '2026-08-09', 'it')).toBe('3–9 agosto');
});

test('a week range crossing a month boundary names both months, without a zero-padded day', () => {
	expect(formatWeekRange('2026-07-27', '2026-08-02', 'en')).toBe('July 27 – August 2');
	expect(formatWeekRange('2026-07-27', '2026-08-02', 'it')).toBe('27 luglio – 2 agosto');
});

test('a week range crossing a year boundary names both years', () => {
	expect(formatWeekRange('2026-12-28', '2027-01-03', 'it')).toBe(
		'28 dicembre 2026 – 3 gennaio 2027'
	);
});

test('a byte count picks the largest unit that keeps it readable, decimal steps', () => {
	expect(formatBytes(512, 'en')).toBe('512 byte');
	expect(formatBytes(432_300_000, 'en')).toBe('432.3 MB');
	expect(formatBytes(432_300_000, 'it')).toBe('432,3 MB');
	expect(formatBytes(1_500_000_000, 'en')).toBe('1.5 GB');
});

test('a duration in seconds picks the largest unit that keeps it readable, 60-based steps', () => {
	expect(formatDuration(3, 'en')).toBe('3 sec');
	expect(formatDuration(90, 'en')).toBe('1.5 min');
	expect(formatDuration(90, 'it')).toBe('1,5 min');
	expect(formatDuration(5400, 'en')).toBe('1.5 hr');
});

test('a negative duration never renders below zero', () => {
	expect(formatDuration(-5, 'en')).toBe('0 sec');
});
