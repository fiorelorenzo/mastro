// The one thing that turns mail polling (#84), the agent drain/enqueue
// loop (#85), the alert engine's push/digest runs (#74/#75) and the
// drive mirror's publish run (#50/#346) into an actual schedule (#222):
// every one of those is a plain HTTP endpoint that expects a caller —
// `/api/mail/poll`, `/api/agent/run`, `/api/alerts/run/push`,
// `/api/alerts/run/digest`, `/api/drive/publish` — and nothing in this
// repository supplied one before this file. Runs as its own compose
// service (`scheduler`, compose.prod.yaml), built from the same image
// `web` is, on a different final stage with a different `CMD` — the same
// shape the `runner` service already uses for the ACP process.
//
// Plain node, no schema import and no database driver, like
// scripts/migrate.ts and scripts/record-backup-run.ts, and for a related
// reason: this file only ever calls the app's own HTTP endpoints, with
// the shared bearer tokens `.env.prod` already carries
// (`IMAP_POLL_CRON_TOKEN`, `ALERT_CRON_TOKEN`, `DRIVE_MIRROR_CRON_TOKEN`
// — the agent-run route reuses the alert token, see its own comment),
// so it needs nothing a plain node process cannot already do.
//
// Each job below is "run once now, then again every N minutes" rather
// than a cron expression: this process *is* the timer, so there is no
// external clock to align a cron string to, and a self-hoster who wants
// a different cadence sets the matching `*_INTERVAL_MINUTES` variable
// instead of editing a crontab. Every job also runs once immediately at
// startup, so a fresh `docker compose up` starts ingesting without
// waiting out a full interval first. A job whose token is unset is
// skipped outright (not called with an empty bearer, which would just
// collect 401s) — the same "not configured is a supported state, not a
// failure" stance `mail/config.ts`'s `isImapConfigured` and
// `drive/config.ts`'s `mirrorConfigFromEnv` already take. A job that
// throws (a network blip, the database briefly unreachable) logs and is
// retried on the next tick — it never crashes the loop, which would
// silently stop every *other* job too.
//
// What this file cannot do anything about: if this process itself dies,
// nothing calls any of the five endpoints any more, including the alert
// engine that would otherwise notice `agent_run`/`mailbox_poll_run`/
// `backup_run` going stale — the alert engine cannot observe its own
// absence, the same acknowledged gap docs/backup.md documents for "the
// database itself is unreachable". The mitigation is supervision of
// *this* process, not another alert: `restart: unless-stopped` in
// compose.prod.yaml, and `docker compose logs scheduler`. See
// docs/deploy.md, "Scheduling", for the honest statement of that gap.

// `log` (`src/lib/server/log/logger.ts`) is the one import in this file —
// itself dependency-free, like every other module reachable from this
// script, so it costs nothing toward "plain node, no schema import and no
// database driver" above. Its own presence is what marks this file as an
// ES module to the type checker (an `import` does that on its own), which
// is what lets the top-level `await` below exist at all; nothing else
// here needs marking as a module, so there is no separate `export {}`.
import { log } from '../src/lib/server/log/logger.ts';

interface Job {
	readonly name: string;
	readonly path: string;
	readonly token: string | undefined;
	readonly intervalMinutes: number;
}

const baseUrl = (process.env.SCHEDULER_BASE_URL ?? 'http://web:3000').replace(/\/+$/, '');

function minutes(envVar: string, fallbackMinutes: number): number {
	const raw = process.env[envVar];
	if (!raw) return fallbackMinutes;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMinutes;
}

const jobs: Job[] = [
	{
		name: 'mail poll',
		path: '/api/mail/poll',
		token: process.env.IMAP_POLL_CRON_TOKEN,
		intervalMinutes: minutes('MAIL_POLL_INTERVAL_MINUTES', 5)
	},
	{
		name: 'agent run',
		path: '/api/agent/run',
		// Reuses ALERT_CRON_TOKEN, the same shared secret
		// `/api/agent/run/+server.ts` itself checks against — not a mail or
		// alert-specific credential, just the one bearer token that route
		// happens to have been given (see that file's own comment).
		token: process.env.ALERT_CRON_TOKEN,
		intervalMinutes: minutes('AGENT_RUN_INTERVAL_MINUTES', 5)
	},
	{
		name: 'alert push',
		path: '/api/alerts/run/push',
		token: process.env.ALERT_CRON_TOKEN,
		intervalMinutes: minutes('ALERT_PUSH_INTERVAL_MINUTES', 15)
	},
	{
		name: 'alert digest',
		path: '/api/alerts/run/digest',
		token: process.env.ALERT_CRON_TOKEN,
		// A week, in minutes — `runAlertDigest` (`alerts/dispatch.ts`) is
		// idempotent (a second run within the same week finds everything
		// already marked delivered and sends nothing), so this only needs
		// to land roughly weekly, not on a calendar-aligned day.
		intervalMinutes: minutes('ALERT_DIGEST_INTERVAL_MINUTES', 7 * 24 * 60)
	},
	{
		name: 'drive publish',
		path: '/api/drive/publish',
		// #346: this job's own token, not a shared one — see the route's own
		// comment for why. Unset (the common case until a self-hoster
		// configures a mirror target at all) skips the tick outright, the
		// same "not configured is a supported state" every other job here
		// takes; the route also answers `{ status: 'skipped' }` on its own
		// if the token is set but no mirror target is, since a self-hoster
		// can configure the cron token ahead of the mirror itself.
		token: process.env.DRIVE_MIRROR_CRON_TOKEN,
		intervalMinutes: minutes('DRIVE_PUBLISH_INTERVAL_MINUTES', 15)
	}
];

async function runJob(job: Job): Promise<void> {
	if (!job.token) {
		log.warn('scheduler: job skipped, its cron token is not set', { job: job.name });
		return;
	}
	try {
		const response = await fetch(`${baseUrl}${job.path}`, {
			method: 'POST',
			headers: { authorization: `Bearer ${job.token}` }
		});
		const body = await response.text();
		if (!response.ok) {
			log.error('scheduler: job responded with a non-2xx status', {
				job: job.name,
				status: response.status,
				body
			});
			return;
		}
		log.info('scheduler: job ok', { job: job.name, body });
	} catch (error) {
		log.error('scheduler: job failed', { job: job.name, error });
	}
}

const TICK_MS = 60_000;
// `0` for every job: "never run yet", so the first tick below runs
// everything immediately instead of waiting out a full interval.
const lastRunAt: Record<string, number> = Object.fromEntries(jobs.map((job) => [job.name, 0]));

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
	process.on(signal, () => {
		log.info('scheduler: received signal, stopping after the current tick', { signal });
		stopping = true;
	});
}

log.info('scheduler: starting', {
	baseUrl,
	jobs: jobs.map((job) => ({ job: job.name, intervalMinutes: job.intervalMinutes }))
});

function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

while (!stopping) {
	const now = Date.now();
	for (const job of jobs) {
		const due = now - (lastRunAt[job.name] ?? 0) >= job.intervalMinutes * 60_000;
		if (!due) continue;
		lastRunAt[job.name] = now;
		await runJob(job);
	}
	await sleep(TICK_MS);
}
