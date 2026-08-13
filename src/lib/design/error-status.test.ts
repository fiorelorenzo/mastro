import { expect, test } from 'vitest';
import { errorKind, errorSeverity, hasExplanation } from './error-status';

test('404 is critical even though it is a 4xx — the thing is simply gone', () => {
	expect(errorSeverity(404)).toBe('critical');
});

test('every other 4xx is a warning, a guarded state the visitor can act on', () => {
	expect(errorSeverity(400)).toBe('warning');
	expect(errorSeverity(403)).toBe('warning');
	expect(errorSeverity(422)).toBe('warning');
});

test('5xx is always critical', () => {
	expect(errorSeverity(500)).toBe('critical');
	expect(errorSeverity(503)).toBe('critical');
});

test('status maps to one of three generic copy kinds', () => {
	expect(errorKind(404)).toBe('not-found');
	expect(errorKind(400)).toBe('bad-request');
	expect(errorKind(403)).toBe('bad-request');
	expect(errorKind(500)).toBe('server');
	expect(errorKind(503)).toBe('server');
});

test('a call-site explanation is used as-is', () => {
	expect(hasExplanation('This invoice is not overdue.')).toBe(true);
	expect(hasExplanation('Cliente non trovato.')).toBe(true);
});

test('SvelteKit\u2019s own fabricated placeholders are not shown as prose', () => {
	// error(status) with no body
	expect(hasExplanation('Error: 404')).toBe(false);
	expect(hasExplanation('Error: 400')).toBe(false);
	// an unmatched route
	expect(hasExplanation('Not Found')).toBe(false);
	expect(hasExplanation('not found')).toBe(false);
	// the default handleError for an uncaught exception
	expect(hasExplanation('Internal Error')).toBe(false);
});

test('a missing or blank message has no explanation', () => {
	expect(hasExplanation(undefined)).toBe(false);
	expect(hasExplanation(null)).toBe(false);
	expect(hasExplanation('')).toBe(false);
	expect(hasExplanation('   ')).toBe(false);
});
