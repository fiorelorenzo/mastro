/*
 * country-picker.ts — the option list behind the client form's country
 * picker (#241), which replaced a free-text "type an ISO alpha-2 code"
 * field that sat right next to a tax id already starting with that same
 * code.
 *
 * `countries.json` holds nothing but the 249 currently-assigned ISO
 * 3166-1 alpha-2 codes — data, not logic. This file turns each one into a
 * name by asking the platform's own `Intl.DisplayNames` for the active
 * locale, and never branches on any single code itself. That is the
 * property `src/lib/server/fiscal/no-country-logic.test.ts` (AGENTS.md
 * invariant 1, "no country-specific logic outside a jurisdiction pack")
 * exists to keep true everywhere outside a pack: a country picker lists
 * every country identically, it does not treat one specially.
 */
import type { Locale } from '$lib/paraglide/runtime';
import countryCodes from './countries.json';

export interface CountryOption {
	readonly code: string;
	readonly name: string;
}

/** Every ISO 3166-1 alpha-2 country, labelled in `locale` and sorted by
 *  that label — so the list reads correctly regardless of which interface
 *  language is asking for it, with no separately maintained translation
 *  table to fall out of sync. */
export function countryOptions(locale: Locale): readonly CountryOption[] {
	const displayNames = new Intl.DisplayNames([locale], { type: 'region' });
	const collator = new Intl.Collator(locale);
	return (countryCodes as readonly string[])
		.map((code) => ({ code, name: displayNames.of(code) ?? code }))
		.sort((a, b) => collator.compare(a.name, b.name));
}
