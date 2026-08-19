import { describe, expect, test } from 'vitest';
import {
	EMPTY_FRESHNESS_STATE,
	oldestStaleAt,
	recordRevalidated,
	recordSessionInvalid,
	recordStaleServe,
	shouldRefreshAfterRevalidation
} from './freshness-policy';

describe('recordStaleServe / oldestStaleAt', () => {
	test('nothing is stale before any cache serve is recorded', () => {
		expect(oldestStaleAt(EMPTY_FRESHNESS_STATE)).toBeNull();
	});

	test('a single stale serve is reported by its own timestamp', () => {
		const state = recordStaleServe(
			EMPTY_FRESHNESS_STATE,
			'/clients/__data.json',
			'2024-03-01T10:00:00Z'
		);
		expect(oldestStaleAt(state)).toBe('2024-03-01T10:00:00Z');
	});

	test('with two stale entries, the older timestamp wins, so the banner never understates how old the data is', () => {
		let state = recordStaleServe(
			EMPTY_FRESHNESS_STATE,
			'/clients/__data.json',
			'2024-03-01T10:00:00Z'
		);
		state = recordStaleServe(state, '/__data.json', '2024-02-15T08:00:00Z');
		expect(oldestStaleAt(state)).toBe('2024-02-15T08:00:00Z');
	});
});

describe('recordRevalidated', () => {
	test('clears exactly the URL the network answered for, leaving other stale entries alone', () => {
		let state = recordStaleServe(
			EMPTY_FRESHNESS_STATE,
			'/clients/__data.json',
			'2024-03-01T10:00:00Z'
		);
		state = recordStaleServe(state, '/__data.json', '2024-02-15T08:00:00Z');

		state = recordRevalidated(state, '/clients/__data.json');

		expect(oldestStaleAt(state)).toBe('2024-02-15T08:00:00Z');
	});

	test('revalidating the only stale entry clears the banner entirely', () => {
		const state = recordStaleServe(
			EMPTY_FRESHNESS_STATE,
			'/clients/__data.json',
			'2024-03-01T10:00:00Z'
		);
		expect(oldestStaleAt(recordRevalidated(state, '/clients/__data.json'))).toBeNull();
	});
});

describe('recordSessionInvalid', () => {
	test('wipes every entry: none of it is safe to keep showing once the session is gone', () => {
		let state = recordStaleServe(
			EMPTY_FRESHNESS_STATE,
			'/clients/__data.json',
			'2024-03-01T10:00:00Z'
		);
		state = recordStaleServe(state, '/__data.json', '2024-02-15T08:00:00Z');

		expect(oldestStaleAt(recordSessionInvalid())).toBeNull();
		expect(recordSessionInvalid()).toEqual(EMPTY_FRESHNESS_STATE);
		// state itself is untouched by the pure call above (no mutation).
		expect(oldestStaleAt(state)).toBe('2024-02-15T08:00:00Z');
	});
});

/*
 * #340: the page used to re-read its data on every `data-fresh` message,
 * which refetched the same URL, which produced another `data-fresh`, which
 * re-read again. An open tab never stopped — about 30 messages a second,
 * measured on a page nobody was touching. These cases are the whole
 * difference between that and a page that corrects itself once.
 */
describe('shouldRefreshAfterRevalidation', () => {
	test('a fresh copy of something never announced stale asks for no re-read', () => {
		expect(shouldRefreshAfterRevalidation(EMPTY_FRESHNESS_STATE, '/clients/__data.json')).toBe(
			false
		);
	});

	test('a fresh copy of a URL that was served stale asks for exactly one re-read', () => {
		const stale = recordStaleServe(
			EMPTY_FRESHNESS_STATE,
			'/clients/__data.json',
			'2024-02-15T08:00:00Z'
		);

		expect(shouldRefreshAfterRevalidation(stale, '/clients/__data.json')).toBe(true);

		// Recording the revalidation clears the entry, so the next fresh
		// message for the same URL asks for nothing: that is what stops the
		// cycle rather than merely slowing it down.
		const revalidated = recordRevalidated(stale, '/clients/__data.json');
		expect(shouldRefreshAfterRevalidation(revalidated, '/clients/__data.json')).toBe(false);
	});

	test('one stale URL does not make another URL ask for a re-read', () => {
		const stale = recordStaleServe(
			EMPTY_FRESHNESS_STATE,
			'/clients/__data.json',
			'2024-02-15T08:00:00Z'
		);

		expect(shouldRefreshAfterRevalidation(stale, '/invoices/__data.json')).toBe(false);
	});
});
