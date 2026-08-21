import { json } from '@sveltejs/kit';
import { authorizeCronRequest } from '$lib/server/auth/cron-token';
import { env } from '$env/dynamic/private';
import { settleApprovedDays, utcToday } from '$lib/server/days/settle';
import type { RequestHandler } from './$types';

/**
 * Records approved days whose date has passed as `worked` (the design doc's
 * "the join that doesn't exist").
 *
 * Its own route rather than a step inside `/api/agent/run`: that one is the
 * extraction drain, and a ledger write hidden inside a job about something
 * else is a ledger write nobody finds again. `scripts/scheduler.test.ts`
 * keeps this path in step with the `image` job's sweep in CI, so the route
 * arrives with a caller that is not only the timer.
 *
 * `ALERT_CRON_TOKEN`, the same token `/api/agent/run` and the alert routes
 * use: cron has no session to present, and a fourth token for a fourth
 * timer-driven route would be four things to rotate for one guarantee.
 */
export const POST: RequestHandler = async ({ request }) => {
	authorizeCronRequest(request, env.ALERT_CRON_TOKEN, 'ALERT_CRON_TOKEN');
	const outcome = await settleApprovedDays(utcToday());
	return json({ status: 'ok', ...outcome });
};
