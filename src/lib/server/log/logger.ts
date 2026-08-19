/**
 * The one logging module (#317) every server module and deploy script goes
 * through. This is a single-host deployment read with `docker logs`, not a
 * service with anything to aggregate logs for — the entire requirement is
 * one JSON object per line, with a timestamp, that `jq` can filter. No
 * dependency, no framework, no transport: `console.log` on a pre-shaped
 * object is the whole implementation. See docs/deploy.md, "Reading the
 * logs", for how an operator queries the output.
 *
 * Every level writes to stdout, `error` and `warn` included: the level is
 * already carried in the JSON, so splitting stdout/stderr by level would
 * only risk `docker logs` interleaving the two streams out of order for no
 * offsetting benefit.
 *
 * `context` is where step 2 of #317 asks every call site to carry whatever
 * makes a line joinable to the run it belongs to — an extraction job id,
 * a mailbox poll run, a route or job name — as a plain field, e.g.
 * `log.info('runner: processing', { jobId })`.
 *
 * Every deploy script under `scripts/` runs under plain `node` (type
 * stripping, no bundler) and therefore cannot resolve the `$lib` alias —
 * see `scripts/migrate.ts`'s existing import of `db/target.ts` for the
 * established pattern. Those scripts import this file the same way, by
 * relative path with an explicit `.ts` extension:
 * `../src/lib/server/log/logger.ts`. Server code under `src/lib/server/**`
 * uses `$lib/server/log/logger` like every other server-only import.
 *
 * Redaction is the other half of #317: `describeDatabaseTarget`
 * (`db/target.ts`) already keeps a connection string's password out of the
 * *string it builds*, by construction — parsing the URL and re-assembling
 * only the safe fields. That guarantee is unaffected by this module and
 * needs no change here. What this module adds is a second, independent
 * safety net for every *other* context value a call site might pass
 * straight through without ever having gone near `describeDatabaseTarget`
 * — a raw connection string, a bearer token, an API key — caught
 * structurally, by what the value looks like, never by the name of the key
 * it arrived under. A context object is free-form; a list of forbidden key
 * names is a list of things the next call site forgets to add to it.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

export interface LogRecord {
	readonly time: string;
	readonly level: LogLevel;
	readonly msg: string;
	readonly context?: Record<string, unknown>;
}

const REDACTED = '[redacted]';

/** RFC 4122 UUID — the shape every run/job id in this codebase already has
 * (`crypto.randomUUID()`, see `runner/queue.ts`). Checked first and
 * excluded from every heuristic below, so the very identifiers step 2 asks
 * every call site to carry are never the thing the redaction pass below
 * removes. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `scheme://user:pass@` embedded anywhere in a string — a connection
 * string is rarely the *entire* value reaching a log call (an error
 * message wraps it in a sentence), so this matches a substring and keeps
 * the scheme, dropping only the credential, the same shape
 * `describeDatabaseTarget` keeps for a `DATABASE_URL` proper. Matched
 * structurally against any scheme, not just `postgres:`/`postgresql:`, so
 * a Redis, MySQL or AMQP URL is caught the same way. */
const EMBEDDED_CREDENTIAL = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/:@]*:[^\s/@]*@/g;

/** A JSON Web Token: three base64url segments joined by `.`, each long
 * enough that this cannot be mistaken for a dotted filename or a version
 * string. */
const JWT = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

/** A single contiguous run of URL-safe base64/hex characters, long and
 * mixed enough (both a letter and a digit present) to read as a bearer
 * token or API key rather than an ordinary word — deliberately biased
 * toward over-redacting an unfamiliar id over under-redacting a real
 * secret. A bare UUID is excluded above; anything containing `.`, `/` or
 * whitespace (a filename, a path, a sentence) never reaches this charset
 * test at all. */
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{24,}$/;

function looksLikeOpaqueToken(word: string): boolean {
	if (UUID.test(word)) return false;
	if (!OPAQUE_TOKEN.test(word)) return false;
	return /[A-Za-z]/.test(word) && /[0-9]/.test(word);
}

/** Redacts one string value: connection-string credentials wherever they
 * appear in it, then, word by word, a `Bearer <token>` header and any
 * standalone JWT or opaque token — so a sentence around a secret survives
 * untouched while the secret itself never does. */
function redactString(value: string): string {
	const withoutCredentials = value.replace(
		EMBEDDED_CREDENTIAL,
		(_match, scheme: string) => `${scheme}${REDACTED}@`
	);
	const words = withoutCredentials.split(/(\s+)/);
	let redactNextWord = false;
	for (let i = 0; i < words.length; i++) {
		if (/^\s*$/.test(words[i])) continue;
		if (redactNextWord) {
			words[i] = REDACTED;
			redactNextWord = false;
			continue;
		}
		if (/^bearer:?$/i.test(words[i])) {
			redactNextWord = true;
			continue;
		}
		if (UUID.test(words[i])) continue;
		if (JWT.test(words[i]) || looksLikeOpaqueToken(words[i])) {
			words[i] = REDACTED;
		}
	}
	return words.join('');
}

/** Walks `value` depth-first, redacting every string leaf. `Error`
 * instances serialise to `{}` under plain `JSON.stringify` (`message` and
 * `stack` are non-enumerable), so they are unpacked into a plain object
 * first — otherwise the single most common context value, the caught
 * error itself, would silently vanish from the line instead of appearing
 * redacted-if-necessary. */
function redactValue(value: unknown, seen: WeakSet<object>): unknown {
	if (typeof value === 'string') return redactString(value);
	if (value === null || typeof value !== 'object') return value;
	if (seen.has(value)) return '[circular]';
	seen.add(value);
	if (value instanceof Date) return value.toISOString();
	if (value instanceof Error) {
		return {
			name: value.name,
			message: redactString(value.message),
			stack: value.stack === undefined ? undefined : redactString(value.stack)
		};
	}
	if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		out[key] = redactValue(entry, seen);
	}
	return out;
}

/**
 * Builds one redacted, JSON-serialisable log record, timestamped `now`.
 * Exported directly (not only through `log.*`) so a test can assert on the
 * redacted shape without capturing stdout.
 */
export function buildLogRecord(
	level: LogLevel,
	msg: string,
	context?: LogContext,
	now: Date = new Date()
): LogRecord {
	const record: LogRecord = { time: now.toISOString(), level, msg };
	if (context === undefined || Object.keys(context).length === 0) return record;
	return { ...record, context: redactValue(context, new WeakSet()) as Record<string, unknown> };
}

function emit(level: LogLevel, msg: string, context?: LogContext): void {
	console.log(JSON.stringify(buildLogRecord(level, msg, context)));
}

/** The logging API every call site in `src/lib/server/**` and
 * `scripts/**` goes through: `log.<level>(message, context?)`. */
export const log = {
	debug: (msg: string, context?: LogContext) => emit('debug', msg, context),
	info: (msg: string, context?: LogContext) => emit('info', msg, context),
	warn: (msg: string, context?: LogContext) => emit('warn', msg, context),
	error: (msg: string, context?: LogContext) => emit('error', msg, context)
};
