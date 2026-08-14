// #87's accept dispatcher: `applyProposal`/`proposalValidationError`'s
// `'invoice'` case in `proposal.ts`. Kept in its own file rather than
// folded into `proposal.test.ts` — that file is shared with #86's own
// `'contract'` case landing in the same wave, and a second file avoids
// two parallel changes editing the same test file's fixtures.
//
// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Same
// rolled-back-transaction pattern as `proposal.test.ts` itself.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract, document, invoice, invoiceLine } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { storeDocument } from './document';
import { acceptProposal, createProposal, diffProposalFields, getProposal } from './proposal';

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-invoice-proposals-'));
	process.env.DOCUMENT_STORAGE_ROOT = root;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

let counter = 0;

async function insertContract(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
	counter += 1;
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: `Invoice PDF Test Client ${counter}`,
			taxId: `INV-PDF-TAX-${counter}`,
			country: 'IT',
			addressLine1: 'Via Roma 1',
			addressCity: 'Milano',
			addressPostalCode: '20100',
			noticeChannel: 'email' as const
		})
		.returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Invoice PDF test contract',
			startsOn: '2024-01-01',
			renewalType: 'none' as const,
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
			invoicingCadence: 'monthly' as const,
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			requiresPriorApproval: false
		})
		.returning();
	return contractRow;
}

/** Archives a PDF the same way an invoice-PDF upload would, owned by the
 * contract until a proposal made from it is accepted (or superseded). */
async function insertPdfDocument(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	contractId: string
) {
	const row = await storeDocument(
		{
			bytes: new TextEncoder().encode('%PDF-1.4 fake invoice pdf bytes'),
			mime: 'application/pdf',
			originalName: 'invoice.pdf',
			provenance: 'upload' as const,
			contractId,
			confidential: true,
			ownerType: 'contract' as const,
			ownerId: contractId
		},
		tx
	);
	return row;
}

const invoiceProposedFields = (over: Record<string, unknown> = {}) => ({
	number: 'INV-2026-014',
	issueDate: '2026-03-04',
	dueDate: '2026-04-03',
	clientName: 'Acme SRL',
	currency: 'EUR',
	lines: [
		{
			description: 'Consulenza marzo 2026',
			quantity: 1,
			unitPrice: 60000,
			amount: 60000,
			taxRate: 0
		}
	],
	taxableAmount: 60000,
	taxAmount: 0,
	total: 60000,
	...over
});

test('createProposal records a pending invoice proposal with no decision yet', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertPdfDocument(tx, contractRow.id);

		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'invoice',
				proposedFields: invoiceProposedFields(),
				excerpt: 'Fattura n. INV-2026-014 del 04/03/2026',
				confidence: 0.7
			},
			tx
		);

		expect(created.status).toBe('pending');
		expect(created.validationError).toBeNull();
		expect(created.acceptedFields).toBeNull();
		expect(created.resultId).toBeNull();
	});
});

test('a proposed invoice whose line does not sum to its taxable amount is refused at creation', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertPdfDocument(tx, contractRow.id);

		// createProposal itself never checks lines-sum-to-total (that is
		// `agent/invoice-extraction.ts`'s job, before a proposal is ever
		// created) — `validationError` here only checks what the database
		// itself would reject on INSERT, so a negative line quantity is
		// exactly the shape `proposalValidationError` is meant to catch.
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'invoice',
				proposedFields: invoiceProposedFields({
					lines: [{ description: 'x', quantity: -1, unitPrice: 60000, amount: 60000, taxRate: 0 }]
				}),
				excerpt: 'Fattura n. INV-2026-014 del 04/03/2026',
				confidence: 0.7
			},
			tx
		);

		expect(created.validationError).toMatch(/quantity -1 must be greater than 0/);
	});
});

test('accepting an invoice proposal writes the invoice and its lines, and re-owns the PDF as its evidence', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertPdfDocument(tx, contractRow.id);
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'invoice',
				proposedFields: invoiceProposedFields(),
				excerpt: 'Fattura n. INV-2026-014 del 04/03/2026',
				confidence: 0.7
			},
			tx
		);

		const accepted = await acceptProposal(created.id, { decidedBy: 'lorenzo@example.com' }, tx);

		expect(accepted.status).toBe('accepted');
		expect(accepted.resultId).toBeTruthy();
		expect(diffProposalFields(accepted)).toEqual([]);

		const [invoiceRow] = await tx
			.select()
			.from(invoice)
			.where(eq(invoice.id, accepted.resultId as string));
		expect(invoiceRow.contractId).toBe(contractRow.id);
		expect(invoiceRow.number).toBe('INV-2026-014');
		expect(invoiceRow.issueDate).toBe('2026-03-04');
		expect(invoiceRow.taxableAmount).toBe(60000);
		expect(invoiceRow.taxAmount).toBe(0);
		expect(invoiceRow.total).toBe(60000);

		const lines = await tx
			.select()
			.from(invoiceLine)
			.where(eq(invoiceLine.invoiceId, invoiceRow.id));
		expect(lines).toHaveLength(1);
		expect(lines[0].description).toBe('Consulenza marzo 2026');
		expect(lines[0].amount).toBe(60000);

		const [documentRowAfter] = await tx
			.select()
			.from(document)
			.where(eq(document.id, documentRow.id));
		expect(documentRowAfter.ownerType).toBe('invoice');
		expect(documentRowAfter.ownerId).toBe(invoiceRow.id);
	});
});

test('an edit that breaks the invoice_line CHECK constraints refuses accept, writing nothing', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await insertPdfDocument(tx, contractRow.id);
		const created = await createProposal(
			{
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'invoice',
				proposedFields: invoiceProposedFields(),
				excerpt: 'Fattura n. INV-2026-014 del 04/03/2026',
				confidence: 0.7
			},
			tx
		);

		await expect(
			tx.transaction((nested) =>
				acceptProposal(
					created.id,
					{
						edits: {
							lines: [
								{
									description: 'Consulenza marzo 2026',
									quantity: 1,
									unitPrice: 60000,
									amount: 60000,
									taxRate: 130
								}
							]
						},
						decidedBy: 'lorenzo@example.com'
					},
					nested
				)
			)
		).rejects.toThrow(/taxRate 130 must be between 0 and 100/);

		const fetched = await getProposal(created.id, tx);
		expect(fetched?.status).toBe('pending');
	});
});
