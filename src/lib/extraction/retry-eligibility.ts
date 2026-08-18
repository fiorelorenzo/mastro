/**
 * Whether a failed extraction run can be retried, and why not when it
 * cannot (#315). Pure, and outside `$lib/server` for the same reason
 * `failure-kind.ts` is: the run page reads it live, off the SSE
 * `status`/`failureKind` it already tracks, so a run that fails while the
 * page is open offers (or explains the absence of) a retry without a
 * reload. The server action re-derives the same facts fresh and calls
 * this again before it acts — never trusting what the page rendered —
 * so the two never drift into two different answers.
 */

import { canRetryFailure, type ExtractionFailureKind } from './failure-kind';

/**
 * Total attempts allowed per document: the original run plus this many
 * retries. A human presses the retry button each time (#315's own
 * acceptance: "no automatic retry loop") — nothing here loops on its own
 * — so this only guards against clicking through the same transient
 * failure indefinitely. Counted from how many `extraction_run` rows
 * already name the document (`countExtractionRunsForDocument`), not a
 * column of its own: one document is ever the subject of one lineage of
 * attempts, so that row count already is the attempt count, with nothing
 * new to keep in sync.
 */
export const MAX_EXTRACTION_ATTEMPTS = 3;

/**
 * Why a retry was not offered, or was refused when attempted anyway.
 * `kind_unknown` and `kind_not_retryable` are both "the failure kind says
 * no", but they say it for different, non-interchangeable reasons: a run
 * that failed before the `failure_kind` column existed has nothing on
 * record to judge by, which is not the same claim as `write_refused`'s
 * "the model already answered, and that answer was refused" — telling
 * them apart keeps the run page from asserting something about a legacy
 * run it does not actually know. `source_missing` is not one
 * {@link retryEligibility} itself can find — it only ever surfaces once a
 * retry that *was* eligible then failed to re-read the archived document
 * behind it (`agent/retry.ts`) — but it is a reason a retry did not
 * happen the same way the other five are, so it shares this type rather
 * than a second one next to it.
 */
export type RetryBlockReason =
	| 'not_failed'
	| 'kind_unknown'
	| 'kind_not_retryable'
	| 'attempts_exhausted'
	| 'already_has_proposals'
	| 'source_missing';

export interface RetryFacts {
	readonly isFailed: boolean;
	readonly failureKind: ExtractionFailureKind | null;
	readonly attemptCount: number;
	readonly hasProposals: boolean;
}

export interface RetryEligibility {
	readonly canRetry: boolean;
	readonly reason: RetryBlockReason | null;
}

/**
 * The failure-kind check runs before `attempts_exhausted` and
 * `already_has_proposals`: what a reader wants to know first is whether
 * retrying could ever help, not how many tries are left or whether
 * someone else's attempt already produced something. `already_has_proposals`
 * is checked last because it is the rarest path here — the document's own
 * run failed, so proposals for it can only exist from a *different* run,
 * itself only reachable by retrying this one before — and the least
 * actionable: there is nothing left to do here at all, retry or not.
 */
export function retryEligibility(facts: RetryFacts): RetryEligibility {
	if (!facts.isFailed) return { canRetry: false, reason: 'not_failed' };
	if (facts.failureKind === null) return { canRetry: false, reason: 'kind_unknown' };
	if (!canRetryFailure(facts.failureKind)) {
		return { canRetry: false, reason: 'kind_not_retryable' };
	}
	if (facts.attemptCount >= MAX_EXTRACTION_ATTEMPTS) {
		return { canRetry: false, reason: 'attempts_exhausted' };
	}
	if (facts.hasProposals) return { canRetry: false, reason: 'already_has_proposals' };
	return { canRetry: true, reason: null };
}
