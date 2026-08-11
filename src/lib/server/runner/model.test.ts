import { expect, test } from 'vitest';
import { AcpAgentModel } from './model.ts';
import { RunnerConfigurationError } from './errors.ts';

const FIXTURE_AGENT = new URL('./__fixtures__/fake-acp-agent.ts', import.meta.url).pathname;

test('an unconfigured agent refuses immediately, without spawning anything', async () => {
	const model = new AcpAgentModel(null, 5000);
	await expect(model.call({ instructions: 'x', content: 'y' })).rejects.toThrow(
		RunnerConfigurationError
	);
	await expect(model.call({ instructions: 'x', content: 'y' })).rejects.toThrow(
		/RUNNER_AGENT_COMMAND/
	);
});

test('a configured agent speaks real ACP and returns its text', async () => {
	const model = new AcpAgentModel(
		{
			command: process.execPath,
			args: [FIXTURE_AGENT],
			env: {
				FAKE_AGENT_RESPONSE: JSON.stringify({
					excerpt: 'ok for Thursday',
					confidence: 0.8,
					proposedFields: { date: '2024-01-04' }
				})
			}
		},
		5000
	);
	const { text } = await model.call({
		instructions: 'extract the day',
		content: 'ok for Thursday'
	});
	expect(JSON.parse(text)).toEqual({
		excerpt: 'ok for Thursday',
		confidence: 0.8,
		proposedFields: { date: '2024-01-04' }
	});
});

test('an agent that exits before answering fails loudly, not with a fabricated response', async () => {
	const model = new AcpAgentModel(
		{ command: process.execPath, args: [FIXTURE_AGENT], env: { FAKE_AGENT_EXIT_CODE: '1' } },
		2000
	);
	await expect(model.call({ instructions: 'x', content: 'y' })).rejects.toThrow();
});

test('an agent that never responds in time fails loudly rather than hanging the runner', async () => {
	const model = new AcpAgentModel(
		{ command: process.execPath, args: [FIXTURE_AGENT], env: { FAKE_AGENT_DELAY_MS: '2000' } },
		200
	);
	await expect(model.call({ instructions: 'x', content: 'y' })).rejects.toThrow(/did not respond/);
});
