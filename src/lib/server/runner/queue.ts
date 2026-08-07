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
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExtractionRequest } from './types.ts';

export interface QueuedJob {
	readonly id: string;
	readonly request: ExtractionRequest;
	readonly enqueuedAt: string;
}

export async function ensureQueueDirs(queueDir: string): Promise<void> {
	await mkdir(join(queueDir, 'pending'), { recursive: true });
	await mkdir(join(queueDir, 'done'), { recursive: true });
	await mkdir(join(queueDir, 'failed'), { recursive: true });
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

/** Moves a completed job's file into `done/`. Never called until
 * `processExtractionJob` has fully returned, so a job killed mid-flight
 * is never marked done for work it did not finish. */
export async function markJobDone(queueDir: string, filename: string): Promise<void> {
	await rename(join(queueDir, 'pending', filename), join(queueDir, 'done', filename));
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
