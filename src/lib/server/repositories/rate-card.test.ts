import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { createRateCard, listRateCardsForContracts, type RateCardInput } from './rate-card';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres work
// happens inside a transaction that is always rolled back, same pattern as
// the other repository tests.

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
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy
		})
		.returning();
	return contractRow;
}

function dailyCard(contractId: string, validFrom: string, validTo: string | null): RateCardInput {
	return {
		contractId,
		validFrom,
		validTo,
		kind: 'daily',
		amount: 500,
		unit: 'day',
		allowedFractions: [1, 0.5],
		minimumHours: null,
		disbursementPeriod: null
	};
}

test('listRateCardsForContracts groups every card by its own contract, ordered oldest validity first within each, and nothing for a contract with none', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractA = await insertContract(tx);
		const contractB = await insertContract(tx);
		const contractC = await insertContract(tx);

		await createRateCard(dailyCard(contractA.id, '2024-07-01', null), tx);
		await createRateCard(dailyCard(contractA.id, '2024-01-01', '2024-06-30'), tx);
		await createRateCard(dailyCard(contractB.id, '2024-01-01', null), tx);

		const rows = await listRateCardsForContracts([contractA.id, contractB.id, contractC.id], tx);

		const forA = rows.filter((row) => row.contractId === contractA.id);
		expect(forA.map((row) => row.validFrom)).toEqual(['2024-01-01', '2024-07-01']);

		const forB = rows.filter((row) => row.contractId === contractB.id);
		expect(forB).toHaveLength(1);

		expect(rows.some((row) => row.contractId === contractC.id)).toBe(false);

		expect(await listRateCardsForContracts([], tx)).toEqual([]);
	});
});
