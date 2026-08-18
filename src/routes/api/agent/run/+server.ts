// #85: one turn of the ingestion loop, driven by cron the same way the
// alert jobs are (`api/alerts/run/[job]`, #74/#75). Scheduled by the
// `scheduler` compose service (#222, `scripts/scheduler.ts`) in
// production, the same caller the alert jobs and the mail poller get.
//
// Turn every answer the runner has left in `done/` into proposals, then
// queue an extraction job for every archived message that still has
// none. The model call happens in neither place: it happens in the
// runner's own process (`node scripts/runner.ts watch`), which is #82's
// separation working as intended. This route holds the database write
// grant and never calls a model; that process calls the model and cannot
// write.
//
// Public on `route-guard.ts`'s list for the same reason the alert jobs
// are: the caller is cron, with no browser session to present.
// Authorization is `authorizeCronRequest` (`$lib/server/auth/cron-token.ts`,
// #304), reusing `ALERT_CRON_TOKEN` — not a separate agent-run
// credential, just the one bearer token this route happens to have been
// given (`scripts/scheduler.ts`'s own comment says the same of its call
// to this route).
//
// Every call records its outcome into `agent_run` (#222), the same
// run-record shape `backup_run`/`mailbox_poll_run` already established —
// `detectAgentRunFailure` (`alerts/detectors.ts`) is this table's stated
// reader, so a scheduler that stops calling this route, or a call that
// throws, shows up as an alert instead of silence. A job inside the run
// that could not be turned into a proposal (`DrainOutcome.failed`) also
// counts as `failure`: it is the "the run had a problem" signal this
// table exists for, distinct from `rejectedDays`, which is normal
// content review, not a run-health problem, and is left out of the
// status on purpose.

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { drainCompletedJobs } from '$lib/server/agent/drain';
import { enqueueDayExtractions } from '$lib/server/agent/enqueue';
import { authorizeCronRequest } from '$lib/server/auth/cron-token';
import { recordAgentRun } from '$lib/server/repositories/agent-run';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	authorizeCronRequest(request, env.ALERT_CRON_TOKEN, 'ALERT_CRON_TOKEN');

	const queueDir = env.RUNNER_QUEUE_DIR ?? './data/runner-queue';
	try {
		// Drain first. Enqueueing skips a document that already has proposals,
		// and the drain is what writes them: the other order queues a second
		// job for a message whose answer is sitting in `done/` unapplied, and
		// pays for a model call to learn what it already knows.
		const drained = await drainCompletedJobs(queueDir);
		const queued = await enqueueDayExtractions(queueDir);

		const failed = drained.failed.length;
		await recordAgentRun({
			status: failed > 0 ? 'failure' : 'success',
			detail:
				failed > 0
					? drained.failed.map((job) => `${job.filename}: ${job.reason}`).join('; ')
					: `drained ${drained.applied} applied, ${drained.skipped} skipped; queued ${queued.enqueued}, ${queued.alreadyProposed} already proposed`
		});
		return json({ drained, queued });
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		await recordAgentRun({ status: 'failure', detail }).catch(() => {
			// Best effort, mirroring scripts/backup.sh's own "the database
			// itself may be exactly what is unreachable" acknowledgement
			// (docs/backup.md, "Failure is observable"): if recording the
			// outcome also fails, the original error below is still what
			// the caller and the container logs see.
		});
		throw err;
	}
};
