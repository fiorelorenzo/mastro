// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Every test
// works inside a transaction it rolls back, same pattern as
// `forecast.test.ts`. Years are chosen far apart per test (and far from
// other fiscal test files' own eras — see `profile.test.ts`'s comment on
// the same concern) since `fiscal_profile` carries a database-wide
// exclusion constraint on its validity period.

import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client as pool, db, type DbExecutor } from '$lib/server/db';
import { client, contract, invoice } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { fiscalProfile } from '$lib/server/db/schema/fiscal';
import { createInvoice, type InvoiceInput } from '$lib/server/repositories/invoice';
import { createCeiling } from '$lib/server/repositories/ceiling';
import { evaluateActiveCeilings } from './ceiling-status';
import type { FiscalPack } from './pack';
import { buildRegistry, type PackRegistry } from './registry';

afterAll(async () => {
	await pool.end();
});

let clientCounter = 0;

function clientFields() {
	clientCounter += 1;
	return {
		legalName: `Test Client ${clientCounter}`,
		taxId: `TEST-TAX-CEILSTATUS-${clientCounter}`,
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100',
		noticeChannel: 'email' as const
	};
}

async function insertContract(tx: DbExecutor) {
	const [clientRow] = await tx.insert(client).values(clientFields()).returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Test contract',
			startsOn: '2091-01-01',
			renewalType: 'none',
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
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
		issueDate: '2091-06-01',
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

test('a pack ceiling and a persisted contract ceiling both appear, evaluated by the same call', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { clientRow, contractRow } = await insertContract(tx);
			const invoiceRow = await createInvoice(
				invoiceInput(contractRow.id),
				{ kind: 'human', email: 'lorenzo@example.com' },
				'test fixture',
				tx
			);
			await tx.update(invoice).set({ paidOn: '2091-06-10' }).where(eq(invoice.id, invoiceRow.id));

			await createCeiling(
				{
					contractId: contractRow.id,
					code: 'client-share-cap',
					label: { en: 'Client share cap', it: 'Tetto quota cliente' },
					legalBasis: null,
					basis: 'cash_received_calendar_year',
					measure: 'percentage_share',
					value: 0.5,
					alertLevels: [],
					consequence: { en: 'Renegotiate.', it: 'Rinegoziare.' }
				},
				tx
			);

			const pack: FiscalPack = {
				id: 'test-ceiling-status-pack',
				version: '1',
				effectiveFrom: '2024-01-01',
				displayName: { en: 'x', it: 'x' },
				basis: 'cash',
				fiscalYear: { startMonth: 1, startDay: 1 },
				ceilings: [
					{
						id: 'test-pack-cap',
						origin: 'pack',
						label: { en: 'Pack cap', it: 'Tetto pacchetto' },
						measure: 'absolute_amount',
						value: 500_000,
						basis: 'cash_received_calendar_year',
						perimeter: { kind: 'all_clients' },
						alertLevels: [],
						consequence: { en: 'x', it: 'x' }
					}
				],
				treatments: [],
				charges: [],
				formats: []
			};
			const registry: PackRegistry = buildRegistry([pack]);
			await tx.insert(fiscalProfile).values({
				packId: 'test-ceiling-status-pack',
				packVersion: '1',
				validFrom: '2091-01-01',
				validTo: null
			});

			const evaluated = await evaluateActiveCeilings('2091-06-15', tx, registry);

			const packResult = evaluated.find((e) => e.ceiling.id === 'test-pack-cap');
			const contractResult = evaluated.find((e) => e.ceiling.id === 'client-share-cap');

			expect(packResult).toBeDefined();
			expect(packResult?.ceiling.origin).toBe('pack');
			expect(packResult?.currentValue).toBe(100_000);

			expect(contractResult).toBeDefined();
			expect(contractResult?.ceiling.origin).toBe('contract');
			expect(contractResult?.ceiling.perimeter).toEqual({ kind: 'client', clientId: clientRow.id });
			expect(contractResult?.currentValue).toBe(100_000); // this client is the only revenue
			expect(contractResult?.limitValue).toBe(Math.round(100_000 * 0.5));

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a contract ceiling survives a fiscal profile switch with no pack ceilings, while the pack set empties', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { contractRow } = await insertContract(tx);
			await createCeiling(
				{
					contractId: contractRow.id,
					code: 'survives-regime-change',
					label: { en: 'x', it: 'x' },
					legalBasis: null,
					basis: 'cash_received_calendar_year',
					measure: 'absolute_amount',
					value: 1_000_000,
					alertLevels: [],
					consequence: { en: 'x', it: 'x' }
				},
				tx
			);

			const packWithoutCeilings: FiscalPack = {
				id: 'test-ceiling-status-empty',
				version: '1',
				effectiveFrom: '2024-01-01',
				displayName: { en: 'x', it: 'x' },
				basis: 'accrual',
				fiscalYear: { startMonth: 1, startDay: 1 },
				ceilings: [],
				treatments: [],
				charges: [],
				formats: []
			};
			const registry: PackRegistry = buildRegistry([packWithoutCeilings]);
			await tx.insert(fiscalProfile).values({
				packId: 'test-ceiling-status-empty',
				packVersion: '1',
				validFrom: '2092-01-01',
				validTo: null
			});

			const evaluated = await evaluateActiveCeilings('2092-03-01', tx, registry);

			expect(evaluated).toHaveLength(1); // the contract ceiling alone
			expect(evaluated[0].ceiling.id).toBe('survives-regime-change');
			expect(evaluated[0].ceiling.origin).toBe('contract');

			tx.rollback();
		})
	).rejects.toThrow();
});
