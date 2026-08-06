// The database side of resolution (#31): fetches `fiscal_profile` rows and
// hands them to the pure functions in `resolve.ts`. Accepts either the pool
// (`db`) or an open transaction, so tests can resolve inside the
// transaction they are about to roll back.

import { and, asc, gt, isNull, lt, lte, or } from 'drizzle-orm';
import { db } from '../db';
import { fiscalProfile } from '../db/schema/fiscal';
import { defaultRegistry, type PackRegistry } from './registry';
import { resolvePackAt, resolvePackOverRange, type ResolvedFiscalPeriod } from './resolve';

export type FiscalDatabase = Pick<typeof db, 'select'>;
export type FiscalProfileRow = typeof fiscalProfile.$inferSelect;

/** The profile active on `date`, or `null` if none covers it. */
export async function fetchActiveFiscalProfile(
	database: FiscalDatabase,
	date: string
): Promise<FiscalProfileRow | null> {
	const rows = await database
		.select()
		.from(fiscalProfile)
		.where(
			and(
				lte(fiscalProfile.validFrom, date),
				or(isNull(fiscalProfile.validTo), gt(fiscalProfile.validTo, date))
			)
		);
	if (rows.length > 1) {
		throw new Error(`${rows.length} fiscal profiles are active on ${date}, expected at most one`);
	}
	return rows[0] ?? null;
}

/** Every profile overlapping `[from, to)`, ordered by `valid_from`. */
export async function fetchFiscalProfilesInRange(
	database: FiscalDatabase,
	from: string,
	to: string
): Promise<FiscalProfileRow[]> {
	return database
		.select()
		.from(fiscalProfile)
		.where(
			and(
				lt(fiscalProfile.validFrom, to),
				or(isNull(fiscalProfile.validTo), gt(fiscalProfile.validTo, from))
			)
		)
		.orderBy(asc(fiscalProfile.validFrom));
}

/** The pack in force on `date`, resolved against the fiscal profile on
 * record and `registry` (every pack mastro ships, by default). */
export async function resolveActiveFiscalPack(
	database: FiscalDatabase,
	date: string,
	registry: PackRegistry = defaultRegistry
): Promise<ResolvedFiscalPeriod<FiscalProfileRow> | null> {
	const profile = await fetchActiveFiscalProfile(database, date);
	if (!profile) return null;
	return resolvePackAt(registry, [profile], date);
}

/** The packs in force over `[from, to)`, one entry per sub-period, correct
 * across a regime change that falls inside the range. */
export async function resolveFiscalPackOverRange(
	database: FiscalDatabase,
	from: string,
	to: string,
	registry: PackRegistry = defaultRegistry
): Promise<readonly ResolvedFiscalPeriod<FiscalProfileRow>[]> {
	const profiles = await fetchFiscalProfilesInRange(database, from, to);
	return resolvePackOverRange(registry, profiles, from, to);
}
