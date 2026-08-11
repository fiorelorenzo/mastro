// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Every test
// works inside a transaction it rolls back, same pattern as
// `ceiling.test.ts`.

import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { minorUnits } from '$lib/money';
import { client as pool, type DbExecutor } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import {
	createRenewalAssumption,
	deleteRenewalAssumption,
	getRenewalAssumptionByContract,
	listRenewalAssumptionsWithContract,
	updateRenewalAssumption,
	type ContractRenewalAssumptionInput
} from './contract-renewal-assumption';

afterAll(async () => {
	await pool.end();
});

let clientCounter = 0;

function clientFields() {
	clientCounter += 1;
	return {
		legalName: `Test Client ${clientCounter}`,
		taxId: `TEST-TAX-RENEWAL-${clientCounter}`,
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100',
		noticeChannel: 'email' as const
	};
}

async function insertContract(
	tx: DbExecutor,
	overrides: Partial<typeof contract.$inferInsert> = {}
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
			paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			...overrides
		})
		.returning();
	return { clientRow, contractRow };
}

function assumptionInput(
	contractId: string,
	overrides: Partial<ContractRenewalAssumptionInput> = {}
): ContractRenewalAssumptionInput {
	return {
		contractId,
		probability: 0.6,
		expectedVolumeMinorUnits: minorUnits(500_000),
		horizonEndsOn: '2025-12-31',
		...overrides
	};
}

test('createRenewalAssumption stores the three parameters as given', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);
		const row = await createRenewalAssumption(assumptionInput(contractRow.id), tx);

		expect(row.contractId).toBe(contractRow.id);
		expect(row.probability).toBe(0.6);
		expect(row.expectedVolumeMinorUnits).toBe(500_000);
		expect(row.horizonEndsOn).toBe('2025-12-31');
	});
});

test('a second assumption on the same contract is rejected — one per contract', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);
		await createRenewalAssumption(assumptionInput(contractRow.id), tx);

		await expect(createRenewalAssumption(assumptionInput(contractRow.id), tx)).rejects.toThrow();
	});
});

test('a probability outside 0–1 is rejected by the database, not just the caller', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);
		await expect(
			createRenewalAssumption(assumptionInput(contractRow.id, { probability: 1.5 }), tx)
		).rejects.toThrow();
	});
});

test('getRenewalAssumptionByContract returns null for a contract with none recorded', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);
		const found = await getRenewalAssumptionByContract(contractRow.id, tx);
		expect(found).toBeUndefined();
	});
});

test('updateRenewalAssumption round-trips a change to all three parameters', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);
		const created = await createRenewalAssumption(assumptionInput(contractRow.id), tx);

		const updated = await updateRenewalAssumption(
			created.id,
			assumptionInput(contractRow.id, {
				probability: 0.25,
				expectedVolumeMinorUnits: minorUnits(900_000),
				horizonEndsOn: '2026-06-30'
			}),
			tx
		);

		expect(updated.probability).toBe(0.25);
		expect(updated.expectedVolumeMinorUnits).toBe(900_000);
		expect(updated.horizonEndsOn).toBe('2026-06-30');
	});
});

test('deleteRenewalAssumption removes the row — the withdrawal path for #39', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);
		const created = await createRenewalAssumption(assumptionInput(contractRow.id), tx);

		await deleteRenewalAssumption(created.id, tx);

		expect(await getRenewalAssumptionByContract(contractRow.id, tx)).toBeUndefined();
	});
});

test("listRenewalAssumptionsWithContract joins each row to its own contract's endsOn, terminationNoticeDays and title", async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx, {
			title: 'Retainer with Acme',
			endsOn: '2024-12-31',
			terminationNoticeDays: 45
		});
		await createRenewalAssumption(assumptionInput(contractRow.id), tx);

		const listed = await listRenewalAssumptionsWithContract(tx);
		const found = listed.find((row) => row.contractId === contractRow.id);

		expect(found?.contract.title).toBe('Retainer with Acme');
		expect(found?.contract.endsOn).toBe('2024-12-31');
		expect(found?.contract.terminationNoticeDays).toBe(45);
	});
});
