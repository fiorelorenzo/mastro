import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

/** The connection pool. Tests close it in `afterAll`; the server never does. */
export const client = postgres(env.DATABASE_URL);

export const db = drizzle(client, { schema });

/** `db` itself, or the `tx` a `db.transaction` callback receives — the
 * type repository functions accept when a caller wants them to
 * participate in an ambient transaction instead of running standalone.
 * See `src/lib/server/repositories/approval.ts` for why this matters:
 * `createApproval` composes `storeDocument` and its own insert in one
 * transaction, and drizzle has no other structural way to say "either the
 * pool or a transaction on it" than lifting the callback parameter type
 * off `db.transaction` itself. */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
