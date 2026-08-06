// Sign-out (#51). Protected by the default guard like everything else not
// on route-guard.ts's public list: only a signed-in browser can reach it,
// and Better Auth clears the session cookie regardless of whether the
// session it names still exists.
import { auth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const response = await auth.api.signOut({
		headers: request.headers,
		asResponse: true
	});

	const headers = new Headers(response.headers);
	headers.delete('content-type');
	headers.delete('content-length');
	headers.set('location', '/sign-in');
	return new Response(null, { status: 303, headers });
};
