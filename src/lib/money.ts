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

/**
 * Money times a plain ratio — a tax rate, a share, a fraction of a day —
 * rounded to a whole minor unit, since a fraction of a cent is not a value
 * this codebase is allowed to hold.
 */
export function scaleMinorUnits(amount: MinorUnits, factor: number): MinorUnits {
	return Math.round(amount * factor) as MinorUnits;
}

/** Zero, as money. */
export const NO_MINOR_UNITS = 0 as MinorUnits;

/**
 * Round-trips a value already stored as `MinorUnits` (integer cents) back
 * into a plain, non-localised decimal string for an editable form field —
 * e.g. pre-filling `expense.amount` or `ExpensePolicy`'s `capAmount` on an
 * edit screen. Not a display helper (`$lib/i18n/format.ts`'s
 * `formatMinorUnits` owns that, through `Intl`) and not server-only
 * arithmetic (`$lib/server/import/decimal.ts`'s `decimalStringToMinorUnits`
 * owns parsing a submission back into cents): this lives outside
 * `$lib/server` on purpose, since a `+page.svelte` pre-filling a form runs
 * in the browser and cannot import server-only code. Integer arithmetic
 * throughout — `cents` is already whole, so there is no rounding step to
 * get wrong, only digit formatting.
 */
export function minorUnitsToDecimalString(cents: number): string {
	const sign = cents < 0 ? '-' : '';
	const abs = Math.abs(cents);
	const intPart = Math.trunc(abs / 100);
	const fracPart = String(abs % 100).padStart(2, '0');
	return `${sign}${intPart}.${fracPart}`;
}
