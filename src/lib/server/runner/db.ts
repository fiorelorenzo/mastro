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
 * The one column model routing needs (#81's decision comment on #82):
 * null for a contract with no hosted-extraction consent on file, and null
 * — indistinguishably, from this role's read scope — for a contract id
 * that does not exist at all. Both cases refuse hosted the same way
 * (`routing.ts`), so the distinction never matters to a caller.
 */
export async function getHostedExtractionConsentDocumentId(
	sql: RunnerDb,
	contractId: string
): Promise<string | null> {
	const rows = await sql<{ hosted_extraction_consent_document_id: string | null }[]>`
		SELECT hosted_extraction_consent_document_id FROM contract WHERE id = ${contractId}
	`;
	return rows[0]?.hosted_extraction_consent_document_id ?? null;
}

/**
 * The contract a document actually belongs to, read independently of
 * whatever a job claims — `job.ts` compares this against the job's own
 * `contractId` before any content reaches a model, so a producer bug
 * naming the wrong contract cannot silently borrow a different contract's
 * hosted-extraction consent.
 */
export async function getDocumentContractId(
	sql: RunnerDb,
	documentId: string
): Promise<string | null> {
	const rows = await sql<{ contract_id: string }[]>`
		SELECT contract_id FROM document WHERE id = ${documentId}
	`;
	return rows[0]?.contract_id ?? null;
}
