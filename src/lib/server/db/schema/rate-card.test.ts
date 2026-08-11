import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { rejection } from '$lib/server/db/pg-error';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract, rateCard } from './index';
import type { ExpensePolicy, PaymentTerms } from './contract';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
// Real database, work done inside a transaction that is always rolled back —
// see `src/lib/server/db/set-updated-at.test.ts` for the pattern. This is the
// database-level half of #19's acceptance: `resolveRateCard` (see
// `src/lib/server/domain/rate-card.test.ts`) proves adjacent periods resolve
// unambiguously in application code; this proves overlap is rejected by the
// `rate_card_no_overlapping_validity` exclusion constraint even if application
// code never checked.

afterAll(async () => {
	await pool.end();
});

let clientCounter = 0;

async function insertContract(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
	clientCounter += 1;
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: `Test Client ${clientCounter}`,
			taxId: `TEST-TAX-${clientCounter}`,
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

function dailyCard(contractId: string, validFrom: string, validTo: string | null) {
	return {
		contractId,
		validFrom,
		validTo,
		kind: 'daily' as const,
		amount: 500,
		unit: 'day' as const,
		allowedFractions: [1, 0.5]
	};
}

test('adjacent validity periods are both accepted', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		await tx.insert(rateCard).values(dailyCard(contractRow.id, '2024-01-01', '2024-06-30'));
		await tx.insert(rateCard).values(dailyCard(contractRow.id, '2024-07-01', null));

		const cards = await tx.select().from(rateCard).where(eq(rateCard.contractId, contractRow.id));
		expect(cards).toHaveLength(2);
	});
});

test('an overlapping validity period is rejected by the database, not only by application code', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		await tx.insert(rateCard).values(dailyCard(contractRow.id, '2024-01-01', null));

		expect(
			await rejection(() =>
				tx.insert(rateCard).values(dailyCard(contractRow.id, '2024-06-01', null))
			)
		).toMatchObject({
			code: '23P01',
			constraint_name: 'rate_card_no_overlapping_validity'
		});
	});
});
