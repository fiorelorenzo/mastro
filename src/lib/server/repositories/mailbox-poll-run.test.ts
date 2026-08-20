import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool } from '$lib/server/db';
import { mailboxPollRun } from '$lib/server/db/schema';
import {
	acknowledgeMailboxPollRun,
	getLatestMailboxPollRun,
	recordMailboxPollRun
} from './mailbox-poll-run';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Mirrors
// `repositories/document-mirror.test.ts`'s pattern for the same shape of
// table (#84 reuses `document_mirror_run`'s own run-recording shape).

afterAll(async () => {
	await pool.end();
});

test('recordMailboxPollRun writes a row with the given status and detail, unacknowledged by default', async () => {
	await inRolledBackTransaction(async (tx) => {
		const row = await recordMailboxPollRun(
			{ status: 'failure', detail: 'connect ECONNREFUSED' },
			tx
		);
		expect(row.status).toBe('failure');
		expect(row.detail).toBe('connect ECONNREFUSED');
		expect(row.acknowledgedAt).toBeNull();
	});
});

test('getLatestMailboxPollRun returns the most recent row, null when none exist', async () => {
	await inRolledBackTransaction(async (tx) => {
		// This query reads the whole table, so "no rows yet" is only a fact
		// this test can assert if it makes it one — the same reasoning the
		// sibling test in `alerts/repository.test.ts` already carries. It
		// passed for a year only because nothing else in the suite wrote a
		// poll run; #380's shared-mailbox pass does, and a real instance
		// certainly does.
		await tx.delete(mailboxPollRun);
		expect(await getLatestMailboxPollRun(tx)).toBeNull();

		// Distinct times: two rows inserted in one transaction share its clock,
		// and "the most recent" of two identical stamps is undefined.
		await recordMailboxPollRun({ status: 'failure', detail: 'first' }, tx);
		await tx
			.update(mailboxPollRun)
			.set({ createdAt: new Date('2026-01-01T00:00:00Z') })
			.where(eq(mailboxPollRun.status, 'failure'));
		await recordMailboxPollRun({ status: 'success', detail: null }, tx);

		const latest = await getLatestMailboxPollRun(tx);
		expect(latest?.status).toBe('success');
		expect(latest?.detail).toBeNull();
	});
});

test('acknowledgeMailboxPollRun sets acknowledged_at without touching status or detail', async () => {
	await inRolledBackTransaction(async (tx) => {
		const row = await recordMailboxPollRun({ status: 'failure', detail: 'boom' }, tx);
		const acknowledged = await acknowledgeMailboxPollRun(row.id, tx);

		expect(acknowledged.acknowledgedAt).not.toBeNull();
		expect(acknowledged.status).toBe('failure');
		expect(acknowledged.detail).toBe('boom');

		const [reread] = await tx.select().from(mailboxPollRun).where(eq(mailboxPollRun.id, row.id));
		expect(reread.acknowledgedAt).not.toBeNull();
	});
});
