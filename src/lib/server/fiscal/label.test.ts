import { expect, test } from 'vitest';
import { legalText } from '$lib/legal/legal-text';
import type { LabelBundle } from './label';

test('a label bundle reads directly by language, the same figure in both', () => {
	const bundle: LabelBundle = { en: 'Generic', it: 'Generico' };
	expect(bundle.en).toBe('Generic');
	expect(bundle.it).toBe('Generico');
});

test('a label bundle missing a supported language fails the type check', () => {
	// @ts-expect-error a LabelBundle must have an entry for every
	// SupportedLanguage — that is the type-level gate #67 asks for, since a
	// runtime check nobody runs is not a gate.
	const incomplete: LabelBundle = { en: 'Generic' };

	expect(incomplete.en).toBe('Generic');
});

// Stand-in for the shape any translation helper has: it takes a
// `LabelBundle` and an interface language, nothing else. This is the
// compile-time proof for AGENTS.md invariant 5 — legal strings are never
// translated. If `LegalText` ever became structurally assignable to
// `LabelBundle`, the `@ts-expect-error` below stops erroring and `pnpm
// check` fails.
function renderLabel(bundle: LabelBundle, language: 'en' | 'it'): string {
	return bundle[language];
}

test('a legal text cannot be handed to a label renderer', () => {
	const statute = legalText(
		'it',
		"Operazione senza applicazione dell'IVA, art. 1 c. 58 L. 190/2014"
	);
	// @ts-expect-error a LegalText has no 'en'/'it' keys, it is not a LabelBundle
	renderLabel(statute, 'en');
	expect(statute.kind).toBe('legal-text');
});
