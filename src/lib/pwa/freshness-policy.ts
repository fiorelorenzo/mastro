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
 * One of the two reasons {@link shouldRefreshAfterFreshData} re-reads on a
 * `data-fresh` message: whether this tab was told `url` was stale before
 * this fresh copy arrived, decided **before** {@link recordRevalidated}
 * clears the entry.
 *
 * This alone used to be the whole rule, and its own contribution to #340
 * still holds unchanged: re-reading unconditionally on every `data-fresh`
 * refetches the same URL, a successful refetch posts another `data-fresh`,
 * and an untouched tab never stopped — roughly 30 messages a second,
 * measured before this guard existed.
 *
 * What this function's presence used to imply — that a fresh copy of a
 * URL never announced stale is always the ordinary case, stale-while-
 * revalidate confirming what is already on screen, with nothing to
 * re-read — turned out to be false: staleness is only announced on
 * revalidation failure or after the grace period in service-worker.ts, so
 * a revalidation that succeeds quickly with a *different* payload leaves
 * old rows on screen with this function alone returning `false` the whole
 * time. See {@link shouldRefreshAfterFreshData} for the other half that
 * closes that gap.
 */
export function shouldRefreshAfterRevalidation(state: FreshnessState, url: string): boolean {
	return state[url]?.stale === true;
}

/**
 * Whether the arrival of a fresh copy of `url` should make the page
 * re-read its data (#401), decided **before** {@link recordRevalidated}
 * clears the entry. This is the function `sw-client.svelte.ts` actually
 * calls on `mastro:data-fresh`; {@link shouldRefreshAfterRevalidation}
 * above is one of its two inputs, kept separate because it is still
 * correct on its own and its existing tests are the regression guard for
 * #340.
 *
 * `shouldRefreshAfterRevalidation`'s doc comment used to claim that a
 * fresh copy of a URL never announced stale is always the ordinary case -
 * stale-while-revalidate confirming what is already on screen - and so
 * needs no re-read. That is false: staleness is only announced on
 * revalidation failure or after `STALE_ANNOUNCE_GRACE_MS`, so a
 * revalidation that both succeeds quickly AND returns different bytes
 * (the scheduler wrote five new proposals server-side while the cached
 * copy of `/proposals/__data.json` still showed none) updates
 * `DATA_CACHE` and leaves stale rows on screen indefinitely, with no
 * announcement to ever trigger a re-read. `changed` closes that gap: it
 * is computed in `processNetworkDataResponse` by diffing the response
 * body against the cache entry it is about to overwrite, so it is true
 * exactly when the page is rendering something the network has since
 * disagreed with, independent of whether the grace timer had a chance to
 * fire.
 *
 * This still terminates the way #340 needs: a re-read refetches `url`,
 * and that refetch is diffed against the cache entry that was just
 * written with those same bytes, so `changed` comes back false and the
 * re-read this call asked for does not ask for another one. One extra
 * round trip, never a loop.
 */
export function shouldRefreshAfterFreshData(
	state: FreshnessState,
	url: string,
	changed: boolean
): boolean {
	return changed || shouldRefreshAfterRevalidation(state, url);
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
