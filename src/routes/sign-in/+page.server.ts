import type { PageServerLoad } from './$types';

/**
 * The sign-in page (#140). Public, and one of the few routes on
 * `route-guard.ts`'s list, so this load runs with no session.
 *
 * `callbackURL` is carried through to the button so a visitor who was sent
 * here from a protected page lands back on it. Only same-origin paths: an
 * absolute URL, or one starting `//`, would turn this into an open
 * redirector, which is worth nothing to the visitor and a great deal to
 * whoever finds it.
 *
 * `error` is a flag, never a message from the query string. Anything a
 * caller can put in the URL is text an attacker can put on the page, and
 * the one error that actually reaches here (the allowlist refusing an
 * address) has a deliberately uninformative message anyway: it must not
 * reveal whether an address is known (#53).
 */
export const load: PageServerLoad = ({ url }) => {
	const requested = url.searchParams.get('callbackURL');
	const callbackURL =
		requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

	return { callbackURL, rejected: url.searchParams.has('error') };
};
