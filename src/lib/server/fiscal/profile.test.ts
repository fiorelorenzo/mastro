// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Every test
// works inside a transaction it rolls back (the `set-updated-at.test.ts`
// pattern), so the suite leaves no rows behind.

import { sql } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client, db } from '../db';
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

test('the database rejects two fiscal profiles whose periods overlap', async () => {
	const failure = await db
		.transaction(async (tx) => {
			await tx.insert(fiscalProfile).values({
				packId: 'flat-rate',
				packVersion: '1',
				validFrom: '2023-01-01',
				validTo: '2025-01-01'
			});
			await tx
				.insert(fiscalProfile)
				.values({ packId: 'standard', packVersion: '1', validFrom: '2024-06-01', validTo: null });
			tx.rollback();
		})
		.catch((error: unknown) => error);
	expect(causeMessage(failure)).toMatch(/fiscal_profile_no_overlap/);
});

test('two consecutive profiles with different packs coexist without ambiguity', async () => {
	await expect(
		db.transaction(async (tx) => {
			await tx.insert(fiscalProfile).values({
				packId: 'flat-rate',
				packVersion: '1',
				validFrom: '2023-01-01',
				validTo: '2025-01-01'
			});
			await tx
				.insert(fiscalProfile)
				.values({ packId: 'standard', packVersion: '1', validFrom: '2025-01-01', validTo: null });

			const before = await fetchActiveFiscalProfile(tx, '2024-12-31');
			const after = await fetchActiveFiscalProfile(tx, '2025-01-01');
			expect(before?.packId).toBe('flat-rate');
			expect(after?.packId).toBe('standard');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a query over a period spanning both profiles uses the right pack for each sub-period', async () => {
	await expect(
		db.transaction(async (tx) => {
			await tx.insert(fiscalProfile).values({
				packId: 'flat-rate',
				packVersion: '1',
				validFrom: '2023-01-01',
				validTo: '2025-01-01'
			});
			await tx
				.insert(fiscalProfile)
				.values({ packId: 'standard', packVersion: '1', validFrom: '2025-01-01', validTo: null });

			const rows = await fetchFiscalProfilesInRange(tx, '2024-06-01', '2025-06-01');
			expect(rows.map((r) => r.packId)).toEqual(['flat-rate', 'standard']);

			const resolved = await resolveFiscalPackOverRange(tx, '2024-06-01', '2025-06-01', registry);
			expect(resolved).toHaveLength(2);
			expect(resolved[0]).toMatchObject({ from: '2024-06-01', to: '2025-01-01' });
			expect(resolved[0].pack.id).toBe('flat-rate');
			expect(resolved[1]).toMatchObject({ from: '2025-01-01', to: '2025-06-01' });
			expect(resolved[1].pack.id).toBe('standard');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a profile with no successor resolves the current pack for the active taxpayer', async () => {
	await expect(
		db.transaction(async (tx) => {
			await tx
				.insert(fiscalProfile)
				.values({ packId: 'flat-rate', packVersion: '1', validFrom: '2024-01-01', validTo: null });

			const resolved = await resolveActiveFiscalPack(tx, '2030-01-01', registry);
			expect(resolved?.pack.id).toBe('flat-rate');
			expect(resolved?.to).toBeNull();

			tx.rollback();
		})
	).rejects.toThrow();
});

test('overrides are stored and read back as configuration, not baked into any pack', async () => {
	await expect(
		db.transaction(async (tx) => {
			await tx.insert(fiscalProfile).values({
				packId: 'flat-rate',
				packVersion: '1',
				validFrom: '2024-01-01',
				validTo: null,
				overrides: { profitabilityCoefficient: { activityCode: '62.01.00', rate: 0.67 } }
			});

			const active = await fetchActiveFiscalProfile(tx, '2024-06-01');
			expect(active?.overrides).toEqual({
				profitabilityCoefficient: { activityCode: '62.01.00', rate: 0.67 }
			});

			tx.rollback();
		})
	).rejects.toThrow();
});

test('the valid_range check rejects a profile whose end is not after its start', async () => {
	const failure = await db
		.transaction(async (tx) => {
			await tx.insert(fiscalProfile).values({
				packId: 'flat-rate',
				packVersion: '1',
				validFrom: '2024-01-01',
				validTo: '2024-01-01'
			});
			tx.rollback();
		})
		.catch((error: unknown) => error);
	expect(causeMessage(failure)).toMatch(/fiscal_profile_valid_range/);
});

test('updating a fiscal profile refreshes updated_at, same as every other table', async () => {
	await expect(
		db.transaction(async (tx) => {
			const oldTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000);
			const [inserted] = await tx
				.insert(fiscalProfile)
				.values({
					packId: 'flat-rate',
					packVersion: '1',
					validFrom: '2024-01-01',
					validTo: null,
					updatedAt: oldTimestamp
				})
				.returning();
			expect(inserted.updatedAt.getTime()).toBe(oldTimestamp.getTime());

			await tx
				.update(fiscalProfile)
				.set({ validFrom: '2024-01-01' })
				.where(sql`id = ${inserted.id}`);

			const [updated] = await tx
				.select()
				.from(fiscalProfile)
				.where(sql`id = ${inserted.id}`);
			expect(updated.updatedAt.getTime()).toBeGreaterThan(oldTimestamp.getTime());

			tx.rollback();
		})
	).rejects.toThrow();
});
