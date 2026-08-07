// Where the sign-in page's button goes (#51, #140). A real HTTP redirect
// to Google's consent screen, not the JSON envelope Better Auth's own
// /api/auth/sign-in/social returns for its JS client. Building the
// authorization URL is entirely Better Auth's job (including the OAuth
// state cookie it sets along the way, which callback verification needs
// back); this route only turns that into a redirect a browser follows.
//
// Split out of /sign-in, which is now a page a human can look at rather
// than a bounce straight off the instance. Both GET and POST: the page
// posts a form, and a bookmarked link should still work.
import { error } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

const start: RequestHandler = async ({ url, request }) => {
	const requested = url.searchParams.get('callbackURL');
	const callbackURL =
		requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

	const response = await auth.api.signInSocial({
		// `errorCallbackURL` is what sends a refused sign-in back to a page
		// that can say so: without it the allowlist rejection (#53) ends on
		// Better Auth's own error URL, which is a dead end for a human. The
		// page renders one fixed message from the flag alone and never from
		// anything in the query string, so this still discloses nothing
		// about whether the address is known.
		body: { provider: 'google', callbackURL, errorCallbackURL: '/sign-in?error=1' },
		headers: request.headers,
		asResponse: true
	});
	const location = response.headers.get('location');
	if (!location) error(502, 'Google did not return a sign-in redirect');

	const headers = new Headers(response.headers);
	headers.delete('content-type');
	headers.delete('content-length');
	return new Response(null, { status: 302, headers });
};

export const GET = start;
export const POST = start;
