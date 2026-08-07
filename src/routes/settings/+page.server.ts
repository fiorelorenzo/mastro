// The Settings destination the nav points at (#146): the one page where
// the fiscal profile, the interface language and the alert preferences
// live, since all three are things a self-hoster sets once and forgets.
import { db } from '$lib/server/db';
import { resolveActiveFiscalPack } from '$lib/server/fiscal/profile';
import type { PageServerLoad } from './$types';

/**
 * The fiscal pack in force today, read-only here (configuring it is not
 * built yet — task #146 only has to stop `/settings` pointing at a 404).
 * `null` on a fresh instance, which has no `fiscal_profile` row: the
 * common case for a self-hoster who has not run the setup step yet, not
 * an error state.
 */
export const load: PageServerLoad = async () => {
	const today = new Date().toISOString().slice(0, 10);
	const active = await resolveActiveFiscalPack(db, today);
	return {
		fiscalProfile: active
			? { displayName: active.pack.displayName, validFrom: active.profile.validFrom }
			: null
	};
};
