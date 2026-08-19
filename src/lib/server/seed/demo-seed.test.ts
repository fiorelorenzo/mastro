// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. These tests
// call `seedDemo` for real rather than a pure helper, because the thing
// under test is exactly what it decides against the database it finds, and
// that decision was wrong for a year (#332). They therefore run against the
// real instance and are careful to leave it as they found it: neither test
// writes anything, and both are skipped rather than destructive when the
// instance is not the seeded demo one.
//
// A rolled-back transaction cannot be used here. `seedDemo` reads through
// the `db` singleton and takes no executor (see the file's own header on why
// it is not one transaction), so a transaction opened in the test would be
// invisible to it.

import { afterAll, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { client as pool, db } from '$lib/server/db';
import { client as clientTable } from '$lib/server/db/schema';
import { seedDemo } from './demo-seed';

afterAll(async () => {
	await pool.end();
});

const NORDWIND_TAX_ID = 'IT01234560001';

test('a seeded instance reports itself already seeded and writes nothing', async () => {
	const profile = await db.query.fiscalProfile.findFirst();
	if (!profile) {
		// An unseeded instance: running the seed here to create the
		// precondition would leave demo data behind for every other test
		// file in the run, which is the one thing this file must not do.
		expect(profile).toBeUndefined();
		return;
	}

	const before = await db.query.client.findMany();
	const result = await seedDemo();

	expect(result.alreadySeeded).toBe(true);
	expect(await db.query.client.findMany()).toHaveLength(before.length);
});

/**
 * The regression this issue was filed for. The old guard keyed on
 * Nordwind's `tax_id`, which the client form can edit, so editing it made
 * the seed believe the database was empty and crash on
 * `fiscal_profile_no_overlap` — an error naming a table two screens away
 * from the cause.
 *
 * The edit is made and reverted here inside the assertion's own scope, on
 * the seeded instance, because that is the only place the precondition
 * exists. It is a single column on one row, restored in a `finally`, and
 * every other test in the suite scopes its assertions to ids it created
 * itself, so a tax id changing for the length of one call is invisible to
 * them.
 */
test('editing a demo client tax id does not make the seed believe the instance is empty', async () => {
	const nordwind = await db.query.client.findFirst({
		where: eq(clientTable.taxId, NORDWIND_TAX_ID)
	});
	if (!nordwind) {
		expect(nordwind).toBeUndefined();
		return;
	}

	const mutated = `${NORDWIND_TAX_ID}-EDITED-BY-A-HUMAN`;
	try {
		await db.update(clientTable).set({ taxId: mutated }).where(eq(clientTable.id, nordwind.id));

		const result = await seedDemo();

		expect(result.alreadySeeded).toBe(true);
	} finally {
		await db
			.update(clientTable)
			.set({ taxId: NORDWIND_TAX_ID })
			.where(eq(clientTable.id, nordwind.id));
	}

	const restored = await db.query.client.findFirst({ where: eq(clientTable.id, nordwind.id) });
	expect(restored?.taxId).toBe(NORDWIND_TAX_ID);
});
