// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Every test
// works inside a transaction it rolls back (`inRolledBackTransaction`).

import { afterAll, expect, test } from 'vitest';
import { rejection } from '$lib/server/db/pg-error';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, type DbExecutor } from '$lib/server/db';
import { practiceProfile } from '$lib/server/db/schema';
import { getPracticeProfile, savePracticeProfile } from './practice-profile';

afterAll(async () => {
	await pool.end();
});

const input = {
	legalName: 'Vera Marchetti',
	taxId: 'MRCVRA80A01H501Z',
	vatId: 'IT01234567890',
	country: 'IT',
	addressLine1: 'Via Garibaldi 12',
	addressLine2: null,
	addressCity: 'Bologna',
	addressPostalCode: '40100',
	addressRegion: 'BO'
};

/** `practice_profile` is a singleton this suite does not own on a database
 * another agent or a manual verification pass may have already filled in
 * — clearing it inside the test's own rolled-back transaction is the same
 * discipline `fiscal-profile.test.ts`'s `makeRoomForOwnProfiles` uses for
 * `fiscal_profile`, undone the moment the transaction rolls back. */
async function makeRoomForOwnProfile(tx: DbExecutor) {
	await tx.delete(practiceProfile);
}

test('getPracticeProfile returns undefined on a fresh instance with no row yet', async () => {
	const profile = await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfile(tx);
		return getPracticeProfile(tx);
	});
	expect(profile).toBeUndefined();
});

test('savePracticeProfile inserts the first row on an empty table', async () => {
	const row = await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfile(tx);
		return savePracticeProfile(input, tx);
	});
	expect(row.legalName).toBe('Vera Marchetti');
	expect(row.taxId).toBe('MRCVRA80A01H501Z');
	expect(row.vatId).toBe('IT01234567890');
	expect(row.addressLine2).toBeNull();
});

test('savePracticeProfile edits the existing row in place rather than inserting a second one', async () => {
	const { first, second, read } = await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfile(tx);
		const firstRow = await savePracticeProfile(input, tx);
		const secondRow = await savePracticeProfile(
			{ ...input, legalName: 'Vera Marchetti Consulenza' },
			tx
		);
		const readBack = await getPracticeProfile(tx);
		return { first: firstRow, second: secondRow, read: readBack };
	});
	expect(second.id).toBe(first.id);
	expect(read?.legalName).toBe('Vera Marchetti Consulenza');
});

test('the database rejects a second row even bypassing the repository (practice_profile_singleton_unique)', async () => {
	const error = await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfile(tx);
		await tx.insert(practiceProfile).values(input);
		return rejection(() => tx.insert(practiceProfile).values(input), tx);
	});
	expect(error.code).toBe('23505');
	expect(error.constraint_name).toBe('practice_profile_singleton_unique');
});

test('the database rejects singleton = false directly (practice_profile_singleton_true)', async () => {
	const error = await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfile(tx);
		return rejection(() => tx.insert(practiceProfile).values({ ...input, singleton: false }), tx);
	});
	expect(error.code).toBe('23514');
	expect(error.constraint_name).toBe('practice_profile_singleton_true');
});
