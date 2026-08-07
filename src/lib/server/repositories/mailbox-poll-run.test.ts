import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
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
	await expect(
		db.transaction(async (tx) => {
			const row = await recordMailboxPollRun(
				{ status: 'failure', detail: 'connect ECONNREFUSED' },
				tx
			);
			expect(row.status).toBe('failure');
			expect(row.detail).toBe('connect ECONNREFUSED');
			expect(row.acknowledgedAt).toBeNull();

			tx.rollback();
		})
	).rejects.toThrow();
});

test('getLatestMailboxPollRun returns the most recent row, null when none exist', async () => {
	await expect(
		db.transaction(async (tx) => {
			expect(await getLatestMailboxPollRun(tx)).toBeNull();

			await recordMailboxPollRun({ status: 'failure', detail: 'first' }, tx);
			await recordMailboxPollRun({ status: 'success', detail: null }, tx);

			const latest = await getLatestMailboxPollRun(tx);
			expect(latest?.status).toBe('success');
			expect(latest?.detail).toBeNull();

			tx.rollback();
		})
	).rejects.toThrow();
});

test('acknowledgeMailboxPollRun sets acknowledged_at without touching status or detail', async () => {
	await expect(
		db.transaction(async (tx) => {
			const row = await recordMailboxPollRun({ status: 'failure', detail: 'boom' }, tx);
			const acknowledged = await acknowledgeMailboxPollRun(row.id, tx);

			expect(acknowledged.acknowledgedAt).not.toBeNull();
			expect(acknowledged.status).toBe('failure');
			expect(acknowledged.detail).toBe('boom');

			const [reread] = await tx.select().from(mailboxPollRun).where(eq(mailboxPollRun.id, row.id));
			expect(reread.acknowledgedAt).not.toBeNull();

			tx.rollback();
		})
	).rejects.toThrow();
});
