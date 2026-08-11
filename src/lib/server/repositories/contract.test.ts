import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { rejection } from '$lib/server/db/pg-error';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { getDocument, storeDocument } from './document';
import { revokeHostedExtractionConsent, setHostedExtractionConsentDocument } from './contract';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Same
// rolled-back-transaction pattern as `document.test.ts`, plus its same
// throwaway blob-store root for `storeDocument`'s real filesystem writes.

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-documents-'));
	process.env.DOCUMENT_STORAGE_ROOT = root;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

async function insertContract(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: `Test Client ${crypto.randomUUID()}`,
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
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy
		})
		.returning();
	return contractRow;
}

test('setHostedExtractionConsentDocument archives the document owned by the contract and points at it', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);

		const updated = await setHostedExtractionConsentDocument(
			contractRow.id,
			{
				bytes: new TextEncoder().encode('I consent to hosted extraction for Acme SRL'),
				mime: 'application/pdf',
				originalName: 'consent.pdf',
				provenance: 'upload' as const,
				confidential: true
			},
			tx
		);

		expect(updated.hostedExtractionConsentDocumentId).not.toBeNull();
		const consentDocument = await getDocument(updated.hostedExtractionConsentDocumentId!, tx);
		expect(consentDocument).toMatchObject({
			ownerType: 'contract',
			ownerId: contractRow.id,
			contractId: contractRow.id,
			originalName: 'consent.pdf'
		});
	});
});

test('revokeHostedExtractionConsent clears the link without deleting the archived document', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const updated = await setHostedExtractionConsentDocument(
			contractRow.id,
			{
				bytes: new TextEncoder().encode('consent'),
				mime: 'application/pdf',
				originalName: 'consent.pdf',
				provenance: 'upload' as const,
				confidential: true
			},
			tx
		);
		const documentId = updated.hostedExtractionConsentDocumentId!;

		const revoked = await revokeHostedExtractionConsent(contractRow.id, tx);
		expect(revoked.hostedExtractionConsentDocumentId).toBeNull();

		const stillArchived = await getDocument(documentId, tx);
		expect(stillArchived).toBeDefined();
	});
});

test("pointing hosted_extraction_consent_document_id at a document that is not this contract's own evidence is rejected", async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const otherContractRow = await insertContract(tx);
		// A document archived under a *different* contract's own evidence.
		const foreignDocument = await storeDocument(
			{
				bytes: new TextEncoder().encode("someone else's consent"),
				mime: 'application/pdf',
				originalName: 'other.pdf',
				provenance: 'upload' as const,
				contractId: otherContractRow.id,
				confidential: true,
				ownerType: 'contract' as const,
				ownerId: otherContractRow.id
			},
			tx
		);

		const refusal = await rejection(() =>
			tx
				.update(contract)
				.set({ hostedExtractionConsentDocumentId: foreignDocument.id })
				.where(eq(contract.id, contractRow.id))
		);
		expect(refusal.message).toMatch(
			/must reference a document archived as this contract's own evidence/
		);
	});
});
