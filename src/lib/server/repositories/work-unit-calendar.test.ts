import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract, workUnit } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { createWorkUnit, getMostRecentContractId, listWorkUnitsBetween } from './work-unit';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Same rollback
// pattern as `work-unit.test.ts`. `createWorkUnit` never touches the blob
// store directly, but the fixture contract still needs
// `DOCUMENT_STORAGE_ROOT` set defensively in case a future change adds an
// approval to one of these tests.

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-work-unit-calendar-'));
	process.env.DOCUMENT_STORAGE_ROOT = root;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

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

test('listWorkUnitsBetween returns only the days inside the inclusive range, ordered by date', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const actor = { kind: 'human' as const, email: 'lorenzo@example.com' };

		await createWorkUnit(
			{ contractId: contractRow.id, date: '2024-05-31', quantity: 1, scope: 'Before the range.' },
			actor,
			'seed',
			tx
		);
		const inside1 = await createWorkUnit(
			{ contractId: contractRow.id, date: '2024-06-01', quantity: 1, scope: 'First of June.' },
			actor,
			'seed',
			tx
		);
		const inside2 = await createWorkUnit(
			{ contractId: contractRow.id, date: '2024-06-30', quantity: 0.5, scope: 'Last of June.' },
			actor,
			'seed',
			tx
		);
		await createWorkUnit(
			{ contractId: contractRow.id, date: '2024-07-01', quantity: 1, scope: 'After the range.' },
			actor,
			'seed',
			tx
		);

		const rows = await listWorkUnitsBetween('2024-06-01', '2024-06-30', tx);
		expect(rows.map((row) => row.id)).toEqual([inside1.id, inside2.id]);
	});
});

test("getMostRecentContractId names the contract behind the latest inserted day, scoped by explicit far-future timestamps so a populated database's own history cannot outrank it", async () => {
	// `created_at` defaults to `now()`, which Postgres resolves once per
	// transaction (`transaction_timestamp()`) — two inserts sharing this
	// test's outer transaction would otherwise tie, which the ordering
	// this function relies on cannot break. Every real call site opens its
	// own transaction (`createWorkUnit` is called with no ambient `tx`),
	// so that tie never happens outside a rollback-per-test setup; here we
	// just set `createdAt` explicitly instead of depending on wall-clock
	// spacing between two calls in the same transaction. The function has
	// no per-caller scope to assert against (it names the single most
	// recent day system-wide, by design — #24's "contract used most
	// recently" default), so against a database that already has history
	// (a seeded instance) this test cannot assert "null with no history":
	// it only proves the ordering between its own two contracts, each
	// timestamped decades past any realistic seed data.
	await inRolledBackTransaction(async (tx) => {
		const contractA = await insertContract(tx);
		const contractB = await insertContract(tx);
		const actor = { kind: 'human' as const, email: 'lorenzo@example.com' };

		const dayForA = await createWorkUnit(
			{ contractId: contractA.id, date: '2024-06-01', quantity: 1, scope: 'For A.' },
			actor,
			'seed',
			tx
		);
		await tx
			.update(workUnit)
			.set({ createdAt: new Date('2099-01-01T10:00:00Z') })
			.where(eq(workUnit.id, dayForA.id));
		expect(await getMostRecentContractId(tx)).toBe(contractA.id);

		const dayForB = await createWorkUnit(
			{ contractId: contractB.id, date: '2024-06-02', quantity: 1, scope: 'For B.' },
			actor,
			'seed',
			tx
		);
		await tx
			.update(workUnit)
			.set({ createdAt: new Date('2099-01-01T11:00:00Z') })
			.where(eq(workUnit.id, dayForB.id));
		expect(await getMostRecentContractId(tx)).toBe(contractB.id);
	});
});
