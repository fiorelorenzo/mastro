// The sign-in route (#51, #54's public list). A GET here is a real HTTP
// redirect to Google's consent screen, not the JSON envelope Better Auth's
// own /api/auth/sign-in/social returns for its JS client. Building the
// authorization URL is entirely Better Auth's job (including the OAuth
// state cookie it sets along the way, which callback verification below
// needs back); this route only turns that into a redirect a browser follows.
import { error } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, request }) => {
	const requested = url.searchParams.get('callbackURL');
	const callbackURL =
		requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

	const response = await auth.api.signInSocial({
		body: { provider: 'google', callbackURL },
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
