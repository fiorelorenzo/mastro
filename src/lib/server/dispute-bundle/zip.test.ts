import { unzipSync } from 'fflate';
import { resolve, sep } from 'node:path';
import { expect, test } from 'vitest';
import { minorUnits } from '$lib/money';
import { renderDisputeBundleZip } from './zip';
import type { DisputeBundle } from './types';

function bundle(overrides: Partial<DisputeBundle> = {}): DisputeBundle {
	return {
		workUnitId: 'wu-1',
		date: '2026-06-01',
		quantity: 1,
		scope: 'Audit scorte trimestrale',
		state: 'disputed',
		contract: {
			id: 'contract-1',
			title: 'Consulenza operativa',
			clientName: 'Nordwind Logistics S.r.l.',
			currency: 'EUR',
			templateLanguage: 'en'
		},
		approval: {
			id: 'approval-1',
			channel: 'email',
			sender: 'elena.marchetti@nordwindlogistics.example',
			receivedAt: new Date('2026-07-15T08:40:00Z'),
			messageId: '<approvazione-luglio-2026@nordwindlogistics.example>',
			excerpt: 'confermo le giornate concordate... Procedi pure.'
		},
		document: {
			id: 'document-1',
			hash: 'deadbeef',
			mime: 'message/rfc822',
			originalName: 'approvazione-luglio-2026.eml',
			provenance: 'mail',
			createdAt: new Date('2026-07-15T08:40:00Z')
		},
		register: { from: '2026-06-01', to: '2026-06-30', entry: null, totalQuantity: 0 },
		clauseNotes: [],
		invoiceLine: {
			invoiceId: 'invoice-1',
			invoiceNumber: '2026/009',
			lineDescription: 'Audit scorte trimestrale — 01/06/2026',
			amount: minorUnits(70000),
			currency: 'EUR'
		},
		...overrides
	};
}

test('the zip carries both the summary and the archived original itself, under its own file name — invariant 4', () => {
	const documentBytes = new TextEncoder().encode('Da: Elena Marchetti\nOggetto: Approvazione\n');
	const zip = renderDisputeBundleZip(bundle(), documentBytes, 'en');

	const members = unzipSync(zip);
	expect(Object.keys(members).toSorted()).toEqual([
		'source/approvazione-luglio-2026.eml',
		'summary.txt'
	]);
	expect(new TextDecoder().decode(members['source/approvazione-luglio-2026.eml'])).toBe(
		'Da: Elena Marchetti\nOggetto: Approvazione\n'
	);
	expect(new TextDecoder().decode(members['summary.txt'])).toContain('2026/009');
});

test('a day with no archived original still exports — the summary alone, never a fabricated source entry', () => {
	const zip = renderDisputeBundleZip(bundle({ document: null }), null, 'en');
	const members = unzipSync(zip);
	expect(Object.keys(members)).toEqual(['summary.txt']);
});

test('a hostile originalName never produces an entry that escapes the archive root — issue #300', () => {
	// The `Message-ID` header behind `originalName` is entirely
	// sender-controlled (`mail/poll.ts`); these are the traversal shapes
	// issue #300 calls out by name, plus the two "nothing usable survives"
	// shapes (empty, only dots) that must fall back to a generated name.
	const hostileNames = [
		'../../x',
		'/abs/x',
		'..\\..\\x',
		'',
		'....',
		'a'.repeat(500),
		'evil\nname.eml'
	];
	const bytes = new TextEncoder().encode('raw source bytes');
	const root = resolve('/tmp/dispute-bundle-extract-root');

	for (const originalName of hostileNames) {
		const zip = renderDisputeBundleZip(
			bundle({ document: { ...bundle().document!, originalName } }),
			bytes,
			'en'
		);
		const members = unzipSync(zip);
		const entryNames = Object.keys(members).filter((key) => key !== 'summary.txt');

		// Exactly one source entry, still under `source/`, still carrying
		// the real bytes — sanitising the name never drops the evidence.
		expect(entryNames).toHaveLength(1);
		const [entryName] = entryNames;
		expect(entryName.startsWith('source/')).toBe(true);
		expect(members[entryName]).toEqual(bytes);

		// The part of the acceptance criterion a string comparison cannot
		// fake: resolve the entry the way a real extractor would and check
		// it never leaves `root`, for every hostile shape above.
		const destination = resolve(root, entryName);
		expect(destination === root || destination.startsWith(root + sep)).toBe(true);

		const relative = entryName.slice('source/'.length);
		expect(relative.split(/[\\/]/)).not.toContain('..');
		expect(relative.startsWith('/')).toBe(false);
		expect(relative).not.toMatch(/^[a-zA-Z]:/);
		expect(relative.length).toBeLessThanOrEqual(200);
	}
});

test('an empty or dots-only originalName falls back to a stable name built from the document id', () => {
	const bytes = new TextEncoder().encode('raw source bytes');

	for (const originalName of ['', '....']) {
		const zip = renderDisputeBundleZip(
			bundle({ document: { ...bundle().document!, id: 'document-1', originalName } }),
			bytes,
			'en'
		);
		const members = unzipSync(zip);
		expect(Object.keys(members).toSorted()).toEqual(['source/document-document-1', 'summary.txt']);
	}
});

test('an ordinary originalName still comes through recognisably, unmodified', () => {
	const bytes = new TextEncoder().encode('raw source bytes');
	const zip = renderDisputeBundleZip(
		bundle({ document: { ...bundle().document!, originalName: 'giornate-fine-agosto.eml' } }),
		bytes,
		'en'
	);
	const members = unzipSync(zip);
	expect(members['source/giornate-fine-agosto.eml']).toEqual(bytes);
});
