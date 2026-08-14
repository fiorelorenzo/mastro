import { expect, test } from 'vitest';
import { isRunnerConfigured } from './status';

test('isRunnerConfigured is false when RUNNER_AGENT_COMMAND is unset or blank', () => {
	expect(isRunnerConfigured({})).toBe(false);
	expect(isRunnerConfigured({ RUNNER_AGENT_COMMAND: '' })).toBe(false);
	expect(isRunnerConfigured({ RUNNER_AGENT_COMMAND: '   ' })).toBe(false);
});

test('isRunnerConfigured is true once a command is set, whitespace trimmed', () => {
	expect(isRunnerConfigured({ RUNNER_AGENT_COMMAND: 'npx' })).toBe(true);
	expect(isRunnerConfigured({ RUNNER_AGENT_COMMAND: '  npx  ' })).toBe(true);
});
