import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from './rollback';
import { rejection } from './pg-error';
import { client as pool, db } from './index';
import { approval, client, contract, document, expense, invoice } from './schema';
import type { ExpensePolicy, PaymentTerms } from './schema/contract';
import { minorUnits } from '$lib/money';
import { createApproval } from '$lib/server/repositories/approval';
import { createExpense } from '$lib/server/repositories/expense';
import { createInvoice, type InvoiceInput } from '$lib/server/repositories/invoice';

// #301: `drizzle/0064_document_owner_delete_guard.sql` refuses to delete an
// invoice, expense or approval row that a `document` still names as its
// `owner_type`/`owner_id`, mirroring how `document_validate_owner`
// (0010/0011/0025/0026) already refuses to *write* a document pointing at
// an owner that does not exist. Needs a migrated database
// (`pnpm db:up && pnpm db:migrate`). Postgres work happens inside a
// transaction that is always rolled back; blob writes from
// `createApproval`/`createExpense` are real filesystem side effects a
// rollback cannot undo, so they go to a throwaway temp directory removed
// in `afterEach`, same pattern as `repositories/approval.test.ts` and
// `repositories/expense.test.ts`.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-document-owner-delete-guard-'));
	process.env.DOCUMENT_STORAGE_ROOT = root;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

async function insertContract(tx: Tx) {
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
			requiresExpensePreAuthorisation: false,
			requiresPriorApproval: false
		})
		.returning();
	return contractRow;
}

test('deleting an invoice that a document still evidences (its archived original) is refused, by constraint name', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const invoiceRow = await createInvoice(
			{
				contractId: contractRow.id,
				number: `INV-${crypto.randomUUID()}`,
				issueDate: '2024-06-01',
				documentType: 'invoice',
				currency: 'EUR',
				taxTreatmentCode: null,
				statutoryReference: null,
				stampDuty: null,
				socialCharge: null,
				dueDate: null,
				paymentMethod: null,
				iban: null,
				transmissionId: null,
				lines: [
					{
						description: 'Consulting',
						quantity: 1,
						unitPrice: minorUnits(100_000),
						amount: minorUnits(100_000),
						taxRate: 0,
						taxTreatmentCode: null,
						workUnitIds: []
					}
				]
			} satisfies InvoiceInput,
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);

		// The shape an import leaves behind (`persist.ts`): the structured
		// original archived as a document owned by the invoice it evidences.
		await tx.insert(document).values({
			hash: 'a'.repeat(64),
			mime: 'application/json',
			size: 10,
			originalName: 'invoice.json',
			provenance: 'upload',
			contractId: contractRow.id,
			confidential: true,
			ownerType: 'invoice',
			ownerId: invoiceRow.id
		});

		const error = await rejection(
			() => tx.delete(invoice).where(eq(invoice.id, invoiceRow.id)),
			tx
		);

		expect(error).toMatchObject({
			code: '23503',
			constraint_name: 'document_owner_blocks_invoice_delete'
		});
	});
});

test('deleting an expense that a document still evidences (its receipt) is refused, by constraint name', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const expenseRow = await createExpense(
			{
				contractId: contractRow.id,
				date: '2024-06-01',
				description: 'Train ticket',
				amount: minorUnits(5_000),
				preAuthorised: false,
				authorisationReference: null
			},
			{
				bytes: new TextEncoder().encode('receipt bytes'),
				mime: 'application/pdf',
				originalName: 'receipt.pdf',
				provenance: 'upload',
				confidential: false
			},
			tx
		);

		const error = await rejection(
			() => tx.delete(expense).where(eq(expense.id, expenseRow.id)),
			tx
		);

		expect(error).toMatchObject({
			code: '23503',
			constraint_name: 'document_owner_blocks_expense_delete'
		});
	});
});

test('deleting an approval that a document still evidences (its archived proof) is refused, by constraint name', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const approvalRow = await createApproval(
			{
				contractId: contractRow.id,
				channel: 'email',
				sender: 'client@example.com',
				receivedAt: new Date('2024-06-01T09:00:00Z'),
				messageId: `msg-${crypto.randomUUID()}`,
				excerpt: 'Approved, go ahead.',
				origin: { kind: 'manual' },
				document: {
					bytes: new TextEncoder().encode('approval email'),
					mime: 'message/rfc822',
					originalName: 'approval.eml',
					provenance: 'mail',
					confidential: true
				}
			},
			tx
		);

		const error = await rejection(
			() => tx.delete(approval).where(eq(approval.id, approvalRow.id)),
			tx
		);

		expect(error).toMatchObject({
			code: '23503',
			constraint_name: 'document_owner_blocks_approval_delete'
		});
	});
});

test('deleting an expense that no document evidences succeeds, proving the guard is scoped to actual references', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const expenseRow = await createExpense(
			{
				contractId: contractRow.id,
				date: '2024-06-01',
				description: 'Cash purchase, no receipt archived',
				amount: minorUnits(2_000),
				preAuthorised: false,
				authorisationReference: null
			},
			null,
			tx
		);

		const [deleted] = await tx.delete(expense).where(eq(expense.id, expenseRow.id)).returning();

		expect(deleted.id).toBe(expenseRow.id);
	});
});
