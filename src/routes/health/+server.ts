import { sql } from 'drizzle-orm';
import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';

/** Liveness plus a real database round trip, for compose and the reverse proxy. */
export async function GET() {
	try {
		await db.execute(sql`select 1`);
	} catch (error) {
		console.error('health: database unreachable', error);
		return json({ status: 'error', database: 'unreachable' }, { status: 503 });
	}
	return json({ status: 'ok', database: 'ok' });
}
