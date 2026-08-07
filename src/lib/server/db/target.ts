/**
 * Describing which database a command is about to touch, safely.
 *
 * Node's `--env-file` family never overrides a variable that is already set
 * in the environment, so an ambient `DATABASE_URL` inherited from a parent
 * process silently wins over the one in the `.env` next to the code. With
 * one database per worktree that is how migrations end up applied to, and
 * fixtures written into, somebody else's database. The defence is not to
 * fight Node's precedence, it is to make every command say out loud which
 * database it resolved.
 *
 * Neither function here ever returns the connection URL itself: a URL
 * carries the password, and these strings are written to logs.
 */

/** What an unusable `DATABASE_URL` describes as. Deliberately opaque: such a
 * value may still contain a password, so it can never be echoed back. */
const UNRECOGNISED = '(unrecognised DATABASE_URL)';

/**
 * `user@host:port/database` for a Postgres connection URL, without the
 * password. The port falls back to Postgres' default when the URL omits it,
 * so two URLs that reach the same server read the same way.
 *
 * Anything that is not a Postgres URL describes as `(unrecognised
 * DATABASE_URL)` rather than as itself. The scheme check is not pedantry:
 * `mastro:hunter2@localhost`, a URL missing its scheme, parses happily as a
 * URL whose protocol is `mastro:` and whose path is `hunter2@localhost`, so
 * describing it field by field would print the password.
 */
export function describeDatabaseTarget(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return UNRECOGNISED;
	}
	if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return UNRECOGNISED;
	const user = parsed.username === '' ? '(no user)' : decodeURIComponent(parsed.username);
	// An empty hostname means a unix socket, which carries its directory in
	// the `host` parameter instead.
	const host =
		parsed.hostname === '' ? (parsed.searchParams.get('host') ?? '(no host)') : parsed.hostname;
	const port = parsed.port === '' ? '5432' : parsed.port;
	const database = parsed.pathname.replace(/^\//, '');
	return `${user}@${host}:${port}/${database === '' ? '(no database)' : database}`;
}

/**
 * A warning when the environment and the `.env` file point at different
 * databases, or `null` when they agree or when either is missing.
 *
 * The comparison is on the described target rather than on the raw URLs, so
 * two URLs differing only by password produce no warning: they reach the
 * same database, which is what this guards, and a warning naming the same
 * target twice would read as a bug.
 *
 * The caller proceeds after warning. The environment winning is Node's
 * documented behaviour and scripted callers depend on it; the defect being
 * addressed is that it used to happen in silence.
 */
export function describeTargetMismatch(
	fromEnvironment: string | undefined,
	fromEnvFile: string | undefined
): string | null {
	if (fromEnvironment === undefined || fromEnvFile === undefined) return null;
	const environmentTarget = describeDatabaseTarget(fromEnvironment);
	const fileTarget = describeDatabaseTarget(fromEnvFile);
	if (environmentTarget === fileTarget) return null;
	return (
		'DATABASE_URL was already set in the environment, so it overrides .env: ' +
		`using ${environmentTarget}, not ${fileTarget}. ` +
		'Unset it, or pass the one you meant explicitly, if that is not what you want.'
	);
}
