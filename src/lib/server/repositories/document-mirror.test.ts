import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract, document, documentMirrorRun } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { claimDocumentForContract, storeDocument } from './document';
import {
	countUnattributedPendingDocuments,
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
	await inRolledBackTransaction(async (tx) => {
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
	});
});

test('getDocumentMirrorContext returns null for an id that does not exist', async () => {
	await inRolledBackTransaction(async (tx) => {
		const context = await getDocumentMirrorContext(crypto.randomUUID(), tx);
		expect(context).toBeNull();
	});
});

test('listUnmirroredDocuments only returns documents with no remote_file_id, oldest first', async () => {
	await inRolledBackTransaction(async (tx) => {
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

		// Distinct timestamps, because ordering is the point of this test and
		// `now()` is the transaction's own start time: two rows inserted here
		// share it, so "oldest first" between them is undefined. It only ever
		// looked deterministic while this table was nearly empty. AGENTS.md
		// records this trap; this test was standing on it.
		await tx
			.update(document)
			.set({ createdAt: new Date('2026-01-01T00:00:00Z') })
			.where(eq(document.id, first.id));
		await tx
			.update(document)
			.set({ createdAt: new Date('2026-01-02T00:00:00Z') })
			.where(eq(document.id, second.id));

		const pending = await listUnmirroredDocuments(500, tx);
		const pendingIds = pending.map((row) => row.id);
		expect(pendingIds).toContain(first.id);
		expect(pendingIds).toContain(second.id);
		expect(pendingIds.indexOf(first.id)).toBeLessThan(pendingIds.indexOf(second.id));
	});
});

test('listUnmirroredDocuments excludes a document with no contract_id, even though its remote_file_id is null', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const attributed = await storeDocument(
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
		// A first-intake attachment nobody has claimed yet (#380): null
		// contract_id, null owner, exactly the shape #393's 407 production
		// documents were in.
		const unattributed = await storeDocument(
			{
				bytes: new TextEncoder().encode('b'),
				mime: 'text/plain',
				originalName: 'b.txt',
				provenance: 'mail',
				contractId: null,
				confidential: false,
				ownerType: null,
				ownerId: null
			},
			tx
		);

		const pending = await listUnmirroredDocuments(500, tx);
		const pendingIds = pending.map((row) => row.id);
		expect(pendingIds).toContain(attributed.id);
		expect(pendingIds).not.toContain(unattributed.id);
	});
});

test('countUnattributedPendingDocuments counts unmirrored documents with no contract_id, not attributed ones', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		await storeDocument(
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
		const unattributed = await storeDocument(
			{
				bytes: new TextEncoder().encode('b'),
				mime: 'text/plain',
				originalName: 'b.txt',
				provenance: 'mail',
				contractId: null,
				confidential: false,
				ownerType: null,
				ownerId: null
			},
			tx
		);

		const before = await countUnattributedPendingDocuments(tx);
		expect(before).toBeGreaterThanOrEqual(1);

		// Attributing it later removes it from the count without a manual
		// mirror-side step, since the count is a live query, not a snapshot.
		// `claimDocumentForContract` sets `ownerType`/`ownerId` together with
		// `contractId`, which `document_unclaimed_together` requires.
		await claimDocumentForContract(unattributed.id, contractRow.id, tx);
		const after = await countUnattributedPendingDocuments(tx);
		expect(after).toBe(before - 1);
	});
});

test('listUnacknowledgedMirrorFailures excludes acknowledged and successful runs', async () => {
	await inRolledBackTransaction(async (tx) => {
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
	});
});
