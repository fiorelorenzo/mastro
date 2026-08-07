import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { client, contract, workUnit } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { createApproval } from './approval';
import {
	createWorkUnit,
	getWorkUnit,
	getWorkUnitDocument,
	listWorkUnitTransitions,
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
	await expect(
		db.transaction(async (tx) => {
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

			tx.rollback();
		})
	).rejects.toThrow();
});

test("a day's archived original is reachable in one query, once an approval is linked", async () => {
	await expect(
		db.transaction(async (tx) => {
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

			const row = await createWorkUnit(
				{
					contractId: contractRow.id,
					date: '2024-06-10',
					quantity: 1,
					scope: 'Migrated the API.',
					approvalId: approvalRow.id,
					state: 'approved'
				},
				{ kind: 'human', email: 'lorenzo@example.com' },
				'linked at creation',
				tx
			);

			const original = await getWorkUnitDocument(row.id, tx);
			expect(original?.originalName).toBe('approval.eml');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a write outside the repository entirely is still logged, defaulting to a system actor', async () => {
	await expect(
		db.transaction(async (tx) => {
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

			tx.rollback();
		})
	).rejects.toThrow();
});

test('getWorkUnit reads a single day back by id', async () => {
	await expect(
		db.transaction(async (tx) => {
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

			tx.rollback();
		})
	).rejects.toThrow();
});
