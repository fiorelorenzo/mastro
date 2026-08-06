// Applies every pending SQL migration in ./drizzle, then exits.
// Runs under plain `node` (type stripping), so it needs no build step and no
// dev dependency: the deployed image can run it on boot.
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const client = postgres(url, { max: 1, onnotice: () => {} });

try {
	await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
	console.log('migrations applied');
} finally {
	await client.end();
}
