// Acceptance tests for #33. Every figure asserted here is the one checked
// against the statute in it-flat-rate.ts's own header comment — this file
// is what keeps that comment honest if the numbers ever drift.

import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client } from '../../db';
import { fiscalProfile } from '../../db/schema/fiscal';
import { evaluateCharges, evaluateInvoiceCharges, resolveDefaultTaxTreatment } from '../pack';
import { buildRegistry, defaultRegistry, lookupPack } from '../registry';
import { resolvePackAt } from '../resolve';
import { resolveActiveFiscalPack } from '../profile';
import { itFlatRatePack } from './it-flat-rate';

afterAll(async () => {
	await client.end();
});

test('cash basis, calendar fiscal year', () => {
	expect(itFlatRatePack.basis).toBe('cash');
	expect(itFlatRatePack.fiscalYear).toEqual({ startMonth: 1, startDay: 1 });
});

test('the soft ceiling is 85,000 EUR and loses the regime only from the following year', () => {
	const ceiling = itFlatRatePack.ceilings.find((c) => c.id === 'it-flat-rate-revenue-ceiling');
	expect(ceiling?.value).toBe(8_500_000);
	expect(ceiling?.measure).toBe('absolute_amount');
	expect(ceiling?.basis).toBe('cash_received_calendar_year');
	expect(ceiling?.consequence.en).toMatch(/following fiscal year/);
	expect(ceiling?.legalBasis?.language).toBe('it');
});

test('the hard ceiling is 100,000 EUR and loses the regime immediately, with VAT due', () => {
	const ceiling = itFlatRatePack.ceilings.find(
		(c) => c.id === 'it-flat-rate-immediate-exit-ceiling'
	);
	expect(ceiling?.value).toBe(10_000_000);
	expect(ceiling?.consequence.en).toMatch(/immediately/);
	expect(ceiling?.consequence.en).toMatch(/VAT/);
});

test('the two ceilings are distinct and both carry a legal basis', () => {
	expect(itFlatRatePack.ceilings).toHaveLength(2);
	for (const ceiling of itFlatRatePack.ceilings) {
		expect(ceiling.legalBasis).toBeDefined();
	}
});

test('the exempt treatment code renders its statutory citation verbatim, in Italian', () => {
	const treatment = itFlatRatePack.treatments.find((t) => t.code === 'N2.2');
	expect(treatment?.legalText.language).toBe('it');
	expect(treatment?.legalText.text).toBe(
		"Operazione senza applicazione dell'IVA, ai sensi dell'articolo 1, comma 58, della legge 23 dicembre 2014, n. 190"
	);
});

test('stamp duty applies only once a document exceeds 77.47 EUR, and is a fixed 2.00 EUR', () => {
	const atThreshold = evaluateCharges(itFlatRatePack, { invoiceTotal: 7747 });
	expect(atThreshold.map((e) => e.charge.id)).not.toContain('it-flat-rate-virtual-stamp-duty');

	const aboveThreshold = evaluateCharges(itFlatRatePack, { invoiceTotal: 7748 });
	const stamp = aboveThreshold.find((e) => e.charge.id === 'it-flat-rate-virtual-stamp-duty');
	expect(stamp?.amount).toBe(200);
});

test('the social-security surcharge is 4% of the invoice total, computed by rule for any amount', () => {
	const evaluated = evaluateCharges(itFlatRatePack, { invoiceTotal: 100_000 });
	const surcharge = evaluated.find((e) => e.charge.id === 'it-flat-rate-social-security-surcharge');
	expect(surcharge?.amount).toBe(4_000);
});

test('both charges apply together on a large invoice, each computed independently', () => {
	const evaluated = evaluateCharges(itFlatRatePack, { invoiceTotal: 50_000 });
	expect(evaluated.map((e) => e.charge.id).sort()).toEqual(
		['it-flat-rate-social-security-surcharge', 'it-flat-rate-virtual-stamp-duty'].sort()
	);
});

test('the default treatment is the unconditional exempt code, VAT-exempt, with its own statutory text (#216)', () => {
	const treatment = resolveDefaultTaxTreatment(itFlatRatePack);
	expect(treatment?.code).toBe('N2.2');
	expect(treatment?.taxRate).toBe(0);
	expect(treatment?.legalText?.language).toBe('it');
	expect(treatment?.legalText?.text).toBe(
		"Operazione senza applicazione dell'IVA, ai sensi dell'articolo 1, comma 58, della legge 23 dicembre 2014, n. 190"
	);
});

test('the issuer tax-regime code is RF19 (#256)', () => {
	expect(itFlatRatePack.taxRegimeCode).toBe('RF19');
});

test('evaluateInvoiceCharges sums the virtual stamp duty and the INPS surcharge into their own named slots', () => {
	const result = evaluateInvoiceCharges(itFlatRatePack, { invoiceTotal: 50_000 });
	expect(result.stampDuty).toBe(200);
	expect(result.socialCharge).toBe(2_000);
});

test('the pack ships registered by default, resolvable by id and version', () => {
	expect(lookupPack(defaultRegistry, 'it-flat-rate', '1')).toBe(itFlatRatePack);
});

test('resolution finds the pack by id and version, independent of the default registry', () => {
	const registry = buildRegistry([itFlatRatePack]);
	const profiles = [
		{ packId: 'it-flat-rate', packVersion: '1', validFrom: '2023-01-01', validTo: null }
	];
	expect(resolvePackAt(registry, profiles, '2024-06-01')?.pack).toBe(itFlatRatePack);
});

// 1910: past every real regime's start. An open-ended row cannot simply
// pick an earlier start date to dodge a real seeded "current regime" row
// — two open-ended ranges always overlap regardless of where either one
// starts — so this clears the table first instead, inside its own
// rolled-back transaction (see `profile.test.ts`'s `makeRoomForOwnProfiles`
// comment for the full reasoning).
test('a taxpayer on the flat-rate pack resolves end to end, both ceilings included', async () => {
	await inRolledBackTransaction(async (tx) => {
		await tx.delete(fiscalProfile);
		await tx.insert(fiscalProfile).values({
			packId: 'it-flat-rate',
			packVersion: '1',
			validFrom: '1910-01-01',
			validTo: null
		});

		const resolved = await resolveActiveFiscalPack(tx, '1910-06-01');
		expect(resolved?.pack.id).toBe('it-flat-rate');
		expect(resolved?.pack.ceilings).toHaveLength(2);
	});
});
