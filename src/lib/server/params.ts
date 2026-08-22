import { error } from '@sveltejs/kit';
import { isUuid } from '$lib/uuid';

/**
 * A route param can lean on `src/params/uuid.ts` — SvelteKit checks it
 * before the loader runs. A query param cannot: there is no matcher for
 * `?contractId=`, so the loader has to decide for itself. This is for the
 * routes where the param names a required row (`/approvals/new`,
 * `/invoices/propose`) — a missing or malformed value 404s with the
 * route's own not-found message, the same answer an unknown-but-valid id
 * would get, rather than being handed to a query Postgres rejects (#390).
 *
 * Not for a route where absence is itself a legitimate state (`/invoices/new`,
 * `/day/new`): those read the param directly and treat a value that names no
 * offered row exactly like an absent one, entirely in application code, with
 * no query built from the raw param.
 */
export function requireUuidSearchParam(url: URL, name: string, notFoundMessage: string): string {
	const value = url.searchParams.get(name) ?? '';
	if (!isUuid(value)) error(404, notFoundMessage);
	return value;
}
