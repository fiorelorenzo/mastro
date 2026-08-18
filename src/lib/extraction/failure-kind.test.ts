import { expect, test } from 'vitest';
import { canRetryFailure, EXTRACTION_FAILURE_KINDS } from './failure-kind';

test('a retry is offered for the two kinds with no model answer to repeat, never for the one that already has one', () => {
	expect(canRetryFailure('agent_failed')).toBe(true);
	expect(canRetryFailure('timed_out')).toBe(true);
	expect(canRetryFailure('write_refused')).toBe(false);
});

test('every known failure kind gets an explicit answer, not a fallthrough default', () => {
	for (const kind of EXTRACTION_FAILURE_KINDS) {
		expect(typeof canRetryFailure(kind)).toBe('boolean');
	}
});
