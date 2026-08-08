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
export type MinorUnits = number;

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
