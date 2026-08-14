// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Every test
// works inside a transaction it rolls back, same reasoning as
// `fiscal/profile.test.ts` — see `makeRoomForOwnProfiles` below.

import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { rejection } from '$lib/server/db/pg-error';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, type DbExecutor } from '$lib/server/db';
import { fiscalProfile } from '$lib/server/db/schema';
import { getCurrentFiscalProfile, listFiscalProfiles, switchFiscalProfile } from './fiscal-profile';

afterAll(async () => {
	await pool.end();
});

/** `fiscal_profile` carries a database-wide EXCLUDE constraint, and a
 * database this suite runs against may already carry a real, currently
 * open regime (`valid_to` null) — a demo seed's "the regime in force
 * today has no known end" row. An open-ended fixture of this test's own
 * collides with that row at ANY start date (two open-ended ranges always
 * overlap), so a test that needs one clears the table first instead —
 * exactly `fiscal/profile.test.ts`'s own `makeRoomForOwnProfiles`,
 * reproduced here rather than imported since that module is test-only.
 * Nothing outside this test ever sees it: the delete is undone the
 * moment the transaction rolls back. */
async function makeRoomForOwnProfiles(tx: DbExecutor) {
	await tx.delete(fiscalProfile);
}

test('switchFiscalProfile inserts the first profile on an empty table with no close step', async () => {
	const row = await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfiles(tx);
		return switchFiscalProfile(
			{ packId: 'generic', packVersion: '1', validFrom: '2020-01-01', validTo: null },
			tx
		);
	});
	expect(row.packId).toBe('generic');
	expect(row.validFrom).toBe('2020-01-01');
	expect(row.validTo).toBeNull();
});

test("switchFiscalProfile closes the previously open profile at the new one's start date — #223's mid-year regime change", async () => {
	const { closed, opened } = await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfiles(tx);
		const first = await switchFiscalProfile(
			{ packId: 'it-flat-rate', packVersion: '1', validFrom: '2020-01-01', validTo: null },
			tx
		);
		const second = await switchFiscalProfile(
			{ packId: 'it-standard', packVersion: '1', validFrom: '2020-07-01', validTo: null },
			tx
		);
		const closedRow = await tx.query.fiscalProfile.findFirst({
			where: eq(fiscalProfile.id, first.id)
		});
		return { closed: closedRow, opened: second };
	});
	expect(closed?.validTo).toBe('2020-07-01');
	expect(opened.packId).toBe('it-standard');
	expect(opened.validTo).toBeNull();
});

test('a profile that already has its own validTo is closed history and is left alone', async () => {
	const { untouched, opened } = await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfiles(tx);
		const [historical] = await tx
			.insert(fiscalProfile)
			.values({ packId: 'a', packVersion: '1', validFrom: '2019-01-01', validTo: '2020-01-01' })
			.returning();
		const opened = await switchFiscalProfile(
			{ packId: 'b', packVersion: '1', validFrom: '2020-01-01', validTo: null },
			tx
		);
		const untouched = await tx.query.fiscalProfile.findFirst({
			where: eq(fiscalProfile.id, historical.id)
		});
		return { untouched, opened };
	});
	expect(untouched?.validTo).toBe('2020-01-01');
	expect(opened.packId).toBe('b');
});

test('getCurrentFiscalProfile returns the one open-ended row after a switch, never a closed one', async () => {
	const current = await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfiles(tx);
		await switchFiscalProfile(
			{ packId: 'a', packVersion: '1', validFrom: '2020-01-01', validTo: null },
			tx
		);
		await switchFiscalProfile(
			{ packId: 'b', packVersion: '1', validFrom: '2020-06-01', validTo: null },
			tx
		);
		return getCurrentFiscalProfile(tx);
	});
	expect(current?.packId).toBe('b');
});

test('getCurrentFiscalProfile is null when every recorded profile is closed', async () => {
	const current = await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfiles(tx);
		await tx
			.insert(fiscalProfile)
			.values({ packId: 'a', packVersion: '1', validFrom: '2020-01-01', validTo: '2020-06-01' });
		return getCurrentFiscalProfile(tx);
	});
	expect(current).toBeUndefined();
});

test('listFiscalProfiles returns every recorded profile, oldest first, regardless of insertion order', async () => {
	const rows = await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfiles(tx);
		await tx.insert(fiscalProfile).values({
			packId: 'later',
			packVersion: '1',
			validFrom: '2020-06-01',
			validTo: null
		});
		await tx.insert(fiscalProfile).values({
			packId: 'earlier',
			packVersion: '1',
			validFrom: '2020-01-01',
			validTo: '2020-06-01'
		});
		return listFiscalProfiles(tx);
	});
	expect(rows.map((row) => row.packId)).toEqual(['earlier', 'later']);
});

test('switchFiscalProfile rejects a period colliding with an already-closed historical profile, and explains why (#223)', async () => {
	const error = await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfiles(tx);
		await tx
			.insert(fiscalProfile)
			.values({ packId: 'a', packVersion: '1', validFrom: '2020-01-01', validTo: '2020-06-01' });
		return rejection(
			() =>
				switchFiscalProfile(
					{ packId: 'b', packVersion: '1', validFrom: '2020-03-01', validTo: null },
					tx
				),
			tx
		);
	});
	expect(error.code).toBe('23P01');
	expect(error.constraint_name).toBe('fiscal_profile_no_overlap');
});
