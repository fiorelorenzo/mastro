// The database side of #223's fiscal profile UI. `fiscal/profile.ts` reads
// `fiscal_profile` for resolution (which pack applied on a date); this file
// is the write path that used to not exist at all — every profile on every
// instance before #223 was a hand-written `INSERT` (see
// `seed/demo-seed.ts`'s own comment on why it still writes the row
// directly rather than through here: it inserts exactly one row into an
// empty table, nothing this module adds over a plain `db.insert` applies).

import { asc, eq, isNull } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { fiscalProfile } from '$lib/server/db/schema';

export type FiscalProfileInput = {
	readonly packId: string;
	readonly packVersion: string;
	/** Inclusive ISO date. */
	readonly validFrom: string;
	/** Exclusive ISO date; `null` keeps the profile open-ended (the current regime). */
	readonly validTo: string | null;
};

/** Every fiscal profile ever recorded, oldest first — the regime history a
 * settings screen shows, and what `switchFiscalProfile` appends to rather
 * than overwrites. */
export async function listFiscalProfiles(executor: DbExecutor = db) {
	return executor.query.fiscalProfile.findMany({ orderBy: asc(fiscalProfile.validFrom) });
}

/** The one profile still open-ended (`valid_to IS NULL`), if any. At most
 * one exists by construction: `switchFiscalProfile` always closes the
 * previous open profile before opening the next, so a settings screen's
 * "current regime" card reads this directly instead of resolving "today"
 * through the engine — the latter also answers "none" for an instance
 * whose only profile has not started yet, which is not the question this
 * one asks. */
export async function getCurrentFiscalProfile(executor: DbExecutor = db) {
	return executor.query.fiscalProfile.findFirst({ where: isNull(fiscalProfile.validTo) });
}

/**
 * Records a new fiscal profile, closing whichever profile was open-ended
 * before it in the same transaction — this is what "changing regime
 * mid-year" (#223) means at the data level: the outgoing regime's
 * pack-origin ceilings stop applying from `input.validFrom`, the incoming
 * pack's own start applying from the same instant, with no gap and no
 * overlap (AGENTS.md invariant 2: contract-origin ceilings live elsewhere
 * and are untouched by this).
 *
 * A brand-new instance with no profile yet skips the close step and this
 * is a plain insert — #223's "a new self-hoster configures their regime
 * entirely from the interface" acceptance case.
 *
 * Only the open-ended profile is ever touched, and only when it started
 * strictly before `input.validFrom`: a profile that already has its own
 * `validTo` is closed history and is left alone, and backdating
 * `input.validFrom` to on-or-before the open profile's own start is not a
 * "close and replace" this function attempts — the insert is left to
 * collide, and the database's own `fiscal_profile_no_overlap` exclusion
 * constraint rejects it. The caller (the settings route) turns that 23P01
 * into the human-readable message #223 asks for, the same way
 * `rate-card-form.ts` does for `rate_card_no_overlapping_validity`.
 *
 * `tx`, if given, is used directly instead of opening a new transaction —
 * lets a caller (or a test) compose this with other writes atomically.
 */
export async function switchFiscalProfile(input: FiscalProfileInput, tx?: DbExecutor) {
	const run = async (executor: DbExecutor) => {
		const current = await executor.query.fiscalProfile.findFirst({
			where: isNull(fiscalProfile.validTo)
		});
		if (current && current.validFrom < input.validFrom) {
			await executor
				.update(fiscalProfile)
				.set({ validTo: input.validFrom })
				.where(eq(fiscalProfile.id, current.id));
		}
		const [row] = await executor
			.insert(fiscalProfile)
			.values({
				packId: input.packId,
				packVersion: input.packVersion,
				validFrom: input.validFrom,
				validTo: input.validTo
			})
			.returning();
		return row;
	};
	return tx ? run(tx) : db.transaction(run);
}
