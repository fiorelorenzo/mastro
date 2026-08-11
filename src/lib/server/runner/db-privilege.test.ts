import { afterAll, afterEach, expect, test } from 'vitest';
import { rejection } from '$lib/server/db/pg-error';
import { env } from '$env/dynamic/private';
import { client as pool } from '$lib/server/db';
import { connectRunnerDb, type RunnerDb } from './db.ts';
import {
	deleteCommittedContract,
	insertCommittedContract,
	insertCommittedDocument
} from './__fixtures__/db-fixtures.ts';

// #82's actual acceptance: not "the code looks like it enforces this" but
// "Postgres itself refuses it". This connects twice — once with the
// app's own full-privilege role (`pool`, to set up and tear down rows the
// runner role can then try to reach) and once with the real
// `mastro_runner` role created by `drizzle/0035_acp_runner_role.sql` — and
// proves both halves: the reads that role is granted succeed, and every
// read or write outside that grant is refused by the database, not by
// application code that could regress silently.
//
// Needs a migrated database (`pnpm db:up && pnpm db:migrate`) with
// `RUNNER_DB_PASSWORD` set before migrating, so `mastro_runner` has a
// usable password matching `RUNNER_DATABASE_URL` — see `.env.example`.
// Rows this test creates are committed, not rolled back: a second
// connection cannot see another connection's open transaction, so the
// rest of the suite's roll-back-transaction pattern does not apply here
// (see `__fixtures__/db-fixtures.ts`).

if (!env.RUNNER_DATABASE_URL) {
	throw new Error(
		'RUNNER_DATABASE_URL is not set. Copy .env.example to .env, set RUNNER_DB_PASSWORD, ' +
			'run `pnpm db:migrate`, and set RUNNER_DATABASE_URL to the same password.'
	);
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

async function setUpContractAndDocument() {
	const contractRow = await insertCommittedContract();
	const documentRow = await insertCommittedDocument(contractRow.id);
	cleanup.push(() => deleteCommittedContract(contractRow.id, contractRow.clientId));
	return { contractRow, documentRow };
}

test('the runner role can read the one contract column it filters by', async () => {
	const { contractRow } = await setUpContractAndDocument();
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	const rows = await runnerSql<
		{ id: string }[]
	>`SELECT id FROM contract WHERE id = ${contractRow.id}`;
	expect(rows).toEqual([{ id: contractRow.id }]);
});

test('the runner role can read the document row it was handed', async () => {
	const { documentRow } = await setUpContractAndDocument();
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	const rows = await runnerSql<
		{ id: string }[]
	>`SELECT id FROM document WHERE id = ${documentRow.id}`;
	expect(rows).toEqual([{ id: documentRow.id }]);
});

test('reading any other contract column is refused by Postgres, not merely unused', async () => {
	const { contractRow } = await setUpContractAndDocument();
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	expect(
		(await rejection(() => runnerSql`SELECT title FROM contract WHERE id = ${contractRow.id}`))
			.message
	).toMatch(/permission denied/);
});

test('reading a wholly different table is refused', async () => {
	await setUpContractAndDocument();
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	expect((await rejection(() => runnerSql`SELECT * FROM client LIMIT 1`)).message).toMatch(
		/permission denied/
	);
	expect((await rejection(() => runnerSql`SELECT * FROM work_unit LIMIT 1`)).message).toMatch(
		/permission denied/
	);
	expect((await rejection(() => runnerSql`SELECT * FROM invoice LIMIT 1`)).message).toMatch(
		/permission denied/
	);
	expect((await rejection(() => runnerSql`SELECT * FROM approval LIMIT 1`)).message).toMatch(
		/permission denied/
	);
	expect((await rejection(() => runnerSql`SELECT * FROM proposal LIMIT 1`)).message).toMatch(
		/permission denied/
	);
});

test('the runner role cannot write to contract', async () => {
	const { contractRow } = await setUpContractAndDocument();
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	expect(
		(
			await rejection(
				() => runnerSql`UPDATE contract SET title = 'hijacked' WHERE id = ${contractRow.id}`
			)
		).message
	).toMatch(/permission denied/);
});

test('the runner role cannot write to document', async () => {
	const { contractRow } = await setUpContractAndDocument();
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	expect(
		(
			await rejection(
				() => runnerSql`
			INSERT INTO document (hash, mime, size, original_name, provenance, contract_id, confidential, owner_type, owner_id)
			VALUES (repeat('0', 64), 'text/plain', 1, 'x', 'upload', ${contractRow.id}, true, 'contract', ${contractRow.id})
		`
			)
		).message
	).toMatch(/permission denied/);
});

test('the runner role cannot write anywhere else in the ledger either', async () => {
	const { contractRow } = await setUpContractAndDocument();
	runnerSql = connectRunnerDb(runnerDatabaseUrl);

	expect(
		(
			await rejection(
				() =>
					runnerSql`INSERT INTO work_unit (contract_id, date, quantity, state) VALUES (${contractRow.id}, '2024-01-01', 1, 'proposed')`
			)
		).message
	).toMatch(/permission denied/);
});
