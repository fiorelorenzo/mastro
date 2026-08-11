import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import {
	createApproval,
	documentBelongsToApproval,
	getApprovalDocument,
	listApprovalsForContract
} from './approval';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres work
// happens inside a transaction that is always rolled back, same pattern as
// `repositories/document.test.ts` and the schema tests. Blob writes are
// real filesystem side effects a rollback cannot undo, so they go to a
// throwaway temp directory removed in `afterEach`.

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-approvals-'));
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
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			requiresPriorApproval: true
		})
		.returning();
	return contractRow;
}

test('creating an approval archives its proof and links it in both directions', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const bytes = new TextEncoder().encode('Yes, go ahead with the three days next week.');

		const approvalRow = await createApproval(
			{
				contractId: contractRow.id,
				channel: 'email',
				sender: 'client@example.com',
				receivedAt: new Date('2024-05-01T09:00:00Z'),
				messageId: '<abc@example.com>',
				excerpt: 'Yes, go ahead with the three days next week.',
				origin: { kind: 'manual' },
				document: {
					bytes,
					mime: 'message/rfc822',
					originalName: 'approval.eml',
					provenance: 'mail',
					confidential: true
				}
			},
			tx
		);

		// Forward: from the approval to its archived original.
		const original = await getApprovalDocument(approvalRow.id, tx);
		expect(original?.originalName).toBe('approval.eml');
		expect(original?.confidential).toBe(true);

		// Reverse: from the document back to the approval it evidences.
		expect(
			original ? await documentBelongsToApproval(original.id, approvalRow.id, tx) : false
		).toBe(true);

		const forContract = await listApprovalsForContract(contractRow.id, tx);
		expect(forContract.map((a) => a.id)).toEqual([approvalRow.id]);
	});
});
