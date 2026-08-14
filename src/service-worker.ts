/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

// The service worker (#61). Excluded from svelte-check (see
// .svelte-kit/tsconfig.json and the comment at the top of
// src/lib/pwa/sw-cache-policy.ts): its global scope is `webworker`, not
// `dom`, and TypeScript cannot check both in one program. Every decision
// that does not need a live Worker/Cache/Response object is a pure,
// separately tested function imported from sw-cache-policy.ts instead.
//
// ── the caching rule for authenticated responses ──────────────────────
//
// Cache Storage in this file holds exactly two things, and nothing else:
//
// 1. The shell (`SHELL_CACHE`): the build's JS/CSS bundle, the files under
//    `static/`, and the one prerendered page (`/offline`). All three are
//    produced at build time, before any request — and so before any
//    session — exists, which is what makes them safe to precache on
//    `install` and hand to literally anyone: there is no `locals.user` in
//    them to leak.
// 2. Runtime data (`DATA_CACHE`): responses to same-origin GET requests
//    that are not full-page navigations — SvelteKit's own `__data.json`
//    fetches and any `+server.ts` JSON endpoint — excluding everything
//    under `/api/auth/`, which carries session identity rather than
//    ledger data and is never written here (see
//    `isCacheableDataRequest`).
//
// A full HTML *document* is never read from, or written to, either cache.
// That is the one rule this file will not bend on, and the reason is the
// invariant in #61 itself: an authenticated page's rendered HTML has no
// session check left to perform once it is sitting in Cache Storage, so
// serving it to a later, possibly signed-out, request would hand over
// whatever the ledger looked like at cache time with no way to tell the
// two visitors apart. `handleNavigate` below always asks the network
// first and, on failure, falls back to the single public, stateless
// `/offline` page — never to a cached copy of the real one.
//
// The data cache still gets read offline, by design: `handleDataRequest`
// serves the last good copy immediately (stale-while-revalidate) so an
// already-open tab keeps working, and every such response is tagged with
// `x-mastro-cached-at` and announced to open tabs (`mastro:data-stale` /
// `mastro:data-fresh`) so the UI never passes a cached figure off as
// current — see OfflineDataBanner.svelte. Two things bound how long that
// cached ledger data can outlive the session it was fetched under:
//
// - The moment any network round trip reveals the session is gone —
//   SvelteKit's own redirect envelope, `isSessionInvalidPayload` — the
//   whole data cache is wiped, not just the one URL that proved it.
// - Every deploy uses a new cache name (`version` from `$service-worker`)
//   and `activate` deletes every cache that is not the current one, so
//   data cached under an old build's response shape never survives a
//   deploy either.
//
// What this cannot do: purge a tab that is offline for the entire window
// between a remote sign-out and its next network round trip. There is no
// way to check session validity without a network call, offline or not —
// this is a hard limit of the approach, not an oversight, and it is why
// the rule above is "never cache a document": the worst an offline,
// already-hydrated tab can do is keep showing data it already had, which
// is the explicit offline feature #61 asks for, not a new exposure.
import { base, build, files, prerendered, version } from '$service-worker';
import {
	dataCacheKey,
	dataCacheName,
	dayEntryDataUrl,
	isCacheableDataRequest,
	isOfflineDocumentRequest,
	isSessionInvalidPayload,
	offlineFallbackUrl,
	shellCacheName
} from '$lib/pwa/sw-cache-policy';

const sw = self as unknown as ServiceWorkerGlobalScope;

const SHELL_CACHE = shellCacheName(version);
const DATA_CACHE = dataCacheName(version);
const CURRENT_CACHE_NAMES: ReadonlySet<string> = new Set([SHELL_CACHE, DATA_CACHE]);

const SHELL_URLS: readonly string[] = [...build, ...files, ...prerendered];
const SHELL_PATHNAMES: ReadonlySet<string> = new Set(
	SHELL_URLS.map((url) => new URL(url, sw.location.href).pathname)
);
const OFFLINE_URL = `${base}/offline`;

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(SHELL_CACHE);
			await cache.addAll(SHELL_URLS);
			// #227: the day-entry form's own data — which contracts exist, the
			// default one to preselect, today's date — is what lets a cold,
			// offline start reach a *working* form rather than just the
			// offline page's static prose: see /offline/+page.svelte's own
			// goto() and handleDataRequest below, which this warms the same
			// cache for. A signed-out install (no session cookie yet, e.g.
			// this is the very first visit, to /sign-in) gets a redirect
			// envelope here, which processNetworkDataResponse already treats
			// as "wipe, don't cache" — the ordinary stale-while-revalidate
			// path in handleDataRequest warms it for real the first time a
			// signed-in visitor actually opens the page themselves.
			await warmDayEntryData();
			// A ledger stuck on an old build until every tab closes is worse
			// than one extra reload (#61 — "a new deployment does not leave a
			// stale shell serving forever"). No offline write queue exists
			// this wave (#62), so there is nothing unsaved a forced update
			// could lose.
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const existingNames = await caches.keys();
			await Promise.all(
				existingNames
					.filter((name) => !CURRENT_CACHE_NAMES.has(name))
					.map((name) => caches.delete(name))
			);
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	if (request.mode === 'navigate') {
		event.respondWith(handleNavigate(request));
		return;
	}

	if (SHELL_PATHNAMES.has(url.pathname)) {
		event.respondWith(handleShellAsset(request));
		return;
	}

	if (
		isCacheableDataRequest({ method: request.method, mode: request.mode, pathname: url.pathname })
	) {
		event.respondWith(handleDataRequest(event));
	}
});

/**
 * Displays a push notification (#63). The payload is `push/send.ts`'s
 * `PushPayload` — `{ title, body, url }`, JSON-encoded before it left the
 * server — so a garbled or empty push (a service delivering a malformed
 * message) is treated as nothing to show rather than a thrown handler.
 * Touches no cache: push handling is orthogonal to the caching rule at
 * the top of this file, which is only ever about what `fetch` may serve.
 */
sw.addEventListener('push', (event) => {
	let payload: { title?: string; body?: string; url?: string } = {};
	try {
		if (event.data) payload = event.data.json();
	} catch {
		return;
	}
	if (!payload.title) return;

	event.waitUntil(
		sw.registration.showNotification(payload.title, {
			body: payload.body,
			data: { url: payload.url ?? `${base}/alerts` },
			tag: 'mastro-alert'
		})
	);
});

/** Focuses an already-open tab on the notification's target URL if one
 * exists, opens a new one otherwise. */
sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = (event.notification.data as { url?: string } | undefined)?.url ?? `${base}/alerts`;
	event.waitUntil(
		(async () => {
			const clientList = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
			const targetUrl = new URL(url, sw.location.href).href;
			for (const client of clientList) {
				if (client.url === targetUrl && 'focus' in client) {
					await client.focus();
					return;
				}
			}
			await sw.clients.openWindow(targetUrl);
		})()
	);
});

/**
 * Network first, since a document is never cached (see the rule at the top
 * of this file): the only fallback is the precached, stateless offline
 * page, never a previous visitor's rendered HTML.
 */
/**
 * A full-page navigation: always the network, never a cached document (see
 * the caching rule at the top of this file), with `/offline` as the only
 * fallback.
 *
 * **`redirect: 'manual'` is load-bearing, not a detail.** A navigation
 * fetched with the default `follow` makes the service worker follow the
 * chain itself, and this app's very first chain leaves the origin: `/`
 * redirects to `/sign-in`, whose button redirects to Google. A worker
 * cannot return a cross-origin response for a same-origin navigation, so
 * that fetch rejects outright ("Unsafe attempt to load URL ... from frame
 * with URL .../service-worker.js") and lands in the catch below, meaning
 * every visitor with the worker installed got the offline page instead of
 * the sign-in they asked for. With `manual` the 3xx comes back as an
 * opaque redirect that the *browser* follows, off-origin or not, which is
 * what would have happened with no worker at all.
 *
 * The fallback redirects to `/offline` rather than answering with its HTML
 * under the requested URL. Serving one page's markup at another page's
 * address leaves the address bar lying and hands SvelteKit a document that
 * does not match the route it is hydrating.
 */
async function handleNavigate(request: Request): Promise<Response> {
	const requestUrl = new URL(request.url);
	const offlineUrl = new URL(OFFLINE_URL, sw.location.origin);

	// #227: without this, a session with no network at all — not just a
	// failed /day/new, /offline itself too — would fetch /offline below,
	// fail exactly the same way, and be handed the same redirect every
	// other failed navigation gets, which the browser re-requests as a
	// brand new navigation to /offline: an infinite loop, never a working
	// page. See isOfflineDocumentRequest's own doc comment for why serving
	// this one document from Cache Storage does not weaken the "never
	// cache a document" rule above.
	if (isOfflineDocumentRequest(requestUrl.pathname, offlineUrl.pathname)) {
		const cache = await caches.open(SHELL_CACHE);
		const cached = await cache.match(OFFLINE_URL);
		if (cached) return cached;
	}

	try {
		return await fetch(request.url, {
			method: request.method,
			headers: request.headers,
			credentials: 'include',
			redirect: 'manual'
		});
	} catch {
		return Response.redirect(offlineFallbackUrl(request.url, OFFLINE_URL, sw.location.origin), 303);
	}
}

/**
 * Proactively warms the day-entry form's own data into DATA_CACHE at
 * `install` (#227), through the exact same `processNetworkDataResponse`
 * path `handleDataRequest` uses for every other data fetch — so a build
 * that adds a new field to `/day/new`'s `load()` return shape is still
 * subject to the same content-type/session checks as any other cached
 * response, with nothing duplicated here. Best-effort: a network error
 * (offline at install time) or the absence of a session cookie yet (the
 * very first, signed-out install) both leave the cache exactly as empty
 * as it already was — `install` still resolves and `skipWaiting` still
 * runs either way.
 */
async function warmDayEntryData(): Promise<void> {
	const url = dayEntryDataUrl(base, sw.location.origin);
	try {
		const response = await fetch(url, { credentials: 'include' });
		await processNetworkDataResponse(dataCacheKey(url), response);
	} catch {
		// No network yet, or nothing to catch — see the doc comment above.
	}
}

/** Cache first: every shell URL is either content-hashed or was just replaced wholesale by `install` above. */
async function handleShellAsset(request: Request): Promise<Response> {
	const cache = await caches.open(SHELL_CACHE);
	const cached = await cache.match(request);
	return cached ?? fetch(request);
}

/**
 * Stale-while-revalidate: a cached copy (if any) answers immediately and
 * the network request that follows updates the cache in the background,
 * via `event.waitUntil` so it keeps running after the response is sent.
 */
/** How long a revalidation may run before the copy on screen is called
 * unconfirmed. Long enough that a healthy round trip never trips it,
 * short enough that a reader is not left studying figures nothing has
 * checked. */
const STALE_ANNOUNCE_GRACE_MS = 1_500;

function handleDataRequest(event: FetchEvent): Promise<Response> {
	const { request } = event;
	const cacheKey = dataCacheKey(request.url);

	return (async () => {
		const cache = await caches.open(DATA_CACHE);
		const cached = await cache.match(cacheKey);
		const revalidated = fetch(request)
			.then((response) => processNetworkDataResponse(cacheKey, response))
			.catch(() => null);

		if (cached) {
			// Serve the cached copy at once, but do NOT call it stale yet.
			//
			// Announcing staleness here fired on every navigation with a warm
			// cache and was cleared a moment later by `data-fresh`, so the
			// warning banner flashed yellow on every screen of a perfectly
			// healthy instance. A marker that appears when nothing is wrong
			// is not a marker, it is noise, and it trains you to ignore the
			// one time it means something.
			//
			// #61 asks that a stale response be visibly marked as stale. That
			// is true when revalidation FAILS, and when it is taking long
			// enough that you are reading unconfirmed figures — not during
			// the sub-second round trip that confirms them. So: announce on
			// failure, or after a grace period, and never merely because a
			// cache was hit.
			const announceStale = () =>
				notifyClients({
					type: 'mastro:data-stale',
					url: cacheKey,
					cachedAt: cached.headers.get('x-mastro-cached-at')
				});
			const graceTimer = setTimeout(announceStale, STALE_ANNOUNCE_GRACE_MS);
			event.waitUntil(
				revalidated.then((response) => {
					clearTimeout(graceTimer);
					// `processNetworkDataResponse` emits `data-fresh` itself on
					// the paths that cache; a null (network failure) or a
					// non-ok response never reaches it, and that is exactly
					// the case the banner exists for.
					if (!response || !response.ok) announceStale();
					return response;
				})
			);
			return cached;
		}

		return (await revalidated) ?? Response.error();
	})();
}

/**
 * Caches a successful, still-authenticated JSON response and tags it with
 * when it was cached; wipes the whole data cache instead the moment the
 * response proves the session is gone (see the rule at the top of this
 * file). Never caches an error response or anything that is not JSON —
 * that also skips SvelteKit's chunked `text/sveltekit-data` deferred-data
 * responses, which stream and so are not safely re-servable from a single
 * cached copy; those simply fall back to the network every time.
 */
async function processNetworkDataResponse(cacheKey: string, response: Response): Promise<Response> {
	if (!response.ok) return response;
	if (!(response.headers.get('content-type') ?? '').includes('application/json')) return response;

	const payload: unknown = await response
		.clone()
		.json()
		.catch(() => null);

	if (isSessionInvalidPayload(payload)) {
		await caches.delete(DATA_CACHE);
		notifyClients({ type: 'mastro:session-invalid', url: cacheKey });
		return response;
	}

	const cachedAt = new Date().toISOString();
	const taggedHeaders = new Headers(response.headers);
	taggedHeaders.set('x-mastro-cached-at', cachedAt);
	const cache = await caches.open(DATA_CACHE);
	await cache.put(
		cacheKey,
		new Response(await response.clone().arrayBuffer(), {
			status: response.status,
			headers: taggedHeaders
		})
	);
	notifyClients({ type: 'mastro:data-fresh', url: cacheKey });
	return response;
}

async function notifyClients(message: Record<string, unknown>): Promise<void> {
	const openClients = await sw.clients.matchAll({ type: 'window' });
	for (const client of openClients) client.postMessage(message);
}
