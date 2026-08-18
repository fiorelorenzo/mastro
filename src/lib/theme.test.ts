import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
	parseThemePreference,
	themeAttribute,
	THEME_STORAGE_KEY,
	THEME_PREFERENCES
} from './theme';

describe('parseThemePreference', () => {
	test.each(THEME_PREFERENCES)('accepts the stored value %s verbatim', (preference) => {
		expect(parseThemePreference(preference)).toBe(preference);
	});

	test('defaults to system for a null value (nothing stored yet)', () => {
		expect(parseThemePreference(null)).toBe('system');
	});

	test('defaults to system for garbage that was never written by this app', () => {
		expect(parseThemePreference('solarized')).toBe('system');
		expect(parseThemePreference('')).toBe('system');
	});
});

describe('themeAttribute', () => {
	test('system removes the attribute, deferring to prefers-color-scheme', () => {
		expect(themeAttribute('system')).toBeNull();
	});

	test('light and dark pass through as the literal attribute value', () => {
		expect(themeAttribute('light')).toBe('light');
		expect(themeAttribute('dark')).toBe('dark');
	});
});

// The pre-paint script (`static/theme-init.js`, referenced from
// `src/app.html`, #303) cannot import this module — it runs before a
// module graph exists — so it duplicates THEME_STORAGE_KEY as a string
// literal. This test is what stops that literal drifting away from the
// constant every other consumer uses.
test('the pre-paint script reads the same storage key theme.svelte.ts writes', () => {
	const script = readFileSync(new URL('../../static/theme-init.js', import.meta.url), 'utf-8');
	expect(script).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
});
