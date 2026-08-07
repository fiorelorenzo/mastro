// The one entry point a cron job (or the future worker process AGENTS.md
// describes and this repo does not build yet) has to actually drive the
// IMAP poller (#84) in production — `$lib/server/mail/poll.ts`'s
// `pollMailboxesOnce` is a plain function with no scheduler of its own,
// mirroring `/api/alerts/run/[job]/+server.ts` exactly: "picked up
// within the configured interval" is the interval of whichever cron
// entry calls this, documented in the PR description, the same way
// #74/#75's push/digest interval is.
//
// This route is on `route-guard.ts`'s public list for the same reason
// `/api/alerts/run/[job]` is: the caller is cron, with no browser
// session to present. Authorization is a shared bearer token, compared
// in constant time.
import { timingSafeEqual } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { mailConfigFromEnv } from '$lib/server/mail/config';
import { pollMailboxesOnce } from '$lib/server/mail/poll';
import type { RequestHandler } from './$types';

function isAuthorized(request: Request): boolean {
	const token = (env.IMAP_POLL_CRON_TOKEN ?? '').trim();
	if (!token) return false;

	const header = request.headers.get('authorization') ?? '';
	const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
	const expected = Buffer.from(token);
	const given = Buffer.from(presented);
	return expected.length === given.length && timingSafeEqual(expected, given);
}

export const POST: RequestHandler = async ({ request }) => {
	if (!isAuthorized(request)) {
		// `IMAP_POLL_CRON_TOKEN` unset is a misconfiguration (503), a wrong
		// or missing token is a rejected caller (401) — both fail closed,
		// the difference is only which one a self-hoster needs to fix.
		if (!(env.IMAP_POLL_CRON_TOKEN ?? '').trim()) {
			error(503, 'IMAP_POLL_CRON_TOKEN is not set on this instance');
		}
		error(401, 'invalid or missing bearer token');
	}

	const result = await pollMailboxesOnce(mailConfigFromEnv().imap);
	return json(result);
};
