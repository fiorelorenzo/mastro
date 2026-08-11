// #82: the model interface every producer (#85/#86/#87) calls through, and
// its one implementation — the configured ACP CLI agent (`acp-client.ts`),
// never a fake. With no agent configured, `AcpAgentModel.call` throws
// `RunnerConfigurationError` immediately rather than returning a
// plausible-looking response.

import { runAcpPrompt } from './acp-client.ts';
import type { AgentCommandConfig } from './config.ts';
import { RunnerConfigurationError } from './errors.ts';

export interface ModelCallInput {
	readonly instructions: string;
	readonly content: string;
}

export interface ModelCallOutput {
	readonly text: string;
}

/** What every producer calls through — `job.ts` never spawns a process or
 * touches ACP directly, only ever this interface. */
export interface ExtractionModel {
	call(input: ModelCallInput): Promise<ModelCallOutput>;
}

/**
 * An `ExtractionModel` backed by the configured ACP CLI agent —
 * `AcpAgentModel(config.agent, config.modelTimeoutMs)`, built once in
 * `cli.ts` from `loadRunnerConfig()`. `agent === null` means no command is
 * configured; `call` refuses immediately rather than spawning anything,
 * which is what makes "no agent on this box" fail loudly instead of
 * silently.
 */
export class AcpAgentModel implements ExtractionModel {
	// Explicit fields assigned in the constructor body, not TypeScript
	// parameter properties (`constructor(private readonly x: T)`) — Node's
	// strip-only mode (`scripts/runner.ts` runs this file, transitively,
	// under plain `node`) rejects that syntax outright
	// (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`), since it is a real
	// transformation, not merely type annotations to erase.
	private readonly agent: AgentCommandConfig | null;
	private readonly timeoutMs: number;

	constructor(agent: AgentCommandConfig | null, timeoutMs: number) {
		this.agent = agent;
		this.timeoutMs = timeoutMs;
	}

	async call(input: ModelCallInput): Promise<ModelCallOutput> {
		if (this.agent === null) {
			throw new RunnerConfigurationError(
				'no agent is configured (RUNNER_AGENT_COMMAND is unset) — refusing to fabricate a ' +
					'proposal. Configure a real ACP-speaking CLI agent; see docs/agent-runner.md.'
			);
		}
		const text = await runAcpPrompt({
			command: this.agent.command,
			args: this.agent.args,
			env: this.agent.env,
			prompt: `${input.instructions}\n\n---\n\n${input.content}`,
			timeoutMs: this.timeoutMs
		});
		return { text };
	}
}
