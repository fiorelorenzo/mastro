import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { minorUnits } from '$lib/money';
import { createExpense, getExpenseReceipts } from './expense';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres work
// happens inside a transaction that is always rolled back, same pattern as
// the other repository tests. `createExpense`'s receipt writes a blob to
// disk, so `DOCUMENT_STORAGE_ROOT` points at a throwaway temp directory
// removed in `afterEach`, same as `repositories/document.test.ts`.

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-expenses-'));
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
			expensePolicy: { kind: 'reimbursed_at_cost' } satisfies ExpensePolicy,
			requiresExpensePreAuthorisation: false
		})
		.returning();
	return contractRow;
}

test('#215: an expense receipt is reachable in one query, and absence is explicit', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);

		const withoutReceipt = await createExpense(
			{
				contractId: contractRow.id,
				date: '2024-06-10',
				description: 'Taxi',
				amount: minorUnits(1200),
				preAuthorised: false,
				authorisationReference: null
			},
			null,
			tx
		);
		// No receipt ever archived against this one — the edit screen's own
		// upload form reads this same query to decide whether to offer the
		// file input or the archived original (#215's "receipt on an
		// expense").
		expect(await getExpenseReceipts(withoutReceipt.id, tx)).toEqual([]);

		const withReceipt = await createExpense(
			{
				contractId: contractRow.id,
				date: '2024-06-11',
				description: 'Hotel',
				amount: minorUnits(9000),
				preAuthorised: false,
				authorisationReference: null
			},
			{
				bytes: new TextEncoder().encode('a scanned hotel receipt'),
				mime: 'application/pdf',
				originalName: 'hotel-receipt.pdf',
				provenance: 'upload',
				confidential: false
			},
			tx
		);

		const receipts = await getExpenseReceipts(withReceipt.id, tx);
		expect(receipts).toHaveLength(1);
		expect(receipts[0].originalName).toBe('hotel-receipt.pdf');

		// The two expenses' receipt queries stay independent of each other.
		expect(await getExpenseReceipts(withoutReceipt.id, tx)).toEqual([]);
	});
});
