import { pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';

export const backupRunStatus = pgEnum('backup_run_status', ['success', 'failure']);
export type BackupRunStatus = (typeof backupRunStatus.enumValues)[number];

/**
 * One row per backup attempt (#77), written by `scripts/record-backup-run.ts`
 * at the end of `scripts/backup.sh` regardless of outcome. This is the
 * signal the alert engine (#74, not built yet) is meant to query: a
 * `failure` row that has not been acknowledged, or the absence of any row
 * newer than the backup interval — which means the job did not run at all,
 * a case a `failure` row can never cover because nothing ran to write one.
 * See docs/backup.md for the exact query #74 should use.
 */
export const backupRun = pgTable('backup_run', {
	id: id(),
	status: backupRunStatus('status').notNull(),
	detail: text('detail'),
	acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
	...timestamps()
});
