import { desc, eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { mailboxPollRun, type MailboxPollRunStatus } from '$lib/server/db/schema';

export type MailboxPollRunInput = {
	status: MailboxPollRunStatus;
	detail: string | null;
};

/** Records one poll attempt. This is the only thing that makes a failed
 * or backoff-exhausted poll visible instead of an unhandled rejection
 * nobody sees — see the doc comment on `mailbox_poll_run`
 * (`db/schema/mailbox-poll-run.ts`) for the alert-engine query shape #74
 * is meant to run against it. */
export async function recordMailboxPollRun(input: MailboxPollRunInput, executor: DbExecutor = db) {
	const [row] = await executor
		.insert(mailboxPollRun)
		.values({ status: input.status, detail: input.detail })
		.returning();
	return row;
}

/** The most recent poll attempt, or `null` if none has ever been
 * recorded — `detectMailboxPollFailure`'s only input, mirroring
 * `fetchLatestBackupRun`. */
export async function getLatestMailboxPollRun(executor: DbExecutor = db) {
	const [row] = await executor
		.select()
		.from(mailboxPollRun)
		.orderBy(desc(mailboxPollRun.createdAt))
		.limit(1);
	return row ?? null;
}

export async function acknowledgeMailboxPollRun(id: string, executor: DbExecutor = db) {
	const [row] = await executor
		.update(mailboxPollRun)
		.set({ acknowledgedAt: new Date() })
		.where(eq(mailboxPollRun.id, id))
		.returning();
	return row;
}
