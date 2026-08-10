// #85: one turn of the ingestion loop, driven by cron the same way the
// alert jobs are (`api/alerts/run/[job]`, #74/#75).
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
// are: the caller is cron, with no browser session to present, and the
// bearer check below is the actual protection.

import { timingSafeEqual } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { drainCompletedJobs } from '$lib/server/agent/drain';
import { enqueueDayExtractions } from '$lib/server/agent/enqueue';
import type { RequestHandler } from './$types';

function isAuthorized(request: Request): boolean {
	const token = (env.ALERT_CRON_TOKEN ?? '').trim();
	if (!token) return false;

	const header = request.headers.get('authorization') ?? '';
	const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
	const expected = Buffer.from(token);
	const given = Buffer.from(presented);
	return expected.length === given.length && timingSafeEqual(expected, given);
}

export const POST: RequestHandler = async ({ request }) => {
	if (!isAuthorized(request)) {
		if (!(env.ALERT_CRON_TOKEN ?? '').trim()) {
			error(503, 'ALERT_CRON_TOKEN is not set on this instance');
		}
		error(401, 'invalid or missing bearer token');
	}

	const queueDir = env.RUNNER_QUEUE_DIR ?? './data/runner-queue';
	// Drain first. Enqueueing skips a document that already has proposals,
	// and the drain is what writes them: the other order queues a second
	// job for a message whose answer is sitting in `done/` unapplied, and
	// pays for a model call to learn what it already knows.
	const drained = await drainCompletedJobs(queueDir);
	const queued = await enqueueDayExtractions(queueDir);
	return json({ drained, queued });
};
