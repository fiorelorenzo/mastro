// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Every test
// works inside a transaction it rolls back, same pattern as
// `revenue.test.ts`.

import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client as pool, db, type DbExecutor } from '$lib/server/db';
import { client, contract, invoice, rateCard } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { createInvoice, type InvoiceInput } from '$lib/server/repositories/invoice';
import { createRenewalAssumption } from '$lib/server/repositories/contract-renewal-assumption';
import { createWorkUnit, transitionWorkUnit } from '$lib/server/repositories/work-unit';
import {
	forecastCollected,
	forecastCommitted,
	forecastProjected,
	forecastRenewalAssumptions,
	forecastRevenue
} from './forecast';

afterAll(async () => {
	await pool.end();
});

let clientCounter = 0;

function clientFields() {
	clientCounter += 1;
	return {
		legalName: `Test Client ${clientCounter}`,
		taxId: `TEST-TAX-FORECAST-${clientCounter}`,
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100',
		noticeChannel: 'email' as const
	};
}

async function insertContract(
	tx: DbExecutor,
	overrides: { terminationNoticeDays?: number; endsOn?: string | null } = {}
) {
	const [clientRow] = await tx.insert(client).values(clientFields()).returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Test contract',
			startsOn: '2024-01-01',
			endsOn: overrides.endsOn ?? null,
			renewalType: 'none',
			terminationNoticeDays: overrides.terminationNoticeDays ?? 30,
			paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			requiresPriorApproval: false
		})
		.returning();
	return contractRow;
}

function invoiceInput(contractId: string, overrides: Partial<InvoiceInput> = {}): InvoiceInput {
	return {
		contractId,
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
				unitPrice: 100_000,
				amount: 100_000,
				taxRate: 0,
				taxTreatmentCode: null,
				workUnitIds: []
			}
		],
		...overrides
	};
}

test('forecastCollected reads paid invoices in the period', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const invoiceRow = await createInvoice(
				invoiceInput(contractRow.id),
				{ kind: 'human', email: 'lorenzo@example.com' },
				'test fixture',
				tx
			);
			await tx.update(invoice).set({ paidOn: '2024-06-15' }).where(eq(invoice.id, invoiceRow.id));

			const figure = await forecastCollected('2024-01-01', '2025-01-01', tx);
			expect(figure.amount).toBe(100_000);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('forecastCommitted counts an issued unpaid invoice and an approved day, never a proposed one', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);

			// Issued, never paid: committed.
			await createInvoice(
				invoiceInput(contractRow.id, { issueDate: '2024-05-01' }),
				{ kind: 'human', email: 'lorenzo@example.com' },
				'test fixture',
				tx
			);
			await tx.insert(rateCard).values({
				contractId: contractRow.id,
				validFrom: '2024-01-01',
				validTo: null,
				kind: 'daily',
				amount: 500,
				unit: 'day',
				allowedFractions: [1],
				minimumHours: null,
				disbursementPeriod: null
			});

			const beforeAnyDay = await forecastCommitted('2024-06-01', '2024-01-01', '2025-01-01', tx);
			expect(beforeAnyDay.amount).toBe(50_000); // the unpaid invoice alone

			const day = await createWorkUnit(
				{ contractId: contractRow.id, date: '2024-06-05', quantity: 1, scope: 'A day' },
				{ kind: 'human', email: 'lorenzo@example.com' },
				'proposed',
				tx
			);

			// Still 'proposed': must not move the figure at all.
			const withProposedDay = await forecastCommitted('2024-06-01', '2024-01-01', '2025-01-01', tx);
			expect(withProposedDay.amount).toBe(beforeAnyDay.amount);

			// Approved (500 EUR/day = 50,000 minor units): now it counts.
			await transitionWorkUnit(
				day.id,
				{ state: 'approved' },
				{ kind: 'human', email: 'lorenzo@example.com' },
				'approved',
				tx
			);
			const withApprovedDay = await forecastCommitted('2024-06-01', '2024-01-01', '2025-01-01', tx);
			expect(withApprovedDay.amount).toBe(50_000 + 50_000);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('forecastProjected reads a recurring fee beyond the irrevocability window, up to the contract end', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, {
				terminationNoticeDays: 30,
				endsOn: '2024-12-31'
			});
			await tx.insert(rateCard).values({
				contractId: contractRow.id,
				validFrom: '2024-01-01',
				validTo: null,
				kind: 'fixed_recurring',
				amount: 1_000,
				unit: 'month',
				allowedFractions: [1],
				minimumHours: null,
				disbursementPeriod: 'monthly'
			});

			const projected = await forecastProjected('2024-06-15', '2024-01-01', '2025-01-01', tx);
			// Beyond the 30-day window (through 2024-07-15): August through
			// December, five monthly occurrences at 1,000 EUR each.
			expect(projected.amount).toBe(5 * 100_000);

			const committed = await forecastCommitted('2024-06-15', '2024-01-01', '2025-01-01', tx);
			// Only the July occurrence falls inside the window.
			expect(committed.amount).toBe(100_000);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('forecastRevenue combines all three levels, matching the individual calls', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const invoiceRow = await createInvoice(
				invoiceInput(contractRow.id, { issueDate: '2024-03-01' }),
				{ kind: 'human', email: 'lorenzo@example.com' },
				'test fixture',
				tx
			);
			await tx.update(invoice).set({ paidOn: '2024-03-10' }).where(eq(invoice.id, invoiceRow.id));

			const breakdown = await forecastRevenue('2024-06-01', '2024-01-01', '2025-01-01', tx);
			const collected = await forecastCollected('2024-01-01', '2025-01-01', tx);

			expect(breakdown.collected).toEqual(collected);
			expect(breakdown.collected.amount).toBe(100_000);
			expect(breakdown.committed.level).toBe('committed');
			expect(breakdown.projected.level).toBe('projected');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('forecastProjected stays empty for an indefinite contract with no renewal assumption recorded', async () => {
	await expect(
		db.transaction(async (tx) => {
			await insertContract(tx, { terminationNoticeDays: 30, endsOn: null });

			const projected = await forecastProjected('2024-01-01', '2024-01-01', '2025-01-01', tx);
			expect(projected.amount).toBe(0);

			const assumptions = await forecastRenewalAssumptions(
				'2024-01-01',
				'2024-01-01',
				'2025-01-01',
				tx
			);
			expect(assumptions).toEqual([]);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('forecastRenewalAssumptions pairs a recorded assumption with the contribution it produces, matching forecastProjected (#39)', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, { terminationNoticeDays: 30, endsOn: null });
			await createRenewalAssumption(
				{
					contractId: contractRow.id,
					probability: 0.5,
					expectedVolumeMinorUnits: 200_000,
					horizonEndsOn: '2024-02-20'
				},
				tx
			);

			// asOfDate 2024-01-01 + 30 days' notice: window through
			// 2024-01-31, so the horizon starts 2024-02-01 and runs 20 days
			// (Feb 1 through Feb 20 inclusive) to 2024-02-20. Fully inside
			// the query window below: 200,000 * 0.5 = 100,000.
			const projected = await forecastProjected('2024-01-01', '2024-01-01', '2025-01-01', tx);
			expect(projected.amount).toBe(100_000);

			const assumptions = await forecastRenewalAssumptions(
				'2024-01-01',
				'2024-01-01',
				'2025-01-01',
				tx
			);
			expect(assumptions).toEqual([
				{
					contractId: contractRow.id,
					contractTitle: 'Test contract',
					assumption: {
						probability: 0.5,
						expectedVolumeMinorUnits: 200_000,
						horizonEndsOn: '2024-02-20'
					},
					contribution: 100_000
				}
			]);

			tx.rollback();
		})
	).rejects.toThrow();
});
