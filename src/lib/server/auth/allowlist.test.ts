import { expect, test } from 'vitest';
import { isAllowedEmail, parseAllowlist } from './allowlist';

test('an unset allowlist admits nobody', () => {
	expect(isAllowedEmail('lorenzo@example.com', parseAllowlist(undefined))).toBe(false);
});

test('an empty allowlist admits nobody', () => {
	expect(isAllowedEmail('lorenzo@example.com', parseAllowlist(''))).toBe(false);
});

test('an address on the list is allowed', () => {
	const allowlist = parseAllowlist('lorenzo@example.com,other@example.com');
	expect(isAllowedEmail('lorenzo@example.com', allowlist)).toBe(true);
});

test('an address outside the list is rejected', () => {
	const allowlist = parseAllowlist('lorenzo@example.com');
	expect(isAllowedEmail('someone-else@example.com', allowlist)).toBe(false);
});

test('matching ignores case, since Google normalises email to lowercase', () => {
	const allowlist = parseAllowlist('Lorenzo@Example.com');
	expect(isAllowedEmail('lorenzo@example.com', allowlist)).toBe(true);
});

test('surrounding whitespace in the configured list is ignored', () => {
	const allowlist = parseAllowlist(' lorenzo@example.com , other@example.com ');
	expect(isAllowedEmail('lorenzo@example.com', allowlist)).toBe(true);
	expect(isAllowedEmail('other@example.com', allowlist)).toBe(true);
});

test('stray commas do not produce a wildcard entry', () => {
	expect(parseAllowlist('lorenzo@example.com,,').size).toBe(1);
});
