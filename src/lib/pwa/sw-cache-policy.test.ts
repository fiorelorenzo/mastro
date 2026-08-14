import { describe, expect, test } from 'vitest';
import {
	dataCacheKey,
	dataCacheName,
	dayEntryDataUrl,
	isCacheableDataRequest,
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
	test('drops the query string, so a repeat __data.json fetch with a different invalidation marker still hits the same entry', () => {
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
