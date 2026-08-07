import { describe, expect, test } from 'vitest';
import {
	EMPTY_FRESHNESS_STATE,
	oldestStaleAt,
	recordRevalidated,
	recordSessionInvalid,
	recordStaleServe
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
