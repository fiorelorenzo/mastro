import { expect, test } from 'vitest';
import { factLine } from './crumbs';

test('a subtitle drops the facts a record does not have', () => {
	// A contract with no notice period and an open-ended validity supplies
	// nulls, and must not render " ·  · " where the facts are missing.
	expect(factLine(['From 1 Jan 2026', null, undefined, '30 days notice'])).toBe(
		'From 1 Jan 2026 · 30 days notice'
	);
	expect(factLine([null, undefined])).toBe('');
	expect(factLine(['  ', 'tacit renewal'])).toBe('tacit renewal');
});

test('a subtitle keeps the order it was given', () => {
	expect(factLine(['a', 'b', 'c'])).toBe('a · b · c');
});
