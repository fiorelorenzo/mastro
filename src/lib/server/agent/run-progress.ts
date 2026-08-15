// #278: the one place that turns `runs/<jobId>.jsonl` (`runner/queue.ts`)
// into `extraction_run_event` rows. Both callers need exactly this: the
// SSE stream (`routes/import/runs/[id]/stream/+server.ts`) polls it every
// 500ms while a run is live, and `drain.ts` calls it once more, after
// `finishRunApplied`, to catch any trailing lines a run nobody watched
// live — the scheduler's own safety net — would otherwise leave stranded
// on disk when its jsonl file is deleted.
//
// `readRunProgress` always returns every line from the start of the file
// (`runner/queue.ts`'s own doc comment: there is no cursor, no byte
// offset carried between calls). Re-persisting the same lines is safe
// because `appendRunEvents`'s `ON CONFLICT DO NOTHING` on `(run_id, seq)`
// makes the insert idempotent — so this function does not need to track
// what it has already stored either; it hands the whole file to
// `appendRunEvents` every time and lets the database dedupe.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DbExecutor } from '$lib/server/db';
import {
	appendRunEvents,
	markRunRunning,
	type ExtractionRunRow
} from '$lib/server/repositories/extraction-run';
import { readRunProgress } from '$lib/server/runner/queue';
import type { RunProgressLine } from '$lib/server/runner/types';

/**
 * Reads `run.jobId`'s transcript off disk and persists every line as an
 * `extraction_run_event` row, returning the lines it read so a caller
 * that also wants to know what is new (the stream, tracking its own last
 * emitted `seq` in memory) does not have to read the file a second time.
 *
 * The first line ever observed — for this run, or for a caller that is
 * only now catching up on a run nobody watched live — moves the run from
 * `queued` to `running`, using that line's own `at` rather than the
 * current time: `markRunRunning`'s own doc comment is explicit that a
 * late call must never push `started_at` later than the update that
 * actually arrived first.
 */
export async function persistRunProgress(
	queueDir: string,
	run: Pick<ExtractionRunRow, 'id' | 'jobId'>,
	executor?: DbExecutor
): Promise<RunProgressLine[]> {
	const lines = await readRunProgress(queueDir, run.jobId);
	if (lines.length === 0) return lines;

	await markRunRunning(run.jobId, new Date(lines[0].at), executor);
	await appendRunEvents(
		run.id,
		lines.map((line) => ({
			seq: line.seq,
			at: new Date(line.at),
			kind: line.kind,
			payload: line.payload
		})),
		executor
	);
	return lines;
}

/**
 * The reason a job failed, read straight off `failed/<jobId>.json` —
 * `markJobFailed`'s own payload shape (`{ ...job, error, failedAt }`,
 * `runner/queue.ts`). `queue.ts` has a symmetric reader for `done/`
 * (`readCompletedJob`) but none for `failed/`: nothing before the stream
 * route ever needed to read a failure back off disk, since the scheduler
 * only ever reads `done/` and a job's own runner process is the one that
 * put it there in the first place.
 *
 * `null` when the file is not there — "this job has not failed", not an
 * error — which doubles as this function's own existence check, so a
 * caller never has to `stat` the path and then read it as two separate
 * steps that could race the runner's own rename between them.
 */
export async function readFailedJobReason(queueDir: string, jobId: string): Promise<string | null> {
	let raw: string;
	try {
		raw = await readFile(join(queueDir, 'failed', `${jobId}.json`), 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw err;
	}
	const parsed = JSON.parse(raw) as { error?: unknown };
	return typeof parsed.error === 'string'
		? parsed.error
		: 'the runner failed with no reason recorded';
}
