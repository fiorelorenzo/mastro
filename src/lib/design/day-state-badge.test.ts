// Pure-logic coverage of the day-state → Badge mapping (no
// @testing-library/svelte in this project — see badge-variants.ts).
// Exhaustiveness itself (a 12th work_unit state or a 4th queued status)
// is enforced by the TypeScript compiler against the Record types in
// day-state-badge.ts, not by a test; what a test can and must prove is
// that the eleven concrete states (docs/specs/ux-review/04-day-lifecycle.md:310-315)
// each resolve to exactly one variant, and that `worked_without_approval`
// is the single most visually distinct one.

import { describe, expect, test } from 'vitest';
import type { QueuedDayStatus } from '$lib/pwa/offline-queue';
import { getLocale, overwriteGetLocale } from '$lib/paraglide/runtime';
import {
	queuedDayStatusBadge,
	workUnitStateBadge,
	workUnitStates,
	type WorkUnitStateValue
} from './day-state-badge';

const queuedDayStatuses: readonly QueuedDayStatus[] = ['pending', 'syncing', 'failed'];

describe('workUnitStateBadge', () => {
	test('resolves all ten work_unit states', () => {
		for (const state of workUnitStates) {
			const result = workUnitStateBadge(state);
			expect(result.variant, state).toBeTruthy();
			expect(result.glyph, state).toBeTruthy();
			expect(result.label, state).toBeTruthy();
		}
	});

	test('every state has a non-empty, state-specific label', () => {
		const labels = workUnitStates.map((state) => workUnitStateBadge(state).label);
		expect(new Set(labels).size).toBe(workUnitStates.length);
	});

	test('worked_without_approval is the only critical day state', () => {
		const criticalStates = workUnitStates.filter(
			(state) => workUnitStateBadge(state).variant === 'critical'
		);
		expect(criticalStates).toEqual(['worked_without_approval']);
	});

	test('worked_without_approval does not share its variant with any other state', () => {
		const wwaVariant = workUnitStateBadge('worked_without_approval').variant;
		const sharing = workUnitStates.filter(
			(state): state is Exclude<WorkUnitStateValue, 'worked_without_approval'> =>
				state !== 'worked_without_approval' && workUnitStateBadge(state).variant === wwaVariant
		);
		expect(sharing).toEqual([]);
	});

	test("worked_without_approval's glyph matches its Badge variant's glyph", () => {
		const result = workUnitStateBadge('worked_without_approval');
		expect(result.glyph).toBe('■');
	});
});

describe('queuedDayStatusBadge', () => {
	test('resolves all three offline queue statuses', () => {
		for (const status of queuedDayStatuses) {
			const result = queuedDayStatusBadge(status);
			expect(result.variant, status).toBeTruthy();
			expect(result.glyph, status).toBeTruthy();
			expect(result.label, status).toBeTruthy();
		}
	});

	test('failed is never critical: that variant is reserved for worked_without_approval', () => {
		expect(queuedDayStatusBadge('failed').variant).not.toBe('critical');
	});

	test('the three queued statuses are distinguishable by variant', () => {
		const variants = queuedDayStatuses.map((status) => queuedDayStatusBadge(status).variant);
		expect(new Set(variants).size).toBe(queuedDayStatuses.length);
	});
});

// #422: the label maps in day-state-badge.ts hold message *functions*,
// never a called-once string, precisely so a badge resolves against
// whichever locale is active *when it is rendered* rather than whichever
// locale happened to be active the first time this module was imported.
// `overwriteGetLocale` simulates a request switching locale the way
// `setLocale` would in the browser (same technique as
// `$lib/i18n/proposal-issue.test.ts`). Before the fix this test would have
// failed: both reads would have returned whatever string was frozen in at
// import time.
describe('labels follow the active locale at call time, not import time', () => {
	test('a day-state badge label follows a locale switch', () => {
		const originalGetLocale = getLocale;
		try {
			overwriteGetLocale(() => 'en');
			expect(workUnitStateBadge('proposed').label).toBe('Proposed');

			overwriteGetLocale(() => 'it');
			expect(workUnitStateBadge('proposed').label).toBe('Proposta');
		} finally {
			overwriteGetLocale(originalGetLocale);
		}
	});

	test('a queued-day-status badge label follows a locale switch', () => {
		const originalGetLocale = getLocale;
		try {
			overwriteGetLocale(() => 'en');
			expect(queuedDayStatusBadge('pending').label).toBe(
				"Queued — will sync when you're back online"
			);

			overwriteGetLocale(() => 'it');
			expect(queuedDayStatusBadge('pending').label).toBe(
				'In coda — verrà sincronizzata quando torni online'
			);
		} finally {
			overwriteGetLocale(originalGetLocale);
		}
	});
});
