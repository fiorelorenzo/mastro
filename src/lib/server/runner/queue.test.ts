import { spawn } from 'node:child_process';
import { appendFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, expect, test } from 'vitest';
import { env } from '$env/dynamic/private';
import { client as pool } from '$lib/server/db';
import {
	appendRunProgress,
	deleteRunProgress,
	enqueueJob,
	ensureQueueDirs,
	listPendingJobs,
	markJobDone,
	readCompletedJob,
	markJobFailed,
	readPendingJob,
	readRunProgress,
	runProgressPath
} from './queue.ts';
import {
	deleteCommittedContract,
	insertCommittedContract,
	insertCommittedDocument
} from './__fixtures__/db-fixtures.ts';

if (!env.RUNNER_DATABASE_URL) {
	throw new Error('RUNNER_DATABASE_URL is not set; see .env.example');
}
const runnerDatabaseUrl = env.RUNNER_DATABASE_URL;

let queueDir: string;
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
	while (cleanup.length > 0) {
		await cleanup.pop()?.();
	}
	if (queueDir) await rm(queueDir, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

async function freshQueueDir(): Promise<string> {
	queueDir = await mkdtemp(join(tmpdir(), 'mastro-runner-queue-'));
	return queueDir;
}

test('a job survives from enqueue through done, and failed jobs record why', async () => {
	const dir = await freshQueueDir();
	const request = {
		documentId: crypto.randomUUID(),
		contractId: crypto.randomUUID(),
		targetType: 'work_unit',
		content: 'x',
		instructions: 'y'
	};
	const id = await enqueueJob(dir, request);

	const pending = await listPendingJobs(dir);
	expect(pending).toEqual([`${id}.json`]);

	const job = await readPendingJob(dir, `${id}.json`);
	expect(job).toMatchObject({ id, request });

	const result = {
		documentId: request.documentId,
		contractId: request.contractId,
		targetType: 'work_unit',
		proposedFields: { days: [] },
		excerpt: 'x',
		confidence: 1
	};
	await markJobDone(dir, `${id}.json`, job, result);
	expect(await listPendingJobs(dir)).toEqual([]);
	expect(await readdir(join(dir, 'done'))).toEqual([`${id}.json`]);
	// The answer travels with the job: the app drains this file, and the
	// runner's stdout is for a human reading the log (#85).
	expect(await readCompletedJob(dir, `${id}.json`)).toMatchObject({ id, result });
});

test('a failed job is moved out of pending and carries its error', async () => {
	const dir = await freshQueueDir();
	const request = {
		documentId: crypto.randomUUID(),
		contractId: crypto.randomUUID(),
		targetType: 'work_unit',
		content: 'x',
		instructions: 'y'
	};
	const id = await enqueueJob(dir, request);
	const job = await readPendingJob(dir, `${id}.json`);

	await markJobFailed(dir, `${id}.json`, job, 'model exploded');

	expect(await listPendingJobs(dir)).toEqual([]);
	const failedFiles = await readdir(join(dir, 'failed'));
	expect(failedFiles).toEqual([`${id}.json`]);
});

test('ensureQueueDirs creates runs/ alongside pending/, done/ and failed/', async () => {
	const dir = await freshQueueDir();
	await ensureQueueDirs(dir);
	expect(await readdir(dir)).toEqual(expect.arrayContaining(['pending', 'done', 'failed', 'runs']));
});

test('appendRunProgress lines round-trip through readRunProgress, in order', async () => {
	const dir = await freshQueueDir();
	const jobId = crypto.randomUUID();
	const first = {
		seq: 0,
		at: '2026-01-01T00:00:00.000Z',
		kind: 'message' as const,
		payload: 'hello'
	};
	const second = {
		seq: 1,
		at: '2026-01-01T00:00:01.000Z',
		kind: 'stop' as const,
		payload: 'end_turn'
	};

	await appendRunProgress(dir, jobId, first);
	await appendRunProgress(dir, jobId, second);

	expect(runProgressPath(dir, jobId)).toBe(join(dir, 'runs', `${jobId}.jsonl`));
	expect(await readRunProgress(dir, jobId)).toEqual([first, second]);
});

test('readRunProgress drops a trailing partial line: a reader racing an in-flight append', async () => {
	const dir = await freshQueueDir();
	const jobId = crypto.randomUUID();
	const complete = {
		seq: 0,
		at: '2026-01-01T00:00:00.000Z',
		kind: 'thought' as const,
		payload: 'considering the excerpt'
	};
	await appendRunProgress(dir, jobId, complete);
	// What `appendFile` writes for line 1 mid-flight, before the writer's
	// promise has resolved and before the trailing newline lands — the
	// exact race `readRunProgress` has to tolerate rather than throw on.
	await appendFile(
		runProgressPath(dir, jobId),
		'{"seq":1,"at":"2026-01-01T00:00:01.000Z","kind":"mess'
	);

	expect(await readRunProgress(dir, jobId)).toEqual([complete]);
});

test('readRunProgress on a job with no transcript on disk returns no lines, not an error', async () => {
	const dir = await freshQueueDir();
	expect(await readRunProgress(dir, crypto.randomUUID())).toEqual([]);
});

test('deleteRunProgress removes the transcript, and a second call is not an error', async () => {
	const dir = await freshQueueDir();
	const jobId = crypto.randomUUID();
	await appendRunProgress(dir, jobId, {
		seq: 0,
		at: '2026-01-01T00:00:00.000Z',
		kind: 'message',
		payload: 'hi'
	});

	await deleteRunProgress(dir, jobId);
	expect(await readRunProgress(dir, jobId)).toEqual([]);
	await expect(deleteRunProgress(dir, jobId)).resolves.toBeUndefined();
});

// The actual restart-safety proof (#82's acceptance): run the real CLI
// process, SIGKILL it mid-job, and check the filesystem — not the logic
// in isolation. Needs a committed contract/document the runner role can
// read (see db-privilege.test.ts) and the fixture ACP agent as the local
// provider.
//
// FAKE_AGENT_DELAY_MS below is a genuine real-time delay, not a masked
// race: this test kills a real, separate OS process and then inspects
// real files on disk, so there is no in-process clock `vi.useFakeTimers()`
// could drive instead — the delay only has to be long enough that the
// `waitForOutput` below reliably observes "processing" before the fixture
// agent would have answered, which a fixed 1.5s margin against a
// millisecond-scale prompt turn comfortably is.
const FIXTURE_AGENT = new URL('./__fixtures__/fake-acp-agent.ts', import.meta.url).pathname;
const RUNNER_SCRIPT = new URL('../../../../scripts/runner.ts', import.meta.url).pathname;

function spawnRunnerWatch(dir: string, extraEnv: Record<string, string> = {}) {
	return spawn(process.execPath, [RUNNER_SCRIPT, 'watch'], {
		env: {
			PATH: process.env.PATH ?? '',
			RUNNER_DATABASE_URL: runnerDatabaseUrl,
			RUNNER_QUEUE_DIR: dir,
			RUNNER_AGENT_COMMAND: process.execPath,
			RUNNER_AGENT_ARGS: JSON.stringify([FIXTURE_AGENT]),
			RUNNER_AGENT_ENV: JSON.stringify({
				FAKE_AGENT_DELAY_MS: '1500',
				FAKE_AGENT_RESPONSE: JSON.stringify({
					excerpt: 'ok for Thursday',
					confidence: 0.9,
					proposedFields: {}
				})
			}),
			...extraEnv
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
}

type RunnerProcess = ReturnType<typeof spawnRunnerWatch>;

function waitForOutput(child: RunnerProcess, pattern: RegExp, timeoutMs = 10_000): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	let buffer = '';
	const timer = setTimeout(
		() => reject(new Error(`timed out waiting for ${pattern}: saw ${buffer}`)),
		timeoutMs
	);
	const onData = (chunk: Buffer) => {
		buffer += chunk.toString();
		if (pattern.test(buffer)) {
			clearTimeout(timer);
			child.stdout.off('data', onData);
			resolve();
		}
	};
	child.stdout.on('data', onData);
	return promise;
}

function waitForExit(child: RunnerProcess, timeoutMs = 5000): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const timer = setTimeout(() => reject(new Error('timed out waiting for exit')), timeoutMs);
	child.once('exit', () => {
		clearTimeout(timer);
		resolve();
	});
	return promise;
}

test('killing the runner mid-job loses nothing: the job stays whole in pending, and a restart finishes it', async () => {
	const dir = await freshQueueDir();
	const contractRow = await insertCommittedContract();
	cleanup.push(() => deleteCommittedContract(contractRow.id, contractRow.clientId));
	const documentRow = await insertCommittedDocument(contractRow.id);

	const jobId = await enqueueJob(dir, {
		documentId: documentRow.id,
		contractId: contractRow.id,
		targetType: 'work_unit',
		content: 'ok for Thursday',
		instructions: 'extract the day'
	});

	const first = spawnRunnerWatch(dir);
	let firstOutput = '';
	first.stdout.on('data', (chunk) => (firstOutput += chunk.toString()));
	first.stderr.on('data', (chunk) => (firstOutput += chunk.toString()));

	await waitForOutput(first, new RegExp(`processing ${jobId}`));
	// The fixture agent is still inside its 1500ms delay here — the job
	// cannot have finished yet. Kill immediately, hard, no graceful
	// shutdown at all: this is the crash this acceptance criterion has
	// to survive, not a clean stop.
	first.kill('SIGKILL');
	await waitForExit(first);

	const pendingAfterKill = await readdir(join(dir, 'pending'));
	const doneAfterKill = await readdir(join(dir, 'done')).catch(() => []);
	expect(pendingAfterKill).toEqual([`${jobId}.json`]);
	expect(doneAfterKill).toEqual([]);

	const second = spawnRunnerWatch(dir);
	let secondOutput = '';
	second.stdout.on('data', (chunk) => (secondOutput += chunk.toString()));
	second.stderr.on('data', (chunk) => (secondOutput += chunk.toString()));
	try {
		await waitForOutput(second, new RegExp(`completed ${jobId}`), 10_000);
	} finally {
		second.kill('SIGTERM');
		await waitForExit(second).catch(() => {});
	}

	const pendingAfterRestart = await readdir(join(dir, 'pending'));
	const doneAfterRestart = await readdir(join(dir, 'done'));
	expect(pendingAfterRestart).toEqual([]);
	expect(doneAfterRestart).toEqual([`${jobId}.json`]);
}, 20_000);
