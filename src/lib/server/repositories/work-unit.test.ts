import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract, workUnit } from '$lib/server/db/schema';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { createApproval } from './approval';
import {
	createApprovedWorkUnit,
	createWorkUnit,
	getWorkUnit,
	getWorkUnitDocument,
	listWorkUnitTransitions,
	listWorkUnitsForContractOnDate,
	transitionWorkUnit
} from './work-unit';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres work
// happens inside a transaction that is always rolled back, same pattern as
// the other repository tests. `createApproval` writes a document to disk,
// so `DOCUMENT_STORAGE_ROOT` points at a throwaway temp directory removed
// in `afterEach`, same as `repositories/approval.test.ts`.

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-work-units-'));
	process.env.DOCUMENT_STORAGE_ROOT = root;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

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

test('createWorkUnit and transitionWorkUnit record actor and reason through set_config', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);

		const row = await createWorkUnit(
			{ contractId: contractRow.id, date: '2024-06-10', quantity: 1, scope: 'Migrated the API.' },
			{ kind: 'human', email: 'lorenzo@example.com' },
			'day agreed over a call',
			tx
		);
		await transitionWorkUnit(
			row.id,
			{ state: 'approved' },
			{ kind: 'agent', proposalReference: 'proposal-42' },
			'matched against the mailbox',
			tx
		);

		const log = await listWorkUnitTransitions(row.id, tx);
		expect(log.map((entry) => entry.actor)).toEqual([
			{ kind: 'human', email: 'lorenzo@example.com' },
			{ kind: 'agent', proposalReference: 'proposal-42' }
		]);
		expect(log.map((entry) => entry.reason)).toEqual([
			'day agreed over a call',
			'matched against the mailbox'
		]);
	});
});

test("a day's archived original is reachable in one query, once an approval is linked", async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);
		const approvalRow = await createApproval(
			{
				contractId: contractRow.id,
				channel: 'email',
				sender: 'client@example.com',
				receivedAt: new Date('2024-06-01T09:00:00Z'),
				messageId: '<xyz@example.com>',
				excerpt: 'Please proceed with the migration next week.',
				origin: { kind: 'manual' },
				document: {
					bytes: new TextEncoder().encode('Please proceed with the migration next week.'),
					mime: 'message/rfc822',
					originalName: 'approval.eml',
					provenance: 'mail',
					confidential: true
				}
			},
			tx
		);

		const noDocumentYet = await getWorkUnitDocument(crypto.randomUUID(), tx);
		expect(noDocumentYet).toBeNull();

		// A day is created at `proposed` and walked to `approved`: the state
		// machine (drizzle/0012) refuses an INSERT that starts there, whatever
		// the approval says.
		const proposed = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2024-06-10',
				quantity: 1,
				scope: 'Migrated the API.',
				state: 'proposed'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'proposed',
			tx
		);
		const row = await transitionWorkUnit(
			proposed.id,
			{ state: 'approved', approvalId: approvalRow.id },
			{ kind: 'human', email: 'lorenzo@example.com' },
			'linked at approval',
			tx
		);

		const original = await getWorkUnitDocument(row.id, tx);
		expect(original?.originalName).toBe('approval.eml');
	});
});

test('createApprovedWorkUnit inserts proposed and transitions to approved in one step, never inserting approved directly', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);
		const approvalRow = await createApproval(
			{
				contractId: contractRow.id,
				channel: 'email',
				sender: 'client@example.com',
				receivedAt: new Date('2024-06-01T09:00:00Z'),
				messageId: '<xyz@example.com>',
				excerpt: 'Please proceed with the migration next week.',
				origin: { kind: 'manual' },
				document: {
					bytes: new TextEncoder().encode('Please proceed with the migration next week.'),
					mime: 'message/rfc822',
					originalName: 'approval.eml',
					provenance: 'mail',
					confidential: true
				}
			},
			tx
		);

		const row = await createApprovedWorkUnit(
			{ contractId: contractRow.id, date: '2024-06-10', quantity: 1, scope: 'Migrated the API.' },
			approvalRow.id,
			{ kind: 'agent', proposalReference: 'proposal-1' },
			'accepted from proposal proposal-1',
			tx
		);

		expect(row.state).toBe('approved');
		expect(row.approvalId).toBe(approvalRow.id);

		// Two writes, not one: the state machine forbids an INSERT that
		// starts at 'approved' (drizzle/0012), so this must have gone
		// through 'proposed' first, and the log proves it.
		const log = await listWorkUnitTransitions(row.id, tx);
		expect(log.map((entry) => [entry.fromState, entry.toState])).toEqual([
			[null, 'proposed'],
			['proposed', 'approved']
		]);
		expect(log.map((entry) => entry.reason)).toEqual([
			'accepted from proposal proposal-1',
			'accepted from proposal proposal-1'
		]);
	});
});

test('a write outside the repository entirely is still logged, defaulting to a system actor', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);

		// No set_config call at all here, unlike createWorkUnit/
		// transitionWorkUnit — this is what a future import connecting
		// straight to Postgres would look like.
		const [row] = await tx
			.insert(workUnit)
			.values({
				contractId: contractRow.id,
				date: '2024-06-10',
				quantity: 1,
				scope: 'Migrated the API.'
			})
			.returning();

		const log = await listWorkUnitTransitions(row.id, tx);
		expect(log).toHaveLength(1);
		expect(log[0].actor).toEqual({ kind: 'system' });
		expect(log[0].reason).toBe('no reason supplied');
	});
});

test('getWorkUnit reads a single day back by id', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const created = await createWorkUnit(
			{ contractId: contractRow.id, date: '2024-06-10', quantity: 0.5, scope: 'Half day of QA.' },
			{ kind: 'human', email: 'lorenzo@example.com' },
			'day agreed over a call',
			tx
		);

		const fetched = await getWorkUnit(created.id, tx);
		expect(fetched?.quantity).toBe(0.5);
		expect(fetched?.scope).toBe('Half day of QA.');
	});
});

test('#62: replaying createWorkUnit with the same client-generated id is a no-op that returns the existing day, not a duplicate or an error', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const id = crypto.randomUUID();
		const input = {
			id,
			contractId: contractRow.id,
			date: '2024-06-10',
			quantity: 1,
			scope: 'Migrated the API.'
		};

		const first = await createWorkUnit(
			input,
			{ kind: 'human', email: 'lorenzo@example.com' },
			'recorded offline, first sync attempt',
			tx
		);
		expect(first.id).toBe(id);

		// The offline queue replays the exact same fields under the exact
		// same id — a dropped connection right after the first attempt
		// succeeded means the client cannot tell it apart from one that
		// never reached the server, so it resends unconditionally.
		const replay = await createWorkUnit(
			input,
			{ kind: 'human', email: 'lorenzo@example.com' },
			'replayed after reconnecting',
			tx
		);
		expect(replay).toEqual(first);

		const rows = await tx.select().from(workUnit).where(eq(workUnit.id, id));
		expect(rows).toHaveLength(1);

		// The conflict suppressed the whole INSERT, so the AFTER INSERT
		// logging trigger never ran a second time either.
		const log = await listWorkUnitTransitions(id, tx);
		expect(log).toHaveLength(1);
		expect(log[0].reason).toBe('recorded offline, first sync attempt');
	});
});

test('#62: a second day for the same contract and date under a different id still trips the one-active-per-date constraint', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);

		await createWorkUnit(
			{
				id: crypto.randomUUID(),
				contractId: contractRow.id,
				date: '2024-06-10',
				quantity: 1,
				scope: 'Migrated the API.'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'first day',
			tx
		);

		// Only a conflict on `id` is targeted — a genuinely different
		// mutation that happens to collide on contract and date is not
		// mistaken for a replay of the first one.
		await expect(
			createWorkUnit(
				{
					id: crypto.randomUUID(),
					contractId: contractRow.id,
					date: '2024-06-10',
					quantity: 1,
					scope: 'A different day entirely.'
				},
				{ kind: 'human', email: 'lorenzo@example.com' },
				'second, unrelated day',
				tx
			)
		).rejects.toSatisfy((error) =>
			isPostgresConstraintViolation(error, '23505', 'work_unit_one_active_per_contract_date')
		);
	});
});

test('the days one contract already holds for one date (#417)', async () => {
	// What `/day/new` asks before it lets somebody record a second day. It
	// has to be scoped to the pair, not to the date: the shared instance has
	// other contracts with days on the same dates (AGENTS.md), and a form
	// warning about somebody else's day would be worse than no warning.
	const result = await inRolledBackTransaction(async (tx) => {
		const first = await insertContract(tx, false);
		const second = await insertContract(tx, false);

		const mine = await createWorkUnit(
			{ contractId: first.id, date: '2026-08-04', quantity: 0.5, scope: 'meetings' },
			{ kind: 'human', email: 'lorenzo@example.com' },
			'recorded for the #417 fixture',
			tx
		);
		// Same date, other contract: must not appear.
		await createWorkUnit(
			{ contractId: second.id, date: '2026-08-04', quantity: 1, scope: 'elsewhere' },
			{ kind: 'human', email: 'lorenzo@example.com' },
			'recorded for the #417 fixture',
			tx
		);
		// Same contract, next day: must not appear either.
		await createWorkUnit(
			{ contractId: first.id, date: '2026-08-05', quantity: 1, scope: 'later' },
			{ kind: 'human', email: 'lorenzo@example.com' },
			'recorded for the #417 fixture',
			tx
		);

		return {
			onTheDate: await listWorkUnitsForContractOnDate(first.id, '2026-08-04', tx),
			mineId: mine.id,
			emptyDate: await listWorkUnitsForContractOnDate(first.id, '2026-08-06', tx)
		};
	});

	expect(result.onTheDate.map((day) => day.id)).toEqual([result.mineId]);
	expect(Number(result.onTheDate[0].quantity)).toBe(0.5);
	expect(result.emptyDate).toEqual([]);
});
