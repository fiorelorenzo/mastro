// The account holder's own tax id (#45), read from configuration and never
// guessed — see `direction.ts` for what it is compared against. Kept as a
// pure, independently testable parse (mirroring `auth/allowlist.ts`) next
// to the one line that actually reads the environment, mirroring
// `auth/index.ts`.

import { env } from '$env/dynamic/private';
import type { DbExecutor } from '$lib/server/db';
import { getPracticeProfile } from '$lib/server/repositories/practice-profile';

/**
 * Validates the raw `ACCOUNT_HOLDER_TAX_ID` value. Throws rather than
 * falling back to a guess: an unset or blank value means direction
 * detection cannot tell an outgoing invoice from an incoming one, and
 * silently treating every file in a folder as revenue is the exact defect
 * #45 exists to prevent.
 */
export function readAccountHolderTaxId(raw: string | undefined | null): string {
	const trimmed = (raw ?? '').trim();
	if (!trimmed) {
		throw new Error(
			'No account-holder tax id: set it on the practice profile (/settings/practice), or as ACCOUNT_HOLDER_TAX_ID. Direction detection needs it to tell an outgoing invoice from an incoming one.'
		);
	}
	return trimmed;
}

/**
 * The account holder's tax id, read when an import actually needs it.
 *
 * Deliberately a function rather than a module-level constant (#133): a
 * constant runs its throw at import time, and SvelteKit's postbuild
 * analysis imports every server module, so an unset value failed the whole
 * build rather than the one feature that needs it. It also meant an
 * instance that never imports an invoice could not boot. The refusal to
 * guess is unchanged, it just happens where the guess would have been
 * made.
 *
 * The practice profile comes first, and the environment variable second.
 * Since #258 the practitioner's own fiscal identity is a row a human fills
 * in from `/settings/practice`, which makes `ACCOUNT_HOLDER_TAX_ID` a
 * second source of truth for one fact — and the kind that goes wrong
 * quietly, because the two can disagree and only one of them is on screen.
 * The variable stays supported for instances configured before that row
 * existed, and for a deployment that would rather keep it in the
 * environment.
 */
export async function resolveAccountHolderTaxId(executor?: DbExecutor): Promise<string | null> {
	const profile = await getPracticeProfile(executor);
	const fromProfile = (profile?.taxId ?? '').trim();
	if (fromProfile) return fromProfile;
	const fromEnv = (env.ACCOUNT_HOLDER_TAX_ID ?? '').trim();
	return fromEnv || null;
}

/** As above, but throwing the way `readAccountHolderTaxId` does — for the
 * callers that have already checked and want the value. */
export async function getAccountHolderTaxId(executor?: DbExecutor): Promise<string> {
	return readAccountHolderTaxId(await resolveAccountHolderTaxId(executor));
}
