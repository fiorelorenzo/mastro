import { expect, test } from 'vitest';
import * as m from '$lib/paraglide/messages';
import { legalText, type LegalText } from './legal-text';

test('legalText carries the language the law was written in alongside the verbatim text', () => {
	const statute = legalText(
		'it',
		"Operazione senza applicazione dell'IVA ai sensi dell'art. 1, commi 54-89, L. 190/2014."
	);

	expect(statute.kind).toBe('legal-text');
	expect(statute.language).toBe('it');
	expect(statute.text).toBe(
		"Operazione senza applicazione dell'IVA ai sensi dell'art. 1, commi 54-89, L. 190/2014."
	);
});

test('an object missing the language a legal text was written in is not a LegalText', () => {
	// @ts-expect-error `language` is required — a legal text with no known
	// language defeats the whole point of carrying one.
	const incomplete: LegalText = { kind: 'legal-text', text: 'no language attached' };

	expect(incomplete.text).toBe('no language attached');
});

test('a mandatory invoice annotation renders identically in English and in Italian', () => {
	// A jurisdiction pack (#30) will supply the real text; this fixture only
	// stands in for one so the invariant can be exercised without a pack.
	const annotation = legalText(
		'it',
		"Operazione senza applicazione dell'IVA ai sensi dell'art. 1, commi 54-89, L. 190/2014."
	);

	const renderInEnglish = {
		label: m.invoice_mandatory_annotation_label({}, { locale: 'en' }),
		annotation
	};
	const renderInItalian = {
		label: m.invoice_mandatory_annotation_label({}, { locale: 'it' }),
		annotation
	};

	// The label around it is interface copy, so it translates.
	expect(renderInEnglish.label).toBe('Mandatory annotation');
	expect(renderInItalian.label).toBe('Annotazione obbligatoria');

	// The annotation itself is the law's text, not interface copy: it never
	// passes through a message function, so switching locale cannot touch it.
	expect(renderInItalian.annotation).toEqual(renderInEnglish.annotation);
});
