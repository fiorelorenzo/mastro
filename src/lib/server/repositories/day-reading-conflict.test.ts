import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract, dayReadingConflict } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { storeDocument } from './document';
import { recordDayReadingConflict } from './day-reading-conflict';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres work
// happens inside a transaction that is always rolled back, same pattern as
// the other repository tests. `storeDocument` writes real bytes to disk, so
// `DOCUMENT_STORAGE_ROOT` points at a throwaway temp directory removed in
// `afterEach`, same as `repositories/work-unit.test.ts`.

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-day-reading-conflict-'));
	process.env.DOCUMENT_STORAGE_ROOT = root;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

async function seedContractAndDocument(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
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
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			requiresPriorApproval: false
		})
		.returning();
	const documentRow = await storeDocument(
		{
			bytes: new TextEncoder().encode(`From: ops@client.example\r\n\r\nuna giornata il 4`),
			mime: 'message/rfc822',
			originalName: 'thread.eml',
			provenance: 'mail' as const,
			contractId: contractRow.id,
			confidential: true,
			ownerType: 'contract' as const,
			ownerId: contractRow.id
		},
		tx
	);
	return { contractId: contractRow.id, documentId: documentRow.id };
}

/** A second archived document on the same contract, so a test can prove the
 * upsert really replaces `document_id` (not just `proposed_fields`) —
 * Task 5 shipped a first attempt that left a stale `document_id` behind on
 * an otherwise-refreshed row. */
async function seedSecondDocument(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	contractId: string
) {
	const documentRow = await storeDocument(
		{
			bytes: new TextEncoder().encode(`From: ops@client.example\r\n\r\nniente il 4`),
			mime: 'message/rfc822',
			originalName: 'thread-2.eml',
			provenance: 'mail' as const,
			contractId,
			confidential: true,
			ownerType: 'contract' as const,
			ownerId: contractId
		},
		tx
	);
	return documentRow.id;
}

test('the newest reading supersedes the previous one for the same day', async () => {
	// Upserted, not appended: what a reviewer needs is what the mail says
	// now, not every reading that ever disagreed. Every mutable column is
	// pinned here, not just `proposedFields`: dropping any of
	// `documentId`/`excerpt` from the upsert's `set` clause would leave a
	// stale value behind while this test stayed green, since a superseded
	// row that agrees on the other columns cannot tell a real replace from
	// a no-op.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractId, documentId: firstDocumentId } = await seedContractAndDocument(tx);
		const secondDocumentId = await seedSecondDocument(tx, contractId);
		await recordDayReadingConflict(
			{
				contractId,
				date: '2026-08-04',
				documentId: firstDocumentId,
				extractionRunId: null,
				proposedFields: { date: '2026-08-04', quantity: 1, scope: 'meetings' },
				excerpt: 'una giornata il 4'
			},
			tx
		);
		await recordDayReadingConflict(
			{
				contractId,
				date: '2026-08-04',
				documentId: secondDocumentId,
				extractionRunId: null,
				proposedFields: null,
				excerpt: null
			},
			tx
		);
		return {
			rows: await tx
				.select()
				.from(dayReadingConflict)
				.where(eq(dayReadingConflict.contractId, contractId)),
			secondDocumentId
		};
	});

	expect(result.rows).toHaveLength(1);
	expect(result.rows[0].proposedFields).toBeNull();
	expect(result.rows[0].excerpt).toBeNull();
	expect(result.rows[0].documentId).toBe(result.secondDocumentId);
});
