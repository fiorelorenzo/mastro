// Pure request/response classification for the service worker's caching
// rules (#61). Kept apart from src/service-worker.ts on purpose: that file
// runs in the ServiceWorkerGlobalScope, whose ambient types (`self`,
// `caches`, `FetchEvent`) collide with the `dom` lib the rest of the
// project uses (TypeScript cannot merge `dom` and `webworker` in one
// program), so it is excluded from `svelte-check` entirely — see
// `.svelte-kit/tsconfig.json`. Everything that can be decided from plain
// values instead of live Worker/Cache/Response objects lives here instead,
// where it is an ordinary module `pnpm test` and `pnpm check` both cover.
//
// The caching rule this project applies for authenticated responses, in
// one place: nothing under `/api/auth/` is ever written to Cache Storage,
// because it carries session identity, not ledger data — a stale copy of
// "am I signed in" is a worse answer than none. Every other same-origin GET
// that is not a full-page navigation is fair game for the stale-while-
// revalidate data cache, because SvelteKit's own redirect envelope (see
// `isSessionInvalidPayload` below) is what proves a cached copy has gone
// stale in the one way that matters: the session it was fetched under no
// longer exists.

/**
 * Same-origin GET requests outside `/api/auth/` and outside navigation are
 * the only ones treated as "data": SvelteKit's own `__data.json` fetches
 * (issued for every client-side navigation and every hover-preload, see
 * `data-sveltekit-preload-data="hover"` in `src/app.html`) and any
 * `+server.ts` JSON endpoint fetched with `fetch()`. A full-page navigation
 * (`mode: 'navigate'`) never comes through here — see `handleNavigate` in
 * `service-worker.ts` for why a document is never served from this cache.
 */
export function isCacheableDataRequest(request: {
	readonly method: string;
	readonly mode: string;
	readonly pathname: string;
}): boolean {
	return (
		request.method === 'GET' &&
		request.mode !== 'navigate' &&
		!request.pathname.startsWith('/api/auth/')
	);
}

/**
 * The Cache Storage key for a data request: same origin and pathname as
 * `url`, search string dropped. SvelteKit appends its own bookkeeping to a
 * repeat `__data.json` fetch — `?x-sveltekit-invalidated=…`, marking which
 * load node it considers stale on the client — and that marker varies
 * between requests for what is otherwise the same route's data. Keying
 * the cache on the full URL would miss on every such repeat fetch and
 * silently fall back to the network every time, defeating stale-while-
 * revalidate for exactly the case it exists for: revisiting a route
 * already cached.
 */
export function dataCacheKey(url: string): string {
	const normalized = new URL(url);
	normalized.search = '';
	return normalized.toString();
}

/**
 * SvelteKit serializes a `load`-thrown (or `handle`-thrown) redirect as a
 * `200` JSON envelope shaped `{ type: 'redirect', location }` for a data
 * request — see `@sveltejs/kit`'s `redirect_json_response`. The auth guard
 * in `hooks.server.ts` throws exactly this redirect for a session that no
 * longer validates, so this shape is the earliest, and only, origin-
 * verified signal available to a service worker that a cached response is
 * about to belong to nobody: a `fetch` event's `Request` never exposes the
 * `Cookie` header, so there is no way to check session validity locally.
 */
export function isSessionInvalidPayload(payload: unknown): boolean {
	return (
		typeof payload === 'object' &&
		payload !== null &&
		'type' in payload &&
		payload.type === 'redirect'
	);
}

/** Versioned so `activate` can drop every cache from a previous deploy (#61). */
export function shellCacheName(version: string): string {
	return `mastro-shell-${version}`;
}

/**
 * Also versioned by build, not just wiped on sign-out: a deploy can change
 * what a `load` function returns, and feeding an old shape to new client
 * code is its own kind of wrong number.
 */
export function dataCacheName(version: string): string {
	return `mastro-data-${version}`;
}
