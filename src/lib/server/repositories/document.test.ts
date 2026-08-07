import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import {
	getDocument,
	listDocumentsForOwner,
	readDocumentBytes,
	setDocumentRemoteFileId,
	storeDocument
} from './document';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres work
// happens inside a transaction that is always rolled back, same pattern as
// the schema tests (`src/lib/server/db/set-updated-at.test.ts`) — every
// function in `document.ts` takes the ambient `tx` explicitly for this
// reason. Blob writes are real filesystem side effects a rollback cannot
// undo, so they go to a throwaway temp directory removed in `afterEach`.

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

test('uploading the same file twice stores one copy on disk and two references in Postgres', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const bytes = new TextEncoder().encode('the client confirmed the scope by email');

			const first = await storeDocument(
				{
					bytes,
					mime: 'message/rfc822',
					originalName: 'confirmation.eml',
					provenance: 'mail',
					contractId: contractRow.id,
					confidential: true,
					ownerType: 'contract',
					ownerId: contractRow.id
				},
				tx
			);
			const second = await storeDocument(
				{
					bytes,
					mime: 'message/rfc822',
					originalName: 'confirmation-forwarded.eml',
					provenance: 'mail',
					contractId: contractRow.id,
					confidential: true,
					ownerType: 'contract',
					ownerId: contractRow.id
				},
				tx
			);

			expect(first.id).not.toBe(second.id);
			expect(first.hash).toBe(second.hash);

			const references = await listDocumentsForOwner('contract', contractRow.id, tx);
			expect(references.map((r) => r.id).sort()).toEqual([first.id, second.id].sort());

			const bytesBack = await readDocumentBytes(first);
			expect(Buffer.compare(bytesBack, Buffer.from(bytes))).toBe(0);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a document is reachable by id and its owner is reachable in the other direction', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const stored = await storeDocument(
				{
					bytes: new TextEncoder().encode('signed contract'),
					mime: 'application/pdf',
					originalName: 'contract-signed.pdf',
					provenance: 'upload',
					contractId: contractRow.id,
					confidential: false,
					ownerType: 'contract',
					ownerId: contractRow.id
				},
				tx
			);

			const fetched = await getDocument(stored.id, tx);
			expect(fetched?.originalName).toBe('contract-signed.pdf');

			const forOwner = await listDocumentsForOwner('contract', contractRow.id, tx);
			expect(forOwner.map((d) => d.id)).toContain(stored.id);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('setDocumentRemoteFileId records the mirror id without touching anything else', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const stored = await storeDocument(
				{
					bytes: new TextEncoder().encode('signed contract'),
					mime: 'application/pdf',
					originalName: 'contract-signed.pdf',
					provenance: 'upload',
					contractId: contractRow.id,
					confidential: false,
					ownerType: 'contract',
					ownerId: contractRow.id
				},
				tx
			);
			expect(stored.remoteFileId).toBeNull();

			const updated = await setDocumentRemoteFileId(stored.id, 'Contracts/Acme/doc.pdf', tx);

			expect(updated.remoteFileId).toBe('Contracts/Acme/doc.pdf');
			expect(updated.originalName).toBe(stored.originalName);
			expect(updated.hash).toBe(stored.hash);

			tx.rollback();
		})
	).rejects.toThrow();
});
