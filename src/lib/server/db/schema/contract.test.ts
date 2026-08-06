import { afterAll, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { client, contract, contractRenewalType } from './index';
import type { ExpensePolicy, PaymentTerms } from './contract';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
// Real database, work done inside a transaction that is always rolled back —
// see `src/lib/server/db/set-updated-at.test.ts` for the pattern. These
// exercise the CHECK constraints in `0002_client_contract_rate_card_constraints.sql`,
// not just the TypeScript types, since a constraint that only exists in the
// application layer is not the guarantee #18 asks for.

afterAll(async () => {
	await pool.end();
});

let clientCounter = 0;

function clientFields() {
	clientCounter += 1;
	return {
		legalName: `Test Client ${clientCounter}`,
		taxId: `TEST-TAX-${clientCounter}`,
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100',
		noticeChannel: 'email' as const
	};
}

function baseContract(clientId: string) {
	return {
		clientId,
		title: 'Test contract',
		startsOn: '2024-01-01',
		renewalType: 'none' as const,
		renewalNoticeDays: null as number | null,
		terminationNoticeDays: 30,
		paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
		invoicingCadence: 'monthly' as const,
		currency: 'EUR',
		taxTreatment: 'generic',
		expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy
	};
}

test('both payment-term shapes round-trip through the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const [row] = await tx.insert(client).values(clientFields()).returning();

			const net: PaymentTerms = { kind: 'net', days: 45 };
			const [netContract] = await tx
				.insert(contract)
				.values({ ...baseContract(row.id), title: 'Net terms', paymentTerms: net })
				.returning();
			expect(netContract.paymentTerms).toEqual(net);

			const dayOfMonth: PaymentTerms = { kind: 'day_of_month', day: 31, monthOffset: 1 };
			const [dayOfMonthContract] = await tx
				.insert(contract)
				.values({ ...baseContract(row.id), title: 'Day of month terms', paymentTerms: dayOfMonth })
				.returning();
			expect(dayOfMonthContract.paymentTerms).toEqual(dayOfMonth);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a malformed payment_terms document is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const [row] = await tx.insert(client).values(clientFields()).returning();

			await expect(
				tx.insert(contract).values({
					...baseContract(row.id),
					// Not a shape the CHECK constraint recognises.
					paymentTerms: { kind: 'net', days: -1 } as unknown as PaymentTerms
				})
			).rejects.toMatchObject({
				code: '23514',
				constraint_name: 'contract_payment_terms_shape'
			});

			tx.rollback();
		})
	).rejects.toThrow();
});

test('all four renewal types are representable', async () => {
	await expect(
		db.transaction(async (tx) => {
			const [row] = await tx.insert(client).values(clientFields()).returning();

			for (const renewalType of contractRenewalType.enumValues) {
				const [contractRow] = await tx
					.insert(contract)
					.values({
						...baseContract(row.id),
						title: `Renewal type ${renewalType}`,
						renewalType,
						renewalNoticeDays: renewalType === 'none' ? null : 30
					})
					.returning();
				expect(contractRow.renewalType).toBe(renewalType);
			}

			tx.rollback();
		})
	).rejects.toThrow();
});
