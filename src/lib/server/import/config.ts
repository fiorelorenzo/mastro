// The account holder's own tax id (#45), read from configuration and never
// guessed — see `direction.ts` for what it is compared against. Kept as a
// pure, independently testable parse (mirroring `auth/allowlist.ts`) next
// to the one line that actually reads the environment, mirroring
// `auth/index.ts`.

import { env } from '$env/dynamic/private';

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
			'ACCOUNT_HOLDER_TAX_ID is not set. Direction detection needs it to tell an outgoing invoice from an incoming one.'
		);
	}
	return trimmed;
}

/** The account holder's tax id, read once at module load. */
export const accountHolderTaxId = readAccountHolderTaxId(env.ACCOUNT_HOLDER_TAX_ID);
