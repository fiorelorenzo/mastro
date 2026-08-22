import { expect, test } from 'vitest';
import { rereadEligibility } from './reread-eligibility';

test('a conversation with no in-flight run can be re-read', () => {
	expect(rereadEligibility({ hasInFlightRun: false })).toEqual({ canReread: true, reason: null });
});

test('a conversation that already has a queued or running run refuses a second ask', () => {
	expect(rereadEligibility({ hasInFlightRun: true })).toEqual({
		canReread: false,
		reason: 'in_flight'
	});
});
