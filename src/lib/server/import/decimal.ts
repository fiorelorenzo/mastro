// Converts a decimal-string amount into `MinorUnits` without ever routing
// the value through binary floating point — see the comment on
// `MinorUnits` in `$lib/money` for why. The digit-level reading itself
// lives in `$lib/decimal` (`parseDecimalString`/`roundDecimalParts`),
// outside `$lib/server`, because `AmountInput` needs the same reading in
// the browser that this file applies on submission; this module only adds
// the two things that ARE server-only: the `MinorUnits` brand, and the
// currency's own scale.

import { parseDecimalString, roundDecimalParts } from '$lib/decimal';
import { minorUnits, minorUnitScale, type MinorUnits } from '$lib/money';
import type { Locale } from '$lib/paraglide/runtime';

/**
 * Parses a plain decimal string into `currency`'s minor units, rounding
 * half away from zero one digit past the currency's own scale.
 *
 * Without a `locale` — every FatturaPA field this parses (e.g.
 * `Amount2DecimalType`, `"1220.00"`) — only the wire shape matches: a
 * literal dot, never a thousands separator, regardless of the interface's
 * own locale. A structured import document is not written in anyone's
 * locale; it is a schema, and reading it any other way would make the
 * import non-deterministic.
 *
 * With a `locale` — every manual form submission (`invoice-form.ts`,
 * `expense-form.ts`, `contract-form.ts`'s expense policy cap,
 * `mail-send-form.ts`) — the active locale's own decimal separator and
 * thousands grouping are accepted too, in addition to the bare wire
 * shape. Before this, the parser only ever took `"700.00"` while the
 * whole interface renders `"700,00 €"` in Italian: typing back what the
 * screen shows was a validation error (#203). See `$lib/decimal`'s
 * `parseDecimalString` for exactly how the ambiguity between a grouped
 * integer and a bare decimal resolves — by locale, never by guessing.
 *
 * `currency` is not optional and does not default to two digits, because
 * defaulting is how the hardcoded hundred survived four rounds (#164,
 * #179, #184): a caller that has not thought about the currency should
 * not compile.
 *
 * The fractional part is optional in every reading: a currency with no
 * minor unit has no decimal point to write, and `"1500"` is the only way
 * to say ¥1500. Genuinely malformed input — `"abc"`, `"1.2.3"`,
 * `"1,2,3"`, the empty string — is still rejected in every locale.
 */
export function decimalStringToMinorUnits(
	raw: string,
	currency: string,
	locale?: Locale
): MinorUnits {
	const parts = parseDecimalString(raw, locale);
	if (!parts) throw new Error(`not a decimal amount: ${JSON.stringify(raw)}`);
	const scale = minorUnitScale(currency);
	const digits = String(scale).length - 1;
	return minorUnits(roundDecimalParts(parts, digits));
}
