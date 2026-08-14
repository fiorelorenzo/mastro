// Wires the DOM/localStorage side of the theme preference; the parsing and
// attribute-resolution rules themselves live in theme.ts so they can be unit
// tested without a browser (mirrors install.svelte.ts/install-logic.ts).
import { browser } from '$app/environment';
import {
	parseThemePreference,
	themeAttribute,
	THEME_STORAGE_KEY,
	type ThemePreference
} from './theme';

class ThemeStore {
	// The inline script in app.html already stamped `data-theme` on `<html>`
	// before this module ever loads (see its comment) — reading the same
	// storage key here just brings the reactive `$state` in sync with what
	// is already on the page, not a second decision.
	#preference = $state<ThemePreference>(
		browser ? parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY)) : 'system'
	);

	get preference(): ThemePreference {
		return this.#preference;
	}

	set(preference: ThemePreference): void {
		this.#preference = preference;
		if (!browser) return;
		localStorage.setItem(THEME_STORAGE_KEY, preference);
		const attribute = themeAttribute(preference);
		if (attribute === null) delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = attribute;
	}
}

export const theme = new ThemeStore();
