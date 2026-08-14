// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres work
// happens inside a transaction that is always rolled back, same pattern as
// `repositories/work-unit.test.ts`. Each row under test opens its own
// nested transaction (a savepoint, since the outer one is already open) —
// exactly what `persistDayImportBatch` does in production against the
// real pool, so a constraint violation on one row is provably contained
// here the same way it will be there.
import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { createWorkUnit, listWorkUnitTransitions } from '$lib/server/repositories/work-unit';
import { persistDayImportBatch, type PersistDayImportRow } from './day-import-persist';

afterAll(async () => {
	await pool.end();
});

const ACTOR = { kind: 'human' as const, email: 'lorenzo@example.com' };

async function insertContract(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	requiresPriorApproval: boolean
) {
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
			requiresPriorApproval
		})
		.returning();
	return contractRow;
}

function importRow(overrides: Partial<PersistDayImportRow> = {}): PersistDayImportRow {
	return {
		rowNumber: 1,
		contractId: 'placeholder',
		date: '2026-03-10',
		quantity: 1,
		scope: 'Migrated the API',
		requestedState: 'worked',
		...overrides
	};
}

test('a created row is indistinguishable from a typed one: same createWorkUnit path, same state machine, plus a transition log entry naming the import', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);

		const outcomes = await persistDayImportBatch(
			[importRow({ contractId: contractRow.id, rowNumber: 7, date: '2026-03-10' })],
			'year-of-days.csv',
			ACTOR,
			tx
		);

		expect(outcomes).toEqual([
			{ kind: 'created', rowNumber: 7, workUnitId: expect.any(String), state: 'worked' }
		]);
		const created = outcomes[0];
		if (created.kind !== 'created') throw new Error('expected created');

		const transitions = await listWorkUnitTransitions(created.workUnitId, tx);
		expect(transitions).toHaveLength(1);
		expect(transitions[0].toState).toBe('worked');
		expect(transitions[0].actor).toEqual(ACTOR);
		expect(transitions[0].reason).toBe('imported from year-of-days.csv, row 7');
	});
});

test('a row on a contract requiring prior approval lands in worked_without_approval, exactly like a typed one would (#23)', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);

		const outcomes = await persistDayImportBatch(
			[importRow({ contractId: contractRow.id, date: '2026-03-11' })],
			'year-of-days.csv',
			ACTOR,
			tx
		);

		expect(outcomes[0]).toMatchObject({ kind: 'created', state: 'worked_without_approval' });
	});
});

test('an explicit proposed row is recorded proposed, not redirected through the risk state', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);

		const outcomes = await persistDayImportBatch(
			[importRow({ contractId: contractRow.id, date: '2026-03-12', requestedState: 'proposed' })],
			'year-of-days.csv',
			ACTOR,
			tx
		);

		expect(outcomes[0]).toMatchObject({ kind: 'created', state: 'proposed' });
	});
});

test('a row colliding with a day already on record comes back already_recorded, never a raw error, and creates nothing', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2026-03-13',
				quantity: 1,
				scope: 'Already typed by hand'
			},
			ACTOR,
			'day agreed over a call',
			tx
		);

		const outcomes = await persistDayImportBatch(
			[importRow({ contractId: contractRow.id, date: '2026-03-13', rowNumber: 3 })],
			'year-of-days.csv',
			ACTOR,
			tx
		);

		expect(outcomes).toEqual([{ kind: 'already_recorded', rowNumber: 3 }]);
	});
});

test('one bad row never stops the batch: a colliding row in the middle does not roll back the rows around it', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2026-03-20',
				quantity: 1,
				scope: 'Already typed by hand'
			},
			ACTOR,
			'day agreed over a call',
			tx
		);

		const outcomes = await persistDayImportBatch(
			[
				importRow({
					contractId: contractRow.id,
					date: '2026-03-19',
					rowNumber: 1,
					scope: 'Row one'
				}),
				importRow({
					contractId: contractRow.id,
					date: '2026-03-20',
					rowNumber: 2,
					scope: 'Row two, collides'
				}),
				importRow({
					contractId: contractRow.id,
					date: '2026-03-21',
					rowNumber: 3,
					scope: 'Row three'
				})
			],
			'year-of-days.csv',
			ACTOR,
			tx
		);

		expect(outcomes.map((outcome) => outcome.kind)).toEqual([
			'created',
			'already_recorded',
			'created'
		]);

		const recordedDates = await tx.query.workUnit.findMany({
			where: (workUnit, { eq }) => eq(workUnit.contractId, contractRow.id),
			columns: { date: true }
		});
		// The pre-existing row plus the two rows this batch actually created —
		// row two's collision never touched either of them.
		expect(recordedDates.map((row) => row.date).sort()).toEqual([
			'2026-03-19',
			'2026-03-20',
			'2026-03-21'
		]);
	});
});
