import { expect, test } from 'vitest';
import { match } from './uuid';

// The regression guard for #390's route-param half: SvelteKit checks this
// matcher before any loader for `[id=uuid]`-style segments run, so a
// segment failing it 404s with no loader ever seeing the value. This test
// is what still catches a route that stops using the matcher, or a matcher
// that stops rejecting what Postgres would — a curl probe against a
// running server proves the wiring once, this proves the rule stays true.

test('accepts a real generated uuid, and the same value uppercased', () => {
	const generated = crypto.randomUUID();
	expect(match(generated)).toBe(true);
	expect(match(generated.toUpperCase())).toBe(true);
});

test('rejects the exact strings #390 measured as 500s', () => {
	expect(match('not-a-uuid')).toBe(false);
	expect(match('also-not')).toBe(false);
});

test('rejects an empty segment, a near-miss length, and a uuid missing its dashes', () => {
	expect(match('')).toBe(false);
	expect(match('123e4567-e89b-12d3-a456-42661417400')).toBe(false); // one digit short
	expect(match('123e4567e89b12d3a456426614174000')).toBe(false);
});

test('rejects a well-formed uuid carrying extra characters, so a longer path segment cannot slip through', () => {
	const generated = crypto.randomUUID();
	expect(match(`${generated}x`)).toBe(false);
	expect(match(`x${generated}`)).toBe(false);
});
