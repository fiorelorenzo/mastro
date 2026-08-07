// #82: the model interface every producer (#85/#86/#87) calls through,
// and its two implementations — one CLI agent spawned locally, one
// spawned as the hosted path once `routing.ts` has already cleared it.
// Both speak ACP (`acp-client.ts`); neither is a fake. With no local model
// and no hosted credentials available on this box, `AcpAgentModel.call`
// throws `RunnerConfigurationError` immediately when its agent is
// unconfigured, rather than returning a plausible-looking response —
// see `model.test.ts` for what is actually exercised here versus what
// cannot be, honestly, without either of those.

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
 * An `ExtractionModel` backed by one configured ACP CLI agent —
 * `AcpAgentModel('local', config.localAgent, ...)` or
 * `AcpAgentModel('hosted', config.hostedAgent, ...)`, built once in
 * `cli.ts` from `loadRunnerConfig()`. `agent === null` means this
 * provider has no command configured; `call` refuses immediately rather
 * than spawning anything, which is what makes "no local model on this
 * box" and "no hosted credentials" fail loudly instead of silently.
 */
export class AcpAgentModel implements ExtractionModel {
	// Explicit fields assigned in the constructor body, not TypeScript
	// parameter properties (`constructor(private readonly x: T)`) — Node's
	// strip-only mode (`scripts/runner.ts` runs this file, transitively,
	// under plain `node`) rejects that syntax outright
	// (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`), since it is a real
	// transformation, not merely type annotations to erase.
	private readonly kind: 'local' | 'hosted';
	private readonly agent: AgentCommandConfig | null;
	private readonly timeoutMs: number;

	constructor(kind: 'local' | 'hosted', agent: AgentCommandConfig | null, timeoutMs: number) {
		this.kind = kind;
		this.agent = agent;
		this.timeoutMs = timeoutMs;
	}

	async call(input: ModelCallInput): Promise<ModelCallOutput> {
		if (this.agent === null) {
			throw new RunnerConfigurationError(
				`no ${this.kind} agent is configured (RUNNER_${this.kind.toUpperCase()}_AGENT_COMMAND ` +
					'is unset) — refusing to fabricate a proposal. Configure a real ACP-speaking CLI ' +
					'agent, or do not route work to this provider.'
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
