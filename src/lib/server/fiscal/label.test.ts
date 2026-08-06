import { expect, test } from 'vitest';
import { legalText, type LabelBundle } from './label';

// Stand-in for the shape any translation helper has: it takes a
// `LabelBundle` and an interface language, nothing else. This is the
// compile-time proof for AGENTS.md invariant 5 — legal strings are never
// translated. If `LegalText` ever became structurally assignable to
// `LabelBundle`, the `@ts-expect-error` below stops erroring and `pnpm
// check` fails.
function renderLabel(bundle: LabelBundle, language: 'en' | 'it'): string {
	return bundle[language];
}

test('a legal string cannot be handed to a label renderer', () => {
	const statute = legalText(
		'it',
		"Operazione senza applicazione dell'IVA, art. 1 c. 58 L. 190/2014"
	);
	// @ts-expect-error a LegalText has no 'en'/'it' keys, it is not a LabelBundle
	renderLabel(statute, 'en');
	expect(statute.kind).toBe('legal-text');
});

test('legal text keeps the language the law was written in, verbatim', () => {
	const statute = legalText('it', 'Regime forfettario, art. 1 c. 54-89 L. 190/2014');
	expect(statute.language).toBe('it');
	expect(statute.text).toBe('Regime forfettario, art. 1 c. 54-89 L. 190/2014');
});
