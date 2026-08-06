// Deny-by-default access control (#54). A route is protected unless its id
// is on route-guard.ts's short public list, so a route added later without
// updating this file stays protected; that is the point.
import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { auth } from '$lib/server/auth';
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

const handleAuth: Handle = async ({ event, resolve }) => {
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

// Language first, so a redirect or an error page from the guard is still
// rendered in the visitor's locale.
export const handle: Handle = sequence(handleParaglide, handleAuth);
