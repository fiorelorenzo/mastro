import { afterAll, expect, test } from 'vitest';
import { rejection } from '$lib/server/db/pg-error';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool } from '$lib/server/db';
import { client } from './index';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Real database,
// work done inside a transaction that is always rolled back — see
// `src/lib/server/db/set-updated-at.test.ts` for the pattern. Proves #259's
// two CHECK constraints (`0050_client_sdi_routing.sql`) actually fire, even
// though `client-form.ts` already validates both — the database is the
// backstop for every other writer (import, seed, a future API), not a
// second opinion on the form.

afterAll(async () => {
	await pool.end();
});

let counter = 0;

function baseClient(overrides: { sdiCode?: string | null; pecAddress?: string | null } = {}) {
	counter += 1;
	return {
		legalName: `Test Client ${counter}`,
		taxId: `TEST-TAX-${counter}`,
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100',
		noticeChannel: 'email' as const,
		sdiCode: overrides.sdiCode,
		pecAddress: overrides.pecAddress
	};
}

test('a client with neither sdiCode nor pecAddress is accepted: both are optional', async () => {
	await inRolledBackTransaction(async (tx) => {
		const [row] = await tx.insert(client).values(baseClient()).returning();
		expect(row.sdiCode).toBeNull();
		expect(row.pecAddress).toBeNull();
	});
});

test('a valid 7-character sdiCode and a valid pecAddress are both accepted', async () => {
	await inRolledBackTransaction(async (tx) => {
		const [row] = await tx
			.insert(client)
			.values(baseClient({ sdiCode: 'ABC1234', pecAddress: 'client@pec.example.it' }))
			.returning();
		expect(row.sdiCode).toBe('ABC1234');
		expect(row.pecAddress).toBe('client@pec.example.it');
	});
});

test('an sdiCode shorter or longer than 7 characters is rejected by the database', async () => {
	await inRolledBackTransaction(async (tx) => {
		// Two rejections inside one test: `rejection`'s `tx` form contains
		// each failure in its own savepoint, so the second insert still
		// runs against a live transaction instead of one already aborted
		// by the first (`src/lib/server/db/pg-error.ts`'s own doc comment).
		const short = await rejection(
			() => tx.insert(client).values(baseClient({ sdiCode: 'ABC123' })),
			tx
		);
		expect(short).toMatchObject({ code: '23514', constraint_name: 'client_sdi_code_length' });

		const long = await rejection(
			() => tx.insert(client).values(baseClient({ sdiCode: 'ABC12345' })),
			tx
		);
		expect(long).toMatchObject({ code: '23514', constraint_name: 'client_sdi_code_length' });
	});
});

test('a pecAddress that is not shaped like an email is rejected by the database', async () => {
	await inRolledBackTransaction(async (tx) => {
		const error = await rejection(
			() => tx.insert(client).values(baseClient({ pecAddress: 'not-an-email' })),
			tx
		);
		expect(error).toMatchObject({
			code: '23514',
			constraint_name: 'client_pec_address_is_email'
		});
	});
});

// ── migration 0056: a legal name and a country, and nothing else ──────────

test('a client with only a legal name and a country is accepted', async () => {
	await inRolledBackTransaction(async (tx) => {
		const [row] = await tx
			.insert(client)
			.values({ legalName: 'Minimal Client', country: 'IT' })
			.returning();
		expect(row.taxId).toBeNull();
		expect(row.addressLine1).toBeNull();
		expect(row.addressCity).toBeNull();
		expect(row.addressPostalCode).toBeNull();
		expect(row.noticeChannel).toBeNull();
	});
});

// The half of the nullability that is easy to get wrong. Postgres does not
// treat two NULLs as equal under a unique constraint, so the guarantee
// import matching relies on survives for every client that has a tax id,
// while any number of clients without one coexist. Asserted against the
// database rather than reasoned about, because the whole design of #0056
// rests on it.
test('two clients can both have no tax id at all', async () => {
	await inRolledBackTransaction(async (tx) => {
		await tx.insert(client).values({ legalName: 'No Tax Id A', country: 'IT' });
		await tx.insert(client).values({ legalName: 'No Tax Id B', country: 'FR' });
		const rows = await tx.select().from(client);
		expect(rows.filter((row) => row.taxId === null).length).toBeGreaterThanOrEqual(2);
	});
});

test('two clients still cannot share a real tax id', async () => {
	await inRolledBackTransaction(async (tx) => {
		const shared = `SHARED-TAX-${Date.now()}`;
		await tx.insert(client).values({ legalName: 'First', country: 'IT', taxId: shared });
		expect(
			await rejection(
				() => tx.insert(client).values({ legalName: 'Second', country: 'IT', taxId: shared }),
				tx
			)
		).toMatchObject({ code: '23505', constraint_name: 'client_tax_id_unique' });
	});
});
