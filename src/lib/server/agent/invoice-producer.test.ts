// #87. The model is scripted here: what a real one answers is
// `scripts/propose-invoice-from-pdf.ts`'s question (run by hand against
// Claude), and what this file proves is that one PDF becomes the right
// proposal, or none at all — the same split `day-producer.test.ts`
// already draws for #85.

import PDFDocument from 'pdfkit';
import { expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client, contract, document, type ExpensePolicy } from '$lib/server/db/schema';
import type { DbExecutor } from '$lib/server/db';
import type { ProposalCandidate } from '$lib/server/runner/types';
import {
	extractPdfText,
	proposeInvoiceFromPdf,
	writeInvoiceProposal,
	type RunExtraction
} from './invoice-producer';

async function seed(tx: DbExecutor) {
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: 'Invoice Producer SRL',
			taxId: `IT${Date.now()}`,
			country: 'IT',
			addressLine1: 'Via Prova 1',
			addressCity: 'Milano',
			addressPostalCode: '20121',
			noticeChannel: 'email'
		})
		.returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Contratto quadro 2026',
			startsOn: '2026-01-01',
			endsOn: '2026-12-31',
			renewalType: 'none',
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 },
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy
		})
		.returning();
	const [documentRow] = await tx
		.insert(document)
		.values({
			hash: 'b'.repeat(64),
			mime: 'application/pdf',
			size: 128,
			originalName: 'invoice.pdf',
			provenance: 'upload',
			contractId: contractRow.id,
			confidential: true,
			ownerType: 'contract',
			ownerId: contractRow.id
		})
		.returning();
	return { contractRow, documentRow };
}

const invoiceFields = (over: Record<string, unknown> = {}) => ({
	number: 'INV-2026-014',
	issueDate: '2026-03-04',
	dueDate: '2026-04-03',
	clientName: 'Acme SRL',
	currency: 'EUR',
	lines: [
		{
			description: 'Consulenza marzo 2026',
			quantity: 1,
			unitPrice: '600.00',
			amount: '600.00',
			taxRate: 0
		}
	],
	taxableAmount: '600.00',
	taxAmount: '0.00',
	total: '600.00',
	...over
});

const CONTENT = 'Fattura n. INV-2026-014 del 04/03/2026. Cliente: Acme SRL. Totale: 600.00 EUR.';

const answer = (
	over: Partial<{
		proposedFields: Record<string, unknown>;
		excerpt: string;
		confidence: number;
	}> = {}
): RunExtraction => {
	return async (request) =>
		({
			documentId: request.documentId,
			contractId: request.contractId,
			targetType: request.targetType,
			proposedFields: invoiceFields(),
			excerpt: 'Fattura n. INV-2026-014 del 04/03/2026',
			confidence: 0.75,
			...over
		}) satisfies ProposalCandidate;
};

function renderInvoicePdf(lines: readonly string[]): Promise<Buffer> {
	const doc = new PDFDocument({ size: 'A4', margin: 40 });
	const chunks: Buffer[] = [];
	doc.on('data', (chunk: Buffer) => chunks.push(chunk));
	const done = new Promise<Buffer>((resolve, reject) => {
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
	});
	doc.font('Helvetica').fontSize(11);
	for (const line of lines) doc.text(line);
	doc.end();
	return done;
}

test('extractPdfText reads a generated PDF back to recognisable text', async () => {
	const pdf = await renderInvoicePdf([
		'Fattura n. INV-2026-014 del 04/03/2026',
		'Cliente: Acme SRL',
		'Consulenza marzo 2026    600.00'
	]);
	const text = await extractPdfText(pdf);
	expect(text).toContain('INV-2026-014');
	expect(text).toContain('Acme SRL');
});

test('a well-formed answer writes one pending invoice proposal', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		const outcome = await writeInvoiceProposal(
			{ documentId: documentRow.id, contractId: contractRow.id },
			CONTENT,
			await answer()({
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'invoice',
				content: CONTENT,
				instructions: ''
			}),
			tx
		);

		expect(outcome.rejected).toEqual([]);
		expect(outcome.proposals).toHaveLength(1);
		const [proposalRow] = outcome.proposals;
		expect(proposalRow.targetType).toBe('invoice');
		expect(proposalRow.status).toBe('pending');
		expect(proposalRow.excerpt).toBe('Fattura n. INV-2026-014 del 04/03/2026');
		expect(proposalRow.proposedFields).toMatchObject({
			number: 'INV-2026-014',
			issueDate: '2026-03-04',
			clientName: 'Acme SRL',
			taxableAmount: 60000,
			taxAmount: 0,
			total: 60000
		});
	});
});

test('an excerpt that is not verbatim in the document writes no proposal, just a reason', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		const candidate = await answer({ excerpt: 'Invoice number INV-2026-014, a paraphrase' })({
			documentId: documentRow.id,
			contractId: contractRow.id,
			targetType: 'invoice',
			content: CONTENT,
			instructions: ''
		});
		const outcome = await writeInvoiceProposal(
			{ documentId: documentRow.id, contractId: contractRow.id },
			CONTENT,
			candidate,
			tx
		);

		expect(outcome.proposals).toEqual([]);
		expect(outcome.rejected).toHaveLength(1);
		expect(outcome.rejected[0].reason).toMatch(/not verbatim/);
	});
});

test('a total that does not match its own lines writes no proposal, just a reason', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		const candidate = await answer({ proposedFields: invoiceFields({ total: '700.00' }) })({
			documentId: documentRow.id,
			contractId: contractRow.id,
			targetType: 'invoice',
			content: CONTENT,
			instructions: ''
		});
		const outcome = await writeInvoiceProposal(
			{ documentId: documentRow.id, contractId: contractRow.id },
			CONTENT,
			candidate,
			tx
		);

		expect(outcome.proposals).toEqual([]);
		expect(outcome.rejected[0].reason).toMatch(/does not equal taxableAmount/);
	});
});

test('a malformed answer throws, rather than being repaired', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		const candidate = await answer({ proposedFields: { number: 'INV-1' } })({
			documentId: documentRow.id,
			contractId: contractRow.id,
			targetType: 'invoice',
			content: CONTENT,
			instructions: ''
		});
		await expect(
			writeInvoiceProposal(
				{ documentId: documentRow.id, contractId: contractRow.id },
				CONTENT,
				candidate,
				tx
			)
		).rejects.toThrow(/proposedFields\.issueDate/);
	});
});

test('proposeInvoiceFromPdf reads the PDF, runs the (scripted) model, and writes the proposal', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, documentRow } = await seed(tx);
		const pdf = await renderInvoicePdf([
			'Fattura n. INV-2026-014 del 04/03/2026',
			'Cliente: Acme SRL',
			'Consulenza marzo 2026    600.00'
		]);

		const outcome = await proposeInvoiceFromPdf(
			{ documentId: documentRow.id, contractId: contractRow.id },
			pdf,
			answer(),
			tx
		);

		expect(outcome.proposals).toHaveLength(1);
		expect(outcome.proposals[0].contractId).toBe(contractRow.id);
	});
});
