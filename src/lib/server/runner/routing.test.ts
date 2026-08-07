import { eq } from 'drizzle-orm';
import { afterAll, afterEach, expect, test } from 'vitest';
import { env } from '$env/dynamic/private';
import { client as pool, db } from '$lib/server/db';
import { contract } from '$lib/server/db/schema';
import { connectRunnerDb, type RunnerDb } from './db.ts';
import { HostedExtractionRefused } from './errors.ts';
import { resolveProvider } from './routing.ts';
import {
	deleteCommittedContract,
	insertCommittedContract,
	insertCommittedDocument
} from './__fixtures__/db-fixtures.ts';

// Real database, real `mastro_runner` role — the routing decision has to
// hold against the actual grant `db-privilege.test.ts` proves exists, not
// a stand-in. See that file for the database-setup prerequisites.

if (!env.RUNNER_DATABASE_URL) {
	throw new Error('RUNNER_DATABASE_URL is not set; see .env.example');
}
const runnerDatabaseUrl = env.RUNNER_DATABASE_URL;

let runnerSql: RunnerDb;
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
	while (cleanup.length > 0) {
		await cleanup.pop()?.();
	}
});

afterAll(async () => {
	await runnerSql?.end();
	await pool.end();
});

test('requesting nothing, or local, always resolves to local — no database read needed to know that', async () => {
	const contractRow = await insertCommittedContract();
	cleanup.push(() => deleteCommittedContract(contractRow.id, contractRow.clientId));
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	// A contract id that does not exist at all still resolves to local: the
	// default requires no lookup to grant.
	expect(await resolveProvider(runnerSql, contractRow.id, undefined)).toBe('local');
	expect(await resolveProvider(runnerSql, contractRow.id, 'local')).toBe('local');
	expect(await resolveProvider(runnerSql, crypto.randomUUID(), undefined)).toBe('local');
});

test('requesting hosted on a contract with no consent on file is refused, not silently downgraded', async () => {
	const contractRow = await insertCommittedContract();
	cleanup.push(() => deleteCommittedContract(contractRow.id, contractRow.clientId));
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	await expect(resolveProvider(runnerSql, contractRow.id, 'hosted')).rejects.toThrow(
		HostedExtractionRefused
	);
});

test('requesting hosted on a contract id that does not exist is refused the same way', async () => {
	runnerSql = connectRunnerDb(runnerDatabaseUrl);
	await expect(resolveProvider(runnerSql, crypto.randomUUID(), 'hosted')).rejects.toThrow(
		HostedExtractionRefused
	);
});

test('requesting hosted on a contract with real archived consent resolves to hosted', async () => {
	const contractRow = await insertCommittedContract();
	cleanup.push(() => deleteCommittedContract(contractRow.id, contractRow.clientId));
	const consentDocument = await insertCommittedDocument(contractRow.id, 'contract', contractRow.id);
	await db
		.update(contract)
		.set({ hostedExtractionConsentDocumentId: consentDocument.id })
		.where(eq(contract.id, contractRow.id));
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	expect(await resolveProvider(runnerSql, contractRow.id, 'hosted')).toBe('hosted');
});
