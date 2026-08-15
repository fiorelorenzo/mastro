// #82: the runner's durable job queue — on disk, never in the database
// (the runner's role has no write grant to keep one there, and "restarts
// cleanly and loses no queued work" should not depend on a role boundary
// holding). Every state change that matters is one `rename(2)`, atomic on
// the same filesystem: a job file is either still whole in `pending/`, or
// it is whole in `done/`/`failed/` — there is no state in between for a
// crash to land in. `queue.test.ts` proves this by killing a running
// runner process mid-job and checking the directory, not by reasoning
// about it.

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExtractionRequest, ProposalCandidate, RunProgressLine } from './types.ts';

export interface QueuedJob {
	readonly id: string;
	readonly request: ExtractionRequest;
	readonly enqueuedAt: string;
}

export async function ensureQueueDirs(queueDir: string): Promise<void> {
	await mkdir(join(queueDir, 'pending'), { recursive: true });
	await mkdir(join(queueDir, 'done'), { recursive: true });
	await mkdir(join(queueDir, 'failed'), { recursive: true });
	await mkdir(join(queueDir, 'runs'), { recursive: true });
}

/**
 * Durably enqueues `request`. Writes to a temp file first and `rename`s it
 * into `pending/` — the rename is what makes this atomic: a crash before
 * it completes leaves no file in `pending/` at all, never a half-written
 * one the runner could pick up and fail to parse.
 */
export async function enqueueJob(queueDir: string, request: ExtractionRequest): Promise<string> {
	await ensureQueueDirs(queueDir);
	const id = randomUUID();
	const job: QueuedJob = { id, request, enqueuedAt: new Date().toISOString() };
	const finalPath = join(queueDir, 'pending', `${id}.json`);
	const tmpPath = `${finalPath}.tmp`;
	await writeFile(tmpPath, JSON.stringify(job, null, 2));
	await rename(tmpPath, finalPath);
	return id;
}

/** Every job file currently in `pending/`, sorted by filename. Job ids are
 * random UUIDs, so this is not a strict enqueue-order guarantee across
 * concurrent enqueuers — nothing in this queue promises one. */
export async function listPendingJobs(queueDir: string): Promise<string[]> {
	await ensureQueueDirs(queueDir);
	const names = await readdir(join(queueDir, 'pending'));
	return names.filter((name) => name.endsWith('.json')).sort();
}

export async function readPendingJob(queueDir: string, filename: string): Promise<QueuedJob> {
	const raw = await readFile(join(queueDir, 'pending', filename), 'utf8');
	return JSON.parse(raw) as QueuedJob;
}

/** A finished job, with what the model actually answered. The runner has
 * no write grant for `proposal`, so this file in `done/` is the hand-off:
 * the app drains it (`$lib/server/agent/drain.ts`) and writes the rows
 * itself. A file rather than the process's stdout, so a producer that was
 * not running when the job finished still gets it. */
export interface CompletedJob extends QueuedJob {
	readonly result: ProposalCandidate;
	readonly completedAt: string;
}

/** Records what the model answered and moves the job into `done/`. Never
 * called until `processExtractionJob` has fully returned, so a job killed
 * mid-flight is never marked done for work it did not finish. The write
 * happens in `pending/` and the rename is what publishes it, the same
 * atomicity `enqueueJob` relies on. */
export async function markJobDone(
	queueDir: string,
	filename: string,
	job: QueuedJob,
	result: ProposalCandidate
): Promise<void> {
	const pendingPath = join(queueDir, 'pending', filename);
	const completed: CompletedJob = { ...job, result, completedAt: new Date().toISOString() };
	await writeFile(pendingPath, JSON.stringify(completed, null, 2));
	await rename(pendingPath, join(queueDir, 'done', filename));
}

/** Every completed job waiting to be turned into proposals, oldest first
 * by filename. Read by the app, never by the runner. */
export async function listCompletedJobs(queueDir: string): Promise<string[]> {
	await ensureQueueDirs(queueDir);
	const names = await readdir(join(queueDir, 'done'));
	return names.filter((name) => name.endsWith('.json')).sort();
}

export async function readCompletedJob(queueDir: string, filename: string): Promise<CompletedJob> {
	const raw = await readFile(join(queueDir, 'done', filename), 'utf8');
	return JSON.parse(raw) as CompletedJob;
}

/** Moves a drained job out of `done/` once its proposals exist. A separate
 * directory rather than a delete: what the model answered is the evidence
 * behind a proposal a human is about to read, and invariant 4 says keep
 * the source. */
export async function markJobApplied(queueDir: string, filename: string): Promise<void> {
	await mkdir(join(queueDir, 'applied'), { recursive: true });
	await rename(join(queueDir, 'done', filename), join(queueDir, 'applied', filename));
}

/** Records why a job failed and moves it into `failed/` — a terminal
 * state a human reviews and re-enqueues if the failure was transient,
 * never retried automatically (an automatic retry loop is exactly how a
 * misconfigured hosted call would end up hammering a provider). */
export async function markJobFailed(
	queueDir: string,
	filename: string,
	job: QueuedJob,
	error: string
): Promise<void> {
	const pendingPath = join(queueDir, 'pending', filename);
	const failedPayload = { ...job, error, failedAt: new Date().toISOString() };
	await writeFile(pendingPath, JSON.stringify(failedPayload, null, 2));
	await rename(pendingPath, join(queueDir, 'failed', filename));
}

/** Where the runner appends `RunProgressLine`s for `jobId` — a fourth
 * directory beside `pending/`, `done/` and `failed/`, because a run's
 * transcript is neither a queued job nor a finished one: it exists while
 * the job is still `pending/`, and the stream reader keeps draining it
 * after the job has already moved to `done/` or `failed/`. */
export function runProgressPath(queueDir: string, jobId: string): string {
	return join(queueDir, 'runs', `${jobId}.jsonl`);
}

/** Appends one `RunProgressLine` to `jobId`'s transcript. Newline-delimited
 * JSON, not a JSON array, because an array would need the whole file
 * rewritten on every update — this is called once per agent update, and
 * `readRunProgress` below is what has to cope with the result. */
export async function appendRunProgress(
	queueDir: string,
	jobId: string,
	line: RunProgressLine
): Promise<void> {
	await ensureQueueDirs(queueDir);
	await appendFile(runProgressPath(queueDir, jobId), `${JSON.stringify(line)}\n`);
}

/** Every complete line appended so far, in order. Invariant 3 means the
 * only way to watch a run live is to poll this file while the runner is
 * still writing it, so a reader here is racing an in-flight
 * `appendRunProgress` — that race, not a bug, is the whole point of this
 * function existing. A trailing line that fails to parse is the writer's
 * `appendFile` caught mid-flush; it is dropped rather than thrown, and
 * the next poll picks it up complete. A missing file (the job has not
 * produced its first update yet, or its transcript was already drained
 * and deleted) reads back as no lines, not an error. */
export async function readRunProgress(queueDir: string, jobId: string): Promise<RunProgressLine[]> {
	let raw: string;
	try {
		raw = await readFile(runProgressPath(queueDir, jobId), 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw err;
	}
	const lines = raw.split('\n').filter((line) => line.length > 0);
	const result: RunProgressLine[] = [];
	for (let i = 0; i < lines.length; i++) {
		try {
			result.push(JSON.parse(lines[i]) as RunProgressLine);
		} catch (err) {
			if (i === lines.length - 1) break;
			throw err;
		}
	}
	return result;
}

/** Removes `jobId`'s transcript once whoever drains it (the stream, or the
 * scheduler as the fallback path) has stored every line as an
 * `extraction_run_event` row — the jsonl is a transport buffer, never the
 * record, so nothing reads it again after this. A file that is already
 * gone (drained twice, or never written because the job failed before
 * its first update) is not an error. */
export async function deleteRunProgress(queueDir: string, jobId: string): Promise<void> {
	await rm(runProgressPath(queueDir, jobId), { force: true });
}
