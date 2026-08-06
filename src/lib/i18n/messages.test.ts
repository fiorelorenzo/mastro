import { expect, test } from 'vitest';
import en from '../../../messages/en.json';
import it from '../../../messages/it.json';

// A key present in one catalogue and missing from the other is exactly how
// an untranslated fallback leaks through: Paraglide falls back silently to
// the base locale for that one message instead of failing anything.

test('every message has both an English and an Italian translation', () => {
	const englishKeys = Object.keys(en)
		.filter((key) => key !== '$schema')
		.sort();
	const italianKeys = Object.keys(it)
		.filter((key) => key !== '$schema')
		.sort();

	expect(italianKeys).toEqual(englishKeys);
});

test('no translation is left empty', () => {
	for (const catalogue of [en, it]) {
		for (const [key, value] of Object.entries(catalogue)) {
			if (key === '$schema') continue;
			expect(value.trim(), `"${key}" is empty`).not.toBe('');
		}
	}
});
