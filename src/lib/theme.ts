// Pure theme-preference logic, kept apart from the DOM/localStorage wiring in
// theme.svelte.ts so it is testable without a browser — and shared, as plain
// data, with the inline pre-paint script in app.html (see the comment there:
// the storage key below is duplicated as a string literal in app.html
// because that script runs before any module graph exists, and
// theme-preload.test.ts pins the two together so they cannot drift).
//
// "System" is not a third value applied to the DOM: it is the *absence* of
// the `data-theme` attribute, which is exactly what lets `prefers-color-scheme`
// in palette.css/tokens.css keep driving the scheme live, with no JS
// involved and no listener to wire up (see #232).
export const THEME_STORAGE_KEY = 'mastro:theme';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Narrows an arbitrary stored value (or `null`, never written before)
 * down to a valid preference, defaulting to `'system'` for anything else —
 * garbage in storage is never a broken page, just the default scheme. */
export function parseThemePreference(value: string | null): ThemePreference {
	return (THEME_PREFERENCES as readonly string[]).includes(value ?? '')
		? (value as ThemePreference)
		: 'system';
}

/** The `data-theme` attribute value to stamp on `<html>` for a preference,
 * or `null` to remove the attribute entirely and defer to the OS media
 * query. */
export function themeAttribute(preference: ThemePreference): 'light' | 'dark' | null {
	return preference === 'system' ? null : preference;
}
