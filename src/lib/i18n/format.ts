// Locale-driven number, date and currency formatting (#66). Everything here
// wraps `Intl` — never a hand-rolled separator, a `toFixed` percentage, or a
// concatenated currency symbol — so this file is the only thing left to
// call: reach for one of these instead of formatting a number or a date
// inline, wherever either is displayed.

import type { MinorUnits, NotMinorUnits } from '$lib/money';
import { getLocale, type Locale } from '$lib/paraglide/runtime';

/**
 * A plain number in the active locale's own decimal and thousands
 * separators, e.g. `1234.5` reads `1,234.5` in English and `1.234,5` in
 * Italian. The building block every other formatter here narrows with an
 * `Intl.NumberFormat` style option.
 */
export function formatNumber(value: number, locale: Locale = getLocale()): string {
	return new Intl.NumberFormat(locale).format(value);
}

/**
 * A monetary amount in `currency` (an ISO 4217 code, e.g. `'EUR'`, as
 * stored on a contract — see `src/lib/server/db/schema/contract.ts`). Intl
 * picks the symbol, its position relative to the digits, and the
 * decimal/thousands separators for the active locale; nothing here ever
 * concatenates a currency symbol onto a formatted number by hand.
 */
export function formatAmount(
	amount: NotMinorUnits,
	currency: string,
	locale: Locale = getLocale()
): string {
	return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

/**
 * A monetary amount stored as `MinorUnits` (cents for EUR — see
 * `server/import/invoice.ts` and `server/fiscal/pack.ts`: every amount in
 * this codebase is an integer minor-unit count, never a float). Converts
 * to the major unit using the currency's own number of decimal digits from
 * `Intl` — never a hardcoded `/ 100`, since a handful of real currencies
 * (Japanese yen, Bahraini dinar, ...) use zero or three — before handing
 * off to `formatAmount`.
 */
export function formatMinorUnits(
	minorUnits: MinorUnits,
	currency: string,
	locale: Locale = getLocale()
): string {
	const { maximumFractionDigits = 2 } = new Intl.NumberFormat(locale, {
		style: 'currency',
		currency
	}).resolvedOptions();
	return formatAmount(minorUnits / 10 ** maximumFractionDigits, currency, locale);
}

/**
 * A count of work-unit days, e.g. `1 day` / `1 giorno`, `3 days` / `3
 * giorni`. Goes through Intl's unit formatter rather than a hand-rolled
 * plural suffix, because "day" does not become "giorni" by appending an
 * `s`.
 */
export function formatDays(count: number, locale: Locale = getLocale()): string {
	return new Intl.NumberFormat(locale, {
		style: 'unit',
		unit: 'day',
		unitDisplay: 'long'
	}).format(count);
}

/**
 * A ratio as a percentage, e.g. `0.04` reads `4%` in both locales mastro
 * ships today — the point is not that the digits differ here, it is that
 * neither call site multiplies by 100 and appends a `%` by hand.
 */
export function formatPercent(value: number, locale: Locale = getLocale()): string {
	return new Intl.NumberFormat(locale, { style: 'percent' }).format(value);
}

/**
 * An ISO calendar date (`'2024-03-01'`) or a `Date`, in the active locale's
 * own day/month/year order, e.g. `Mar 1, 2024` in English and `1 mar 2024`
 * in Italian — never `toISOString().slice(0, 10)` or a hand-built
 * `dd/mm/yyyy`. A plain date string is read at UTC midnight so the
 * calendar day it names never shifts with the reader's time zone.
 */
export function formatDate(date: string | Date, locale: Locale = getLocale()): string {
	const value = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : date;
	return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(value);
}

/**
 * The weekday name for an ISO calendar date, in the active locale's own
 * script and abbreviation convention, e.g. `Mon` in English and `lun` in
 * Italian — the month calendar's column headers (#25), never a
 * hand-rolled `['Mon', 'Tue', ...]` array that would silently stay
 * English under the Italian locale.
 */
export function formatWeekday(date: string, locale: Locale = getLocale()): string {
	const value = new Date(`${date}T00:00:00Z`);
	return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(value);
}

/**
 * A month and year, e.g. `August 2026` in English and `agosto 2026` in
 * Italian — the month calendar's own heading (#25). `monthStart` is any
 * ISO date inside the month; only its year/month are read.
 */
export function formatMonth(monthStart: string, locale: Locale = getLocale()): string {
	const value = new Date(`${monthStart}T00:00:00Z`);
	return new Intl.DateTimeFormat(locale, {
		year: 'numeric',
		month: 'long',
		timeZone: 'UTC'
	}).format(value);
}

/**
 * A month, abbreviated, e.g. `Feb 2026` in English and `feb 2026` in
 * Italian — the cash calendar's own x-axis (#58), where twelve
 * `formatMonth`-length labels in a row would overlap. Still carries the
 * full year: the window can cross a calendar year boundary (December
 * into January), and a two-digit year would blur that.
 */
export function formatMonthShort(monthStart: string, locale: Locale = getLocale()): string {
	const value = new Date(`${monthStart}T00:00:00Z`);
	return new Intl.DateTimeFormat(locale, {
		year: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	}).format(value);
}

/**
 * A precise instant in time — an approval's `receivedAt`, a work-unit
 * transition's `createdAt` — in the active locale's own date and time
 * convention, e.g. `Mar 1, 2024, 9:00 AM`. Unlike `formatDate`, this reads
 * in the viewer's own time zone rather than pinning to UTC: an instant is
 * one point on the timeline, not a calendar day that must stay put
 * regardless of who is looking at it. Takes a full ISO datetime string or
 * a `Date` — never a plain `'YYYY-MM-DD'` (that is what `formatDate` is
 * for; feeding one here through `new Date(...)` would parse it at
 * midnight UTC and then render it shifted into the local zone).
 */
export function formatDateTime(instant: string | Date, locale: Locale = getLocale()): string {
	const value = typeof instant === 'string' ? new Date(instant) : instant;
	return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}

/**
 * A Monday-first week as a compact range, e.g. `3–9 August` in English and
 * `3–9 agosto` in Italian — the phone month agenda's own section heading
 * (#221), where a dense list groups by week instead of drawing every empty
 * day. `Intl`'s own range formatter already orders day/month per locale and
 * folds in the month (or year, crossing one) only where the two dates
 * actually differ; `formatRangeToParts` rather than `formatRange` because
 * the plain range formatter zero-pads the day number ("03–09") in every
 * locale this product ships, which no single-date formatter here does.
 */
export function formatWeekRange(start: string, end: string, locale: Locale = getLocale()): string {
	const startDate = new Date(`${start}T00:00:00Z`);
	const endDate = new Date(`${end}T00:00:00Z`);
	const parts = new Intl.DateTimeFormat(locale, {
		day: 'numeric',
		month: 'long',
		timeZone: 'UTC'
	}).formatRangeToParts(startDate, endDate);
	return parts
		.map((part) => (part.type === 'day' ? String(Number(part.value)) : part.value))
		.join('');
}
