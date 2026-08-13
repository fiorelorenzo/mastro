// Field.svelte cannot be rendered in this project's vitest config (the
// `server`/node project excludes `*.svelte.test.ts`, and there is no
// browser/jsdom project — see vite.config.ts). This proves the id-generation
// and aria-describedby-composition logic Field.svelte actually calls,
// directly, rather than a parallel reimplementation of it.

import { describe, expect, test } from 'vitest';
import { computeFieldIds } from './field-ids';

describe('computeFieldIds', () => {
	test('a field with neither hint nor error describes nothing', () => {
		expect(computeFieldIds({ id: 'f1', hasHint: false, hasError: false })).toEqual({
			controlId: 'f1',
			hintId: undefined,
			errorId: undefined,
			describedBy: undefined
		});
	});

	test('a hint alone becomes the describedby', () => {
		const ids = computeFieldIds({ id: 'f1', hasHint: true, hasError: false });
		expect(ids.hintId).toBe('f1-hint');
		expect(ids.errorId).toBeUndefined();
		expect(ids.describedBy).toBe('f1-hint');
	});

	test('an error alone becomes the describedby — this is the aria wiring an invalid field needs', () => {
		const ids = computeFieldIds({ id: 'f1', hasHint: false, hasError: true });
		expect(ids.errorId).toBe('f1-error');
		expect(ids.describedBy).toBe('f1-error');
	});

	test('hint and error both describe the control, hint first', () => {
		const ids = computeFieldIds({ id: 'f1', hasHint: true, hasError: true });
		expect(ids.hintId).toBe('f1-hint');
		expect(ids.errorId).toBe('f1-error');
		expect(ids.describedBy).toBe('f1-hint f1-error');
	});

	test('two fields with different ids never collide on hint or error ids', () => {
		const a = computeFieldIds({ id: 'f1', hasHint: true, hasError: true });
		const b = computeFieldIds({ id: 'f2', hasHint: true, hasError: true });
		expect(a.controlId).not.toBe(b.controlId);
		expect(a.hintId).not.toBe(b.hintId);
		expect(a.errorId).not.toBe(b.errorId);
	});
});
