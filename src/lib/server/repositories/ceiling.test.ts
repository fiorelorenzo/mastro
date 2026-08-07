// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Every test
// works inside a transaction it rolls back, same pattern as
// `rate-card.test.ts`.

import { afterAll, expect, test } from 'vitest';
import { client as pool, db, type DbExecutor } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import {
	createCeiling,
	getCeiling,
	listCeilingsByContract,
	listCeilingsWithContract,
	updateCeiling,
	type CeilingInput
} from './ceiling';

afterAll(async () => {
	await pool.end();
});

let clientCounter = 0;

function clientFields() {
	clientCounter += 1;
	return {
		legalName: `Test Client ${clientCounter}`,
		taxId: `TEST-TAX-CEILREPO-${clientCounter}`,
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
			startsOn: '2024-01-01',
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

function ceilingInput(contractId: string, overrides: Partial<CeilingInput> = {}): CeilingInput {
	return {
		contractId,
		code: 'test-cap',
		label: { en: 'Cap', it: 'Tetto' },
		legalBasis: null,
		basis: 'cash_received_calendar_year',
		measure: 'absolute_amount',
		value: 1_000_000,
		alertLevels: [{ ratio: 0.8, label: { en: 'Close', it: 'Vicino' } }],
		consequence: { en: 'Renegotiate.', it: 'Rinegoziare.' },
		...overrides
	} as CeilingInput;
}

test('createCeiling stores an absolute-amount ceiling with the right column split', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { contractRow } = await insertContract(tx);
			const row = await createCeiling(ceilingInput(contractRow.id), tx);

			expect(row.measure).toBe('absolute_amount');
			expect(row.absoluteValueMinorUnits).toBe(1_000_000);
			expect(row.shareRatio).toBeNull();

			tx.rollback();
		})
	).rejects.toThrow();
});

test('createCeiling stores a percentage-share ceiling with the right column split', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { contractRow } = await insertContract(tx);
			const row = await createCeiling(
				ceilingInput(contractRow.id, { measure: 'percentage_share', value: 0.4 }),
				tx
			);

			expect(row.measure).toBe('percentage_share');
			expect(row.shareRatio).toBe(0.4);
			expect(row.absoluteValueMinorUnits).toBeNull();

			tx.rollback();
		})
	).rejects.toThrow();
});

test("listCeilingsByContract returns only that contract's ceilings, ordered by code", async () => {
	await expect(
		db.transaction(async (tx) => {
			const { contractRow: contractA } = await insertContract(tx);
			const { contractRow: contractB } = await insertContract(tx);

			await createCeiling(ceilingInput(contractA.id, { code: 'b-cap' }), tx);
			await createCeiling(ceilingInput(contractA.id, { code: 'a-cap' }), tx);
			await createCeiling(ceilingInput(contractB.id, { code: 'other-contract-cap' }), tx);

			const listed = await listCeilingsByContract(contractA.id, tx);
			expect(listed.map((c) => c.code)).toEqual(['a-cap', 'b-cap']);

			tx.rollback();
		})
	).rejects.toThrow();
});

test("listCeilingsWithContract joins each ceiling to its own contract's clientId and startsOn", async () => {
	await expect(
		db.transaction(async (tx) => {
			const { clientRow, contractRow } = await insertContract(tx);
			await createCeiling(ceilingInput(contractRow.id), tx);

			const withContracts = await listCeilingsWithContract(tx);
			const found = withContracts.find((c) => c.contractId === contractRow.id);

			expect(found?.contract.clientId).toBe(clientRow.id);
			expect(found?.contract.startsOn).toBe('2024-01-01');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('getCeiling and updateCeiling round-trip a change', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { contractRow } = await insertContract(tx);
			const created = await createCeiling(ceilingInput(contractRow.id), tx);

			const fetched = await getCeiling(created.id, tx);
			expect(fetched?.absoluteValueMinorUnits).toBe(1_000_000);

			const updated = await updateCeiling(
				created.id,
				ceilingInput(contractRow.id, { value: 2_000_000 }),
				tx
			);
			expect(updated.absoluteValueMinorUnits).toBe(2_000_000);

			tx.rollback();
		})
	).rejects.toThrow();
});
