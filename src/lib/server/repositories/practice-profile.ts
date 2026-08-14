// The database side of #258's practice profile UI: the issuer block a
// generated invoice needs on the practice's own side (legal name, tax id,
// VAT id, registered address), symmetric to `client`'s identity on the
// counterparty side.

import { eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { practiceProfile } from '$lib/server/db/schema';

export type PracticeProfileInput = {
	readonly legalName: string;
	readonly taxId: string;
	readonly vatId: string | null;
	readonly country: string;
	readonly addressLine1: string;
	readonly addressLine2: string | null;
	readonly addressCity: string;
	readonly addressPostalCode: string;
	readonly addressRegion: string | null;
};

/**
 * The one `practice_profile` row, or `undefined` on a fresh instance where
 * the self-hoster has not filled it in yet. Deliberately not "or a default
 * placeholder identity": every caller — the settings screen today, an
 * invoice generator later (#260) — is expected to branch on `undefined`
 * and show it, not paper over it with an empty-string issuer block a
 * generated document would silently ship.
 */
export async function getPracticeProfile(executor: DbExecutor = db) {
	return executor.query.practiceProfile.findFirst();
}

/**
 * Creates the row on a fresh instance, or edits the existing one in place
 * — the row IS the practice's current identity, not a history, so there is
 * no equivalent of `fiscal_profile`'s close-and-append. The singleton is
 * still enforced at the database level (`practice_profile_singleton_true`
 * + `practice_profile_singleton_unique`, migration 0049): a second insert
 * racing this read collides on `singleton` rather than silently succeeding
 * and leaving two rows for `getPracticeProfile` to pick between.
 *
 * `tx`, if given, is used directly instead of opening a new transaction —
 * lets a caller compose this with other writes atomically.
 */
export async function savePracticeProfile(input: PracticeProfileInput, tx?: DbExecutor) {
	const run = async (executor: DbExecutor) => {
		const current = await executor.query.practiceProfile.findFirst();
		if (current) {
			const [row] = await executor
				.update(practiceProfile)
				.set(input)
				.where(eq(practiceProfile.id, current.id))
				.returning();
			return row;
		}
		const [row] = await executor.insert(practiceProfile).values(input).returning();
		return row;
	};
	return tx ? run(tx) : db.transaction(run);
}
