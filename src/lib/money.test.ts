import { expect, test } from 'vitest';
import { minorUnitsToDecimalString } from './money';

test('converts whole and fractional cent amounts to a plain decimal string', () => {
	expect(minorUnitsToDecimalString(122000)).toBe('1220.00');
	expect(minorUnitsToDecimalString(0)).toBe('0.00');
	expect(minorUnitsToDecimalString(747)).toBe('7.47');
});

test('keeps the sign on a negative amount', () => {
	expect(minorUnitsToDecimalString(-10050)).toBe('-100.50');
});
