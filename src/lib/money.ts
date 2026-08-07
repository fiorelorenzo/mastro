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
