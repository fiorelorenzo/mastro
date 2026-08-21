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
 * The name of the private header `hooks.server.ts` stamps on the page-data
 * responses this worker is allowed to keep offline, and the only thing the
 * response half of the policy reads.
 */
export const OFFLINE_CACHE_HEADER = 'x-mastro-offline';

/**
 * The response half of the caching decision: allow-only-what-the-app-marks,
 * deny everything else (#341).
 *
 * This gate used to read `Cache-Control: no-store` (#305). The intent was
 * right — evidence must never land in Cache Storage, and documents were
 * being spared only by the accident that a blob's content type is rarely
 * `application/json` — and the discriminator was wrong. `no-store` is what
 * a correct server says about *any* private, per-session payload, and
 * SvelteKit says exactly that on every `__data.json`. Measured: with that
 * gate in place the data cache held **zero** entries, so the whole PWA had
 * a cached shell and no data behind it, and nothing in the suite noticed
 * because the tests fed it hand-written header literals rather than the
 * header SvelteKit actually sends.
 *
 * So the rule is inverted. A response is cached only if the app itself
 * marked it cacheable, which `/documents/[id]` never is, whatever mime it
 * carries and even if a document is one day served as JSON. Nothing
 * upstream of `isCacheableDataRequest` can see the response, so this stays
 * a second, independent gate the write site cannot skip.
 */
export function isCacheableDataResponse(response: {
	readonly offlineMarker: string | null;
}): boolean {
	return response.offlineMarker?.trim().toLowerCase() === 'allow';
}

/**
 * Whether a revalidated data response actually differs from the copy it
 * is about to replace in `DATA_CACHE`, compared as body text rather than
 * headers — `x-mastro-cached-at` is stamped fresh on every write by
 * construction (see `processNetworkDataResponse`), so a header comparison
 * would report every single revalidation as a change regardless of
 * payload, which is no better than the `stale`-flag proxy this replaces.
 *
 * `previousBody === null` means there was nothing cached for this URL
 * yet, so nothing stale was ever on screen for it: the page is about to
 * render the very payload that just arrived, not something older, so
 * that case reports unchanged.
 *
 * This is the real criterion behind #401: a home screen and a list page
 * disagreeing on proposal counts, traced to a revalidation that
 * returned a genuinely different payload inside the stale-announce grace
 * period, so nothing ever told the page to re-read it. See
 * `freshness-policy.ts`'s `shouldRefreshAfterFreshData` for how the
 * result of this comparison is turned into a re-read decision, and its
 * doc comment for why re-reading here cannot loop the way #340 did.
 */
export function dataPayloadChanged(previousBody: string | null, nextBody: string): boolean {
	if (previousBody === null) return false;
	return previousBody !== nextBody;
}

/**
 * Whether a request is a write that invalidates every cached read.
 *
 * Measured before it was written: rejecting a proposal and clicking back to
 * the queue showed the rejected row again and kept showing it. The database
 * had nothing pending, the server rendered nothing pending, and the data
 * cache held the copy from before the rejection with no notion that
 * anything had happened. Stale-while-revalidate is right for reads and
 * indefensible immediately after a write.
 *
 * Any same-origin non-GET counts, which covers a native form POST, an
 * `?/action` submission and a `fetch` to a `+server.ts` endpoint alike, and
 * covers a mutation added later without anybody remembering to. `/api/auth/`
 * is included on purpose: signing out is exactly when nothing cached under
 * the old session may survive.
 *
 * `online` is a parameter rather than read from the worker's own
 * `navigator`, so this stays a pure decision the test suite can drive.
 * While offline the write is going nowhere, the offline queue owns that
 * case, and the cache is precisely what should still be there to read from.
 */
export function isCacheInvalidatingWrite(request: {
	readonly method: string;
	readonly sameOrigin: boolean;
	readonly online: boolean;
}): boolean {
	return request.method !== 'GET' && request.sameOrigin && request.online;
}

/**
 * The Cache Storage key for a data request: same origin and pathname as
 * `url`, with SvelteKit's own bookkeeping parameters removed and every
 * other one kept, in a stable order.
 *
 * SvelteKit appends `?x-sveltekit-invalidated=…` to a repeat `__data.json`
 * fetch, marking which load node it considers stale on the client, and
 * that marker varies between requests for what is otherwise the same
 * route's data. Keying on the full URL would miss on every such repeat
 * fetch and silently fall back to the network, defeating
 * stale-while-revalidate for exactly the case it exists for.
 *
 * This used to drop the whole search string, which fixed that and broke
 * something worse: a query parameter is usually the only thing telling two
 * datasets apart. `/proposals?status=pending`, `?status=accepted` and
 * `?status=rejected` collapsed onto one key, so whichever tab was fetched
 * first was served for all three — the list, and the tab highlight with
 * it, showed data belonging to a different tab. Every tabbed screen had
 * it. A cache that answers one question with another question's answer is
 * worse than no cache.
 */
const SVELTEKIT_BOOKKEEPING_PREFIX = 'x-sveltekit-';

export function dataCacheKey(url: string): string {
	const normalized = new URL(url);
	const kept = new URLSearchParams();
	for (const [key, value] of [...normalized.searchParams].sort(([a], [b]) => a.localeCompare(b))) {
		if (key.startsWith(SVELTEKIT_BOOKKEEPING_PREFIX)) continue;
		kept.append(key, value);
	}
	normalized.search = kept.toString();
	return normalized.toString();
}

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

/**
 * True for a navigation that already targets the offline fallback page
 * itself (#227) — the one document `handleNavigate` (service-worker.ts)
 * must answer straight from `SHELL_CACHE` instead of trying the network
 * first like every other navigation. Without this special case, a
 * session with no network at all fetches `/offline`, fails exactly the
 * same way every other navigation just did, and is handed the redirect
 * `offlineFallbackUrl` below builds — which the *browser* then re-
 * requests as a brand new navigation to `/offline`, looping forever
 * (`ERR_TOO_MANY_REDIRECTS`) instead of ever painting anything. `/offline`
 * is prerendered, public and stateless (`route-guard.ts`), so serving it
 * from Cache Storage here is not the "never cache a document" rule
 * bending — it is the one document that rule was always written to
 * allow.
 */
export function isOfflineDocumentRequest(pathname: string, offlinePathname: string): boolean {
	return pathname === offlinePathname;
}

/**
 * Where a failed navigation redirects to (#227): the offline fallback,
 * carrying the URL that could not be reached as `?to=` so that page's own
 * client script can attempt a same-app `goto()` once hydrated — a normal
 * client-side route change, which `handleDataRequest`'s existing stale-
 * while-revalidate cache can already answer with zero network the moment
 * that route's data was ever warmed (a previous visit, or `install`'s own
 * proactive warm-up for `/day/new` — see `dayEntryDataUrl` below). Never
 * carries `?to=` back to itself: a failed load of `/offline` needs no
 * further redirect target at all.
 */
export function offlineFallbackUrl(failedUrl: string, offlineUrl: string, origin: string): string {
	const target = new URL(offlineUrl, origin);
	const failed = new URL(failedUrl, origin);
	if (!isOfflineDocumentRequest(failed.pathname, target.pathname)) {
		target.searchParams.set('to', `${failed.pathname}${failed.search}`);
	}
	return target.href;
}

/**
 * The exact URL SvelteKit's client router fetches for `/day/new`'s own
 * `load()` — the same `/<route>/__data.json` shape `dataCacheKey` above
 * already documents for every other route. Computed once here so
 * `install`'s proactive warm-up of the day-entry form's own data
 * (service-worker.ts, #227 — "cache the app shell so the entry form
 * opens offline from cold") and `dataCacheKey`'s own normalisation of the
 * request that later reads it back never drift apart on the string.
 */
export function dayEntryDataUrl(base: string, origin: string): string {
	return new URL(`${base}/day/new/__data.json`, origin).href;
}
