// Applies every pending SQL migration in ./drizzle, then exits.
// Runs under plain `node` (type stripping), so it needs no build step and no
// dev dependency: the deployed image can run it on boot.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { describeDatabaseTarget, describeTargetMismatch } from '../src/lib/server/db/target.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// `--env-file` never overrides a variable that is already set, so an
// inherited DATABASE_URL beats the one in .env. Read the file separately and
// say which of the two won: a stale export in the environment otherwise
// migrates a different database than the one this checkout is configured
// for, and nothing in the output would show it.
let fromEnvFile: string | undefined;
try {
	fromEnvFile = parseEnv(readFileSync('.env', 'utf8')).DATABASE_URL;
} catch {
	// No readable .env, which is the normal case in the deployed image.
	// Nothing to compare the environment against.
}

const mismatch = describeTargetMismatch(url, fromEnvFile);
if (mismatch !== null) console.warn(mismatch);

// Announced before connecting, so an interrupted or failing run still leaves
// a record of which database it was pointed at.
const target = describeDatabaseTarget(url);
console.log(`migrating ${target}`);

const client = postgres(url, { max: 1, onnotice: () => {} });

try {
	await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
	console.log(`migrations applied to ${target}`);

	// #82: `mastro_runner` (0035_acp_runner_role.sql) is created without a
	// password — a committed migration is public, so the password cannot
	// live there. Rotating it here, after every migration run, means the
	// same boot path that already applies schema changes (locally via
	// `pnpm db:migrate`, in production via the image's entrypoint) is also
	// what makes the role usable, with no second deploy step to forget.
	// `ALTER ROLE ... PASSWORD` is idempotent: running it again with the
	// same value is a no-op change, so a restart never breaks the runner's
	// existing credential.
	//
	// `PASSWORD` takes a string literal in Postgres' own grammar, not a
	// bind parameter — `ALTER ROLE ... PASSWORD $1` is a syntax error on
	// any driver, not a `postgres`-package limitation. `format(...)` runs
	// server-side, inside an ordinary parameterised SELECT, so the actual
	// password value never touches string concatenation in this script;
	// `%L` quotes it exactly the way Postgres quotes any literal,
	// including one containing a quote character.
	const runnerPassword = process.env.RUNNER_DB_PASSWORD;
	if (runnerPassword) {
		const [{ stmt }] = await client<[{ stmt: string }]>`
			SELECT format('ALTER ROLE mastro_runner WITH PASSWORD %L', ${runnerPassword}::text) AS stmt
		`;
		await client.unsafe(stmt);
		console.log('mastro_runner password set from RUNNER_DB_PASSWORD');
	} else {
		console.warn(
			'RUNNER_DB_PASSWORD is not set: mastro_runner has no usable password, so the ACP runner cannot connect. This is fine if the runner is not deployed yet.'
		);
	}
} finally {
	await client.end();
}
