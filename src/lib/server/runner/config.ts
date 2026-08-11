// #82: everything the runner reads from its own environment. Deliberately
// never `$env/dynamic/private` — that module is a SvelteKit snapshot of
// the *app's* environment, and the whole point of this process is that it
// holds its own credentials, separate from the app's. Plain `process.env`
// also means this file runs unmodified under plain `node` (see
// `scripts/runner.ts`), the same reason `scripts/migrate.ts` reads
// `process.env.DATABASE_URL` directly instead of importing `$lib/server/db`.

import { RunnerConfigurationError } from './errors.ts';

export interface AgentCommandConfig {
	readonly command: string;
	readonly args: readonly string[];
	/** Environment for the spawned subprocess only — never this process's
	 * own `process.env`. See `acp-client.ts`: the child is spawned with
	 * exactly this object, nothing inherited, so `RUNNER_DATABASE_URL` and
	 * every other credential this process holds can never reach the model
	 * agent. */
	readonly env: Readonly<Record<string, string>>;
}

export interface RunnerConfig {
	readonly databaseUrl: string;
	readonly queueDir: string;
	readonly modelTimeoutMs: number;
	/** `null` when unconfigured — a supported state, not an error, until a
	 * job actually needs it. See `model.ts`'s `AcpAgentModel`, which is what
	 * turns "null" into the loud failure #82 asks for. */
	readonly agent: AgentCommandConfig | null;
}

function parseJsonArrayOfStrings(varName: string, raw: string | undefined): string[] {
	if (raw === undefined || raw === '') return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new RunnerConfigurationError(`${varName} must be a JSON array of strings, got: ${raw}`, {
			cause
		});
	}
	if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
		throw new RunnerConfigurationError(`${varName} must be a JSON array of strings, got: ${raw}`);
	}
	return parsed;
}

function parseJsonObjectOfStrings(
	varName: string,
	raw: string | undefined
): Record<string, string> {
	if (raw === undefined || raw === '') return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new RunnerConfigurationError(`${varName} must be a JSON object of strings, got: ${raw}`, {
			cause
		});
	}
	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		Array.isArray(parsed) ||
		!Object.values(parsed).every((value) => typeof value === 'string')
	) {
		throw new RunnerConfigurationError(`${varName} must be a JSON object of strings, got: ${raw}`);
	}
	return parsed as Record<string, string>;
}

function loadAgentCommand(env: NodeJS.ProcessEnv): AgentCommandConfig | null {
	const command = env.RUNNER_AGENT_COMMAND;
	if (!command) return null;
	return {
		command,
		args: parseJsonArrayOfStrings('RUNNER_AGENT_ARGS', env.RUNNER_AGENT_ARGS),
		env: parseJsonObjectOfStrings('RUNNER_AGENT_ENV', env.RUNNER_AGENT_ENV)
	};
}

const DEFAULT_QUEUE_DIR = './data/runner-queue';
const DEFAULT_MODEL_TIMEOUT_MS = 120_000;

export function loadRunnerConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
	const databaseUrl = env.RUNNER_DATABASE_URL;
	if (!databaseUrl) {
		throw new RunnerConfigurationError(
			'RUNNER_DATABASE_URL is not set. The runner needs its own connection string, using ' +
				'the mastro_runner role created by drizzle/0035_acp_runner_role.sql — never the ' +
				"app's own DATABASE_URL, which can write to the ledger."
		);
	}
	const modelTimeoutMs = env.RUNNER_MODEL_TIMEOUT_MS
		? Number(env.RUNNER_MODEL_TIMEOUT_MS)
		: DEFAULT_MODEL_TIMEOUT_MS;
	if (!Number.isFinite(modelTimeoutMs) || modelTimeoutMs <= 0) {
		throw new RunnerConfigurationError(
			`RUNNER_MODEL_TIMEOUT_MS must be a positive number, got: ${env.RUNNER_MODEL_TIMEOUT_MS}`
		);
	}
	return {
		databaseUrl,
		queueDir: env.RUNNER_QUEUE_DIR || DEFAULT_QUEUE_DIR,
		modelTimeoutMs,
		agent: loadAgentCommand(env)
	};
}
