// The mandatory email allowlist (#53). Kept as pure functions, separate from
// env wiring, so it is trivial to test: an empty or unset list admits
// nobody, never everybody, and the check never reveals whether an address
// exists anywhere else.

/** Parses a comma-separated list of addresses into a lowercase set. */
export function parseAllowlist(raw: string | undefined | null): ReadonlySet<string> {
	return new Set(
		(raw ?? '')
			.split(',')
			.map((email) => email.trim().toLowerCase())
			.filter((email) => email.length > 0)
	);
}

/** Whether `email` may sign in. An empty allowlist admits nobody. */
export function isAllowedEmail(email: string, allowlist: ReadonlySet<string>): boolean {
	return allowlist.has(email.trim().toLowerCase());
}

/**
 * The message shown for a rejected sign-in. Constant regardless of why the
 * address was rejected, so it never discloses whether an account exists.
 */
export const ALLOWLIST_REJECTION_MESSAGE =
	'This Google account is not permitted to sign in to this instance.';
