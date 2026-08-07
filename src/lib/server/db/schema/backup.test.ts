import { eq, sql } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { backupRun } from './index';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
// Real database, work done inside a transaction that is always rolled back —
// see `src/lib/server/db/set-updated-at.test.ts` for the pattern. This is
// the storage half of #77's alert contract: `scripts/record-backup-run.ts`
// writes exactly this shape after every backup attempt.

afterAll(async () => {
	await pool.end();
});

test('a backup run is recorded with its status and stays unacknowledged by default', async () => {
	await expect(
		db.transaction(async (tx) => {
			const [failure] = await tx
				.insert(backupRun)
				.values({ status: 'failure', detail: 'pg_dump exited 1' })
				.returning();

			expect(failure.status).toBe('failure');
			expect(failure.detail).toBe('pg_dump exited 1');
			expect(failure.acknowledgedAt).toBeNull();

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a status outside success/failure is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			// The enum type itself is the constraint here: an invalid
			// label cannot even be cast, let alone stored.
			await expect(
				tx.execute(sql`insert into backup_run (status) values ('partial')`)
			).rejects.toThrow();

			tx.rollback();
		})
	).rejects.toThrow();
});

test('acknowledging a run stops it looking like the newest failure', async () => {
	await expect(
		db.transaction(async (tx) => {
			const [row] = await tx.insert(backupRun).values({ status: 'failure' }).returning();

			await tx
				.update(backupRun)
				.set({ acknowledgedAt: new Date() })
				.where(eq(backupRun.id, row.id));

			const [updated] = await tx.select().from(backupRun).where(eq(backupRun.id, row.id));
			expect(updated.acknowledgedAt).not.toBeNull();
			expect(updated.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());

			tx.rollback();
		})
	).rejects.toThrow();
});
