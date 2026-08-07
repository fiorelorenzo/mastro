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
// Authorization is a shared bearer token instead, compared in constant
// time so response timing cannot be used to guess it byte by byte.
import { timingSafeEqual } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runAlertDigest, runAlertPush } from '$lib/server/alerts/dispatch';
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

export const POST: RequestHandler = async ({ request, params }) => {
	if (!isAuthorized(request)) {
		// `ALERT_CRON_TOKEN` unset is a misconfiguration (503), a wrong or
		// missing token is a rejected caller (401) — both fail closed, the
		// difference is only which one a self-hoster needs to fix.
		if (!(env.ALERT_CRON_TOKEN ?? '').trim()) {
			error(503, 'ALERT_CRON_TOKEN is not set on this instance');
		}
		error(401, 'invalid or missing bearer token');
	}

	const asOfDate = new Date().toISOString().slice(0, 10);

	if (params.job === 'push') return json(await runAlertPush(asOfDate));
	if (params.job === 'digest') return json(await runAlertDigest(asOfDate));
	error(404, `unknown alert job "${params.job}"`);
};
