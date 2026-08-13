import { expect, test } from 'vitest';
import { minorUnits, minorUnitsToDecimalString, negateMinorUnits } from './money';

test('converts whole and fractional cent amounts to a plain decimal string', () => {
	expect(minorUnitsToDecimalString(minorUnits(122000), 'EUR')).toBe('1220.00');
	expect(minorUnitsToDecimalString(minorUnits(0), 'EUR')).toBe('0.00');
	expect(minorUnitsToDecimalString(minorUnits(747), 'EUR')).toBe('7.47');
});

test('keeps the sign on a negative amount', () => {
	expect(minorUnitsToDecimalString(minorUnits(-10050), 'EUR')).toBe('-100.50');
});

test('a zero-decimal currency renders with no decimal point at all', () => {
	// JPY has no minor unit, so there is nothing after a point to write —
	// a EUR-only assertion here is exactly what let the hardcoded hundred
	// through #164, #179 and #184.
	expect(minorUnitsToDecimalString(minorUnits(1500), 'JPY')).toBe('1500');
});

test('a three-decimal currency renders past the second digit', () => {
	// BHD has three fraction digits, one more than EUR's cent.
	expect(minorUnitsToDecimalString(minorUnits(1234), 'BHD')).toBe('1.234');
});

test('negateMinorUnits flips the sign and round-trips back through itself', () => {
	expect(negateMinorUnits(minorUnits(20_000))).toBe(-20_000);
	expect(negateMinorUnits(minorUnits(-20_000))).toBe(20_000);
	expect(negateMinorUnits(minorUnits(0))).toBe(0);
});
