import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { client, contract, document, expense, invoice, invoiceLine } from './index';
import { minorUnits, NO_MINOR_UNITS } from '$lib/money';
import type { ExpensePolicy, PaymentTerms } from './contract';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
// Real database, work done inside a transaction that is always rolled back —
// see `src/lib/server/db/set-updated-at.test.ts` for the pattern. This is
// the database-level half of #28's acceptance: a non-reimbursable expense
// is flagged, not rejected, and a rebilled expense cannot be rebilled
// twice, both proved against `0019_expense_and_clause_note_constraints.sql`
// even if application code never checked either.

afterAll(async () => {
	await pool.end();
});

let counter = 0;

async function insertContract(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	overrides: {
		requiresExpensePreAuthorisation?: boolean;
		expensePolicy?: ExpensePolicy;
	} = {}
) {
	counter += 1;
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: `Test Client ${counter}`,
			taxId: `TEST-TAX-${counter}`,
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
			expensePolicy:
				overrides.expensePolicy ?? ({ kind: 'reimbursed_at_cost' } satisfies ExpensePolicy),
			requiresExpensePreAuthorisation: overrides.requiresExpensePreAuthorisation ?? false
		})
		.returning();
	return contractRow;
}

test('a pre-authorised expense on a contract requiring pre-authorisation is reimbursable', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, { requiresExpensePreAuthorisation: true });

			const [row] = await tx
				.insert(expense)
				.values({
					contractId: contractRow.id,
					date: '2024-02-01',
					description: 'Hotel',
					amount: minorUnits(20000),
					preAuthorised: true,
					authorisationReference: 'client email, 2024-01-20'
				})
				.returning();

			expect(row.reimbursable).toBe(true);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('an expense without pre-authorisation on a contract that requires it is flagged non-reimbursable, not rejected', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, { requiresExpensePreAuthorisation: true });

			const [row] = await tx
				.insert(expense)
				.values({
					contractId: contractRow.id,
					date: '2024-02-01',
					description: 'Taxi',
					amount: minorUnits(5000)
				})
				.returning();

			// Accepted, not rejected — the row exists and is simply flagged.
			expect(row.id).toBeTruthy();
			expect(row.reimbursable).toBe(false);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('an expense with no pre-authorisation is reimbursable when the contract does not require one', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, { requiresExpensePreAuthorisation: false });

			const [row] = await tx
				.insert(expense)
				.values({
					contractId: contractRow.id,
					date: '2024-02-01',
					description: 'Taxi',
					amount: minorUnits(5000)
				})
				.returning();

			expect(row.reimbursable).toBe(true);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('reimbursable is false on a contract that does not reimburse expenses at all, even pre-authorised', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, {
				expensePolicy: { kind: 'not_reimbursed' }
			});

			const [row] = await tx
				.insert(expense)
				.values({
					contractId: contractRow.id,
					date: '2024-02-01',
					description: 'Taxi',
					amount: minorUnits(5000),
					preAuthorised: true,
					authorisationReference: 'verbal, confirmed by email'
				})
				.returning();

			expect(row.reimbursable).toBe(false);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('pre_authorised without an authorisation_reference is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			await tx.insert(expense).values({
				contractId: contractRow.id,
				date: '2024-02-01',
				description: 'Taxi',
				amount: minorUnits(5000),
				preAuthorised: true
			});
			tx.rollback();
		})
	).rejects.toThrow();
});

test('an authorisation_reference set without pre_authorised is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			await tx.insert(expense).values({
				contractId: contractRow.id,
				date: '2024-02-01',
				description: 'Taxi',
				amount: minorUnits(5000),
				preAuthorised: false,
				authorisationReference: 'stale reference'
			});
			tx.rollback();
		})
	).rejects.toThrow();
});

test('a non-positive amount is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			await tx.insert(expense).values({
				contractId: contractRow.id,
				date: '2024-02-01',
				description: 'Taxi',
				amount: NO_MINOR_UNITS
			});
			tx.rollback();
		})
	).rejects.toThrow();
});

test('a rebilled expense cannot be rebilled onto a second invoice line', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);

			const [expenseRow] = await tx
				.insert(expense)
				.values({
					contractId: contractRow.id,
					date: '2024-02-01',
					description: 'Taxi',
					amount: minorUnits(5000)
				})
				.returning();

			const [invoiceRow] = await tx
				.insert(invoice)
				.values({
					contractId: contractRow.id,
					number: 'INV-1',
					issueDate: '2024-03-01',
					currency: 'EUR',
					taxableAmount: minorUnits(5000),
					taxAmount: NO_MINOR_UNITS,
					total: minorUnits(5000),
					dueDate: '2024-03-31',
					dueDateSource: 'computed'
				})
				.returning();

			const [lineOne] = await tx
				.insert(invoiceLine)
				.values({
					invoiceId: invoiceRow.id,
					description: 'Rebilled taxi',
					quantity: 1,
					unitPrice: minorUnits(5000),
					amount: minorUnits(5000),
					taxRate: 0
				})
				.returning();

			const [lineTwo] = await tx
				.insert(invoiceLine)
				.values({
					invoiceId: invoiceRow.id,
					description: 'Something else',
					quantity: 1,
					unitPrice: minorUnits(100),
					amount: minorUnits(100),
					taxRate: 0
				})
				.returning();

			await tx
				.update(expense)
				.set({ invoiceLineId: lineOne.id })
				.where(eq(expense.id, expenseRow.id));

			await expect(
				tx.update(expense).set({ invoiceLineId: lineTwo.id }).where(eq(expense.id, expenseRow.id))
			).rejects.toThrow(/already rebilled/);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a receipt document can be owned by an expense', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);

			const [expenseRow] = await tx
				.insert(expense)
				.values({
					contractId: contractRow.id,
					date: '2024-02-01',
					description: 'Taxi',
					amount: minorUnits(5000)
				})
				.returning();

			const [documentRow] = await tx
				.insert(document)
				.values({
					hash: 'a'.repeat(64),
					mime: 'application/pdf',
					size: 100,
					originalName: 'receipt.pdf',
					provenance: 'upload',
					contractId: contractRow.id,
					confidential: false,
					ownerType: 'expense',
					ownerId: expenseRow.id
				})
				.returning();

			expect(documentRow.ownerType).toBe('expense');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('an owner_id that does not name an existing expense is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			await tx.insert(document).values({
				hash: 'b'.repeat(64),
				mime: 'application/pdf',
				size: 100,
				originalName: 'receipt.pdf',
				provenance: 'upload',
				contractId: contractRow.id,
				confidential: false,
				ownerType: 'expense',
				ownerId: contractRow.id // not an expense id
			});
			tx.rollback();
		})
	).rejects.toThrow();
});
