import { afterAll, expect, test } from 'vitest';
import { rejection } from '$lib/server/db/pg-error';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { minorUnits } from '$lib/money';
import { ceiling, client, contract } from './index';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Real
// database, work done inside a transaction that is always rolled back —
// see `src/lib/server/db/set-updated-at.test.ts` for the pattern (which
// already proves the trigger itself works, generically; not re-proven per
// table here) and `contract.test.ts`'s "malformed payment_terms" test for
// the `code`/`constraint_name` assertion shape. One failing insert per
// transaction: Postgres aborts the whole transaction on the first error,
// so a second statement in the same one would only report "current
// transaction is aborted", never its own constraint.

afterAll(async () => {
	await pool.end();
});

let clientCounter = 0;

function clientFields() {
	clientCounter += 1;
	return {
		legalName: `Test Client ${clientCounter}`,
		taxId: `TEST-TAX-CEILING-${clientCounter}`,
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100',
		noticeChannel: 'email' as const
	};
}

async function insertContract(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
	const [clientRow] = await tx.insert(client).values(clientFields()).returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Test contract',
			startsOn: '2024-01-01',
			renewalType: 'none',
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 },
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' }
		})
		.returning();
	return contractRow;
}

function baseCeiling(contractId: string) {
	return {
		contractId,
		code: 'test-cap',
		label: { en: 'Cap', it: 'Tetto' },
		legalBasis: null,
		basis: 'cash_received_calendar_year' as const,
		alertLevels: [{ ratio: 0.8, label: { en: 'Close', it: 'Vicino' } }],
		consequence: { en: 'Renegotiate.', it: 'Rinegoziare.' }
	};
}

test('an absolute-amount ceiling round-trips, with the label bundle and alert levels intact', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const [row] = await tx
			.insert(ceiling)
			.values({
				...baseCeiling(contractRow.id),
				measure: 'absolute_amount',
				absoluteValueMinorUnits: minorUnits(5_000_000),
				shareRatio: null
			})
			.returning();

		expect(row.absoluteValueMinorUnits).toBe(5_000_000);
		expect(row.shareRatio).toBeNull();
		expect(row.alertLevels).toEqual([{ ratio: 0.8, label: { en: 'Close', it: 'Vicino' } }]);
		expect(row.label).toEqual({ en: 'Cap', it: 'Tetto' });
	});
});

test('a percentage-share ceiling round-trips its ratio', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const [row] = await tx
			.insert(ceiling)
			.values({
				...baseCeiling(contractRow.id),
				measure: 'percentage_share',
				absoluteValueMinorUnits: null,
				shareRatio: 0.3
			})
			.returning();

		expect(row.shareRatio).toBe(0.3);
		expect(row.absoluteValueMinorUnits).toBeNull();
	});
});

test('an absolute-amount ceiling with a share ratio set instead is rejected', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		expect(
			await rejection(() =>
				tx.insert(ceiling).values({
					...baseCeiling(contractRow.id),
					measure: 'absolute_amount',
					absoluteValueMinorUnits: null,
					shareRatio: 0.3
				})
			)
		).toMatchObject({ code: '23514', constraint_name: 'ceiling_value_matches_measure' });
	});
});

test('a percentage-share ceiling with an absolute value set instead is rejected', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		expect(
			await rejection(() =>
				tx.insert(ceiling).values({
					...baseCeiling(contractRow.id),
					measure: 'percentage_share',
					absoluteValueMinorUnits: minorUnits(1_000_000),
					shareRatio: null
				})
			)
		).toMatchObject({ code: '23514', constraint_name: 'ceiling_value_matches_measure' });
	});
});

test('a negative absolute value is rejected', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		expect(
			await rejection(() =>
				tx.insert(ceiling).values({
					...baseCeiling(contractRow.id),
					measure: 'absolute_amount',
					absoluteValueMinorUnits: minorUnits(-1),
					shareRatio: null
				})
			)
		).toMatchObject({
			code: '23514',
			constraint_name: 'ceiling_absolute_value_non_negative'
		});
	});
});

test('a share ratio above 1 is rejected', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		expect(
			await rejection(() =>
				tx.insert(ceiling).values({
					...baseCeiling(contractRow.id),
					measure: 'percentage_share',
					absoluteValueMinorUnits: null,
					shareRatio: 1.5
				})
			)
		).toMatchObject({ code: '23514', constraint_name: 'ceiling_share_ratio_range' });
	});
});

test('a share ratio of zero is rejected — a ceiling always caps some positive share', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		expect(
			await rejection(() =>
				tx.insert(ceiling).values({
					...baseCeiling(contractRow.id),
					measure: 'percentage_share',
					absoluteValueMinorUnits: null,
					shareRatio: 0
				})
			)
		).toMatchObject({ code: '23514', constraint_name: 'ceiling_share_ratio_range' });
	});
});

test('two ceilings on the same contract cannot share a code', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		await tx.insert(ceiling).values({
			...baseCeiling(contractRow.id),
			measure: 'absolute_amount',
			absoluteValueMinorUnits: minorUnits(1_000_000),
			shareRatio: null
		});
		expect(
			await rejection(() =>
				tx.insert(ceiling).values({
					...baseCeiling(contractRow.id),
					measure: 'absolute_amount',
					absoluteValueMinorUnits: minorUnits(2_000_000),
					shareRatio: null
				})
			)
		).toMatchObject({ code: '23505', constraint_name: 'ceiling_contract_code_unique' });
	});
});
