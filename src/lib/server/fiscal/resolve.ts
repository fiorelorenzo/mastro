// Resolution: given a date (or a range) and the fiscal profiles on record,
// which pack applied. Pure and database-agnostic — `profile.ts` is the only
// caller that touches Postgres, so this stays unit-testable without one.

import type { FiscalPack } from './pack';
import { lookupPack, type PackRegistry } from './registry';

/** The columns resolution needs from a `fiscal_profile` row. Generic over
 * the row type so a caller can pass the full Drizzle row and get it back
 * attached to the result, overrides included. */
export interface FiscalProfilePeriod {
	readonly packId: string;
	readonly packVersion: string;
	/** ISO date, inclusive. */
	readonly validFrom: string;
	/** ISO date, exclusive; `null` means still current. */
	readonly validTo: string | null;
}

export interface ResolvedFiscalPeriod<P extends FiscalProfilePeriod = FiscalProfilePeriod> {
	readonly profile: P;
	readonly pack: FiscalPack;
	/** The resolved sub-period, clipped to the query. */
	readonly from: string;
	readonly to: string | null;
}

function isActiveOn(period: FiscalProfilePeriod, date: string): boolean {
	return period.validFrom <= date && (period.validTo === null || date < period.validTo);
}

function overlapsRange(period: FiscalProfilePeriod, from: string, to: string): boolean {
	return period.validFrom < to && (period.validTo === null || period.validTo > from);
}

/**
 * The pack in force on `date`, or `null` if no profile covers it. Throws if
 * more than one profile is active on `date`: the exclusion constraint on
 * `fiscal_profile` (see the migration) should make that impossible, so
 * seeing it here means that constraint was bypassed, not that the caller
 * should silently pick one.
 */
export function resolvePackAt<P extends FiscalProfilePeriod>(
	registry: PackRegistry,
	profiles: readonly P[],
	date: string
): ResolvedFiscalPeriod<P> | null {
	const active = profiles.filter((profile) => isActiveOn(profile, date));
	if (active.length === 0) return null;
	if (active.length > 1) {
		throw new Error(`${active.length} fiscal profiles are active on ${date}, expected at most one`);
	}
	const profile = active[0];
	return {
		profile,
		pack: lookupPack(registry, profile.packId, profile.packVersion),
		from: profile.validFrom,
		to: profile.validTo
	};
}

/**
 * The packs in force from `from` (inclusive) to `to` (exclusive), one entry
 * per sub-period, ordered by start date and clipped to `[from, to)`. A
 * range spanning a regime change comes back as more than one entry, each
 * carrying the pack that actually applied to its slice.
 */
export function resolvePackOverRange<P extends FiscalProfilePeriod>(
	registry: PackRegistry,
	profiles: readonly P[],
	from: string,
	to: string
): readonly ResolvedFiscalPeriod<P>[] {
	if (from >= to) throw new Error(`invalid range: from (${from}) must be before to (${to})`);
	return profiles
		.filter((profile) => overlapsRange(profile, from, to))
		.toSorted((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0))
		.map((profile) => ({
			profile,
			pack: lookupPack(registry, profile.packId, profile.packVersion),
			from: profile.validFrom > from ? profile.validFrom : from,
			to: profile.validTo !== null && profile.validTo < to ? profile.validTo : to
		}));
}
