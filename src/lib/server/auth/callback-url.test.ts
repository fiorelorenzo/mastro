// Every shape from #302, plus the pair the original two-clause guard
// already handled correctly. The guard it replaces was byte-identical in
// both sign-in routes and still let `%5C`/backslash-prefixed paths through
// as a protocol-relative open redirect.
import { expect, test } from 'vitest';
import { resolveCallbackURL } from './callback-url';

const origin = 'https://app.example';

test('a same-origin path is kept as-is', () => {
	expect(resolveCallbackURL('/day', origin)).toBe('/day');
});

test('a same-origin path with a query and a fragment is kept in full', () => {
	expect(resolveCallbackURL('/day?tab=notes#section', origin)).toBe('/day?tab=notes#section');
});

test('a protocol-relative path falls back to the default', () => {
	expect(resolveCallbackURL('//evil.example', origin)).toBe('/');
});

test('a literal backslash normalised by URL parsing falls back to the default', () => {
	expect(resolveCallbackURL('/\\evil.example', origin)).toBe('/');
});

test('a percent-encoded backslash stays same-origin and is not double-decoded into one', () => {
	expect(resolveCallbackURL('/%5Cevil.example', origin)).toBe('/%5Cevil.example');
});

test('an absolute URL to another origin falls back to the default', () => {
	expect(resolveCallbackURL('https://evil.example', origin)).toBe('/');
});

test('a javascript: URL falls back to the default', () => {
	expect(resolveCallbackURL('javascript:alert(1)', origin)).toBe('/');
});

test('an empty value falls back to the default', () => {
	expect(resolveCallbackURL('', origin)).toBe('/');
});

test('a missing value falls back to the default', () => {
	expect(resolveCallbackURL(null, origin)).toBe('/');
});

test('a custom fallback is used instead of "/"', () => {
	expect(resolveCallbackURL('//evil.example', origin, '/sign-in?error=1')).toBe('/sign-in?error=1');
});
