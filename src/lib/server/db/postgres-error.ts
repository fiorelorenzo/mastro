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
