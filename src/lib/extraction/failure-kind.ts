/**
 * What kind of thing went wrong in an extraction run, as opposed to the
 * sentence describing it.
 *
 * A run's `error` is diagnostic text: a model's malformed JSON, a zod
 * issue list, a quotation that is not in the document. It is worth keeping
 * verbatim — it is what found the excerpt defect in #283 in twenty-seven
 * seconds — and it is worth showing, but it is not something a reader can
 * be expected to understand on its own, and it is English regardless of
 * what language the interface is speaking.
 *
 * So the kind is recorded separately, at the point of failure where it is
 * already known, and never inferred from the text afterwards. Matching on
 * a diagnostic string to work out what it meant is exactly the mistake
 * `$lib/proposals/validation-issue.ts` exists to undo.
 *
 * Outside `$lib/server` because the run page renders it.
 */
export type ExtractionFailureKind =
	/**
	 * The runner's own extraction call failed: the agent could not be
	 * spawned, the model answered with something that is not the JSON the
	 * job asked for, or the document named by the job was not readable by
	 * the runner's role.
	 */
	| 'agent_failed'
	/**
	 * The model answered and the answer was refused on its way to the
	 * ledger: it did not match the target's shape, or its quotation could
	 * not be found in the document it claims to quote. The extraction
	 * reached `extracted` and got no further — the gap that had no name
	 * before extraction runs existed.
	 */
	| 'write_refused'
	/**
	 * The runner never came back. Distinct from `agent_failed` because
	 * nothing failed as such: there is no diagnostic to read, and the job
	 * may still be running somewhere.
	 */
	| 'timed_out';

export const EXTRACTION_FAILURE_KINDS: readonly ExtractionFailureKind[] = [
	'agent_failed',
	'write_refused',
	'timed_out'
];

export function isExtractionFailureKind(value: unknown): value is ExtractionFailureKind {
	return (
		typeof value === 'string' && (EXTRACTION_FAILURE_KINDS as readonly string[]).includes(value)
	);
}

/**
 * Whether a retry can plausibly change the outcome (#315). `timed_out`
 * and `agent_failed` are both about the runner never producing a usable
 * answer at all — a spawn failure, a wedged process, a raw response that
 * was not even the JSON shape the job asked for — none of which says
 * anything about whether this document can be extracted, so a second
 * attempt is a fair thing to offer. `write_refused` is different in
 * kind: the model already answered, against this exact document, and the
 * app's own validation rejected that answer. A retry reads the same
 * document with the same instructions, so it is not a fresh chance so
 * much as a repeat of a question already asked and already answered —
 * not offered here, and the run page says why.
 */
export function canRetryFailure(kind: ExtractionFailureKind): boolean {
	switch (kind) {
		case 'agent_failed':
		case 'timed_out':
			return true;
		case 'write_refused':
			return false;
	}
}
