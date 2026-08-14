import { unzipSync } from 'fflate';
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
