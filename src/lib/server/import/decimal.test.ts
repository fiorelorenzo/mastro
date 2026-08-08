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
