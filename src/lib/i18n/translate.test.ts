import { expect, test } from 'vitest';
import * as m from '$lib/paraglide/messages';
import { legalText } from '$lib/legal/legal-text';
import { translate } from './translate';

test('translate forwards inputs to the compiled message and returns the localized string', () => {
	expect(translate(m.greeting, { name: 'Lorenzo' }, { locale: 'en' })).toBe('Hello, Lorenzo.');
	expect(translate(m.greeting, { name: 'Lorenzo' }, { locale: 'it' })).toBe('Ciao, Lorenzo.');
});

test('referencing a message key that does not exist fails the type check', () => {
	// @ts-expect-error `does_not_exist` is not a key in messages/en.json or messages/it.json.
	const missing = m.does_not_exist;

	expect(missing).toBeUndefined();
});

test('passing a legal text into an interpolation slot is a type error', () => {
	const annotation = legalText(
		'it',
		"Operazione senza applicazione dell'IVA ai sensi dell'art. 1, commi 54-89, L. 190/2014."
	);

	// @ts-expect-error a LegalText must never flow into a translation call (invariant 5).
	const result = translate(m.greeting, { name: annotation }, { locale: 'en' });

	// The type error does not stop the value from being interpolated at
	// runtime: the guard is compile-time only, which is exactly why this
	// test exercises the runtime call instead of only asserting the
	// `@ts-expect-error` above. A `LegalText` is an object, not a string, so
	// it stringifies to "[object Object]" here rather than carrying its
	// `text` through — further proof that nothing but `LegalText.svelte`
	// should ever be asked to render one.
	expect(result).toBe('Hello, [object Object].');
});
