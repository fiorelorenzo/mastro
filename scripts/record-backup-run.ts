// Records the outcome of one backup attempt (#77) into `backup_run`, the
// table the alert engine (#74, not built yet) is meant to query for a
// failure that has not been acknowledged. See docs/backup.md for the exact
// query it should run. Called at the end of scripts/backup.sh, on both the
// success and the failure path.
//
// Runs under plain `node` (type stripping), like scripts/migrate.ts, and
// for the same reason: the deployed image must run this on a schedule with
// no dev dependency and no Vite build around it. It talks to the table
// directly instead of importing the Drizzle schema, because that schema's
// own relative imports are extensionless and only resolve under Vite/
// svelte-kit's bundler resolution, not under plain node ESM.
import postgres from 'postgres';
import { log } from '../src/lib/server/log/logger.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const [, , status, ...detailWords] = process.argv;
if (status !== 'success' && status !== 'failure') {
	throw new Error('usage: record-backup-run.ts <success|failure> [detail...]');
}
const detail = detailWords.join(' ') || null;

const client = postgres(url, { max: 1, onnotice: () => {} });

try {
	await client`insert into backup_run (status, detail) values (${status}, ${detail})`;
	log.info('backup run recorded', { status, detail });
} finally {
	await client.end();
}
