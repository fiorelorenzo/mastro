// Locale-aware decimal-string parsing and rendering, shared by the server
// (`$lib/server/import/decimal.ts`'s `decimalStringToMinorUnits`, the
// authority for a submission) and the browser (`AmountInput`'s live
// re-render on blur). It lives here, outside `$lib/server`, for the exact
// reason `$lib/money`'s `minorUnitsToDecimalString` does: a component that
// renders in the browser cannot import server-only code, and the two sides
// of this product's oldest form bug (#203) — what the UI prints and what
// its own inputs accept — must read the same rules or they drift again.
//
// No I/O, no `$lib/server` import, nothing here throws for a shape it
// cannot parse: `parseDecimalString` returns `null` instead, so a caller on
// either side decides for itself whether that is a thrown validation error
// (the server) or an untouched text field (the browser, mid-edit).

import { minorUnitScale, type NotMinorUnits } from '$lib/money';
import type { Locale } from '$lib/paraglide/runtime';

export interface DecimalParts {
	readonly sign: '' | '-';
	readonly intPart: string;
	readonly fracPart: string;
}

// The wire format: a structured document's own decimal shape (FatturaPA's
// `Amount2DecimalType`, `"1220.00"`) — a literal dot, never a thousands
// separator, because it is not anyone's locale, it is a schema. This is
// also the fallback reading under a locale (see `parseDecimalString`):
// typing a bare dot stays legible even when the active locale's own
// decimal mark is a comma.
const MACHINE = /^(-?)(\d+)(?:\.(\d+))?$/;

function escapeForCharClass(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface LocalePattern {
	readonly native: RegExp;
	readonly group: string;
	readonly decimal: string;
}

// `locales` is a small fixed set (`'en' | 'it'`) — a plain object is the
// project's own convention for a small static string-keyed lookup, even
// as a lazily-filled cache; `locale` is never anything else at runtime.
const localePatternCache: Partial<Record<Locale, LocalePattern>> = {};

function localePattern(locale: Locale): LocalePattern {
	const cached = localePatternCache[locale];
	if (cached) return cached;
	// Read the separators off `Intl` itself rather than hardcoding "it uses
	// a comma" — the same discipline `$lib/i18n/format.ts` insists on for
	// rendering applies to reading a value back in. Probed with a
	// seven-digit value, not `1234.5`: some locales' CLDR data (Italian
	// included) only group once there are at least two full groups —
	// `Intl.NumberFormat('it').format(1234.5)` alone renders `"1234,5"`,
	// no separator at all, and probing with it would silently fall back
	// to the wrong `group` character.
	const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
	const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.';
	const group = parts.find((part) => part.type === 'group')?.value ?? ',';
	const d = escapeForCharClass(decimal);
	const g = escapeForCharClass(group);
	// An integer part is legible two ways: no separator at all
	// (`"1234567"`), or full thousands grouping (`"1.234.567"` — a leading
	// group of one to three digits, then only complete triplets). Anything
	// in between, e.g. `"1,2,3"`, is not a shorthand for anything; it is
	// rejected rather than guessed at.
	const native = new RegExp(`^(-?)(\\d+|\\d{1,3}(?:${g}\\d{3})+)(?:${d}(\\d+))?$`);
	const pattern: LocalePattern = { native, group, decimal };
	localePatternCache[locale] = pattern;
	return pattern;
}

/**
 * Parses a plain decimal string into its sign and digit runs, without
 * interpreting them against any currency scale — that step is
 * `decimalStringToMinorUnits`'s, in `$lib/server/import/decimal.ts`.
 *
 * Without a `locale`, only the machine shape matches: a literal dot,
 * never a thousands separator. This is unchanged from before #203 and
 * stays the only shape a structured import document gets read as,
 * regardless of the interface's own locale.
 *
 * With a `locale`, three readings are tried, most specific first: the
 * locale's own full thousands grouping plus its own decimal mark
 * (`"1.234,56"` in Italian), the locale's decimal mark alone
 * (`"700,00"`), and — because it must not stop being legible just for
 * having a fixed decimal point — the bare machine shape (`"700.00"`).
 * The first one that fits wins; a string that fits the locale's own
 * grouping is never re-read as a bare decimal (`"1.234"` in Italian is
 * one thousand two hundred thirty-four, a complete grouped integer, not
 * one point two three four) — ambiguity resolves by locale, not by
 * guessing. A partial grouping (`"1,2,3"`), more than one decimal point,
 * or anything else that is not digits and separators still parses to
 * `null` in every locale.
 */
export function parseDecimalString(raw: string, locale?: Locale): DecimalParts | null {
	const trimmed = raw.trim();
	if (!locale) {
		const match = MACHINE.exec(trimmed);
		if (!match) return null;
		const [, sign, intPart, fracPart = ''] = match;
		return { sign: sign as '' | '-', intPart, fracPart };
	}
	const { native, group } = localePattern(locale);
	const match = native.exec(trimmed) ?? MACHINE.exec(trimmed);
	if (!match) return null;
	const [, sign, intPartRaw, fracPart = ''] = match;
	const intPart = group ? intPartRaw.split(group).join('') : intPartRaw;
	return { sign: sign as '' | '-', intPart, fracPart };
}

/**
 * Rounds `parts` to exactly `digits` fractional places, half away from
 * zero, and returns the signed integer at that scale (cents, for
 * `digits: 2`). Integer digit-string arithmetic throughout — `Number` is
 * only ever applied to an already-integral run of digits — so a value
 * with more decimal places than `digits` never drifts through a binary
 * float on its way to the rounded result. Shared by
 * `decimalStringToMinorUnits`'s conversion to `MinorUnits` and
 * `formatDecimalString`'s re-render, so the two can never round
 * differently for the same input.
 */
export function roundDecimalParts(parts: DecimalParts, digits: number): number {
	const scale = 10 ** digits;
	const fracPadded = parts.fracPart.padEnd(digits + 1, '0');
	const whole =
		Number(parts.intPart) * scale + (digits === 0 ? 0 : Number(fracPadded.slice(0, digits)));
	const roundingDigit = fracPadded.charCodeAt(digits) - 48;
	const rounded = roundingDigit >= 5 ? whole + 1 : whole;
	return parts.sign === '-' ? -rounded : rounded;
}

/**
 * Re-renders a decimal string in its canonical form for `currency` and
 * `locale` — the locale's own decimal mark, the currency's own
 * fraction-digit count, rounded the same way `decimalStringToMinorUnits`
 * would round it — or `null` if `raw` does not parse. `AmountInput` calls
 * this on blur, so the field always shows back exactly what the parser
 * accepted (#203): typing `"700"` becomes `"700,00"` in Italian, and the
 * round trip between what is displayed and what is re-typed is provably
 * closed rather than assumed.
 *
 * Deliberately ungrouped: an editable field re-inserting thousands
 * separators after every blur fights its own next keystroke. Grouping is
 * `Amount`'s job, through `formatAmount`/`formatMinorUnits` — this
 * function is read-what-you-typed, not a second renderer for display.
 */
export function formatDecimalString(raw: string, currency: string, locale?: Locale): string | null {
	const parts = parseDecimalString(raw, locale);
	if (!parts) return null;
	const scale = minorUnitScale(currency);
	const digits = String(scale).length - 1;
	const rounded = roundDecimalParts(parts, digits);
	const sign = rounded < 0 ? '-' : '';
	const abs = Math.abs(rounded);
	if (digits === 0) return `${sign}${abs}`;
	const intPart = Math.trunc(abs / scale);
	const fracPart = String(abs % scale).padStart(digits, '0');
	const decimalMark = locale ? localePattern(locale).decimal : '.';
	return `${sign}${intPart}${decimalMark}${fracPart}`;
}

/**
 * Formats an already-major-unit amount (`rate_card.amount` — see the
 * comment on `NotMinorUnits` in `$lib/money`) as a plain decimal string
 * at `currency`'s own fraction-digit count. `AmountInput`'s major-unit
 * companion to `minorUnitsToDecimalString` in `$lib/money`: seeding
 * either kind of field only ever takes the matching branded type, never
 * a bare `number` that could be either — the mix-up `$lib/money`
 * documents as this codebase's most repeated bug.
 */
export function majorUnitsToDecimalString(amount: NotMinorUnits, currency: string): string {
	const scale = minorUnitScale(currency);
	const digits = String(scale).length - 1;
	return amount.toFixed(digits);
}
