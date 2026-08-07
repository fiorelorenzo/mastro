// Locale-driven number, date and currency formatting (#66). Everything here
// wraps `Intl` — never a hand-rolled separator, a `toFixed` percentage, or a
// concatenated currency symbol — so this file is the only thing left to
// call: reach for one of these instead of formatting a number or a date
// inline, wherever either is displayed.

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
	amount: number,
	currency: string,
	locale: Locale = getLocale()
): string {
	return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
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
