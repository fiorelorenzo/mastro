// #82: the actual ACP (agentclientprotocol.com) transport — spawn a CLI
// agent as a subprocess, speak JSON-RPC over its stdio, run one prompt
// turn, return its text. This is the only file that touches
// `@agentclientprotocol/sdk` or `node:child_process`; `model.ts` is the
// policy layer above it (which agent, configured how) and never spawns
// anything itself.

import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { client, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

export interface RunAcpPromptInput {
	readonly command: string;
	readonly args: readonly string[];
	/** Exactly what the spawned process's environment is — never this
	 * process's own `process.env`. A model agent, local or hosted, never
	 * sees `RUNNER_DATABASE_URL` or anything else this process holds. */
	readonly env: Readonly<Record<string, string>>;
	readonly prompt: string;
	readonly timeoutMs: number;
	readonly cwd?: string;
}

/**
 * Spawns `command`, completes the ACP `initialize` handshake, opens one
 * session, sends `prompt`, and returns the agent's accumulated text
 * response. The client offers the agent no filesystem or terminal
 * capability at all: an extraction agent has no legitimate reason to read
 * or write anything outside the prompt/response exchange itself, so
 * `clientCapabilities` declares none available.
 *
 * Always kills the child before returning, success or failure — this is a
 * one-shot request/response call, not a session this process keeps open.
 */
export async function runAcpPrompt(input: RunAcpPromptInput): Promise<string> {
	// `detached` so the child leads its own process group, which is the
	// only way to kill what it spawned. The configured agent is `npx`,
	// which execs a wrapper that forks the real agent: killing the wrapper
	// leaves the agent alive holding this process's stdio open, so a run
	// that has already failed hangs until its timeout and every job leaks
	// one more process. Observed, not theorised — three of them were still
	// running after one job.
	const child = spawn(input.command, [...input.args], {
		cwd: input.cwd ?? process.cwd(),
		env: { ...input.env },
		stdio: ['pipe', 'pipe', 'inherit'],
		detached: true
	});

	// `spawn` fails asynchronously (e.g. ENOENT for a command that does not
	// exist) — an unhandled 'error' event on the child would otherwise
	// crash this process instead of surfacing as a rejected promise.
	const spawnFailure = new Promise<never>((_, reject) => {
		child.once('error', (err) =>
			reject(new Error(`could not start '${input.command}': ${err.message}`, { cause: err }))
		);
	});

	const timeout = new Promise<never>((_, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`ACP agent '${input.command}' did not respond within ${input.timeoutMs}ms`));
		}, input.timeoutMs);
		timer.unref();
	});

	try {
		const stdin = child.stdin;
		const stdout = child.stdout;
		if (!stdin || !stdout) {
			throw new Error(`'${input.command}' was not spawned with piped stdio`);
		}
		const stream = ndJsonStream(
			Writable.toWeb(stdin),
			Readable.toWeb(stdout) as ReadableStream<Uint8Array>
		);

		const promptTurn = client({ name: 'mastro-acp-runner' }).connectWith(stream, async (ctx) => {
			await ctx.request('initialize', {
				protocolVersion: PROTOCOL_VERSION,
				clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } }
			});
			return ctx.buildSession(input.cwd ?? process.cwd()).withSession(async (session) => {
				const promptPromise = session.prompt(input.prompt);
				// The completion is also queued as a stop message for
				// `readText()` to observe (see `ActiveSession.prompt`'s own
				// docstring) — this promise is only kept alive here so a
				// rejection is not reported as an unhandled rejection
				// alongside whatever `readText()` itself throws.
				promptPromise.catch(() => {});
				return session.readText();
			});
		});

		return await Promise.race([promptTurn, spawnFailure, timeout]);
	} catch (cause) {
		throw new Error(`ACP agent '${input.command}' failed: ${(cause as Error).message}`, { cause });
	} finally {
		killProcessGroup(child.pid);
	}
}

/** Kills the agent and everything it spawned. A negative pid signals the
 * whole process group, which is what `detached: true` above exists to
 * create. ESRCH means it is already gone, which is the common case. */
function killProcessGroup(pid: number | undefined): void {
	if (pid === undefined) return;
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		// Already exited, or never started.
	}
}
