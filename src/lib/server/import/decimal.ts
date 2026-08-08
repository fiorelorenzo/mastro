// Converts the decimal-string amounts a structured invoice document
// carries (e.g. FatturaPA's `Amount2DecimalType`, `"1220.00"`) into
// `MinorUnits` without ever routing the value through binary floating
// point — see the comment on `MinorUnits` in `$lib/money` for why. A
// format that hands over a float has already lost the guarantee this file
// exists to keep; adapters must read amounts as strings.

import { minorUnits, minorUnitScale, type MinorUnits } from '$lib/money';

// The fractional part is optional: a currency with no minor unit has no
// decimal point to write, and `"1500"` is the only way to say ¥1500.
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Parses a plain decimal string into `currency`'s minor units, rounding
 * half away from zero one digit past the currency's own scale. Every
 * arithmetic step works on the string's digits directly (`Number` is only
 * ever applied to an already-integral run of digits), so a value with more
 * decimal places than the currency has — legal for some FatturaPA amounts,
 * e.g. `PrezzoUnitario` — never passes through a float on its way to minor
 * units.
 *
 * `currency` is not optional and does not default to two digits, because
 * defaulting is how the hardcoded hundred survived four rounds (#164,
 * #179, #184): a caller that has not thought about the currency should not
 * compile.
 *
 * One deliberate loosening comes with this: the fractional part is now
 * optional, so `"12"` parses as twelve euros where it used to be rejected
 * as malformed. That rejection cannot survive a currency with no minor
 * unit, since `"1500"` is the only way to write ¥1500, and a rule that
 * applied to some currencies and not others would be worse than either.
 * Genuinely malformed input — `"abc"`, `"1.2.3"`, the empty string — is
 * still rejected.
 */
export function decimalStringToMinorUnits(raw: string, currency: string): MinorUnits {
	const match = DECIMAL.exec(raw.trim());
	if (!match) throw new Error(`not a decimal amount: ${JSON.stringify(raw)}`);
	const [, sign, intPart, fracPartRaw = ''] = match;

	const scale = minorUnitScale(currency);
	const digits = String(scale).length - 1;
	// One digit past the currency's scale is all the rounding needs.
	const fracPart = fracPartRaw.padEnd(digits + 1, '0');
	const whole = Number(intPart) * scale + (digits === 0 ? 0 : Number(fracPart.slice(0, digits)));
	const roundingDigit = fracPart.charCodeAt(digits) - 48;
	const rounded = roundingDigit >= 5 ? whole + 1 : whole;
	return minorUnits(sign === '-' ? -rounded : rounded);
}
