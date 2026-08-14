// #87's supersession: a PDF fallback proposal, still pending, superseded
// by the same invoice's structured document arriving later through the
// ordinary import pipeline (`persist.ts`). Needs a migrated database,
// same rolled-back-transaction pattern as `persist.test.ts`, whose
// fixture-building conventions this file duplicates locally rather than
// importing — a self-contained file two parallel wave-7 changes can each
// own without touching the other's.

import { and, eq, ne } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { minorUnits } from '$lib/money';
import {
	client,
	contract,
	document,
	type ExpensePolicy,
	type PaymentTerms
} from '$lib/server/db/schema';
import { storeDocument } from '$lib/server/repositories/document';
import { createProposal, diffProposalFields, getProposal } from '$lib/server/repositories/proposal';
import type { ImportableFile, InvoiceFormatAdapter } from './adapter';
import { SUPERSEDED_BY_STRUCTURED_IMPORT } from './invoice-supersession';
import type { Invoice, InvoiceParty } from './invoice';
import { persistImportedInvoice, type PersistInvoiceOutcome } from './persist';
import { buildAdapterRegistry } from './registry';

afterAll(async () => {
	await pool.end();
});

const ACCOUNT_HOLDER_TAX_ID = 'IT11111111111';
const ACTOR = { kind: 'human' as const, email: 'lorenzo@example.com' };

// A throwaway JSON "format", the same convention `persist.test.ts` and
// `review.test.ts` use, so a test controls the natural key and amounts
// directly instead of hand-writing FatturaPA XML.
const fakeAdapter: InvoiceFormatAdapter = {
	id: 'test-json-invoice',
	detect: (file) => file.filename.endsWith('.json'),
	parse: (file) => JSON.parse(new TextDecoder().decode(file.content)) as Invoice[]
};
const registry = buildAdapterRegistry([fakeAdapter]);
const pack = { formats: [fakeAdapter.id] };

function party(overrides: Partial<InvoiceParty> = {}): InvoiceParty {
	return {
		legalName: 'Rossi Consulting srl',
		taxId: 'IT01234567890',
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100',
		...overrides
	};
}

function invoiceDoc(overrides: Partial<Invoice> = {}): Invoice {
	return {
		number: '2024/1',
		issueDate: '2024-03-15',
		documentType: 'invoice',
		currency: 'EUR',
		supplier: party({ taxId: ACCOUNT_HOLDER_TAX_ID, legalName: 'Consultant' }),
		customer: party(),
		lines: [
			{
				description: 'Consulting',
				quantity: 1,
				unitPrice: minorUnits(100000),
				amount: minorUnits(100000),
				taxRate: 22
			}
		],
		taxSummary: [{ taxRate: 22, taxableAmount: minorUnits(100000), taxAmount: minorUnits(22000) }],
		taxableAmount: minorUnits(100000),
		taxAmount: minorUnits(22000),
		total: minorUnits(122000),
		socialSecurityCharges: [],
		paymentTerms: [],
		transmission: { transmitterId: ACCOUNT_HOLDER_TAX_ID, progressiveNumber: '1' },
		...overrides
	};
}

function jsonFile(filename: string, value: Invoice): ImportableFile {
	return { filename, content: new TextEncoder().encode(JSON.stringify([value])) };
}

function expectCreated(outcome: PersistInvoiceOutcome): string {
	if (outcome.kind !== 'created') {
		throw new Error(`expected a created outcome, got ${outcome.kind}`);
	}
	return outcome.invoiceId;
}

async function insertContract(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: `Supersession Test Client ${crypto.randomUUID()}`,
			taxId: `TEST-TAX-${crypto.randomUUID()}`,
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
			title: 'Test contract',
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

/** A PDF fallback proposal, pending, with its own lower-confidence guess
 * at the same invoice's fields — a client name read slightly wrong, and
 * a total off by the same amount, exactly what a structured document
 * arriving later should correct. */
async function insertPendingPdfProposal(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	contractId: string,
	over: Record<string, unknown> = {}
) {
	const pdfDocument = await storeDocument(
		{
			bytes: new TextEncoder().encode('%PDF-1.4 fake invoice pdf bytes'),
			mime: 'application/pdf',
			originalName: 'invoice-scan.pdf',
			provenance: 'upload' as const,
			contractId,
			confidential: true,
			ownerType: 'contract' as const,
			ownerId: contractId
		},
		tx
	);
	const pdfProposal = await createProposal(
		{
			documentId: pdfDocument.id,
			contractId,
			targetType: 'invoice',
			proposedFields: {
				number: '2024/1',
				issueDate: '2024-03-15',
				dueDate: null,
				clientName: 'Rossi Consulting srl (guessed)',
				currency: 'EUR',
				lines: [
					{ description: 'Consulting', quantity: 1, unitPrice: 99000, amount: 99000, taxRate: 22 }
				],
				taxableAmount: 99000,
				taxAmount: 21780,
				total: 120780,
				...over
			},
			excerpt: 'Invoice 2024/1 dated 15/03/2024',
			confidence: 0.55
		},
		tx
	);
	return { pdfDocument, pdfProposal };
}

test('a structured document supersedes a still-pending PDF proposal for the same invoice: values win, the PDF becomes an attachment, both documents kept', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const { pdfDocument, pdfProposal } = await insertPendingPdfProposal(tx, contractRow.id);

		const outcome = await persistImportedInvoice(
			{
				file: jsonFile('a.json', invoiceDoc()),
				invoiceIndex: 0,
				attachments: [],
				contractId: contractRow.id,
				lineDecisions: [{ workUnitIds: [] }]
			},
			pack,
			registry,
			ACCOUNT_HOLDER_TAX_ID,
			[],
			ACTOR,
			'imported from a fixture folder',
			tx
		);
		const invoiceId = expectCreated(outcome);

		const superseded = await getProposal(pdfProposal.id, tx);
		expect(superseded?.status).toBe('accepted');
		expect(superseded?.resultId).toBe(invoiceId);
		expect(superseded?.decidedBy).toBe(SUPERSEDED_BY_STRUCTURED_IMPORT);
		// The structured document's own values, not the PDF's guess.
		expect(superseded?.acceptedFields).toMatchObject({
			number: '2024/1',
			issueDate: '2024-03-15',
			clientName: 'Rossi Consulting srl',
			taxableAmount: 100000,
			taxAmount: 22000,
			total: 122000
		});
		// The diff is visible: exactly the fields the structured document
		// corrected, #83's own "diff is the whole point" made concrete for
		// an automatic supersession instead of a human's edit.
		expect(
			diffProposalFields(superseded!)
				.map((change) => change.field)
				.sort()
		).toEqual(['clientName', 'dueDate', 'lines', 'taxAmount', 'taxableAmount', 'total'].sort());

		// The PDF becomes an attachment: re-owned onto the real invoice.
		const [pdfDocAfter] = await tx.select().from(document).where(eq(document.id, pdfDocument.id));
		expect(pdfDocAfter.ownerType).toBe('invoice');
		expect(pdfDocAfter.ownerId).toBe(invoiceId);

		// Both documents kept (invariant 4): the structured import's own
		// archived original, plus the PDF the fallback lane read.
		const invoiceDocuments = await tx
			.select()
			.from(document)
			.where(eq(document.ownerId, invoiceId));
		expect(invoiceDocuments).toHaveLength(2);
		expect(invoiceDocuments.map((row) => row.id)).toContain(pdfDocument.id);
		const structuredDocument = await tx
			.select()
			.from(document)
			.where(and(eq(document.ownerId, invoiceId), ne(document.id, pdfDocument.id)));
		expect(structuredDocument[0].mime).not.toBe('application/pdf');
	});
});

test('a pending PDF proposal for a different invoice is left untouched', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const { pdfProposal } = await insertPendingPdfProposal(tx, contractRow.id, {
			number: '2024/999'
		});

		await persistImportedInvoice(
			{
				file: jsonFile('a.json', invoiceDoc()),
				invoiceIndex: 0,
				attachments: [],
				contractId: contractRow.id,
				lineDecisions: [{ workUnitIds: [] }]
			},
			pack,
			registry,
			ACCOUNT_HOLDER_TAX_ID,
			[],
			ACTOR,
			'imported from a fixture folder',
			tx
		);

		const untouched = await getProposal(pdfProposal.id, tx);
		expect(untouched?.status).toBe('pending');
		expect(untouched?.resultId).toBeNull();
	});
});
