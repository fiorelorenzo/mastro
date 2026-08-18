import { expect, test } from 'vitest';
import { CSP_DIRECTIVES, formatCspHeader } from './csp';

test('CSP_DIRECTIVES starts strict: no default origin beyond self, no plugins, no base rewrite, never framed', () => {
	expect(CSP_DIRECTIVES['default-src']).toEqual(['self']);
	expect(CSP_DIRECTIVES['object-src']).toEqual(['none']);
	expect(CSP_DIRECTIVES['base-uri']).toEqual(['self']);
	expect(CSP_DIRECTIVES['frame-ancestors']).toEqual(['none']);
});

test('formatCspHeader quotes keyword sources and leaves everything else bare, semicolon-joined in insertion order', () => {
	const header = formatCspHeader({
		'default-src': ['self'],
		'img-src': ['self', 'https://example.com'],
		'object-src': ['none']
	});

	expect(header).toBe("default-src 'self'; img-src 'self' https://example.com; object-src 'none'");
});

test('formatCspHeader renders the real CSP_DIRECTIVES into a valid-looking header with no stray quoting', () => {
	const header = formatCspHeader(CSP_DIRECTIVES);

	expect(header).toBe(
		"default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
	);
});
