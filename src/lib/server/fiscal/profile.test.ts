// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Every test
// works inside a transaction it rolls back (the `set-updated-at.test.ts`
// pattern), so the suite leaves no rows behind.

import { sql } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client, db, type DbExecutor } from '../db';
import { fiscalProfile } from '../db/schema/fiscal';
import { buildRegistry } from './registry';
import type { FiscalPack } from './pack';
import {
	fetchActiveFiscalProfile,
	fetchFiscalProfilesInRange,
	resolveActiveFiscalPack,
	resolveFiscalPackOverRange
} from './profile';

/**
 * Drizzle wraps every failed query in an error whose own `.message` is just
 * "Failed query: ..."; the Postgres error that actually names the
 * constraint that fired is on `.cause`. Read here rather than duplicating
 * this unwrap at each call site.
 */
function causeMessage(error: unknown): string {
	return error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
}

afterAll(async () => {
	await client.end();
});

function pack(id: string, version: string): FiscalPack {
	return {
		id,
		version,
		effectiveFrom: '2000-01-01',
		displayName: { en: id, it: id },
		basis: 'accrual',
		fiscalYear: { startMonth: 1, startDay: 1 },
		ceilings: [],
		treatments: [],
		charges: [],
		formats: [],
		unresolvedRevenue: 'carries_forward'
	};
}

const registry = buildRegistry([pack('flat-rate', '1'), pack('standard', '1')]);

// `fiscal_profile` carries a database-wide EXCLUDE constraint on the
// validity period, and a database this suite runs against may already
// carry a real, currently-open regime (`valid_to` null) — a demo seed's
// "the regime in force today has no known end" row, exactly the shape
// `resolveActiveFiscalPack` is for. A bounded test fixture dated well
// before any realistic regime's start (every date below sits in
// 1900–1905) never collides with that row, whatever it is — but a test
// that needs an open-ended row of its own cannot simply pick an earlier
// start date: two open-ended ranges always overlap each other regardless
// of where either one starts, since both extend to infinity, and there is
// no valid `valid_to` that closes a row starting in 2024 or later to
// something before 1900 (`valid_to` must stay after `valid_from`). Such a
// test clears the table first instead — `makeRoomForOwnProfiles` — taking
// exclusive, temporary ownership of the whole timeline inside its own
// rolled-back transaction, the same "set up the singleton row it needs
// inside its own rolled-back transaction" #225 asks for, just for every
// row rather than one. Nothing outside this test ever sees it: the delete
// is undone the moment the transaction rolls back.
async function makeRoomForOwnProfiles(tx: DbExecutor) {
	await tx.delete(fiscalProfile);
}
test('the database rejects two fiscal profiles whose periods overlap', async () => {
	const failure = await db
		.transaction(async (tx) => {
			await tx.insert(fiscalProfile).values({
				packId: 'flat-rate',
				packVersion: '1',
				validFrom: '1900-01-01',
				validTo: '1902-01-01'
			});
			await tx
				.insert(fiscalProfile)
				.values({ packId: 'standard', packVersion: '1', validFrom: '1901-06-01', validTo: null });
			tx.rollback();
		})
		.catch((error: unknown) => error);
	expect(causeMessage(failure)).toMatch(/fiscal_profile_no_overlap/);
});

test('two consecutive profiles with different packs coexist without ambiguity', async () => {
	await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfiles(tx);
		await tx.insert(fiscalProfile).values({
			packId: 'flat-rate',
			packVersion: '1',
			validFrom: '1900-01-01',
			validTo: '1902-01-01'
		});
		await tx
			.insert(fiscalProfile)
			.values({ packId: 'standard', packVersion: '1', validFrom: '1902-01-01', validTo: null });

		const before = await fetchActiveFiscalProfile(tx, '1901-12-31');
		const after = await fetchActiveFiscalProfile(tx, '1902-01-01');
		expect(before?.packId).toBe('flat-rate');
		expect(after?.packId).toBe('standard');
	});
});

test('a query over a period spanning both profiles uses the right pack for each sub-period', async () => {
	await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfiles(tx);
		await tx.insert(fiscalProfile).values({
			packId: 'flat-rate',
			packVersion: '1',
			validFrom: '1900-01-01',
			validTo: '1902-01-01'
		});
		await tx
			.insert(fiscalProfile)
			.values({ packId: 'standard', packVersion: '1', validFrom: '1902-01-01', validTo: null });

		const rows = await fetchFiscalProfilesInRange(tx, '1901-06-01', '1902-06-01');
		expect(rows.map((r) => r.packId)).toEqual(['flat-rate', 'standard']);

		const resolved = await resolveFiscalPackOverRange(tx, '1901-06-01', '1902-06-01', registry);
		expect(resolved).toHaveLength(2);
		expect(resolved[0]).toMatchObject({ from: '1901-06-01', to: '1902-01-01' });
		expect(resolved[0].pack.id).toBe('flat-rate');
		expect(resolved[1]).toMatchObject({ from: '1902-01-01', to: '1902-06-01' });
		expect(resolved[1].pack.id).toBe('standard');
	});
});

test('a profile with no successor resolves the current pack for the active taxpayer', async () => {
	await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfiles(tx);
		await tx
			.insert(fiscalProfile)
			.values({ packId: 'flat-rate', packVersion: '1', validFrom: '1901-01-01', validTo: null });

		const resolved = await resolveActiveFiscalPack(tx, '1905-01-01', registry);
		expect(resolved?.pack.id).toBe('flat-rate');
		expect(resolved?.to).toBeNull();
	});
});

test('overrides are stored and read back as configuration, not baked into any pack', async () => {
	await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfiles(tx);
		await tx.insert(fiscalProfile).values({
			packId: 'flat-rate',
			packVersion: '1',
			validFrom: '1901-01-01',
			validTo: null,
			overrides: { profitabilityCoefficient: { activityCode: '62.01.00', rate: 0.67 } }
		});

		const active = await fetchActiveFiscalProfile(tx, '1901-06-01');
		expect(active?.overrides).toEqual({
			profitabilityCoefficient: { activityCode: '62.01.00', rate: 0.67 }
		});
	});
});

test('the valid_range check rejects a profile whose end is not after its start', async () => {
	const failure = await db
		.transaction(async (tx) => {
			await tx.insert(fiscalProfile).values({
				packId: 'flat-rate',
				packVersion: '1',
				validFrom: '1901-01-01',
				validTo: '1901-01-01'
			});
			tx.rollback();
		})
		.catch((error: unknown) => error);
	expect(causeMessage(failure)).toMatch(/fiscal_profile_valid_range/);
});

test('updating a fiscal profile refreshes updated_at, same as every other table', async () => {
	await inRolledBackTransaction(async (tx) => {
		await makeRoomForOwnProfiles(tx);
		const oldTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000);
		const [inserted] = await tx
			.insert(fiscalProfile)
			.values({
				packId: 'flat-rate',
				packVersion: '1',
				validFrom: '1901-01-01',
				validTo: null,
				updatedAt: oldTimestamp
			})
			.returning();
		expect(inserted.updatedAt.getTime()).toBe(oldTimestamp.getTime());

		await tx
			.update(fiscalProfile)
			.set({ validFrom: '1901-01-01' })
			.where(sql`id = ${inserted.id}`);

		const [updated] = await tx
			.select()
			.from(fiscalProfile)
			.where(sql`id = ${inserted.id}`);
		expect(updated.updatedAt.getTime()).toBeGreaterThan(oldTimestamp.getTime());
	});
});
