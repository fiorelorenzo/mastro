import { expect, test } from 'vitest';
import { runAcpPrompt } from './acp-client.ts';

// Genuine ACP (agentclientprotocol.com) protocol traffic against the test
// fixture agent (`__fixtures__/fake-acp-agent.ts`) — a real subprocess,
// spawned, handshaken (`initialize`, `session/new`), prompted
// (`session/prompt`) and read back over stdio, the same transport a real
// local or hosted CLI agent would use. What this cannot prove — because
// no local model and no hosted credentials exist on this box — is that a
// real model's answers are any good; that is `model.test.ts`'s
// "configuration and failure modes" scope, not this file's.

const FIXTURE_AGENT = new URL('./__fixtures__/fake-acp-agent.ts', import.meta.url).pathname;

test('a real ACP round trip returns the agent-declared response text', async () => {
	const text = await runAcpPrompt({
		command: process.execPath,
		args: [FIXTURE_AGENT],
		env: { FAKE_AGENT_RESPONSE: 'hello from the agent' },
		prompt: 'say hello',
		timeoutMs: 5000
	});
	expect(text).toBe('hello from the agent');
});

test('onUpdate sees every update in order, and the returned text is still only the message chunk', async () => {
	const updates: Array<{ kind: string; payload: string }> = [];
	const extraUpdates = [
		{
			sessionUpdate: 'agent_thought_chunk',
			content: { type: 'text', text: 'considering the excerpt' }
		},
		{
			sessionUpdate: 'tool_call',
			toolCallId: 'tc1',
			title: 'reading the contract',
			status: 'completed'
		},
		{
			sessionUpdate: 'plan',
			entries: [{ content: 'extract the day', priority: 'high', status: 'in_progress' }]
		}
	];

	const text = await runAcpPrompt({
		command: process.execPath,
		args: [FIXTURE_AGENT],
		env: {
			FAKE_AGENT_RESPONSE: 'hello from the agent',
			FAKE_AGENT_UPDATES: JSON.stringify(extraUpdates)
		},
		prompt: 'say hello',
		timeoutMs: 5000,
		onUpdate: (update) => updates.push(update)
	});

	// The accumulated return value stays exactly what `readText()` used to
	// produce — only the message chunk — even though `onUpdate` above saw
	// three other update kinds first.
	expect(text).toBe('hello from the agent');
	expect(updates.map((u) => u.kind)).toEqual(['thought', 'tool_call', 'plan', 'message', 'stop']);
	expect(updates[0].payload).toBe('considering the excerpt');
	expect(updates[3].payload).toBe('hello from the agent');
	expect(updates[4].payload).toBe('end_turn');
	expect(JSON.parse(updates[1].payload)).toMatchObject({
		sessionUpdate: 'tool_call',
		toolCallId: 'tc1'
	});
	expect(JSON.parse(updates[2].payload)).toMatchObject({ sessionUpdate: 'plan' });
});

test('spawning a command that does not exist fails with a clear error, not a hang or a crash', async () => {
	await expect(
		runAcpPrompt({
			command: '/no/such/binary-exists-here',
			args: [],
			env: {},
			prompt: 'x',
			timeoutMs: 2000
		})
	).rejects.toThrow(/could not start/);
});

test('an agent that exceeds the timeout is reported, not waited on forever', async () => {
	await expect(
		runAcpPrompt({
			command: process.execPath,
			args: [FIXTURE_AGENT],
			env: { FAKE_AGENT_DELAY_MS: '3000' },
			prompt: 'x',
			timeoutMs: 200
		})
	).rejects.toThrow(/did not respond within 200ms/);
});

test('an agent that exits immediately fails cleanly', async () => {
	await expect(
		runAcpPrompt({
			command: process.execPath,
			args: [FIXTURE_AGENT],
			env: { FAKE_AGENT_EXIT_CODE: '3' },
			prompt: 'x',
			timeoutMs: 2000
		})
	).rejects.toThrow();
});
