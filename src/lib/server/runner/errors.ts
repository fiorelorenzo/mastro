// #82: the two ways the ACP runner refuses to proceed. Neither is a bug
// report — both are the boundary working as designed, so callers (and the
// tests in this folder) match on `instanceof`, not on message text.

/**
 * Thrown by `resolveProvider` (`routing.ts`) when a caller asks for the
 * hosted provider on a contract whose `hosted_extraction_consent_document_id`
 * is null. Thrown before any model object is even touched — see
 * `job.ts`'s `processExtractionJob`, which calls `resolveProvider` before
 * it ever references `models.hosted` — so there is nothing this error can
 * race against: refusal always happens before the network could be
 * reached, not merely before a network call would have succeeded.
 */
export class HostedExtractionRefused extends Error {
	constructor(contractId: string) {
		super(
			`contract ${contractId} has no hosted_extraction_consent_document_id on file; ` +
				'refusing the hosted extraction call rather than falling back to the local ' +
				"model (#81's decision: null means local-only, with no silent fallback the " +
				'other direction either)'
		);
		this.name = 'HostedExtractionRefused';
	}
}

/**
 * Thrown when the runner is asked to do something it has no configuration
 * for — no local agent command, no hosted agent command, a malformed
 * `RUNNER_*_AGENT_ARGS`/`RUNNER_*_AGENT_ENV`. This is the "fail loudly"
 * half of #82's acceptance: with no local model and no hosted credentials
 * available, the honest behaviour is a clear, immediate error, never a
 * plausible-looking fake proposal.
 */
export class RunnerConfigurationError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'RunnerConfigurationError';
	}
}
