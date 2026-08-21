import { json } from '@sveltejs/kit';
import { readPollProgress } from '$lib/server/mail/poll-progress';
import type { RequestHandler } from './$types';

/**
 * What the poll running right now is doing (#405). Read by `+page.svelte`
 * while its own "check now" submit is in flight, so the page can show the
 * phases instead of a button that has replaced itself with a spinner.
 *
 * A GET on the same route tree as the page, so it inherits the session
 * `hooks.server.ts` already requires for `/mail` and needs no guard of its
 * own — `route-guard.ts`'s deny-by-default (invariant 6) means anything not
 * on its public list is authenticated, and this deliberately is not on it.
 * The progress of a mailbox poll names counts from a private ledger.
 *
 * Not cached by the service worker: `hooks.server.ts` stamps the offline
 * allow-marker on data requests (`event.isDataRequest`, which is
 * `__data.json` only), and `sw-cache-policy.ts` caches nothing without it.
 * So this always answers from the process holding the poll, which is the
 * only place the answer exists — `poll-progress.ts` explains why it is
 * module state and not a table.
 */
export const GET: RequestHandler = () => {
	const progress = readPollProgress();
	// `no-store` on top of the header rule above. A conditional GET
	// answering 304 here would show a reader a phase list frozen at
	// whatever the first poll of the process happened to be, and the whole
	// point of this endpoint is that it changes every few hundred
	// milliseconds while nothing about the URL does.
	return json(progress, { headers: { 'cache-control': 'no-store' } });
};
