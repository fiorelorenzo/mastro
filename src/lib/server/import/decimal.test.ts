import { expect, test } from 'vitest';
import { decimalStringToMinorUnits } from './decimal';

test('a plain two-decimal amount converts to cents exactly', () => {
	expect(decimalStringToMinorUnits('1220.00')).toBe(122000);
	expect(decimalStringToMinorUnits('0.00')).toBe(0);
	expect(decimalStringToMinorUnits('7.47')).toBe(747);
});

test('a negative amount keeps its sign', () => {
	expect(decimalStringToMinorUnits('-100.50')).toBe(-10050);
});

test('more than two decimal digits round to the nearest cent, half away from zero', () => {
	expect(decimalStringToMinorUnits('1.005')).toBe(101);
	expect(decimalStringToMinorUnits('1.004')).toBe(100);
	expect(decimalStringToMinorUnits('1.00499999')).toBe(100);
});

test('a value with many digits stays exact instead of drifting through a float', () => {
	// 123456789.01 cannot be represented exactly as a binary float; parsing
	// through Number(raw) directly would risk off-by-one cents here.
	expect(decimalStringToMinorUnits('123456789.01')).toBe(12345678901);
});

test('a non-decimal string is rejected rather than silently coerced', () => {
	expect(() => decimalStringToMinorUnits('not a number')).toThrow(/not a decimal amount/);
	expect(() => decimalStringToMinorUnits('12')).toThrow(/not a decimal amount/);
	expect(() => decimalStringToMinorUnits('')).toThrow(/not a decimal amount/);
});
