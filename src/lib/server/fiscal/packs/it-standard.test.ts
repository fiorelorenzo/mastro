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

import { minorUnits } from '$lib/money';
import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool } from '../../db';
import { client, contract } from '../../db/schema';
import type { ExpensePolicy, PaymentTerms } from '../../db/schema/contract';
import { fiscalProfile } from '../../db/schema/fiscal';
import { defaultRegistry, lookupPack } from '../registry';
import { resolveDefaultTaxTreatment } from '../pack';
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

test('the default treatment is the ordinary case: no code, no legal text, the standard 22% rate (#216)', () => {
	const treatment = resolveDefaultTaxTreatment(itStandardPack);
	expect(treatment).toEqual({ code: null, taxRate: 22, legalText: null });
});

test('the issuer tax-regime code is RF01 (#256)', () => {
	expect(itStandardPack.taxRegimeCode).toBe('RF01');
});

test('the pack ships registered by default, resolvable by id and version', () => {
	expect(lookupPack(defaultRegistry, 'it-standard', '1')).toBe(itStandardPack);
});

test(
	'switching the active fiscal profile from the flat-rate pack to the standard pack empties ' +
		'the resolved ceiling set, leaving a contract-level cap untouched',
	async () => {
		await inRolledBackTransaction(async (tx) => {
			const [clientRow] = await tx.insert(client).values(clientFields()).returning();

			const expensePolicy: ExpensePolicy = {
				kind: 'reimbursed_with_cap',
				capAmount: minorUnits(500_000)
			};
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

			// Flat-rate applies through 1921, standard from 1921 on: a
			// regime change with no bearing on the contract itself. 1920:
			// past every real regime's start. The table is cleared first,
			// inside this rolled-back transaction — a real seeded "current
			// regime" row cannot be dodged with an earlier start date, since
			// two open-ended ranges always overlap regardless of where either
			// starts (see `profile.test.ts`'s `makeRoomForOwnProfiles` comment).
			await tx.delete(fiscalProfile);
			await tx.insert(fiscalProfile).values({
				packId: 'it-flat-rate',
				packVersion: '1',
				validFrom: '1920-01-01',
				validTo: '1921-01-01'
			});
			await tx.insert(fiscalProfile).values({
				packId: 'it-standard',
				packVersion: '1',
				validFrom: '1921-01-01',
				validTo: null
			});

			const underFlatRate = await resolveActiveFiscalPack(tx, '1920-06-01', defaultRegistry);
			expect(underFlatRate?.pack.id).toBe('it-flat-rate');
			expect(underFlatRate?.pack.ceilings.length).toBeGreaterThan(0);

			const underStandard = await resolveActiveFiscalPack(tx, '1921-06-01', defaultRegistry);
			expect(underStandard?.pack.id).toBe('it-standard');
			expect(underStandard?.pack.ceilings).toEqual([]);

			// The contract's own cap — the AGENTS.md invariant-2 example of
			// a ceiling that "follows the counterparty" — lives on the
			// contract row, not on any pack, and nothing in resolving
			// either pack above wrote to it.
			const [reloaded] = await tx.select().from(contract).where(eq(contract.id, contractRow.id));
			expect(reloaded.expensePolicy).toEqual(expensePolicy);
			expect(reloaded.updatedAt).toEqual(contractRow.updatedAt);
		});
	}
);
