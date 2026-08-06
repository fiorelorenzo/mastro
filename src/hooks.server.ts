// Deny-by-default access control (#54). A route is protected unless its id
// is on route-guard.ts's short public list, so a route added later without
// updating this file stays protected; that is the point.
import { redirect, type Handle } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { isEndpointRoute, isPublicRoute } from '$lib/server/route-guard';

export const handle: Handle = async ({ event, resolve }) => {
	if (isPublicRoute(event.route.id)) {
		return resolve(event);
	}

	const sessionData = await auth.api.getSession({ headers: event.request.headers });
	event.locals.session = sessionData?.session ?? null;
	event.locals.user = sessionData?.user ?? null;

	if (sessionData) {
		return resolve(event);
	}

	if (isEndpointRoute(event.route.id)) {
		return new Response(null, { status: 401 });
	}

	redirect(
		303,
		`/sign-in?callbackURL=${encodeURIComponent(event.url.pathname + event.url.search)}`
	);
};
