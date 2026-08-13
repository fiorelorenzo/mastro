import { expect, test } from 'vitest';
import { formatDecimalString, majorUnitsToDecimalString, parseDecimalString } from './decimal';
import {
	minorUnits,
	minorUnitsToDecimalString,
	type MinorUnits,
	type NotMinorUnits
} from './money';

test('without a locale, only the bare-dot wire shape parses', () => {
	expect(parseDecimalString('700.00')).toEqual({ sign: '', intPart: '700', fracPart: '00' });
	expect(parseDecimalString('-1.5')).toEqual({ sign: '-', intPart: '1', fracPart: '5' });
	expect(parseDecimalString('1500')).toEqual({ sign: '', intPart: '1500', fracPart: '' });
});

test('without a locale, a comma never parses — that is not the wire format', () => {
	expect(parseDecimalString('700,00')).toBeNull();
	expect(parseDecimalString('1,234.56')).toBeNull();
});

test('malformed input parses to null in every locale, not just the default', () => {
	for (const locale of [undefined, 'en', 'it'] as const) {
		expect(parseDecimalString('abc', locale)).toBeNull();
		expect(parseDecimalString('1.2.3', locale)).toBeNull();
		expect(parseDecimalString('', locale)).toBeNull();
		// A partial thousands grouping is not a shorthand for anything.
		expect(parseDecimalString('1,2,3', locale)).toBeNull();
	}
});

test('the Italian locale reads its own comma decimal and dot grouping', () => {
	expect(parseDecimalString('700,00', 'it')).toEqual({ sign: '', intPart: '700', fracPart: '00' });
	expect(parseDecimalString('1.234,56', 'it')).toEqual({
		sign: '',
		intPart: '1234',
		fracPart: '56'
	});
});

test('the Italian locale still accepts the bare dot as a fallback reading', () => {
	// #203: the interface renders "700,00 €", but a value typed as
	// "700.00" must not stop being legible just because the locale's own
	// mark is a comma.
	expect(parseDecimalString('700.00', 'it')).toEqual({ sign: '', intPart: '700', fracPart: '00' });
});

test('a complete Italian thousands group wins over the bare-dot fallback', () => {
	// "1.234" is unambiguous in Italian: one thousand two hundred
	// thirty-four, a complete grouping — never "one point two three
	// four". The locale reading is tried first and, when it fits, wins.
	expect(parseDecimalString('1.234', 'it')).toEqual({
		sign: '',
		intPart: '1234',
		fracPart: ''
	});
});

test('the English locale reads its own dot decimal and comma grouping', () => {
	expect(parseDecimalString('700.00', 'en')).toEqual({ sign: '', intPart: '700', fracPart: '00' });
	expect(parseDecimalString('1,234.56', 'en')).toEqual({
		sign: '',
		intPart: '1234',
		fracPart: '56'
	});
});

test('a partial grouping is rejected under every locale, including the ambiguous "1,2,3"', () => {
	expect(parseDecimalString('1,2,3', 'en')).toBeNull();
	expect(parseDecimalString('1,2,3', 'it')).toBeNull();
});

test('formatDecimalString re-renders a parsed value at the currency scale, locale mark, no grouping', () => {
	expect(formatDecimalString('700', 'EUR', 'it')).toBe('700,00');
	expect(formatDecimalString('700', 'EUR', 'en')).toBe('700.00');
	expect(formatDecimalString('1.234,5', 'EUR', 'it')).toBe('1234,50');
	expect(formatDecimalString('1500', 'JPY')).toBe('1500');
});

test('formatDecimalString rounds the same way decimalStringToMinorUnits does', () => {
	expect(formatDecimalString('1.005', 'EUR')).toBe('1.01');
});

test('formatDecimalString returns null for input that does not parse', () => {
	expect(formatDecimalString('abc', 'EUR', 'it')).toBeNull();
	expect(formatDecimalString('1,2,3', 'EUR', 'it')).toBeNull();
});

test('formatDecimalString round-trips: re-rendering a parsed value parses back to the same amount', () => {
	for (const [raw, locale] of [
		['700', 'it'],
		['1.234,56', 'it'],
		['1,234.56', 'en']
	] as const) {
		const rendered = formatDecimalString(raw, 'EUR', locale);
		expect(rendered).not.toBeNull();
		expect(formatDecimalString(rendered as string, 'EUR', locale)).toBe(rendered);
	}
});

test('majorUnitsToDecimalString formats an already-major-unit amount at the currency scale', () => {
	expect(majorUnitsToDecimalString(700 as NotMinorUnits, 'EUR')).toBe('700.00');
	expect(majorUnitsToDecimalString(700.5 as NotMinorUnits, 'EUR')).toBe('700.50');
	expect(majorUnitsToDecimalString(1500 as NotMinorUnits, 'JPY')).toBe('1500');
});

test("AmountInput's two seeding entry points reject each other's branded type at compile time", () => {
	const cents: MinorUnits = minorUnits(70000);
	const major: NotMinorUnits = 700 as NotMinorUnits;
	// The minor-unit entry point ($lib/money) and the major-unit one
	// ($lib/decimal) must not accept each other's amount — the exact
	// mix-up (a cents integer dropped into a euros-shaped text field, or
	// the reverse) `$lib/money`'s comment on `MinorUnits` documents as
	// this codebase's most repeated bug.
	// @ts-expect-error — a NotMinorUnits value must not satisfy minorUnitsToDecimalString's MinorUnits parameter.
	const badSeed1 = minorUnitsToDecimalString(major, 'EUR');
	// @ts-expect-error — a MinorUnits value must not satisfy majorUnitsToDecimalString's NotMinorUnits parameter.
	const badSeed2 = majorUnitsToDecimalString(cents, 'EUR');
	expect([badSeed1, badSeed2]).toHaveLength(2);
});
