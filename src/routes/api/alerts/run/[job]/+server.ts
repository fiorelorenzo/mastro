// The one entry point a cron job (or the future worker process
// AGENTS.md describes and this repo does not build yet) has to actually
// drive the alert engine in production — `$lib/server/alerts/dispatch.ts`'s
// `runAlertPush`/`runAlertDigest` are plain functions with no scheduler
// of their own, per #74/#75/#63's own instructions. See the PR
// description for the exact cron entries this instance needs.
//
// This route is on `route-guard.ts`'s public list (see the comment
// there) because the caller is a cron job with no browser session to
// present — Better Auth's session check does not apply here at all.
// Authorization is a shared bearer token instead, checked by
// `authorizeCronRequest` (`$lib/server/auth/cron-token.ts`, #304), which
// throws a bare 401 for a wrong token, a missing token or an unset
// `ALERT_CRON_TOKEN` alike — that sameness is the point, see its own
// comment.
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runAlertDigest, runAlertPush } from '$lib/server/alerts/dispatch';
import { authorizeCronRequest } from '$lib/server/auth/cron-token';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, params }) => {
	authorizeCronRequest(request, env.ALERT_CRON_TOKEN, 'ALERT_CRON_TOKEN');

	const asOfDate = new Date().toISOString().slice(0, 10);

	if (params.job === 'push') return json(await runAlertPush(asOfDate));
	if (params.job === 'digest') return json(await runAlertDigest(asOfDate));
	error(404, `unknown alert job "${params.job}"`);
};
