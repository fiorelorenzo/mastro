/**
 * Whether `error` is a Postgres error with the given SQLSTATE `code` and
 * constraint name, e.g. a unique or exclusion violation a route wants to
 * turn into a friendly form error instead of a 500.
 *
 * drizzle-orm's postgres-js driver always wraps the underlying `postgres`
 * package error in a `DrizzleQueryError`; the real error — the one carrying
 * `code` and `constraint_name` — lands on `.cause`, not on the wrapper
 * itself. Checking `error.code` directly, without unwrapping, never
 * matches.
 */
export function isPostgresConstraintViolation(
	error: unknown,
	code: string,
	constraintName: string
): boolean {
	const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
	return (
		typeof cause === 'object' &&
		cause !== null &&
		'code' in cause &&
		cause.code === code &&
		'constraint_name' in cause &&
		cause.constraint_name === constraintName
	);
}

/**
 * Whether `error` came from Postgres at all, whatever it was about.
 *
 * For deciding whether "the database rejected this" is a true thing to
 * tell somebody. The proposals screens used to prepend that sentence to
 * every failed decision, including ones the database never saw: accepting
 * a proposal whose source message had no `inbound_thread` row failed in
 * application code, and the screen blamed the database and printed a raw
 * English message with a document UUID in it.
 *
 * Same unwrapping as above, and for the same reason: drizzle-orm wraps the
 * driver's error, and the SQLSTATE `code` is on `.cause`.
 */
export function isPostgresError(error: unknown): boolean {
	const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
	if (typeof cause !== 'object' || cause === null) return false;
	if (!('code' in cause) || !('severity' in cause)) return false;
	// `in` narrows the property to `unknown`, so this is a checked read
	// rather than an asserted shape: every Postgres error carries a
	// SQLSTATE string, and nothing else in this app throws one alongside a
	// `severity`.
	return typeof cause.code === 'string';
}
