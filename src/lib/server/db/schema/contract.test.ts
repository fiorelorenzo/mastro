import { afterAll, expect, test } from 'vitest';
import { rejection } from '$lib/server/db/pg-error';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { locales } from '$lib/paraglide/runtime';
import { client as pool } from '$lib/server/db';
import { client, contract, contractRenewalType, contractTemplateLanguage } from './index';
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
	await inRolledBackTransaction(async (tx) => {
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
	});
});

test('a malformed payment_terms document is rejected by the database', async () => {
	await inRolledBackTransaction(async (tx) => {
		const [row] = await tx.insert(client).values(clientFields()).returning();

		expect(
			await rejection(() =>
				tx.insert(contract).values({
					...baseContract(row.id),
					// Not a shape the CHECK constraint recognises.
					paymentTerms: { kind: 'net', days: -1 } as unknown as PaymentTerms
				})
			)
		).toMatchObject({
			code: '23514',
			constraint_name: 'contract_payment_terms_shape'
		});
	});
});

test('all four renewal types are representable', async () => {
	await inRolledBackTransaction(async (tx) => {
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
	});
});

test('template language defaults to the interface base locale when not set', async () => {
	await inRolledBackTransaction(async (tx) => {
		const [row] = await tx.insert(client).values(clientFields()).returning();
		const [contractRow] = await tx.insert(contract).values(baseContract(row.id)).returning();
		expect(contractRow.templateLanguage).toBe('en');
	});
});

test('every supported template language round-trips through the database (#69)', async () => {
	await inRolledBackTransaction(async (tx) => {
		const [row] = await tx.insert(client).values(clientFields()).returning();

		for (const templateLanguage of contractTemplateLanguage.enumValues) {
			const [contractRow] = await tx
				.insert(contract)
				.values({
					...baseContract(row.id),
					title: `Contract in ${templateLanguage}`,
					templateLanguage
				})
				.returning();
			expect(contractRow.templateLanguage).toBe(templateLanguage);
		}
	});
});

// Guards the same drift `messages.test.ts` guards for the message
// catalogues: `contract_template_language` is hand-written to mirror
// `project.inlang/settings.json`'s `locales` (#69's doc comment on the
// enum explains why it cannot import that list directly), so nothing
// silently lets the two diverge.
test('the contract template language enum matches the interface locales exactly', () => {
	expect([...contractTemplateLanguage.enumValues].sort()).toEqual([...locales].sort());
});

// #84: `mail_folder`'s own constraints (`0034_mail_poll_constraints.sql`).

test('mail_folder defaults to null (not polled) and accepts a plain value', async () => {
	await inRolledBackTransaction(async (tx) => {
		const [clientRow] = await tx.insert(client).values(clientFields()).returning();
		const [unset] = await tx.insert(contract).values(baseContract(clientRow.id)).returning();
		expect(unset.mailFolder).toBeNull();

		const [set] = await tx
			.insert(contract)
			.values({ ...baseContract(clientRow.id), mailFolder: 'Acme Corp' })
			.returning();
		expect(set.mailFolder).toBe('Acme Corp');
	});
});

test('a blank mail_folder is rejected by the database, null is not', async () => {
	await inRolledBackTransaction(async (tx) => {
		const [clientRow] = await tx.insert(client).values(clientFields()).returning();
		await expect(
			tx.insert(contract).values({ ...baseContract(clientRow.id), mailFolder: '   ' })
		).rejects.toThrow();
	});
});

test('two contracts cannot claim the same mail_folder, but two nulls are both fine', async () => {
	await inRolledBackTransaction(async (tx) => {
		const [clientRow] = await tx.insert(client).values(clientFields()).returning();
		await tx
			.insert(contract)
			.values({ ...baseContract(clientRow.id), mailFolder: 'Acme Corp' })
			.returning();

		// In a savepoint: the rejected insert aborts its transaction, and the
		// two inserts below are the other half of what this test proves.
		const conflict = await rejection(
			() => tx.insert(contract).values({ ...baseContract(clientRow.id), mailFolder: 'Acme Corp' }),
			tx
		);
		expect(conflict.code).toBe('23505');

		// Two unpolled contracts, both null, are not a conflict.
		await tx.insert(contract).values(baseContract(clientRow.id)).returning();
		await tx.insert(contract).values(baseContract(clientRow.id)).returning();
	});
});
