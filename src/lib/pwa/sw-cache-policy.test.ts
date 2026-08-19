import { describe, expect, test } from 'vitest';
import {
	dataCacheKey,
	isCacheInvalidatingWrite,
	dataCacheName,
	dayEntryDataUrl,
	isCacheableDataRequest,
	isCacheableDataResponse,
	OFFLINE_CACHE_HEADER,
	isOfflineDocumentRequest,
	isSessionInvalidPayload,
	offlineFallbackUrl,
	shellCacheName
} from './sw-cache-policy';

describe('isCacheableDataRequest', () => {
	test('a client-side data fetch is cacheable', () => {
		expect(
			isCacheableDataRequest({ method: 'GET', mode: 'cors', pathname: '/clients/__data.json' })
		).toBe(true);
	});

	test('a full-page navigation is never treated as data, even to the same path', () => {
		expect(
			isCacheableDataRequest({ method: 'GET', mode: 'navigate', pathname: '/clients/__data.json' })
		).toBe(false);
	});

	test('a write is never cached', () => {
		expect(
			isCacheableDataRequest({ method: 'POST', mode: 'cors', pathname: '/clients/__data.json' })
		).toBe(false);
	});

	test('anything under /api/auth/ is excluded regardless of method or mode: it carries session identity, not ledger data', () => {
		expect(
			isCacheableDataRequest({ method: 'GET', mode: 'cors', pathname: '/api/auth/get-session' })
		).toBe(false);
	});
});

describe('isCacheableDataResponse', () => {
	test('a page-data response the app marked cacheable is cached', () => {
		expect(isCacheableDataResponse({ offlineMarker: 'allow' })).toBe(true);
	});

	test('an unmarked response is never cached, whatever else it carries', () => {
		expect(isCacheableDataResponse({ offlineMarker: null })).toBe(false);
	});

	test('a value other than allow is not a marker', () => {
		expect(isCacheableDataResponse({ offlineMarker: 'deny' })).toBe(false);
		expect(isCacheableDataResponse({ offlineMarker: '' })).toBe(false);
	});

	test('the marker survives the casing and padding a proxy may introduce', () => {
		expect(isCacheableDataResponse({ offlineMarker: ' Allow ' })).toBe(true);
	});

	/*
	 * The case #341 was filed for, and the one the previous version of this
	 * suite could not see. It fed the gate hand-written `cache-control`
	 * literals, so it never noticed that the literal SvelteKit actually
	 * sends on every `__data.json` is `private, no-store` — which the old
	 * rule read as "never cache", emptying the data cache completely.
	 *
	 * A page-data response therefore carries BOTH headers at once, and the
	 * marker is what decides. If this ever regresses to reading
	 * `cache-control` again, this is the test that fails.
	 */
	test('page data is cached even though SvelteKit marks it private, no-store', () => {
		const pageDataHeaders = new Headers({
			'content-type': 'application/json',
			'cache-control': 'private, no-store',
			[OFFLINE_CACHE_HEADER]: 'allow'
		});

		expect(
			isCacheableDataResponse({ offlineMarker: pageDataHeaders.get(OFFLINE_CACHE_HEADER) })
		).toBe(true);
	});

	/* And the case #305 was right about: a document, whatever its mime. */
	test('a document response is not cached even when it is served as JSON', () => {
		const documentHeaders = new Headers({
			'content-type': 'application/json',
			'cache-control': 'private, no-store',
			'content-disposition': 'attachment; filename="evidence.json"'
		});

		expect(
			isCacheableDataResponse({ offlineMarker: documentHeaders.get(OFFLINE_CACHE_HEADER) })
		).toBe(false);
	});
});

describe('isSessionInvalidPayload', () => {
	test('recognises the redirect envelope hooks.server.ts produces for an invalid session', () => {
		expect(isSessionInvalidPayload({ type: 'redirect', location: '/sign-in' })).toBe(true);
	});

	test('an ordinary data payload is not mistaken for a redirect', () => {
		expect(isSessionInvalidPayload({ type: 'data', nodes: [] })).toBe(false);
	});

	test('a bare array or primitive never throws and is not a redirect', () => {
		expect(isSessionInvalidPayload(null)).toBe(false);
		expect(isSessionInvalidPayload('redirect')).toBe(false);
		expect(isSessionInvalidPayload([1, 2, 3])).toBe(false);
	});
});

describe('dataCacheKey', () => {
	test("drops SvelteKit's invalidation marker, so a repeat __data.json fetch still hits the same entry", () => {
		const first = dataCacheKey('http://localhost/clients/__data.json');
		const second = dataCacheKey('http://localhost/clients/__data.json?x-sveltekit-invalidated=01');
		expect(first).toBe(second);
	});

	test('keeps origin and pathname, so two different routes never collide on one entry', () => {
		expect(dataCacheKey('http://localhost/clients/__data.json')).not.toBe(
			dataCacheKey('http://localhost/__data.json')
		);
	});
});

describe('cache names', () => {
	test('shell and data caches are versioned and distinct, so one build never reads across into another', () => {
		expect(shellCacheName('abc123')).toBe('mastro-shell-abc123');
		expect(dataCacheName('abc123')).toBe('mastro-data-abc123');
		expect(shellCacheName('abc123')).not.toBe(dataCacheName('abc123'));
	});
});

describe('isOfflineDocumentRequest', () => {
	test('the offline page itself is recognised', () => {
		expect(isOfflineDocumentRequest('/offline', '/offline')).toBe(true);
	});

	test('every other pathname is not', () => {
		expect(isOfflineDocumentRequest('/day/new', '/offline')).toBe(false);
	});
});

describe('offlineFallbackUrl', () => {
	test('carries the failed URL forward as ?to=', () => {
		const url = offlineFallbackUrl('http://localhost/day/new', '/offline', 'http://localhost');
		expect(url).toBe('http://localhost/offline?to=%2Fday%2Fnew');
	});

	test("preserves the failed URL's own query string inside ?to=", () => {
		const url = offlineFallbackUrl(
			'http://localhost/day/new?contractId=abc',
			'/offline',
			'http://localhost'
		);
		expect(new URL(url).searchParams.get('to')).toBe('/day/new?contractId=abc');
	});

	test('a failed load of /offline itself carries no ?to= — nothing to redirect to twice', () => {
		const url = offlineFallbackUrl('http://localhost/offline', '/offline', 'http://localhost');
		expect(url).toBe('http://localhost/offline');
	});
});

describe('dayEntryDataUrl', () => {
	test('matches the /<route>/__data.json shape every other route request uses', () => {
		expect(dayEntryDataUrl('', 'http://localhost')).toBe('http://localhost/day/new/__data.json');
	});

	test('respects a configured base path', () => {
		expect(dayEntryDataUrl('/mastro', 'http://localhost')).toBe(
			'http://localhost/mastro/day/new/__data.json'
		);
	});
});

describe('isCacheInvalidatingWrite', () => {
	const online = { sameOrigin: true, online: true };

	// The defect this exists for, measured on 2026-08-17: reject a proposal,
	// click back to the queue, and the rejected row is listed again — the
	// cache held the copy from before the write and had no notion one had
	// happened.
	test.each([['POST'], ['PUT'], ['PATCH'], ['DELETE']])('%s invalidates', (method) => {
		expect(isCacheInvalidatingWrite({ ...online, method })).toBe(true);
	});

	test('a GET does not: reads are what the cache is for', () => {
		expect(isCacheInvalidatingWrite({ ...online, method: 'GET' })).toBe(false);
	});

	test("another origin's write says nothing about this ledger", () => {
		expect(isCacheInvalidatingWrite({ method: 'POST', sameOrigin: false, online: true })).toBe(
			false
		);
	});

	// Offline, the write is going nowhere and the cache is the only copy of
	// anything: emptying it would take the app's offline reading with it.
	test('offline, a write leaves the cache alone', () => {
		expect(isCacheInvalidatingWrite({ method: 'POST', sameOrigin: true, online: false })).toBe(
			false
		);
	});
});
