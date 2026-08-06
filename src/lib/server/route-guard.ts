// Deny-by-default route classification (#54). A route is protected unless
// its id is explicitly listed here, so forgetting to list a new route is
// safe: it stays protected. Kept short and reviewable on purpose.
//
// route-guard.test.ts enumerates every route under src/routes and fails if
// this list grows to cover one that was not deliberately made public.
export const PUBLIC_ROUTE_IDS: ReadonlySet<string> = new Set([
	// Better Auth itself: Google sign-in initiation (if ever called directly),
	// the OAuth callback, session lookup, sign-out. One SvelteKit route id
	// covers this whole family; Better Auth does its own internal routing.
	'/api/auth/[...all]',
	// Redirects straight to Google's consent screen.
	'/sign-in',
	// Liveness probe for compose and the reverse proxy.
	'/health'
]);

/**
 * `routeId` is `null` when no file under src/routes matched: either a
 * genuine static file served from `static/`, or a request that is about to
 * 404. Neither case can expose application data, so both pass through.
 */
export function isPublicRoute(routeId: string | null): boolean {
	return routeId === null || PUBLIC_ROUTE_IDS.has(routeId);
}

// Every +server.ts route id, discovered from the filesystem instead of
// hardcoded, so adding an API endpoint automatically gets a 401 instead of a
// redirect when it is rejected for having no session.
const endpointModules = import.meta.glob('/src/routes/**/+server.{js,ts}');
const ENDPOINT_ROUTE_IDS: ReadonlySet<string> = new Set(
	Object.keys(endpointModules).map(
		(path) => path.replace(/^\/src\/routes/, '').replace(/\/\+server\.(js|ts)$/, '') || '/'
	)
);

export function isEndpointRoute(routeId: string | null): boolean {
	return routeId !== null && ENDPOINT_ROUTE_IDS.has(routeId);
}
