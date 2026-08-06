import { expect, test } from 'vitest';
import * as m from '$lib/paraglide/messages';
import { legalString, type LegalString } from './legal-string';

test('legalString brands a plain string without changing its value', () => {
	const value = 'Regime forfettario ex art. 1, commi 54-89, L. 190/2014.';

	expect(legalString(value)).toBe(value);
});

test('a plain string is not accepted where a LegalString is required', () => {
	// @ts-expect-error a string has to be vouched for with legalString() first.
	const value: LegalString = 'not run through legalString()';

	expect(value).toBe('not run through legalString()');
});

test('a mandatory invoice annotation renders identically in English and in Italian', () => {
	// A jurisdiction pack (#30) will supply the real text; this fixture only
	// stands in for one so the invariant can be exercised without a pack.
	const annotation = legalString(
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
	expect(renderInItalian.annotation).toBe(renderInEnglish.annotation);
});
