// Deny-by-default access control (#54). A route is protected unless its id
// is on route-guard.ts's short public list, so a route added later without
// updating this file stays protected; that is the point.
import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { auth, defaultAllowlist } from '$lib/server/auth';
import { isAllowedEmail } from '$lib/server/auth/allowlist';
import { CSP_DIRECTIVES, formatCspHeader } from '$lib/server/security/csp';
import { isEndpointRoute, isPublicRoute } from '$lib/server/route-guard';

// `kit.csp` (vite.config.ts) only ever sets a `Content-Security-Policy`
// header on a rendered HTML page — never on a `+server.ts` endpoint, which
// has no inline script/style for a nonce to protect. Computed once, at
// module load, and reused for every response this handle sees that does
// not already carry one.
const STATIC_CSP_HEADER = formatCspHeader(CSP_DIRECTIVES);

/**
 * Adds the two headers every response needs regardless of route (#303):
 * `X-Content-Type-Options: nosniff`, so a browser never second-guesses a
 * response's declared `Content-Type` (the exact behaviour that made
 * serving an uploaded `text/html` document dangerous in the first place),
 * and a `Content-Security-Policy` for whatever `kit.csp` did not already
 * add one for. Placed first in `sequence` below so it wraps every other
 * handle: any response `handleAuth` or the real render pipeline returns
 * passes back through here before reaching the client.
 */
export const handleSecurityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('x-content-type-options', 'nosniff');
	if (!response.headers.has('content-security-policy')) {
		response.headers.set('content-security-policy', STATIC_CSP_HEADER);
	}
	return response;
};

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', locale)
					.replace('%paraglide.dir%', getTextDirection(locale))
		});
	});

/**
 * Builds the auth guard `Handle`. Exported, with `authInstance`/`allowlist`
 * overrides, so tests can exercise the real revoke-on-reject behaviour
 * against a real Better Auth instance and an explicit allowlist — the same
 * way `auth/index.ts`'s `createAuth` is tested — without mutating
 * `AUTH_ALLOWED_EMAILS` ($env/dynamic/private snapshots it at startup and
 * would not observe that anyway). Production calls this with no arguments.
 */
export function createHandleAuth(
	authInstance: Pick<typeof auth, 'api'> = auth,
	allowlist: ReadonlySet<string> = defaultAllowlist
): Handle {
	return async ({ event, resolve }) => {
		if (isPublicRoute(event.route.id)) {
			return resolve(event);
		}

		let sessionData = await authInstance.api.getSession({ headers: event.request.headers });

		// Better Auth's allowlist hooks (databaseHooks in auth/index.ts) only
		// run when a user or session row is first *created*: refreshing an
		// existing session extends its expiry in place instead of inserting a
		// new row, so neither hook fires again on refresh. Re-checking here,
		// on every request that reaches a real session, is what makes removing
		// an address — or emptying AUTH_ALLOWED_EMAILS entirely — actually take
		// effect for someone already signed in, not just for new sign-ins
		// (#299, invariant 6: an empty allowlist means nobody gets in, never
		// everybody).
		if (sessionData && !isAllowedEmail(sessionData.user.email, allowlist)) {
			// Revoke server-side, not just for this request: an unrevoked
			// session row would let this exact cookie pass again on the very
			// next request, which is indistinguishable from never having
			// checked at all.
			await authInstance.api.signOut({ headers: event.request.headers });
			sessionData = null;
		}

		event.locals.session = sessionData?.session ?? null;
		event.locals.user = sessionData?.user ?? null;

		if (sessionData) {
			return resolve(event);
		}

		// A rejected-for-allowlist session and an outright missing one take
		// this identical path with no further branching, so the two are not
		// distinguishable from the response: neither discloses whether the
		// account exists or ever had access (allowlist.ts, #53).
		if (isEndpointRoute(event.route.id)) {
			return new Response(null, { status: 401 });
		}

		redirect(
			303,
			`/sign-in?callbackURL=${encodeURIComponent(event.url.pathname + event.url.search)}`
		);
	};
}

const handleAuth = createHandleAuth();

// Security headers first, so they wrap every other handle's return value —
// including the bare 401 the guard returns for a rejected endpoint call.
// The one gap: a *thrown* `redirect()` (the guard's page-route case, just
// below) unwinds past every handle's own `resolve()` call before
// SvelteKit turns it into a response, so this can't attach headers to it;
// a redirect has no body for CSP or nosniff to protect anyway. Language
// next, so a redirect or an error page from the guard is still rendered
// in the visitor's locale.
export const handle: Handle = sequence(handleSecurityHeaders, handleParaglide, handleAuth);
