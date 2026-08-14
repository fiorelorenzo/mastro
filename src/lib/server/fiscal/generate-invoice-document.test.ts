// #260 acceptance: a real invoice, under a real jurisdiction pack, ends up
// archived as a `document` (`ownerType: 'invoice'`, `provenance:
// 'generated'`) — the database + disk half of the acceptance
// `generator.test.ts` cannot cover on its own (that file proves the bytes
// are correct; this one proves they get stored). Same pattern as
// `repositories/document.test.ts`: Postgres work rolls back, blob writes
// go to a throwaway temp directory removed after each test.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract, invoice, invoiceLine, practiceProfile } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { getInvoiceWithLines } from '$lib/server/repositories/invoice';
import { getDocument, readDocumentBytes } from '$lib/server/repositories/document';
import { minorUnits } from '$lib/money';
import { evaluateInvoiceCharges, resolveDefaultTaxTreatment } from './pack';
import { itFlatRatePack } from './packs/it-flat-rate';
import { itStandardPack } from './packs/it-standard';
import { generateAndStoreInvoiceDocument } from './generate-invoice-document';

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-fattura-documents-'));
	process.env.DOCUMENT_STORAGE_ROOT = root;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function insertFixtures(tx: Tx, pack: typeof itFlatRatePack | typeof itStandardPack) {
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: 'Nordwind Logistics Srl',
			taxId: `IT${crypto.randomUUID().replace(/-/g, '').slice(0, 11)}`,
			vatId: `IT${crypto.randomUUID().replace(/-/g, '').slice(0, 11)}`,
			country: 'IT',
			addressLine1: 'Corso Italia 5',
			addressCity: 'Milano',
			addressPostalCode: '20100',
			addressRegion: 'MI',
			noticeChannel: 'email' as const,
			sdiCode: 'ABCDE12',
			pecAddress: null
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
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy
		})
		.returning();

	const treatment = resolveDefaultTaxTreatment(pack);
	if (!treatment) throw new Error(`${pack.id} declares no default treatment`);
	const taxableAmount = 100_000;
	const taxAmount = Math.round((taxableAmount * treatment.taxRate) / 100);
	const charges = evaluateInvoiceCharges(pack, { invoiceTotal: taxableAmount });
	const total = taxableAmount + taxAmount + (charges.stampDuty ?? 0) + (charges.socialCharge ?? 0);

	const [invoiceRow] = await tx
		.insert(invoice)
		.values({
			contractId: contractRow.id,
			number: `INV-${crypto.randomUUID().slice(0, 8)}`,
			issueDate: '2026-06-15',
			documentType: 'invoice' as const,
			currency: 'EUR',
			taxableAmount: minorUnits(taxableAmount),
			taxAmount: minorUnits(taxAmount),
			total: minorUnits(total),
			taxTreatmentCode: treatment.code,
			statutoryReference: treatment.legalText,
			stampDuty: charges.stampDuty,
			socialCharge: charges.socialCharge,
			dueDate: '2026-07-15',
			dueDateSource: 'computed' as const,
			paymentMethod: 'MP05',
			iban: 'IT60X0542811101000000123456'
		})
		.returning();
	await tx.insert(invoiceLine).values({
		invoiceId: invoiceRow.id,
		description: 'Consulenza tecnica',
		quantity: 10,
		unitPrice: minorUnits(taxableAmount / 10),
		amount: minorUnits(taxableAmount),
		taxRate: treatment.taxRate,
		taxTreatmentCode: treatment.code
	});

	const [practiceProfileRow] = await tx
		.insert(practiceProfile)
		.values({
			legalName: 'Giulia Bianchi',
			taxId: 'BNCGLI85A41H501K',
			vatId: `IT${crypto.randomUUID().replace(/-/g, '').slice(0, 11)}`,
			country: 'IT',
			addressLine1: 'Via dei Consulenti 8',
			addressCity: 'Bologna',
			addressPostalCode: '40100',
			addressRegion: 'BO'
		})
		.returning();

	return { invoiceId: invoiceRow.id, practiceProfileRow };
}

test('generateAndStoreInvoiceDocument archives the generated XML as a document owned by the invoice', async () => {
	const outcome = await inRolledBackTransaction(async (tx) => {
		const { invoiceId, practiceProfileRow } = await insertFixtures(tx, itFlatRatePack);
		const invoiceRow = await getInvoiceWithLines(invoiceId, tx);
		if (!invoiceRow) throw new Error('invoice not found');
		const result = await generateAndStoreInvoiceDocument(
			invoiceRow,
			practiceProfileRow,
			itFlatRatePack,
			tx
		);
		if (result.kind !== 'stored') throw new Error(`expected 'stored', got ${result.kind}`);
		const stored = await getDocument(result.document.id, tx);
		const bytes = stored ? await readDocumentBytes(stored) : null;
		return { result, stored, bytes, invoiceId };
	});

	expect(outcome.result.kind).toBe('stored');
	expect(outcome.stored?.ownerType).toBe('invoice');
	expect(outcome.stored?.ownerId).toBe(outcome.invoiceId);
	expect(outcome.stored?.provenance).toBe('generated');
	expect(outcome.stored?.mime).toBe('application/xml');
	expect(outcome.stored?.confidential).toBe(true);
	expect(outcome.bytes?.toString('utf-8')).toContain('<RegimeFiscale>RF19</RegimeFiscale>');
});

test("generateAndStoreInvoiceDocument reports 'unsupported' for a pack with no formats, storing nothing", async () => {
	const outcome = await inRolledBackTransaction(async (tx) => {
		const genericLikePack = { ...itStandardPack, formats: [] };
		const { invoiceId, practiceProfileRow } = await insertFixtures(tx, itStandardPack);
		const invoiceRow = await getInvoiceWithLines(invoiceId, tx);
		if (!invoiceRow) throw new Error('invoice not found');
		return generateAndStoreInvoiceDocument(invoiceRow, practiceProfileRow, genericLikePack, tx);
	});
	expect(outcome.kind).toBe('unsupported');
});
