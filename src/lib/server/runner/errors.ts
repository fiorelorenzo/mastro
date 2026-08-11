// #82: how the ACP runner refuses to proceed. Not a bug report — the
// boundary working as designed, so callers (and the tests in this folder)
// match on `instanceof`, not on message text.

/**
 * Thrown when the runner is asked to do something it has no configuration
 * for — no agent command, a malformed `RUNNER_AGENT_ARGS`/`RUNNER_AGENT_ENV`.
 * This is the "fail loudly" half of #82's acceptance: with no agent
 * configured, the honest behaviour is a clear, immediate error, never a
 * plausible-looking fake proposal.
 */
export class RunnerConfigurationError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'RunnerConfigurationError';
	}
}
