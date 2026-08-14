// The Settings destination the nav points at (#146): the one page where
// the fiscal profile, the interface language and the alert preferences
// live, since all three are things a self-hoster sets once and forgets.
import { db } from '$lib/server/db';
import { resolveActiveFiscalPack } from '$lib/server/fiscal/profile';
import type { PageServerLoad } from './$types';

/**
 * The fiscal pack in force today — a summary card only; the read/write
 * screen (#223) lives at `/settings/fiscal`, reached through this page's
 * own `settings_fiscal_manage_link`. `null` on a fresh instance, which
 * has no `fiscal_profile` row: the common case for a self-hoster who has
 * not run the setup step yet, not an error state.
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
