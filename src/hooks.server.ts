// Deny-by-default access control (#54). A route is protected unless its id
// is on route-guard.ts's short public list, so a route added later without
// updating this file stays protected; that is the point.
import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { auth, defaultAllowlist } from '$lib/server/auth';
import { isAllowedEmail } from '$lib/server/auth/allowlist';
import { isEndpointRoute, isPublicRoute } from '$lib/server/route-guard';

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

// Language first, so a redirect or an error page from the guard is still
// rendered in the visitor's locale.
export const handle: Handle = sequence(handleParaglide, handleAuth);
