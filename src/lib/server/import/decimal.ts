// Converts the decimal-string amounts a structured invoice document
// carries (e.g. FatturaPA's `Amount2DecimalType`, `"1220.00"`) into
// `MinorUnits` without ever routing the value through binary floating
// point — see the comment on `MinorUnits` in `invoice.ts` for why. A
// format that hands over a float has already lost the guarantee this file
// exists to keep; adapters must read amounts as strings.

import { minorUnits, type MinorUnits } from '$lib/money';

const DECIMAL = /^(-?)(\d+)\.(\d+)$/;

/**
 * Parses a plain decimal string into minor units, rounding half away from
 * zero at the second fractional digit. Every arithmetic step works on the
 * string's digits directly (`Number` is only ever applied to an
 * already-integral run of digits), so a value with more than two decimal
 * places — legal for some FatturaPA amounts, e.g. `PrezzoUnitario` — never
 * passes through a float on its way to cents.
 */
export function decimalStringToMinorUnits(raw: string): MinorUnits {
	const match = DECIMAL.exec(raw.trim());
	if (!match) throw new Error(`not a decimal amount: ${JSON.stringify(raw)}`);
	const [, sign, intPart, fracPartRaw] = match;
	const fracPart = fracPartRaw.padEnd(3, '0');
	const cents = Number(intPart) * 100 + Number(fracPart.slice(0, 2));
	const roundingDigit = fracPart.charCodeAt(2) - 48;
	const rounded = roundingDigit >= 5 ? cents + 1 : cents;
	return minorUnits(sign === '-' ? -rounded : rounded);
}
