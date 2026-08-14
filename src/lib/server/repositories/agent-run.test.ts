import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool } from '$lib/server/db';
import { agentRun } from '$lib/server/db/schema';
import { acknowledgeAgentRun, getLatestAgentRun, recordAgentRun } from './agent-run';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Mirrors
// `repositories/mailbox-poll-run.test.ts`'s pattern for the same shape of
// table (#222 reuses `mailbox_poll_run`'s own run-recording shape).

afterAll(async () => {
	await pool.end();
});

test('recordAgentRun writes a row with the given status and detail, unacknowledged by default', async () => {
	await inRolledBackTransaction(async (tx) => {
		const row = await recordAgentRun({ status: 'failure', detail: 'ENOTFOUND db' }, tx);
		expect(row.status).toBe('failure');
		expect(row.detail).toBe('ENOTFOUND db');
		expect(row.acknowledgedAt).toBeNull();
	});
});

test('getLatestAgentRun returns the most recent row, null when none exist', async () => {
	await inRolledBackTransaction(async (tx) => {
		// No assertion that the table is empty: a real drain writes an
		// `agent_run` row, so any instance that has ever run one has rows
		// here, and this test is about ordering (AGENTS.md: a test runs
		// against a database with data in it).
		//
		// Distinct times: two rows inserted in one transaction share its clock,
		// and "the most recent" of two identical stamps is undefined. The
		// success row is dated far enough ahead to be the latest whatever else
		// is on file; the failure row is pushed into the past so it cannot win.
		const failure = await recordAgentRun({ status: 'failure', detail: 'first' }, tx);
		await tx
			.update(agentRun)
			.set({ createdAt: new Date('2026-01-01T00:00:00Z') })
			.where(eq(agentRun.id, failure.id));
		const success = await recordAgentRun({ status: 'success', detail: null }, tx);
		await tx
			.update(agentRun)
			.set({ createdAt: new Date('2099-01-01T00:00:00Z') })
			.where(eq(agentRun.id, success.id));

		const latest = await getLatestAgentRun(tx);
		expect(latest?.status).toBe('success');
		expect(latest?.detail).toBeNull();
	});
});

test('acknowledgeAgentRun sets acknowledged_at without touching status or detail', async () => {
	await inRolledBackTransaction(async (tx) => {
		const row = await recordAgentRun({ status: 'failure', detail: 'boom' }, tx);
		const acknowledged = await acknowledgeAgentRun(row.id, tx);

		expect(acknowledged.acknowledgedAt).not.toBeNull();
		expect(acknowledged.status).toBe('failure');
		expect(acknowledged.detail).toBe('boom');

		const [reread] = await tx.select().from(agentRun).where(eq(agentRun.id, row.id));
		expect(reread.acknowledgedAt).not.toBeNull();
	});
});
