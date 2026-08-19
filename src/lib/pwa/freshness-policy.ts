// Pure state transitions for the "showing saved data" banner (#61). Kept
// apart from sw-client.svelte.ts so the decision logic is testable without
// a browser, `navigator.serviceWorker`, or Svelte's reactivity — the same
// split as install-logic.ts / install.svelte.ts.
//
// One entry per URL the service worker has told this tab about, keyed by
// `request.url`. `stale: true` means the last thing shown for that URL came
// from Cache Storage and the background revalidation has not yet (or has
// failed to) confirm it current; `stale: false` means the network has since
// answered for it. Only one route's data is usually in flight at a time —
// SvelteKit aggregates a whole navigation's `load` output into a single
// `__data.json` request — but a page that also calls `fetch()` directly
// against a `+server.ts` endpoint can have more than one, hence a map
// rather than a single value.

export interface FreshnessEntry {
	readonly cachedAt: string;
	readonly stale: boolean;
}

export type FreshnessState = Readonly<Record<string, FreshnessEntry>>;

export const EMPTY_FRESHNESS_STATE: FreshnessState = {};

/** The service worker served `url` from Cache Storage; `cachedAt` is when that copy was written. */
export function recordStaleServe(
	state: FreshnessState,
	url: string,
	cachedAt: string
): FreshnessState {
	return { ...state, [url]: { cachedAt, stale: true } };
}

/** The network has since answered for `url` with a valid session: it is no longer stale. */
export function recordRevalidated(state: FreshnessState, url: string): FreshnessState {
	const next = { ...state };
	delete next[url];
	return next;
}

/**
 * Whether the arrival of a fresh copy of `url` should make the page re-read
 * its data, decided **before** {@link recordRevalidated} clears the entry.
 *
 * Only a URL this tab was told was stale needs one. That is the whole fix
 * for #340: the page used to re-read on every `data-fresh` message, and
 * since re-reading refetches the same URL, and a successful refetch posts
 * another `data-fresh`, an open tab never stopped. Measured before it was
 * written: roughly 30 messages a second, indefinitely, on a page nobody was
 * touching, with the freshness banner flashing whenever one round trip in
 * that storm crossed the stale-announce grace period.
 *
 * A fresh copy of something never announced stale is the ordinary case —
 * stale-while-revalidate confirming what is already on screen — and the
 * page already has that payload, so there is nothing to re-read.
 */
export function shouldRefreshAfterRevalidation(state: FreshnessState, url: string): boolean {
	return state[url]?.stale === true;
}

/**
 * The service worker detected an invalid session (`sw-cache-policy.ts`'s
 * `isSessionInvalidPayload`) and wiped its data cache: nothing this tab
 * still has an entry for is a ledger figure anyone should keep looking at.
 */
export function recordSessionInvalid(): FreshnessState {
	return EMPTY_FRESHNESS_STATE;
}

/**
 * The single timestamp the banner shows: the oldest still-stale entry, so
 * the label never claims data is fresher than the stalest figure on
 * screen. `null` means nothing currently displayed came from the cache.
 */
export function oldestStaleAt(state: FreshnessState): string | null {
	const staleTimestamps = Object.values(state)
		.filter((entry) => entry.stale)
		.map((entry) => entry.cachedAt)
		.sort();
	return staleTimestamps[0] ?? null;
}
