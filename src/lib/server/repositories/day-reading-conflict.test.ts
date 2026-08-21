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

test('the newest reading supersedes the previous one for the same day', async () => {
	// Upserted, not appended: what a reviewer needs is what the mail says
	// now, not every reading that ever disagreed.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractId, documentId } = await seedContractAndDocument(tx);
		await recordDayReadingConflict(
			{
				contractId,
				date: '2026-08-04',
				documentId,
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
				documentId,
				extractionRunId: null,
				proposedFields: null,
				excerpt: null
			},
			tx
		);
		return tx
			.select()
			.from(dayReadingConflict)
			.where(eq(dayReadingConflict.contractId, contractId));
	});

	expect(result).toHaveLength(1);
	expect(result[0].proposedFields).toBeNull();
});
