// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Every test
// works inside a transaction it rolls back, same pattern as
// `profile.test.ts`.

import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client as pool, db, type DbExecutor } from '$lib/server/db';
import { client, contract, invoice } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { fiscalProfile } from '$lib/server/db/schema/fiscal';
import { createInvoice, type InvoiceInput } from '$lib/server/repositories/invoice';
import { fetchLedgerRows, fetchRevenueOverRange } from './revenue';
import { buildRegistry, type PackRegistry } from './registry';
import type { FiscalPack } from './pack';

afterAll(async () => {
	await pool.end();
});

let clientCounter = 0;

function clientFields() {
	clientCounter += 1;
	return {
		legalName: `Test Client ${clientCounter}`,
		taxId: `TEST-TAX-REVENUE-${clientCounter}`,
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100',
		noticeChannel: 'email' as const
	};
}

async function insertContract(
	tx: DbExecutor,
	paymentTerms: PaymentTerms = { kind: 'net', days: 30 }
) {
	const [clientRow] = await tx.insert(client).values(clientFields()).returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Test contract',
			startsOn: '2024-01-01',
			renewalType: 'none',
			terminationNoticeDays: 30,
			paymentTerms,
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy
		})
		.returning();
	return { clientRow, contractRow };
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

test('fetchLedgerRows carries taxable_amount plus social_charge as revenue, never VAT or stamp duty', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { clientRow, contractRow } = await insertContract(tx);
			const invoiceRow = await createInvoice(
				invoiceInput(contractRow.id, {
					socialCharge: 4_000,
					stampDuty: 200,
					lines: [
						{
							description: 'Consulting',
							quantity: 1,
							unitPrice: 100_000,
							amount: 100_000,
							taxRate: 22,
							taxTreatmentCode: null,
							workUnitIds: []
						}
					]
				}),
				{ kind: 'human', email: 'lorenzo@example.com' },
				'test fixture',
				tx
			);
			// taxable 100,000 + tax 22,000 + stamp 200 + social 4,000 = 126,200
			expect(invoiceRow.total).toBe(126_200);

			const rows = await fetchLedgerRows(tx);
			const row = rows.find((r) => r.invoiceId === invoiceRow.id);
			expect(row?.clientId).toBe(clientRow.id);
			// Revenue counted is taxable_amount + social_charge, excluding
			// both VAT and stamp duty.
			expect(row?.amount).toBe(100_000 + 4_000);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('fetchLedgerRows carries both dates, paidOn null until collected', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { contractRow } = await insertContract(tx);
			const invoiceRow = await createInvoice(
				invoiceInput(contractRow.id),
				{ kind: 'human', email: 'lorenzo@example.com' },
				'test fixture',
				tx
			);

			const beforePayment = await fetchLedgerRows(tx);
			expect(beforePayment.find((r) => r.invoiceId === invoiceRow.id)?.paidOn).toBeNull();

			await tx.update(invoice).set({ paidOn: '2024-07-05' }).where(eq(invoice.id, invoiceRow.id));

			const afterPayment = await fetchLedgerRows(tx);
			const row = afterPayment.find((r) => r.invoiceId === invoiceRow.id);
			expect(row?.paidOn).toBe('2024-07-05');
			expect(row?.issueDate).toBe('2024-06-01');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('fetchRevenueOverRange sums under the sole pack in force for a range with no regime change', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { contractRow } = await insertContract(tx);
			const invoiceRow = await createInvoice(
				invoiceInput(contractRow.id, { issueDate: '2087-03-01' }),
				{ kind: 'human', email: 'lorenzo@example.com' },
				'test fixture',
				tx
			);
			await tx.update(invoice).set({ paidOn: '2087-03-10' }).where(eq(invoice.id, invoiceRow.id));

			const cashPack: FiscalPack = {
				id: 'test-revenue-cash',
				version: '1',
				effectiveFrom: '2024-01-01',
				displayName: { en: 'Test cash', it: 'Test cash' },
				basis: 'cash',
				fiscalYear: { startMonth: 1, startDay: 1 },
				ceilings: [],
				treatments: [],
				charges: [],
				formats: []
			};
			const registry: PackRegistry = buildRegistry([cashPack]);
			// Years far in the future so this profile cannot collide with
			// another test file's own era under the database-wide exclusion
			// constraint on `fiscal_profile` (see `profile.test.ts`'s own
			// comment on the same concern).
			await tx.insert(fiscalProfile).values({
				packId: 'test-revenue-cash',
				packVersion: '1',
				validFrom: '2087-01-01',
				validTo: null
			});

			const figure = await fetchRevenueOverRange('2087-01-01', '2088-01-01', tx, registry);

			expect(figure.amount).toBe(100_000);
			expect(figure.subFigures).toEqual([
				{
					basis: 'cash',
					from: '2087-01-01',
					to: '2088-01-01',
					amount: 100_000,
					packId: 'test-revenue-cash'
				}
			]);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('fetchRevenueOverRange sums each sub-period under its own basis across a regime change', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { contractRow } = await insertContract(tx);

			// Issued and paid before the switch: counted under the cash
			// sub-period's basis regardless of which reading would agree.
			const beforeSwitch = await createInvoice(
				invoiceInput(contractRow.id, { issueDate: '2088-02-01' }),
				{ kind: 'human', email: 'lorenzo@example.com' },
				'test fixture',
				tx
			);
			await tx.update(invoice).set({ paidOn: '2088-02-10' }).where(eq(invoice.id, beforeSwitch.id));

			// Issued after the switch to accrual, never paid: still counted,
			// because the sub-period it falls in reads by issue date.
			await createInvoice(
				invoiceInput(contractRow.id, {
					issueDate: '2088-08-01',
					lines: [
						{
							description: 'Consulting',
							quantity: 1,
							unitPrice: 60_000,
							amount: 60_000,
							taxRate: 0,
							taxTreatmentCode: null,
							workUnitIds: []
						}
					]
				}),
				{ kind: 'human', email: 'lorenzo@example.com' },
				'test fixture',
				tx
			);

			const cashPack: FiscalPack = {
				id: 'test-regime-cash',
				version: '1',
				effectiveFrom: '2024-01-01',
				displayName: { en: 'x', it: 'x' },
				basis: 'cash',
				fiscalYear: { startMonth: 1, startDay: 1 },
				ceilings: [],
				treatments: [],
				charges: [],
				formats: []
			};
			const accrualPack: FiscalPack = { ...cashPack, id: 'test-regime-accrual', basis: 'accrual' };
			const registry: PackRegistry = buildRegistry([cashPack, accrualPack]);

			await tx.insert(fiscalProfile).values({
				packId: 'test-regime-cash',
				packVersion: '1',
				validFrom: '2088-01-01',
				validTo: '2088-07-01'
			});
			await tx.insert(fiscalProfile).values({
				packId: 'test-regime-accrual',
				packVersion: '1',
				validFrom: '2088-07-01',
				validTo: '2089-01-01'
			});

			const figure = await fetchRevenueOverRange('2088-01-01', '2089-01-01', tx, registry);

			expect(figure.subFigures).toEqual([
				{
					basis: 'cash',
					from: '2088-01-01',
					to: '2088-07-01',
					amount: 100_000,
					packId: 'test-regime-cash'
				},
				{
					basis: 'accrual',
					from: '2088-07-01',
					to: '2089-01-01',
					amount: 60_000,
					packId: 'test-regime-accrual'
				}
			]);
			expect(figure.amount).toBe(160_000);

			tx.rollback();
		})
	).rejects.toThrow();
});
