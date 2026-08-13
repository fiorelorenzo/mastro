/**
 * An amount in the currency's minor unit: cents for EUR, and nothing at all
 * for a currency with no minor unit, since how many minor units make one
 * major unit is a property of the currency and not a constant (yen has
 * zero, Bahraini dinar three). Always an integer, never a float, because a
 * fiscal amount must not lose precision to binary rounding — see
 * `$lib/server/import/decimal.ts`, which parses one out of a document's
 * decimal string without the value ever passing through a float.
 *
 * This lives here, outside `$lib/server`, for the same reason `LegalText`
 * lives apart from the i18n layer: a jurisdiction pack, a browser component
 * pre-filling a form and an import adapter all need it, and none of them
 * should have to import the others to say "this number is money".
 */
declare const minorUnitsBrand: unique symbol;

export type MinorUnits = number & { readonly [minorUnitsBrand]: true };

/**
 * A number that is explicitly *not* money. `formatAmount` takes this rather
 * than a bare `number`, so handing it a `MinorUnits` is a type error: the
 * optional brand can only be `undefined`, and a `MinorUnits` carries `true`.
 * That is the whole mechanism behind #168 — #164 was nine call sites passing
 * a minor-unit column to a major-unit formatter, and nothing objected.
 */
export type NotMinorUnits = number & { readonly [minorUnitsBrand]?: never };

/**
 * What this does not catch, written here rather than in a merged pull
 * request nobody will read: an anonymous sum. `formatAmount(a + b, 'EUR')`
 * compiles, because `a + b` is a plain `number` and a plain number is
 * legitimately what `formatAmount` takes. Every total in this codebase
 * lands in a `MinorUnits`-typed slot first, which forces it through the
 * operations below and re-brands it, so the real call sites are covered.
 * The expression form is not. If you are adding one, name it first.
 */

/**
 * The single door through which a plain number becomes money. Everywhere
 * else, a `MinorUnits` is produced by another `MinorUnits`: the schema
 * declares the columns, `decimalStringToMinorUnits` parses documents and
 * form input, and the operations below keep the brand across arithmetic.
 *
 * Throws on a non-integer, because a fractional minor unit is not a
 * rounding preference, it is a value that has already been through a float
 * and lost the guarantee this type exists to make.
 */
export function minorUnits(value: number): MinorUnits {
	if (!Number.isInteger(value)) {
		throw new Error(`minor units must be a whole number, got ${value}`);
	}
	return value as MinorUnits;
}

/**
 * Money arithmetic, brand in and brand out.
 *
 * These exist because a brand does not survive `+`: `a + b` on two
 * `MinorUnits` is a plain `number`, and without them every sum would have
 * to be re-branded by hand at the call site, which is a cast with a
 * friendlier name and would leave the guard covering bare columns but not
 * totals. `totalOutstandingByCurrency` was one of #164's nine wrong sites,
 * so totals are exactly where the hole must not be.
 */
export function sumMinorUnits(values: Iterable<MinorUnits>): MinorUnits {
	let total = 0;
	for (const value of values) total += value;
	return total as MinorUnits;
}

export function addMinorUnits(...values: MinorUnits[]): MinorUnits {
	return sumMinorUnits(values);
}

/** The additive inverse, brand preserved — a credit note's line amount
 * (always stored non-negative, like every other invoice line) flipped to
 * the negative ledger contribution it actually is (#213's
 * `fetchLedgerRows`), without a caller reaching for a bare unary `-` on a
 * branded value. */
export function negateMinorUnits(value: MinorUnits): MinorUnits {
	// `-0 as MinorUnits` would be a real, distinct value here (`0 - 0 ===
	// -0` never applies, but unary negation on the literal zero does): a
	// row worth nothing, correctly negated, must stay exactly `0`, not a
	// value `Object.is`-distinct from every other zero this module hands
	// out.
	return (value === 0 ? 0 : -value) as MinorUnits;
}

/**
 * Money times a plain ratio — a tax rate, a share, a fraction of a day —
 * rounded to a whole minor unit, since a fraction of a cent is not a value
 * this codebase is allowed to hold.
 */
export function scaleMinorUnits(amount: MinorUnits, factor: number): MinorUnits {
	return Math.round(amount * factor) as MinorUnits;
}

/**
 * How many minor units make one major unit of `currency`, read from `Intl`
 * rather than assumed. A hundred for EUR, one for JPY, a thousand for BHD.
 *
 * The same lookup `formatMinorUnits` does. It lives here because the two
 * conversions below and the formatter must agree, and because a hardcoded
 * hundred has now been wrong in four separate places (#164, #179, and the
 * two this replaces).
 */
export function minorUnitScale(currency: string): number {
	const { maximumFractionDigits = 2 } = new Intl.NumberFormat('en', {
		style: 'currency',
		currency
	}).resolvedOptions();
	return 10 ** maximumFractionDigits;
}

/**
 * A major-unit amount — a rate card's price, a figure a person typed —
 * converted to the minor units everything downstream stores.
 *
 * Deliberately not `Math.round(amount * scale)`. Multiplying a decimal by
 * a hundred in binary floating point is the thing this codebase has said
 * since `decimal.ts` was written that it does not do: the value goes to a
 * fixed-digit string first and the digits are read off it, so the last
 * minor unit is decided by decimal rounding rather than by however the
 * product happened to land. `toFixed` is the same step the previous
 * `fiscal/forecast.ts` helper used, so figures are unchanged.
 */
export function minorUnitsFromMajor(amount: number, currency: string): MinorUnits {
	const scale = minorUnitScale(currency);
	const digits = String(scale).length - 1;
	const fixed = Math.abs(amount).toFixed(digits);
	const [intPart, fracPart = ''] = fixed.split('.');
	const whole = Number(intPart) * scale + (digits === 0 ? 0 : Number(fracPart));
	return ((amount < 0 ? -whole : whole) || 0) as MinorUnits;
}

/** Zero, as money. */
export const NO_MINOR_UNITS = 0 as MinorUnits;

/**
 * Round-trips a value already stored as `MinorUnits` back
 * into a plain, non-localised decimal string for an editable form field —
 * e.g. pre-filling `expense.amount` or `ExpensePolicy`'s `capAmount` on an
 * edit screen. Not a display helper (`$lib/i18n/format.ts`'s
 * `formatMinorUnits` owns that, through `Intl`) and not server-only
 * arithmetic (`$lib/server/import/decimal.ts`'s `decimalStringToMinorUnits`
 * owns parsing a submission back into cents): this lives outside
 * `$lib/server` on purpose, since a `+page.svelte` pre-filling a form runs
 * in the browser and cannot import server-only code. Integer arithmetic
 * throughout — the amount is already whole, so there is no rounding step
 * to get wrong, only digit formatting. The number of digits comes from the
 * currency, not from the number two: a JPY amount renders with none, and
 * `decimalStringToMinorUnits` must be given the same currency to read it
 * back.
 */
export function minorUnitsToDecimalString(amount: MinorUnits, currency: string): string {
	const scale = minorUnitScale(currency);
	const sign = amount < 0 ? '-' : '';
	const abs = Math.abs(amount);
	const intPart = Math.trunc(abs / scale);
	if (scale === 1) return `${sign}${intPart}`;
	const digits = String(scale).length - 1;
	const fracPart = String(abs % scale).padStart(digits, '0');
	return `${sign}${intPart}.${fracPart}`;
}
