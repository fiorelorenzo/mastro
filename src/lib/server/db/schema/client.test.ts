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
