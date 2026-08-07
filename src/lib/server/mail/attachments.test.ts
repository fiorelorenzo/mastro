import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { client, contract, workUnit } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { createApproval } from '$lib/server/repositories/approval';
import { createWorkUnit } from '$lib/server/repositories/work-unit';
import { renderRegisterCsv } from '$lib/server/register/csv';
import { buildRegister } from '$lib/server/repositories/register';
import { assembleAttachments } from './attachments';

// Same transaction-rollback pattern as `repositories/register.test.ts`.

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-attachments-'));
	process.env.DOCUMENT_STORAGE_ROOT = root;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function seed(tx: Tx) {
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

	const bytes = new TextEncoder().encode('Yes, go ahead.');
	const approvalRow = await createApproval(
		{
			contractId: contractRow.id,
			channel: 'email',
			sender: 'ops@client.example',
			receivedAt: new Date('2024-03-01T09:00:00Z'),
			messageId: '<abc@example.com>',
			excerpt: 'Yes, go ahead.',
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

	const day = await createWorkUnit(
		{
			contractId: contractRow.id,
			date: '2024-03-10',
			quantity: 1,
			scope: 'Attachment fixture day.',
			approvalId: approvalRow.id
		},
		{ kind: 'human', email: 'lorenzo@example.com' },
		'seed',
		tx
	);
	await tx
		.update(workUnit)
		.set({ state: 'invoiced', invoiceLineId: crypto.randomUUID() })
		.where(eq(workUnit.id, day.id));

	return contractRow;
}

test('assembles exactly the attachment kinds requested, generated fresh from the ledger', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await seed(tx);
			const period = { from: '2024-03-01', to: '2024-03-31' };

			const both = await assembleAttachments(
				['day_register_pdf', 'day_register_csv'],
				contractRow.id,
				period,
				'en',
				tx
			);
			expect(both.map((a) => a.filename).sort()).toEqual([
				'day-register-2024-03-01-to-2024-03-31.csv',
				'day-register-2024-03-01-to-2024-03-31.pdf'
			]);
			expect(both.find((a) => a.filename.endsWith('.pdf'))?.contentType).toBe('application/pdf');
			expect(both.find((a) => a.filename.endsWith('.csv'))?.contentType).toBe('text/csv');

			const csvOnly = await assembleAttachments(
				['day_register_csv'],
				contractRow.id,
				period,
				'en',
				tx
			);
			expect(csvOnly).toHaveLength(1);
			const register = await buildRegister(contractRow.id, period.from, period.to, tx);
			expect(csvOnly[0].content.toString('utf8')).toBe(renderRegisterCsv(register, 'en'));

			const none = await assembleAttachments([], contractRow.id, period, 'en', tx);
			expect(none).toEqual([]);

			tx.rollback();
		})
	).rejects.toThrow();
});
