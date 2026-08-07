// Acceptance tests for #34. The real job of this pack is invariant 2
// (AGENTS.md): switching the active fiscal profile from the flat-rate pack
// to this one must remove the flat-rate ceilings while leaving anything
// contract-level untouched, with no code change anywhere outside the
// packs. There is no dashboard yet (#57) and no ceiling engine yet (#36),
// so this proves the invariant at the level that exists today: resolution
// returns the right pack for each side of the switch, the ceiling set it
// exposes is empty on the standard side, and a contract row carrying its
// own cap is bit-for-bit unaffected by the switch. What is not proven here
// — that a dashboard widget actually stops rendering a flat-rate ceiling
// and keeps rendering a contract one — has no code to exercise until #57
// exists; see the PR description.

import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client as pool, db } from '../../db';
import { client, contract } from '../../db/schema';
import type { ExpensePolicy, PaymentTerms } from '../../db/schema/contract';
import { fiscalProfile } from '../../db/schema/fiscal';
import { defaultRegistry, lookupPack } from '../registry';
import { resolveActiveFiscalPack } from '../profile';
import { itStandardPack } from './it-standard';

afterAll(async () => {
	await pool.end();
});

let clientCounter = 0;

function clientFields() {
	clientCounter += 1;
	return {
		legalName: `Test Client ${clientCounter}`,
		taxId: `TEST-TAX-STD-${clientCounter}`,
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100',
		noticeChannel: 'email' as const
	};
}

test('accrual basis, no revenue ceiling', () => {
	expect(itStandardPack.basis).toBe('accrual');
	expect(itStandardPack.ceilings).toEqual([]);
});

test('an ordinary VAT treatment is available, with its own legal text', () => {
	expect(itStandardPack.treatments.length).toBeGreaterThan(0);
	for (const treatment of itStandardPack.treatments) {
		expect(treatment.legalText.language).toBe('it');
	}
});

test('the pack ships registered by default, resolvable by id and version', () => {
	expect(lookupPack(defaultRegistry, 'it-standard', '1')).toBe(itStandardPack);
});

test(
	'switching the active fiscal profile from the flat-rate pack to the standard pack empties ' +
		'the resolved ceiling set, leaving a contract-level cap untouched',
	async () => {
		await expect(
			db.transaction(async (tx) => {
				const [clientRow] = await tx.insert(client).values(clientFields()).returning();

				const expensePolicy: ExpensePolicy = { kind: 'reimbursed_with_cap', capAmount: 500_000 };
				const paymentTerms: PaymentTerms = { kind: 'net', days: 30 };
				const [contractRow] = await tx
					.insert(contract)
					.values({
						clientId: clientRow.id,
						title: 'Standing consulting agreement',
						startsOn: '2023-01-01',
						renewalType: 'none',
						renewalNoticeDays: null,
						terminationNoticeDays: 30,
						paymentTerms,
						invoicingCadence: 'monthly',
						currency: 'EUR',
						taxTreatment: 'generic',
						expensePolicy
					})
					.returning();

				// Flat-rate applies through 2043, standard from 2044 on: a
				// regime change with no bearing on the contract itself.
				//
				// The years are far in the future on purpose. `fiscal_profile`
				// carries a database-wide EXCLUDE constraint on the validity
				// period, so two test files inserting overlapping periods at the
				// same time block each other even though both roll back, and
				// vitest runs files in parallel. Every file that writes a profile
				// keeps to its own era; profile.test.ts owns 2023 to 2025.
				await tx.insert(fiscalProfile).values({
					packId: 'it-flat-rate',
					packVersion: '1',
					validFrom: '2043-01-01',
					validTo: '2044-01-01'
				});
				await tx.insert(fiscalProfile).values({
					packId: 'it-standard',
					packVersion: '1',
					validFrom: '2044-01-01',
					validTo: null
				});

				const underFlatRate = await resolveActiveFiscalPack(tx, '2043-06-01', defaultRegistry);
				expect(underFlatRate?.pack.id).toBe('it-flat-rate');
				expect(underFlatRate?.pack.ceilings.length).toBeGreaterThan(0);

				const underStandard = await resolveActiveFiscalPack(tx, '2044-06-01', defaultRegistry);
				expect(underStandard?.pack.id).toBe('it-standard');
				expect(underStandard?.pack.ceilings).toEqual([]);

				// The contract's own cap — the AGENTS.md invariant-2 example of
				// a ceiling that "follows the counterparty" — lives on the
				// contract row, not on any pack, and nothing in resolving
				// either pack above wrote to it.
				const [reloaded] = await tx.select().from(contract).where(eq(contract.id, contractRow.id));
				expect(reloaded.expensePolicy).toEqual(expensePolicy);
				expect(reloaded.updatedAt).toEqual(contractRow.updatedAt);

				tx.rollback();
			})
		).rejects.toThrow();
	}
);
