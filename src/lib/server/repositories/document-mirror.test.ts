import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { client, contract, documentMirrorRun } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { storeDocument } from './document';
import {
	getDocumentMirrorContext,
	listUnacknowledgedMirrorFailures,
	listUnmirroredDocuments,
	recordMirrorRun
} from './document-mirror';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Same
// rolled-back-transaction pattern as `document.test.ts`, plus a throwaway
// document store root for `storeDocument`'s real filesystem writes.

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-document-mirror-'));
	process.env.DOCUMENT_STORAGE_ROOT = root;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

async function insertContract(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	legalName = `Test Client ${crypto.randomUUID()}`
) {
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName,
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

test('getDocumentMirrorContext resolves the client legal name through the contract', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, 'Acme SRL');
			const stored = await storeDocument(
				{
					bytes: new TextEncoder().encode('x'),
					mime: 'text/plain',
					originalName: 'note.txt',
					provenance: 'upload',
					contractId: contractRow.id,
					confidential: false,
					ownerType: 'contract',
					ownerId: contractRow.id
				},
				tx
			);

			const context = await getDocumentMirrorContext(stored.id, tx);
			expect(context?.clientLegalName).toBe('Acme SRL');
			expect(context?.document.id).toBe(stored.id);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('getDocumentMirrorContext returns null for an id that does not exist', async () => {
	await expect(
		db.transaction(async (tx) => {
			const context = await getDocumentMirrorContext(crypto.randomUUID(), tx);
			expect(context).toBeNull();

			tx.rollback();
		})
	).rejects.toThrow();
});

test('listUnmirroredDocuments only returns documents with no remote_file_id, oldest first', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const first = await storeDocument(
				{
					bytes: new TextEncoder().encode('a'),
					mime: 'text/plain',
					originalName: 'a.txt',
					provenance: 'upload',
					contractId: contractRow.id,
					confidential: false,
					ownerType: 'contract',
					ownerId: contractRow.id
				},
				tx
			);
			const second = await storeDocument(
				{
					bytes: new TextEncoder().encode('b'),
					mime: 'text/plain',
					originalName: 'b.txt',
					provenance: 'upload',
					contractId: contractRow.id,
					confidential: false,
					ownerType: 'contract',
					ownerId: contractRow.id
				},
				tx
			);

			const pending = await listUnmirroredDocuments(tx);
			const pendingIds = pending.map((row) => row.id);
			expect(pendingIds).toContain(first.id);
			expect(pendingIds).toContain(second.id);
			expect(pendingIds.indexOf(first.id)).toBeLessThan(pendingIds.indexOf(second.id));

			tx.rollback();
		})
	).rejects.toThrow();
});

test('listUnacknowledgedMirrorFailures excludes acknowledged and successful runs', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const stored = await storeDocument(
				{
					bytes: new TextEncoder().encode('x'),
					mime: 'text/plain',
					originalName: 'note.txt',
					provenance: 'upload',
					contractId: contractRow.id,
					confidential: false,
					ownerType: 'contract',
					ownerId: contractRow.id
				},
				tx
			);

			await recordMirrorRun({ documentId: stored.id, status: 'success', detail: null }, tx);
			const acknowledged = await recordMirrorRun(
				{ documentId: stored.id, status: 'failure', detail: 'transient network error' },
				tx
			);
			const unacknowledged = await recordMirrorRun(
				{ documentId: stored.id, status: 'failure', detail: 'Drive quota exceeded' },
				tx
			);
			await tx
				.update(documentMirrorRun)
				.set({ acknowledgedAt: new Date() })
				.where(eq(documentMirrorRun.id, acknowledged.id));

			const failures = await listUnacknowledgedMirrorFailures(tx);
			const failureIds = failures.map((row) => row.id);
			expect(failureIds).toContain(unacknowledged.id);
			expect(failureIds).not.toContain(acknowledged.id);

			tx.rollback();
		})
	).rejects.toThrow();
});
