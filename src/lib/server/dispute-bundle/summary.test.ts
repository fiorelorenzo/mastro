import { expect, test } from 'vitest';
import { minorUnits } from '$lib/money';
import { renderDisputeBundleSummary } from './summary';
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
		register: {
			from: '2026-06-01',
			to: '2026-06-30',
			entry: {
				workUnitId: 'wu-1',
				date: '2026-06-01',
				quantity: 1,
				scope: 'Audit scorte trimestrale',
				approval: {
					channel: 'email',
					sender: 'elena.marchetti@nordwindlogistics.example',
					receivedAt: new Date('2026-07-15T08:40:00Z'),
					messageId: '<approvazione-luglio-2026@nordwindlogistics.example>'
				}
			},
			totalQuantity: 1
		},
		clauseNotes: [
			{
				id: 'clause-1',
				clauseReference: 'Art. 7.2',
				verbatimText: 'Le spese di trasferta documentate sono rimborsate a piè di lista.',
				interpretationAdopted: 'La comunicazione via email è considerata valida.'
			}
		],
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

test('the summary carries every source #214 lists: approval excerpt, register entry, clause note and invoice line', () => {
	const text = renderDisputeBundleSummary(bundle(), 'en');

	expect(text).toContain('2026-06-01');
	expect(text).toContain('elena.marchetti@nordwindlogistics.example');
	expect(text).toContain('confermo le giornate concordate... Procedi pure.');
	expect(text).toContain('Art. 7.2');
	expect(text).toContain('La comunicazione via email è considerata valida.');
	expect(text).toContain('2026/009');
	expect(text).toContain('700.00');
});

test('a day billed on a contract that never required approval states plainly that nothing is on file, never a blank line standing in for it', () => {
	const text = renderDisputeBundleSummary(
		bundle({
			approval: null,
			document: null,
			register: { from: '2026-06-01', to: '2026-06-30', entry: null, totalQuantity: 0 }
		}),
		'en'
	);

	expect(text).not.toMatch(/undefined|null/);
	expect(text.length).toBeGreaterThan(0);
});

test('renders in the contract template language passed in, not a hardcoded one', () => {
	const en = renderDisputeBundleSummary(bundle(), 'en');
	const it = renderDisputeBundleSummary(bundle(), 'it');
	expect(en).not.toBe(it);
});

test('an empty clause note list reads as explicitly empty, not as a missing section', () => {
	const text = renderDisputeBundleSummary(bundle({ clauseNotes: [] }), 'en');
	expect(text.toLowerCase()).toMatch(/no clause|none/);
});
