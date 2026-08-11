import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract, document, documentMirrorRun } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { storeDocument } from '$lib/server/repositories/document';
import { getLatestMirrorRun } from '$lib/server/repositories/document-mirror';
import { createLocalDirectoryMirrorTarget } from './local-target';
import type { MirrorTarget } from './mirror-target';
import { publishAllPending, publishDocument } from './publish';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Same pattern
// as every other repository test — real database, rolled back — plus a
// throwaway directory for the document store (side effects a rollback
// cannot undo) and a second, separate throwaway directory standing in for
// the mirror target itself, proving the acceptance criterion "documents
// appear in the configured structure with the remote id recorded" against
// the one target this project can actually run end to end.

const folderConfig = { contractsFolderName: 'Contracts' };

let documentStorageRoot: string;
let mirrorRoot: string;

beforeEach(async () => {
	documentStorageRoot = await mkdtemp(join(tmpdir(), 'mastro-drive-publish-docs-'));
	mirrorRoot = await mkdtemp(join(tmpdir(), 'mastro-drive-publish-mirror-'));
	process.env.DOCUMENT_STORAGE_ROOT = documentStorageRoot;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(documentStorageRoot, { recursive: true, force: true });
	await rm(mirrorRoot, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

async function insertContract(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
	const legalName = `Test Client ${crypto.randomUUID()}`;
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
	return { contract: contractRow, legalName };
}

test('publishing writes the document into the configured structure and records the remote id', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contract: contractRow, legalName } = await insertContract(tx);
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

		const target = createLocalDirectoryMirrorTarget(mirrorRoot);
		const outcome = await publishDocument(stored.id, target, folderConfig, tx);

		const expectedRemoteFileId = join('Contracts', legalName, `${stored.id}__contract-signed.pdf`);
		expect(outcome).toEqual({ ok: true, remoteFileId: expectedRemoteFileId });

		const writtenBytes = await readFile(join(mirrorRoot, expectedRemoteFileId));
		expect(writtenBytes.toString()).toBe('signed contract');

		const [updatedDocument] = await tx.select().from(document).where(eq(document.id, stored.id));
		expect(updatedDocument.remoteFileId).toBe(expectedRemoteFileId);

		const run = await getLatestMirrorRun(stored.id, tx);
		expect(run?.status).toBe('success');
		expect(run?.detail).toBeNull();
	});
});

test('publishing the same document twice is a no-op the second time', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contract: contractRow } = await insertContract(tx);
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

		const target = createLocalDirectoryMirrorTarget(mirrorRoot);
		const first = await publishDocument(stored.id, target, folderConfig, tx);
		const second = await publishDocument(stored.id, target, folderConfig, tx);

		expect(first).toEqual(second);

		const runs = await tx
			.select()
			.from(documentMirrorRun)
			.where(eq(documentMirrorRun.documentId, stored.id));
		expect(runs).toHaveLength(1);
	});
});

test('a failing target leaves remote_file_id null and records a failure run, without throwing', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contract: contractRow } = await insertContract(tx);
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

		const failingTarget: MirrorTarget = {
			publish: async () => {
				throw new Error('Drive quota exceeded');
			}
		};

		const outcome = await publishDocument(stored.id, failingTarget, folderConfig, tx);
		expect(outcome).toEqual({ ok: false, detail: 'Drive quota exceeded' });

		const [row] = await tx.select().from(document).where(eq(document.id, stored.id));
		expect(row.remoteFileId).toBeNull();

		const run = await getLatestMirrorRun(stored.id, tx);
		expect(run?.status).toBe('failure');
		expect(run?.detail).toBe('Drive quota exceeded');
	});
});

test('publishAllPending publishes every unmirrored document and skips one already mirrored', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contract: contractRow } = await insertContract(tx);
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

		const target = createLocalDirectoryMirrorTarget(mirrorRoot);
		await publishDocument(first.id, target, folderConfig, tx);

		const outcomes = await publishAllPending(target, folderConfig, tx);

		// This publishes every unmirrored document in the instance, so the
		// assertion is about this test's own two: the first was already
		// mirrored and must not be touched again, the second must be
		// published. Another test's committed fixtures may legitimately add
		// outcomes of their own.
		expect(outcomes).toContainEqual({
			ok: true,
			remoteFileId: expect.stringContaining(second.id)
		});
		expect(outcomes).not.toContainEqual({
			ok: true,
			remoteFileId: expect.stringContaining(first.id)
		});
	});
});
