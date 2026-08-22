import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
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

test('publishDocument records a failure run for an unattributed document called directly, the throw-before-try path', async () => {
	await inRolledBackTransaction(async (tx) => {
		// A real document row with no contract: `getDocumentMirrorContext`'s
		// `innerJoin` finds nothing and returns null, so `publishDocument`
		// used to throw right here, before its own `try` block started - the
		// outer catch in `publishAllPending` saw it instead, and that catch
		// records nothing (#393). `listUnmirroredDocuments` now keeps a
		// document like this out of the batch entirely, but `publishDocument`
		// is also called directly (`publishAllPending`'s own loop, or any
		// future caller), so it must still record what happened rather than
		// throw an unhandled rejection nobody sees. A row with no
		// `document_id` in `document` at all cannot be inserted here — the
		// foreign key requires it — so this is the closest real instance of
		// the throw-before-try path: a document the join cannot resolve.
		const unattributed = await storeDocument(
			{
				bytes: new TextEncoder().encode('newsletter'),
				mime: 'text/plain',
				originalName: 'newsletter.txt',
				provenance: 'mail',
				contractId: null,
				confidential: false,
				ownerType: null,
				ownerId: null
			},
			tx
		);
		const target = createLocalDirectoryMirrorTarget(mirrorRoot);

		const outcome = await publishDocument(unattributed.id, target, folderConfig, tx);
		expect(outcome).toEqual({ ok: false, detail: `document ${unattributed.id} not found` });

		const run = await getLatestMirrorRun(unattributed.id, tx);
		expect(run?.status).toBe('failure');
		expect(run?.detail).toBe(`document ${unattributed.id} not found`);
	});
});

test('publishAllPending publishes every unmirrored document and skips one already mirrored', async () => {
	await inRolledBackTransaction(async (tx) => {
		// This is the one test here that calls a whole-table operation, so it
		// has to stop depending on what the database already holds - the seed's
		// documents, and whatever another test file committed a second ago
		// (AGENTS.md: "a test runs against a database that has data in it").
		// Before #409 it read every unmirrored row on the instance: it timed
		// out at 5s, then at 20s, and once the pass was bounded to a batch its
		// own two rows fell outside the batch entirely, because they are the
		// newest and the order is oldest-first. Claiming everything else is
		// already mirrored is a legitimate ledger state and makes this test
		// about its own rows again.
		await tx.execute(
			sql`update document set remote_file_id = 'pre-existing' where remote_file_id is null`
		);
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

test('publishAllPending never offers an unattributed document to the publisher, and reports no failures for it', async () => {
	await inRolledBackTransaction(async (tx) => {
		// Same isolation reason as the test above: claim every already-pending
		// row so this run is only about the one this test creates.
		await tx.execute(
			sql`update document set remote_file_id = 'pre-existing' where remote_file_id is null`
		);
		const unattributed = await storeDocument(
			{
				bytes: new TextEncoder().encode('newsletter'),
				mime: 'text/plain',
				originalName: 'newsletter.txt',
				provenance: 'mail',
				contractId: null,
				confidential: false,
				ownerType: null,
				ownerId: null
			},
			tx
		);

		const target = createLocalDirectoryMirrorTarget(mirrorRoot);

		// Deliberately not asserting on the returned outcome list. It used to
		// be `expect(outcomes).toEqual([])` and it flaked: vitest runs test
		// *files* in parallel workers against one database, so a document
		// another file commits between the UPDATE above and this call is
		// visible under READ COMMITTED, gets offered, and fails with an
		// ENOENT because its blob sits under that file's own
		// `DOCUMENT_STORAGE_ROOT` rather than this one's. The assertion then
		// failed for a reason with nothing to do with the behaviour it was
		// about, and `PublishOutcome` carries no document id, so the list
		// cannot be narrowed to what this test created. The list is simply
		// not where this claim lives.
		//
		// The claim is that the unattributed document was never offered, and
		// the two assertions below discriminate it from "offered and
		// swallowed": had the queue handed it over, `publishDocument`
		// resolves its context inside its own `try`, finds none for a
		// document with no contract, and records a `failure` run row for
		// this document (#393). A null run row is only possible if it was
		// never tried.
		await publishAllPending(target, folderConfig, tx);

		const [row] = await tx.select().from(document).where(eq(document.id, unattributed.id));
		expect(row.remoteFileId).toBeNull();
		const run = await getLatestMirrorRun(unattributed.id, tx);
		expect(run).toBeNull();
	});
});
