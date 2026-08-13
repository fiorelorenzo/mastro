import { expect, test } from 'vitest';
import { DOCUMENT_PROVENANCES, documentProvenanceLabel } from './source-document';

test('every provenance resolves to its own non-empty label', () => {
	const labels = DOCUMENT_PROVENANCES.map(documentProvenanceLabel);
	for (const label of labels) expect(label.length).toBeGreaterThan(0);
	expect(new Set(labels).size).toBe(DOCUMENT_PROVENANCES.length);
});
