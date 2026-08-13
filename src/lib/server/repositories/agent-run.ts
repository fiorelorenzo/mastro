import { desc, eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { agentRun, type AgentRunStatus } from '$lib/server/db/schema';

export type AgentRunInput = {
	status: AgentRunStatus;
	detail: string | null;
};

/** Records one turn of the agentic ingestion loop (#85, #222). This is
 * the only thing that makes a failed or never-scheduled run visible
 * instead of silence — see the doc comment on `agent_run`
 * (`db/schema/agent-run.ts`) for the alert-engine query shape #74 runs
 * against it. */
export async function recordAgentRun(input: AgentRunInput, executor: DbExecutor = db) {
	const [row] = await executor
		.insert(agentRun)
		.values({ status: input.status, detail: input.detail })
		.returning();
	return row;
}

/** The most recent run, or `null` if none has ever been recorded —
 * `detectAgentRunFailure`'s only input, mirroring `fetchLatestBackupRun`. */
export async function getLatestAgentRun(executor: DbExecutor = db) {
	const [row] = await executor.select().from(agentRun).orderBy(desc(agentRun.createdAt)).limit(1);
	return row ?? null;
}

export async function acknowledgeAgentRun(id: string, executor: DbExecutor = db) {
	const [row] = await executor
		.update(agentRun)
		.set({ acknowledgedAt: new Date() })
		.where(eq(agentRun.id, id))
		.returning();
	return row;
}
