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
// session to present. Authorization is `authorizeCronRequest`
// (`$lib/server/auth/cron-token.ts`, #304), which throws a bare 401 for
// a wrong token, a missing token or an unset `IMAP_POLL_CRON_TOKEN`
// alike — that sameness is the point, see its own comment.
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { authorizeCronRequest } from '$lib/server/auth/cron-token';
import { imapConfiguredInEnv, mailConfigFromEnv } from '$lib/server/mail/config';
import { pollMailboxesOnce } from '$lib/server/mail/poll';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	authorizeCronRequest(request, env.IMAP_POLL_CRON_TOKEN, 'IMAP_POLL_CRON_TOKEN');

	// Mail is optional. `mailConfigFromEnv` throws on a half-set or unset
	// mailbox on purpose, because sending is a deliberate action nobody should
	// be surprised by the error of — but this route is called by a timer every
	// few minutes, so an instance that never configured IMAP would answer 500
	// on every tick forever. That is the exact failure `AGENTS.md` records for
	// `/api/agent/run`, and it is what the new CI caller for this route caught
	// on its first run. `imapConfiguredInEnv` is the safe probe this file's
	// sibling already wrote for the alert engine's "is polling even configured"
	// gate, reused here rather than duplicated.
	if (!imapConfiguredInEnv()) {
		return json({ status: 'skipped', reason: 'mail is not configured', folders: [] });
	}

	const result = await pollMailboxesOnce(mailConfigFromEnv().imap);
	return json(result);
};
