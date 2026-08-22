import { expect, test } from 'vitest';
import { getLocale, overwriteGetLocale } from '$lib/paraglide/runtime';
import { DOCUMENT_PROVENANCES, documentProvenanceLabel } from './source-document';

test('every provenance resolves to its own non-empty label', () => {
	const labels = DOCUMENT_PROVENANCES.map(documentProvenanceLabel);
	for (const label of labels) expect(label.length).toBeGreaterThan(0);
	expect(new Set(labels).size).toBe(DOCUMENT_PROVENANCES.length);
});

// #422 sibling bug: DOCUMENT_PROVENANCE_LABEL held called-once strings
// (day-state-badge.ts's exact mistake) rather than the message functions,
// so a label rendered on the server never followed the request's locale.
// `overwriteGetLocale` simulates a locale switch the way `setLocale` would
// in the browser.
test('a provenance label follows a locale switch', () => {
	const originalGetLocale = getLocale;
	try {
		overwriteGetLocale(() => 'en');
		expect(documentProvenanceLabel('folder_import')).toBe('Imported from a folder');

		overwriteGetLocale(() => 'it');
		expect(documentProvenanceLabel('folder_import')).toBe('Importato da una cartella');
	} finally {
		overwriteGetLocale(originalGetLocale);
	}
});
