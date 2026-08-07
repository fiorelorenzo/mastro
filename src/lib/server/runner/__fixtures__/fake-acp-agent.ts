#!/usr/bin/env node
// Test fixture only — never wired into any production path. A minimal,
// genuinely ACP-speaking agent (real `initialize`/`session/new`/
// `session/prompt` handshake, `@agentclientprotocol/sdk`'s own `agent()`
// builder) used to prove `acp-client.ts` actually drives the protocol
// correctly, since this repository has no real local model to test
// against (see #82's PR description for exactly what that does and does
// not prove).
//
// Behaviour, controlled entirely by environment variables so a test can
// drive it without touching this file:
//   FAKE_AGENT_RESPONSE   the exact text sent back as one agent_message_chunk
//   FAKE_AGENT_DELAY_MS   milliseconds to wait before responding (default 0)
//   FAKE_AGENT_EXIT_CODE  if set, exits with this code before responding —
//                         simulates a crashed/misbehaving agent
import { Readable, Writable } from 'node:stream';
import { agent, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

const exitCode = process.env.FAKE_AGENT_EXIT_CODE;
if (exitCode !== undefined) {
	process.exit(Number(exitCode));
}

const response =
	process.env.FAKE_AGENT_RESPONSE ?? '{"excerpt":"stub","confidence":0.5,"proposedFields":{}}';
const delayMs = Number(process.env.FAKE_AGENT_DELAY_MS ?? '0');

const stream = ndJsonStream(
	Writable.toWeb(process.stdout),
	Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
);

await agent({ name: 'fake-acp-agent' })
	.onRequest('initialize', () => ({
		protocolVersion: PROTOCOL_VERSION,
		agentCapabilities: { loadSession: false }
	}))
	.onRequest('session/new', () => ({ sessionId: 'fake-session' }))
	.onRequest('session/prompt', async (ctx) => {
		if (delayMs > 0) {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, delayMs);
			await promise;
		}
		await ctx.client.notify('session/update', {
			sessionId: ctx.params.sessionId,
			update: {
				sessionUpdate: 'agent_message_chunk',
				content: { type: 'text', text: response }
			}
		});
		return { stopReason: 'end_turn' };
	})
	.connectWith(stream, () => Promise.withResolvers<never>().promise);
