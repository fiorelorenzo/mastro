// The entry point a cron job has to actually drive the Drive mirror
// (#50) in production — `publishAllPending` (`$lib/server/drive/publish.ts`)
// is a plain function with no scheduler of its own, and nothing called it
// before #346: `DRIVE_MIRROR_REFRESH_TOKEN` was configurable and even set
// on the live instance, and this route still did not exist, which is why
// the mirror had never run once. Measured on production before this route
// existed: 0 rows in `document_mirror_run`, 1 document pending with
// `remote_file_id` null. Modelled exactly on
// `src/routes/api/mail/poll/+server.ts`.
//
// Public on `route-guard.ts`'s list for the same reason `/api/mail/poll`
// is: the caller is cron, with no browser session to present.
// Authorization is `authorizeCronRequest` (`$lib/server/auth/cron-token.ts`,
// #304), a dedicated `DRIVE_MIRROR_CRON_TOKEN` rather than a reused one —
// mail poll and this route are the two jobs whose credential also gates a
// third-party API call (IMAP, Drive) rather than only this app's own
// database, so each keeps its own token the way `IMAP_POLL_CRON_TOKEN`
// already does, instead of joining `ALERT_CRON_TOKEN`'s shared pool.
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createMirrorTarget, mirrorConfigFromEnv } from '$lib/server/drive/config';
import { authorizeCronRequest } from '$lib/server/auth/cron-token';
import {
	DriveMirrorAlreadyInFlightError,
	runExclusiveDriveMirrorPublish
} from '$lib/server/drive/publish-lock';
import { publishAllPending } from '$lib/server/drive/publish';
import { countUnattributedPendingDocuments } from '$lib/server/repositories/document-mirror';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	authorizeCronRequest(request, env.DRIVE_MIRROR_CRON_TOKEN, 'DRIVE_MIRROR_CRON_TOKEN');

	// The mirror is optional (`drive/config.ts`'s own comment: "running with
	// no mirror configured is a supported, silent configuration"). This
	// route is called by a timer every few minutes, so an instance that
	// never configured a mirror target would answer 500 on every tick
	// forever without this check — the same failure `/api/mail/poll`
	// guards against with `imapConfiguredInEnv`, here read straight from
	// `mirrorConfigFromEnv`'s own `null` return instead of a second probe
	// function, since reading the config *is* the check.
	const config = mirrorConfigFromEnv();
	if (!config) {
		return json({ status: 'skipped', reason: 'drive mirror is not configured', published: 0 });
	}

	const target = createMirrorTarget(config);

	// Exclusively, for the reason `publish-lock.ts`'s own comment gives:
	// `publishDocument`'s remoteFileId check is not atomic with its write,
	// so two overlapping ticks could both publish the same pending
	// document to Drive before either records the result.
	try {
		const outcomes = await runExclusiveDriveMirrorPublish(() =>
			publishAllPending(target, config.folder)
		);
		const failures = outcomes.filter((outcome) => !outcome.ok);
		// A batch with nothing to publish because every pending document is
		// still unattributed is a normal state of this product (#393), not an
		// incident: `failed` only counts documents the publisher actually
		// tried and could not place, never the ones the queue withheld
		// because nobody has claimed them yet. `unattributed` is what keeps
		// that withheld count visible instead of making those documents
		// simply disappear from the response — someone who uploaded one and
		// cannot find it in Drive can see why here.
		return json({
			status: failures.length > 0 ? 'partial_failure' : 'ok',
			published: outcomes.length - failures.length,
			failed: failures.length,
			unattributed: await countUnattributedPendingDocuments()
		});
	} catch (error) {
		if (error instanceof DriveMirrorAlreadyInFlightError) {
			// Not an error for a timer: the previous tick is still working.
			return json({ status: 'in_flight', published: 0, failed: 0 });
		}
		throw error;
	}
};
