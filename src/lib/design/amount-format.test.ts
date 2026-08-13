import { expect, test } from 'vitest';
import { formatAmountValue, type AmountValue } from './amount-format';
import { minorUnits, type MinorUnits, type NotMinorUnits } from '$lib/money';

test('a minorUnits value formats through formatMinorUnits', () => {
	const value: AmountValue = { minorUnits: minorUnits(70000) };
	expect(formatAmountValue(value, 'EUR', 'it')).toBe('700,00\u00A0€');
	expect(formatAmountValue(value, 'EUR', 'en')).toBe('€700.00');
});

test('a major value formats through formatAmount, never through formatMinorUnits', () => {
	const value: AmountValue = { major: 700 as NotMinorUnits };
	expect(formatAmountValue(value, 'EUR', 'it')).toBe('700,00\u00A0€');
	expect(formatAmountValue(value, 'EUR', 'en')).toBe('€700.00');
});

test('the same numeric magnitude formats differently as minor vs major units', () => {
	// The trap #203 documents: 700 minor units is 7.00, not 700.00.
	const asMinor: AmountValue = { minorUnits: minorUnits(700) };
	const asMajor: AmountValue = { major: 700 as NotMinorUnits };
	expect(formatAmountValue(asMinor, 'EUR', 'en')).toBe('€7.00');
	expect(formatAmountValue(asMajor, 'EUR', 'en')).toBe('€700.00');
});

test('minorUnits and major are mutually exclusive at the type level', () => {
	const mu: MinorUnits = minorUnits(500);
	const nmu: NotMinorUnits = 500 as NotMinorUnits;
	// @ts-expect-error — a MinorUnits value must not satisfy `major`'s NotMinorUnits brand.
	const badMajor: AmountValue = { major: mu };
	// @ts-expect-error — a NotMinorUnits value must not satisfy `minorUnits`'s MinorUnits brand.
	const badMinor: AmountValue = { minorUnits: nmu };
	// The assertions above are compile-time only (`@ts-expect-error`); this
	// just confirms the test body still runs.
	expect([badMajor, badMinor]).toHaveLength(2);
});
