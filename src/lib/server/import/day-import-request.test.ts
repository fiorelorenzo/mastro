// The pure pieces (`isDayImportColumnMapping`, `parseDayImportFile`) need
// no database; `existingStateByKeyForDayImport` reads through
// `listWorkUnitsBetween`, which does accept an executor, so that one runs
// inside a rolled-back transaction like every other repository test here.
// `candidateClientsForDayImport`/`rateCardsForContracts` compose
// `listClients`/`listContractsWithClient`/`listRateCards` verbatim — none
// of which accept a transaction — so their own behaviour is exercised
// through the real `/import/days` route in a browser against the seeded
// demo instance instead of a throwaway row left behind in the shared dev
// database here.
import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract, workUnit } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { createWorkUnit, transitionWorkUnit } from '$lib/server/repositories/work-unit';
import type { DayImportColumnMapping } from './day-import';
import {
	existingStateByKeyForDayImport,
	isDayImportColumnMapping,
	parseDayImportFile
} from './day-import-request';

afterAll(async () => {
	await pool.end();
});

const FULL_MAPPING: DayImportColumnMapping = {
	date: 0,
	quantity: 1,
	scope: 2,
	client: 3,
	contract: 4,
	state: 5
};
const ACTOR = { kind: 'human' as const, email: 'lorenzo@example.com' };

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
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			requiresPriorApproval: false
		})
		.returning();
	return contractRow;
}

test('isDayImportColumnMapping accepts six number-or-null keys', () => {
	expect(isDayImportColumnMapping(FULL_MAPPING)).toBe(true);
	expect(isDayImportColumnMapping({ ...FULL_MAPPING, contract: null, state: null })).toBe(true);
});

test('isDayImportColumnMapping rejects anything else, never throwing on it', () => {
	expect(isDayImportColumnMapping(null)).toBe(false);
	expect(isDayImportColumnMapping('mapping')).toBe(false);
	expect(
		isDayImportColumnMapping({
			date: '0',
			quantity: 1,
			scope: 2,
			client: 3,
			contract: null,
			state: null
		})
	).toBe(false);
	expect(isDayImportColumnMapping({ date: 0 })).toBe(false);
});

test('parseDayImportFile splits the header from the data rows and sniffs the delimiter', () => {
	const parsed = parseDayImportFile('date;quantity;scope\n2026-03-10;1;API migration');
	expect(parsed).toEqual({
		headerRow: ['date', 'quantity', 'scope'],
		dataRows: [['2026-03-10', '1', 'API migration']]
	});
});

test('parseDayImportFile returns null for a file with no rows at all', () => {
	expect(parseDayImportFile('')).toBeNull();
});

test('existingStateByKeyForDayImport keys a live day by contract and date, scoped to the given active contracts', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		await tx.insert(workUnit).values({
			contractId: contractRow.id,
			date: '2026-03-15',
			quantity: 1,
			scope: 'Already on record',
			state: 'worked'
		});

		const byKey = await existingStateByKeyForDayImport(
			[['2026-03-15', '1', 'x', 'x', '', '']],
			FULL_MAPPING,
			new Set([contractRow.id]),
			tx
		);

		expect(byKey.get(`${contractRow.id}|2026-03-15`)).toBe('worked');
	});
});

test('existingStateByKeyForDayImport excludes rejected and revoked days — the unique index itself excludes them too', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const rejected = await createWorkUnit(
			{ contractId: contractRow.id, date: '2026-03-16', quantity: 1, scope: 'a' },
			ACTOR,
			'test fixture',
			tx
		);
		await transitionWorkUnit(rejected.id, { state: 'rejected' }, ACTOR, 'test fixture', tx);
		const revoked = await createWorkUnit(
			{ contractId: contractRow.id, date: '2026-03-17', quantity: 1, scope: 'b' },
			ACTOR,
			'test fixture',
			tx
		);
		await transitionWorkUnit(revoked.id, { state: 'approved' }, ACTOR, 'test fixture', tx);
		await transitionWorkUnit(revoked.id, { state: 'revoked' }, ACTOR, 'test fixture', tx);

		const byKey = await existingStateByKeyForDayImport(
			[
				['2026-03-16', '1', 'x', 'x', '', ''],
				['2026-03-17', '1', 'x', 'x', '', '']
			],
			FULL_MAPPING,
			new Set([contractRow.id]),
			tx
		);

		expect(byKey.size).toBe(0);
	});
});

test('existingStateByKeyForDayImport ignores a contract outside the active set even if a day exists for it', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		await tx.insert(workUnit).values({
			contractId: contractRow.id,
			date: '2026-03-18',
			quantity: 1,
			scope: 'x',
			state: 'worked'
		});

		const byKey = await existingStateByKeyForDayImport(
			[['2026-03-18', '1', 'x', 'x', '', '']],
			FULL_MAPPING,
			new Set(),
			tx
		);

		expect(byKey.size).toBe(0);
	});
});

test('existingStateByKeyForDayImport is empty when the date column is unmapped or no cell parses to a real date', async () => {
	await inRolledBackTransaction(async (tx) => {
		const withoutDateColumn = await existingStateByKeyForDayImport(
			[['not-a-date', '1', 'x', 'x', '', '']],
			{ ...FULL_MAPPING, date: null },
			new Set(),
			tx
		);
		expect(withoutDateColumn.size).toBe(0);

		const withUnparseableDates = await existingStateByKeyForDayImport(
			[['not-a-date', '1', 'x', 'x', '', '']],
			FULL_MAPPING,
			new Set(),
			tx
		);
		expect(withUnparseableDates.size).toBe(0);
	});
});
