// #82: the runner's own database connection and the exact two reads its
// `mastro_runner` role is granted (`drizzle/0035_acp_runner_role.sql`).
// Raw `postgres` tagged queries, never drizzle's schema — the same reason
// `scripts/record-backup-run.ts` talks to its table directly: this file
// also has to run unmodified under plain `node` (`scripts/runner.ts`), and
// the schema module's own relative imports only resolve under Vite. Kept
// to exactly the two queries below on purpose — anything wider than what
// `mastro_runner` is actually granted would fail at the database, not
// here, but it would also stop reading as a real least-privilege boundary.

import postgres, { type Sql } from 'postgres';

export type RunnerDb = Sql<Record<string, never>>;

export function connectRunnerDb(databaseUrl: string): RunnerDb {
	return postgres(databaseUrl, { max: 1, onnotice: () => {} });
}

/**
 * The contract a document actually belongs to, read independently of
 * whatever a job claims — `job.ts` compares this against the job's own
 * `contractId` before any content reaches a model, so a producer bug
 * naming the wrong contract cannot have this document extracted against
 * it. `found` is `false` only when no such document exists at all — a
 * first-intake document (#86) exists and reads back `found: true,
 * contractId: null`, which `job.ts` treats as agreement with a job that
 * itself claims no contract, not as a missing row.
 */
export async function getDocumentContractId(
	sql: RunnerDb,
	documentId: string
): Promise<{ found: boolean; contractId: string | null }> {
	const rows = await sql<{ contract_id: string | null }[]>`
		SELECT contract_id FROM document WHERE id = ${documentId}
	`;
	if (rows.length === 0) return { found: false, contractId: null };
	return { found: true, contractId: rows[0].contract_id };
}
