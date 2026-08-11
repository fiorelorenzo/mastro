import { expect, test } from 'vitest';
import { loadRunnerConfig } from './config.ts';
import { RunnerConfigurationError } from './errors.ts';

const BASE_ENV = { RUNNER_DATABASE_URL: 'postgres://mastro_runner:x@localhost:5432/mastro' };

test('RUNNER_DATABASE_URL is required', () => {
	expect(() => loadRunnerConfig({})).toThrow(RunnerConfigurationError);
	expect(() => loadRunnerConfig({})).toThrow(/RUNNER_DATABASE_URL/);
});

test('with nothing else set, the agent is unconfigured and defaults apply', () => {
	const config = loadRunnerConfig(BASE_ENV);
	expect(config.agent).toBeNull();
	expect(config.queueDir).toBe('./data/runner-queue');
	expect(config.modelTimeoutMs).toBe(120_000);
});

test('an agent command with no args/env still resolves to empty defaults', () => {
	const config = loadRunnerConfig({ ...BASE_ENV, RUNNER_AGENT_COMMAND: 'my-agent' });
	expect(config.agent).toEqual({ command: 'my-agent', args: [], env: {} });
});

test('args and env parse from JSON', () => {
	const config = loadRunnerConfig({
		...BASE_ENV,
		RUNNER_AGENT_COMMAND: 'my-agent',
		RUNNER_AGENT_ARGS: '["--flag", "value"]',
		RUNNER_AGENT_ENV: '{"API_KEY": "secret"}'
	});
	expect(config.agent).toEqual({
		command: 'my-agent',
		args: ['--flag', 'value'],
		env: { API_KEY: 'secret' }
	});
});

test('malformed RUNNER_AGENT_ARGS is a loud configuration error, not a silent empty array', () => {
	expect(() =>
		loadRunnerConfig({
			...BASE_ENV,
			RUNNER_AGENT_COMMAND: 'x',
			RUNNER_AGENT_ARGS: 'not json'
		})
	).toThrow(RunnerConfigurationError);
});

test('RUNNER_AGENT_ARGS must be an array of strings, not e.g. numbers', () => {
	expect(() =>
		loadRunnerConfig({
			...BASE_ENV,
			RUNNER_AGENT_COMMAND: 'x',
			RUNNER_AGENT_ARGS: '[1, 2]'
		})
	).toThrow(RunnerConfigurationError);
});

test('malformed RUNNER_AGENT_ENV is a loud configuration error', () => {
	expect(() =>
		loadRunnerConfig({
			...BASE_ENV,
			RUNNER_AGENT_COMMAND: 'x',
			RUNNER_AGENT_ENV: '["not", "an", "object"]'
		})
	).toThrow(RunnerConfigurationError);
});

test('RUNNER_MODEL_TIMEOUT_MS overrides the default when it is a positive number', () => {
	const config = loadRunnerConfig({ ...BASE_ENV, RUNNER_MODEL_TIMEOUT_MS: '5000' });
	expect(config.modelTimeoutMs).toBe(5000);
});

test('a non-positive RUNNER_MODEL_TIMEOUT_MS is rejected', () => {
	expect(() => loadRunnerConfig({ ...BASE_ENV, RUNNER_MODEL_TIMEOUT_MS: '0' })).toThrow(
		RunnerConfigurationError
	);
	expect(() => loadRunnerConfig({ ...BASE_ENV, RUNNER_MODEL_TIMEOUT_MS: 'nan' })).toThrow(
		RunnerConfigurationError
	);
});
