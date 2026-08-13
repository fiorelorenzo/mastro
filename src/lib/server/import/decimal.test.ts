import { expect, test } from 'vitest';
import { decimalStringToMinorUnits } from './decimal';
import { minorUnits, minorUnitsToDecimalString } from '$lib/money';

test('a plain two-decimal amount converts to cents exactly', () => {
	expect(decimalStringToMinorUnits('1220.00', 'EUR')).toBe(122000);
	expect(decimalStringToMinorUnits('0.00', 'EUR')).toBe(0);
	expect(decimalStringToMinorUnits('7.47', 'EUR')).toBe(747);
});

test('a negative amount keeps its sign', () => {
	expect(decimalStringToMinorUnits('-100.50', 'EUR')).toBe(-10050);
});

test('more than two decimal digits round to the nearest cent, half away from zero', () => {
	expect(decimalStringToMinorUnits('1.005', 'EUR')).toBe(101);
	expect(decimalStringToMinorUnits('1.004', 'EUR')).toBe(100);
	expect(decimalStringToMinorUnits('1.00499999', 'EUR')).toBe(100);
});

test('a value with many digits stays exact instead of drifting through a float', () => {
	// 123456789.01 cannot be represented exactly as a binary float; parsing
	// through Number(raw) directly would risk off-by-one cents here.
	expect(decimalStringToMinorUnits('123456789.01', 'EUR')).toBe(12345678901);
});

test('a non-decimal string is rejected rather than silently coerced, in every currency', () => {
	// '12' used to be in this list, but it is no longer malformed: a
	// currency with no minor unit (JPY) legitimately has no decimal point,
	// so an integer-only string must parse. What still can't parse is
	// genuinely broken input, regardless of currency.
	for (const currency of ['EUR', 'JPY', 'BHD']) {
		expect(() => decimalStringToMinorUnits('abc', currency)).toThrow(/not a decimal amount/);
		expect(() => decimalStringToMinorUnits('1.2.3', currency)).toThrow(/not a decimal amount/);
		expect(() => decimalStringToMinorUnits('', currency)).toThrow(/not a decimal amount/);
	}
});

test('a zero-decimal currency has no fractional part to parse', () => {
	// JPY has no minor unit: "1500" is the only legal way to write ¥1500.
	// A EUR-only test would scale this by a hardcoded hundred and never
	// catch it — that is how this bug survived #164, #179 and #184.
	expect(decimalStringToMinorUnits('1500', 'JPY')).toBe(1500);
});

test('a three-decimal currency rounds past the second digit', () => {
	// BHD has three fraction digits, so its own scale reaches one digit
	// further than EUR's.
	expect(decimalStringToMinorUnits('1.234', 'BHD')).toBe(1234);
});

test("rounding still applies one digit past the currency's own scale", () => {
	// EUR: the third decimal digit is the rounding digit (101, as above).
	// JPY has zero fraction digits, so its rounding digit is the *first*
	// decimal place: 1.5 rounds away from zero to the next whole yen.
	expect(decimalStringToMinorUnits('1.005', 'EUR')).toBe(101);
	expect(decimalStringToMinorUnits('1.5', 'JPY')).toBe(2);
});

test.each([
	['EUR', '7.47'],
	['JPY', '1500'],
	['BHD', '1.234']
])('a %s amount survives a parse -> render -> parse round trip', (currency, raw) => {
	const parsed = decimalStringToMinorUnits(raw, currency);
	const rendered = minorUnitsToDecimalString(minorUnits(parsed), currency);
	expect(decimalStringToMinorUnits(rendered, currency)).toBe(parsed);
});

test('the Italian locale accepts its own comma decimal, in addition to the bare dot', () => {
	// #203: the parser used to accept only "700.00" while the interface
	// renders "700,00 €" in Italian — typing back what the screen shows
	// was a validation error.
	expect(decimalStringToMinorUnits('700,00', 'EUR', 'it')).toBe(70000);
	expect(decimalStringToMinorUnits('700.00', 'EUR', 'it')).toBe(70000);
});

test('the Italian locale accepts its own thousands grouping', () => {
	expect(decimalStringToMinorUnits('1.234,56', 'EUR', 'it')).toBe(123456);
});

test('a partial thousands grouping is rejected, in every locale', () => {
	expect(() => decimalStringToMinorUnits('1,2,3', 'EUR')).toThrow(/not a decimal amount/);
	expect(() => decimalStringToMinorUnits('1,2,3', 'EUR', 'en')).toThrow(/not a decimal amount/);
	expect(() => decimalStringToMinorUnits('1,2,3', 'EUR', 'it')).toThrow(/not a decimal amount/);
});

test('a complete locale-grouped integer is never re-read as a bare decimal', () => {
	// "1.234" is a complete Italian thousands group (one thousand two
	// hundred thirty-four) — not "one point two three four". Resolving
	// this by locale, rather than falling back to the bare-dot reading,
	// is the whole point of trying the locale's own grouping first.
	expect(decimalStringToMinorUnits('1.234', 'EUR', 'it')).toBe(123400);
});

test('the English locale accepts its own comma grouping', () => {
	expect(decimalStringToMinorUnits('1,234.56', 'EUR', 'en')).toBe(123456);
	// Without a locale, only the wire shape matches: a bare comma is not
	// a valid grouping separator for a structured import document.
	expect(() => decimalStringToMinorUnits('1,234.56', 'EUR')).toThrow(/not a decimal amount/);
});

test.each(['en', 'it'] as const)(
	"every amount field's parser call shape (raw, currency, locale) parses that locale's own format",
	(locale) => {
		// The four call sites that read a manual submission
		// (invoice-form.ts, expense-form.ts, contract-form.ts's expense
		// policy cap, mail-send-form.ts) all funnel through this exact
		// call shape: raw text, a currency, the active locale.
		const native = locale === 'it' ? '700,00' : '700.00';
		expect(decimalStringToMinorUnits(native, 'EUR', locale)).toBe(70000);
	}
);
