// #82: wires configuration, the runner's own database connection and both
// models into the two ways this process actually runs — `watch`, the
// production shape (a long-lived process draining `RUNNER_QUEUE_DIR` as
// jobs arrive), and `once`/`enqueue`, used by tests and by a human running
// this by hand before any producer exists to call it automatically. See
// `scripts/runner.ts` for the plain-`node` entrypoint that calls
// `runRunnerCli(process.argv.slice(2))`.
//
// A future producer (#85/#86/#87) that already runs inside the SvelteKit
// app process is expected to import `enqueueJob` from `./queue.ts`
// directly rather than shelling out through this CLI — the CLI's own
// `enqueue` subcommand exists for manual operation and tests, not as the
// only way in.

import { connectRunnerDb } from './db.ts';
import { loadRunnerConfig } from './config.ts';
import { RunnerConfigurationError } from './errors.ts';
import { processExtractionJob } from './job.ts';
import type { ExtractionModel } from './model.ts';
import { AcpAgentModel } from './model.ts';
import {
	enqueueJob,
	ensureQueueDirs,
	listPendingJobs,
	markJobDone,
	markJobFailed,
	readPendingJob
} from './queue.ts';
import type { ExtractionRequest } from './types.ts';

/** Processes every job currently in `pending/` once, then returns —
 * `cli.ts`'s `once` subcommand, and the unit `queue.test.ts` and
 * `cli.test.ts` build their crash-safety assertions on top of. Never
 * throws for an individual job's failure: that job's own error is
 * recorded (`markJobFailed`) and the loop moves on, the same "one bad row
 * does not stop the batch" shape `runAlertPush`/`runAlertDigest` already
 * use for the alert engine. */
export async function runQueueOnce(
	queueDir: string,
	sql: Parameters<typeof processExtractionJob>[0],
	model: ExtractionModel
): Promise<{ processed: number; failed: number }> {
	const pending = await listPendingJobs(queueDir);
	let processed = 0;
	let failed = 0;
	for (const filename of pending) {
		const job = await readPendingJob(queueDir, filename);
		console.log(`[runner] processing ${filename}`);
		try {
			const result = await processExtractionJob(sql, model, job.request);
			// #82's own scope ends here: "its only output is a proposal
			// object." Writing it into `proposal` (createProposal, #83) is a
			// producer's job — this process has no write grant to do it even
			// if it tried. The hand-off is the file `markJobDone` leaves in
			// `done/`, which the app drains (#85's `agent/drain.ts`); the
			// line on stdout is for a human watching the log, not a seam
			// anything parses.
			console.log(JSON.stringify({ kind: 'proposal', jobId: job.id, ...result }));
			await markJobDone(queueDir, filename, job, result);
			console.log(`[runner] completed ${filename}`);
			processed++;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[runner] failed ${filename}: ${message}`);
			await markJobFailed(queueDir, filename, job, message);
			failed++;
		}
	}
	return { processed, failed };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	const timer = setTimeout(resolve, ms);
	signal.addEventListener('abort', () => {
		clearTimeout(timer);
		resolve();
	});
	return promise;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;

/** The production shape: poll `queueDir` until `signal` aborts (SIGTERM,
 * SIGINT — see `runRunnerCli`), running `runQueueOnce` on every tick.
 * Killing the process at any point — including mid-job, `queue.test.ts`'s
 * own proof — never loses a job: an in-flight job's file is still whole
 * in `pending/`, unmoved until it actually finishes. */
export async function watchQueue(
	queueDir: string,
	sql: Parameters<typeof processExtractionJob>[0],
	model: ExtractionModel,
	signal: AbortSignal,
	pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
): Promise<void> {
	while (!signal.aborted) {
		await runQueueOnce(queueDir, sql, model);
		await sleep(pollIntervalMs, signal);
	}
}

/** `--name value` pairs off `argv`, in one flat object — flag names come
 * from a fixed, known set of CLI options (`document`, `contract`,
 * `target-type`, `content`, `instructions`, `provider`), not an unbounded
 * runtime collection, so a plain object reads as directly as the pairs
 * themselves. */
function parseFlags(argv: string[]): Record<string, string> {
	const flags: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith('--')) continue;
		const name = arg.slice(2);
		const value = argv[i + 1];
		if (value === undefined || value.startsWith('--')) {
			throw new Error(`--${name} needs a value`);
		}
		flags[name] = value;
		i++;
	}
	return flags;
}

function requireFlag(flags: Record<string, string>, name: string): string {
	const value = flags[name];
	if (value === undefined) throw new Error(`--${name} is required`);
	return value;
}

async function runEnqueueCommand(queueDir: string, argv: string[]): Promise<void> {
	const flags = parseFlags(argv);
	const request: ExtractionRequest = {
		documentId: requireFlag(flags, 'document'),
		contractId: requireFlag(flags, 'contract'),
		targetType: requireFlag(flags, 'target-type'),
		content: requireFlag(flags, 'content'),
		instructions: requireFlag(flags, 'instructions')
	};
	const id = await enqueueJob(queueDir, request);
	console.log(`[runner] enqueued ${id}`);
}

/** Entry point called by `scripts/runner.ts`. `argv` is `process.argv.slice(2)`. */
export async function runRunnerCli(argv: string[]): Promise<void> {
	const config = loadRunnerConfig();
	const [command, ...rest] = argv;

	if (command === 'enqueue') {
		await runEnqueueCommand(config.queueDir, rest);
		return;
	}

	const sql = connectRunnerDb(config.databaseUrl);
	const model = new AcpAgentModel(config.agent, config.modelTimeoutMs);
	await ensureQueueDirs(config.queueDir);

	try {
		if (command === 'once' || command === undefined) {
			const { processed, failed } = await runQueueOnce(config.queueDir, sql, model);
			console.log(`[runner] processed ${processed} job(s), ${failed} failed`);
			return;
		}

		if (command === 'watch') {
			const controller = new AbortController();
			process.once('SIGTERM', () => controller.abort());
			process.once('SIGINT', () => controller.abort());
			console.log(
				`[runner] watching ${config.queueDir} ` +
					`(agent: ${config.agent ? 'configured' : 'not configured'})`
			);
			await watchQueue(config.queueDir, sql, model, controller.signal);
			return;
		}

		throw new RunnerConfigurationError(
			`unknown command '${command}' (expected watch, once, enqueue)`
		);
	} finally {
		await sql.end();
	}
}
