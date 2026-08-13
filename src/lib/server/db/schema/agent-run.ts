import { pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';

export const agentRunStatus = pgEnum('agent_run_status', ['success', 'failure']);
export type AgentRunStatus = (typeof agentRunStatus.enumValues)[number];

/**
 * One row per turn of the agentic ingestion loop (#85, #222), written by
 * `POST /api/agent/run` at the end of every call regardless of outcome —
 * the same shape `backup_run` (#77) and `mailbox_poll_run` (#84) already
 * establish, reused rather than invented a third time: a single global
 * row, no per-job or per-document foreign key, because "did draining and
 * enqueueing run at all" is a property of the scheduled call itself, not
 * of any one queued job. A single bad job inside a run (an unparseable
 * answer left in `done/`, `agent/drain.ts`'s own `DrainOutcome.failed`)
 * still counts as a `failure` here — it is exactly the "the run had a
 * problem" signal this table exists to make visible, distinct from a day
 * a human simply rejects (`DrainOutcome.rejectedDays`), which is normal
 * proposal review and not a run failure.
 *
 * The alert engine (#74) is this table's stated reader, the same
 * two-part check `detectBackupFailure`/`detectMailboxPollFailure` already
 * run: an explicit `failure` row, or staleness — nothing recorded
 * recently enough, which a `failure` row can never cover because nothing
 * ran to write one. See `detectAgentRunFailure` in `alerts/detectors.ts`.
 */
export const agentRun = pgTable('agent_run', {
	id: id(),
	status: agentRunStatus('status').notNull(),
	detail: text('detail'),
	acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
	...timestamps()
});
