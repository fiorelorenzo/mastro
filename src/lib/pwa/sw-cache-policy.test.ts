import { describe, expect, test } from 'vitest';
import {
	dataCacheKey,
	dataCacheName,
	isCacheableDataRequest,
	isSessionInvalidPayload,
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
