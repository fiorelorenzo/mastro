// The one bearer-token check every cron-triggered route needs
// (`/api/alerts/run/[job]`, `/api/agent/run`, `/api/mail/poll` — see each
// route's own comment for why they are public on `route-guard.ts`'s list
// instead of sitting behind a session: the caller is cron, with no
// browser to hold one).
//
// #304: this used to be three copies of the same function, each
// comparing `expected.length === given.length && timingSafeEqual(...)`.
// `timingSafeEqual` throws on a length mismatch, so the length check had
// to run first — which made it a timing oracle of its own: an
// unauthenticated caller learns the token's length (which lengths reach
// the slow path) before a single byte is ever compared in constant time.
// Hashing both sides to a fixed-width SHA-256 digest first removes the
// length check entirely; `timingSafeEqual` always compares two 32-byte
// buffers, whatever the presented token's length.
//
// The other half of #304: an unset token variable (misconfiguration) and
// a wrong or missing token (an untrusted caller) used to answer
// differently — 503 naming the unset variable, 401 otherwise — which
// told an unauthenticated caller which cron variables this instance has
// configured. `authorizeCronRequest` throws the identical bare 401 for
// both and logs the misconfiguration server-side instead, where the
// operator can see it and a caller cannot.
import { createHash, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { log } from '$lib/server/log/logger';

/**
 * Authorizes a cron-triggered request against one bearer token read from
 * `varName`. Throws SvelteKit's `error(401)` — no body naming `varName`
 * or anything else — when the token is unset, missing or wrong; returns
 * normally when it matches. Never call this in a request handler and
 * catch the result: like every other use of `error()` in this codebase,
 * it is meant to propagate.
 */
export function authorizeCronRequest(
	request: Request,
	expected: string | undefined,
	varName: string
): void {
	const token = (expected ?? '').trim();
	if (!token) {
		log.error('authorizeCronRequest: cron token is not set on this instance', { varName });
	}

	const header = request.headers.get('authorization') ?? '';
	const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

	const expectedDigest = createHash('sha256').update(token).digest();
	const presentedDigest = createHash('sha256').update(presented).digest();
	const digestsMatch = timingSafeEqual(expectedDigest, presentedDigest);

	if (!token || !digestsMatch) {
		error(401);
	}
}
