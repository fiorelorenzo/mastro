import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { createApproval } from './approval';
import {
	createWorkUnit,
	linkApprovalToWorkUnit,
	listWorkedWithoutApprovalEvents,
	listWorkUnitTransitions,
	markWorkUnitUnbillable
} from './work-unit';
import { fetchWorkedWithoutApprovalRows } from '$lib/server/alerts/repository';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres work
// happens inside a transaction that is always rolled back, same pattern as
// `repositories/work-unit.test.ts`. `createApproval` writes to disk, so
// `DOCUMENT_STORAGE_ROOT` points at a throwaway temp directory removed in
// `afterEach`.

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-worked-without-approval-'));
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
			requiresPriorApproval: true
		})
		.returning();
	return contractRow;
}

test('recording a worked day with no approval surfaces on the feed #74 polls, and a late approval clears it', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);

		const row = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2024-06-12',
				quantity: 1,
				scope: 'Restored the backup after the outage.',
				state: 'worked'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'recorded the same day it happened',
			tx
		);
		expect(row.state).toBe('worked_without_approval');

		const feed = await listWorkedWithoutApprovalEvents(undefined, tx);
		const ownEvent = feed.find((event) => event.workUnitId === row.id);
		expect(ownEvent?.toState).toBe('worked_without_approval');
		expect(ownEvent?.createdAt).toBeInstanceOf(Date);

		const approvalRow = await createApproval(
			{
				contractId: contractRow.id,
				channel: 'email',
				sender: 'client@example.com',
				receivedAt: new Date('2024-06-14T09:00:00Z'),
				messageId: '<late@example.com>',
				excerpt: 'Sorry for the delay, that emergency fix is approved.',
				origin: { kind: 'manual' },
				document: {
					bytes: new TextEncoder().encode('Sorry for the delay, that emergency fix is approved.'),
					mime: 'message/rfc822',
					originalName: 'late-approval.eml',
					provenance: 'mail',
					confidential: true
				}
			},
			tx
		);

		const recovered = await linkApprovalToWorkUnit(
			row.id,
			approvalRow.id,
			{ kind: 'human', email: 'lorenzo@example.com' },
			'client confirmed after the fact',
			tx
		);
		expect(recovered.state).toBe('worked');
	});
});

test('listWorkedWithoutApprovalEvents(sinceInclusive) excludes events before the given instant', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const row = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2024-06-12',
				quantity: 1,
				scope: 'Restored the backup after the outage.',
				state: 'worked'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'recorded the same day it happened',
			tx
		);

		const future = new Date(Date.now() + 60_000);
		const feed = await listWorkedWithoutApprovalEvents(future, tx);
		expect(feed.some((event) => event.workUnitId === row.id)).toBe(false);

		const past = new Date(Date.now() - 60_000);
		const feedFromPast = await listWorkedWithoutApprovalEvents(past, tx);
		expect(feedFromPast.some((event) => event.workUnitId === row.id)).toBe(true);
	});
});

test('#228: a day nobody will ever approve can be closed out as unbillable — the reason lands in the log, and it drops off the alert feed', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);

		const row = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2024-05-03',
				quantity: 1,
				scope: 'Emergency patch the client never wrote back about.',
				state: 'worked'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'recorded the same day it happened',
			tx
		);
		expect(row.state).toBe('worked_without_approval');

		const stillFlagged = await fetchWorkedWithoutApprovalRows(tx);
		expect(stillFlagged.some((r) => r.workUnitId === row.id)).toBe(true);

		const closed = await markWorkUnitUnbillable(
			row.id,
			{ kind: 'human', email: 'lorenzo@example.com' },
			'client confirmed by phone they will never approve this in writing',
			tx
		);
		expect(closed.state).toBe('unbillable');

		const log = await listWorkUnitTransitions(row.id, tx);
		const last = log.at(-1);
		expect(last?.fromState).toBe('worked_without_approval');
		expect(last?.toState).toBe('unbillable');
		expect(last?.reason).toBe('client confirmed by phone they will never approve this in writing');
		expect(last?.actor).toEqual({ kind: 'human', email: 'lorenzo@example.com' });

		// The whole point (#228's acceptance bullet): it leaves the alert
		// feed the moment it does, the same state-filtered query the alert
		// engine itself polls (`fetchWorkedWithoutApprovalRows`).
		const clearedFromFeed = await fetchWorkedWithoutApprovalRows(tx);
		expect(clearedFromFeed.some((r) => r.workUnitId === row.id)).toBe(false);
	});
});
