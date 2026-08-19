import { expect, test } from 'vitest';
import { minorUnits, minorUnitsToDecimalString, negateMinorUnits, scaleMinorUnits } from './money';

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

test('scaleMinorUnits pins the rounding direction on an odd base rather than leaving it to Math.round silently', () => {
	// The audit's own example (#323): 100001 at one half (numerator 1,
	// denominator 2) lands exactly on 50000.5, the one input that actually
	// exercises which way a tie falls.
	expect(scaleMinorUnits(minorUnits(100_001), 1, 2)).toBe(50_001);
});

test('scaleMinorUnits multiplies before it divides, so a rate that has no exact binary fraction still rounds correctly', () => {
	// 22 % as basis points: 2200/10000. Multiplying first keeps every
	// intermediate an exact integer; dividing first (100_00000 * 0.22)
	// would round a binary approximation of 0.22 instead of the real rate.
	expect(scaleMinorUnits(minorUnits(100_00000), 2200, 10_000)).toBe(22_00000);
});

test('scaleMinorUnits scales one amount by a ratio of two others, without dividing them first', () => {
	expect(scaleMinorUnits(minorUnits(9_999), 1, 3)).toBe(3_333);
});
