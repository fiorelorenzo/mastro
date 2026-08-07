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
} finally {
	await client.end();
}
