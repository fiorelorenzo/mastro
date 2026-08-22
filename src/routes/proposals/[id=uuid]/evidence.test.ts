import { describe, expect, test } from 'vitest';
import { isFieldGroundedInExcerpt, splitOnExcerpt } from './evidence';

describe('splitOnExcerpt', () => {
	test('splits the body around the excerpt, case-insensitively, keeping the body’s own casing', () => {
		const body = 'Ciao Lorenzo,\n\nTi confermo le giornate del 17 e 18 agosto.\nGrazie, Paola';
		const result = splitOnExcerpt(body, 'ti confermo le giornate del 17 e 18 agosto');
		expect(result).toEqual({
			before: 'Ciao Lorenzo,\n\n',
			match: 'Ti confermo le giornate del 17 e 18 agosto',
			after: '.\nGrazie, Paola'
		});
	});

	test('returns null when the excerpt is not in the body', () => {
		expect(splitOnExcerpt('Ciao Lorenzo, grazie', 'un testo che non c’è')).toBeNull();
	});

	test('returns null for a blank excerpt rather than matching everything', () => {
		expect(splitOnExcerpt('qualunque testo', '   ')).toBeNull();
	});
});

describe('isFieldGroundedInExcerpt', () => {
	const augustSeventeenth = 'ti confermo le giornate del 17 e 18 agosto';
	const augustEighteenthHalf = '18 agosto, la seconda mezza';

	test('a date is grounded when its day-of-month is in the excerpt', () => {
		expect(isFieldGroundedInExcerpt('2026-08-17', augustSeventeenth)).toBe(true);
		expect(isFieldGroundedInExcerpt('2026-08-19', augustSeventeenth)).toBe(false);
	});

	test('a whole-day quantity needs its own standalone digit, not a substring of another number', () => {
		// "1" is not grounded here even though it is a substring of "17"/"18".
		expect(isFieldGroundedInExcerpt(1, augustSeventeenth)).toBe(false);
		expect(isFieldGroundedInExcerpt(2, 'ti confermo 2 giornate')).toBe(true);
	});

	test('a half-day quantity is grounded by the Italian wording, not a literal "0.5"', () => {
		expect(isFieldGroundedInExcerpt(0.5, augustEighteenthHalf)).toBe(true);
		expect(isFieldGroundedInExcerpt(0.5, augustSeventeenth)).toBe(false);
	});

	test('scope is not grounded when the excerpt never mentions it — the extraction prompt never reads it off the message', () => {
		expect(isFieldGroundedInExcerpt('Collaudo', augustEighteenthHalf)).toBe(false);
	});

	test('a plain string field is grounded when it appears verbatim', () => {
		expect(isFieldGroundedInExcerpt('agosto', augustSeventeenth)).toBe(true);
	});

	test('an empty or missing value is never grounded', () => {
		expect(isFieldGroundedInExcerpt('', augustSeventeenth)).toBe(false);
		expect(isFieldGroundedInExcerpt(null, augustSeventeenth)).toBe(false);
	});
});
