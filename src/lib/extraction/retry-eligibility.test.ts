import { expect, test } from 'vitest';
import { MAX_EXTRACTION_ATTEMPTS, retryEligibility } from './retry-eligibility';

function facts(over: Partial<Parameters<typeof retryEligibility>[0]> = {}) {
	return {
		isFailed: true,
		failureKind: 'timed_out' as const,
		attemptCount: 1,
		hasProposals: false,
		...over
	};
}

test('a run that has not failed cannot be retried', () => {
	expect(retryEligibility(facts({ isFailed: false }))).toEqual({
		canRetry: false,
		reason: 'not_failed'
	});
});

test('a retryable kind, under the bound, with no proposals yet is eligible', () => {
	expect(retryEligibility(facts({ failureKind: 'agent_failed' }))).toEqual({
		canRetry: true,
		reason: null
	});
	expect(retryEligibility(facts({ failureKind: 'timed_out' }))).toEqual({
		canRetry: true,
		reason: null
	});
});

test('write_refused is not retryable — the model already answered against this document', () => {
	expect(retryEligibility(facts({ failureKind: 'write_refused' }))).toEqual({
		canRetry: false,
		reason: 'kind_not_retryable'
	});
});

test('a run that failed before failureKind existed cannot be retried — there is nothing on record to judge by, which reads differently from write_refused', () => {
	expect(retryEligibility(facts({ failureKind: null }))).toEqual({
		canRetry: false,
		reason: 'kind_unknown'
	});
});

test('the bound refuses at MAX_EXTRACTION_ATTEMPTS, not one past it', () => {
	expect(retryEligibility(facts({ attemptCount: MAX_EXTRACTION_ATTEMPTS - 1 }))).toEqual({
		canRetry: true,
		reason: null
	});
	expect(retryEligibility(facts({ attemptCount: MAX_EXTRACTION_ATTEMPTS }))).toEqual({
		canRetry: false,
		reason: 'attempts_exhausted'
	});
});

test('a document that already picked up proposals from another attempt has nothing left to retry', () => {
	expect(retryEligibility(facts({ hasProposals: true }))).toEqual({
		canRetry: false,
		reason: 'already_has_proposals'
	});
});

test('the failure kind is reported before the bound or the duplicate guard, since it answers "would this ever help" first', () => {
	expect(
		retryEligibility(
			facts({
				failureKind: 'write_refused',
				attemptCount: MAX_EXTRACTION_ATTEMPTS,
				hasProposals: true
			})
		)
	).toEqual({ canRetry: false, reason: 'kind_not_retryable' });
});
