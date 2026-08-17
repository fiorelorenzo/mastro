/**
 * `GET /import/runs/[id]/stream` — the live half of #278's "three views"
 * (design doc, "Making it immediate" and "The race this creates, and the
 * guard"). Server-Sent Events, one connection per open run page: it
 * polls `runs/<jobId>.jsonl` (invariant 3 — the runner has no other way
 * to report anything), persists what it finds, and pushes both the
 * transcript and the run's own status to the browser as they change.
 *
 * Two message shapes, both `data: <json>\n\n` so a plain `EventSource`
 * (no custom event name) sees every one of them:
 *
 *   {"type":"event","seq":N,"at":"ISO","kind":"...","payload":"..."}
 *   {"type":"status","status":"queued|running|extracted|applied|failed","error":null|"...","proposalId":null|"uuid"}
 *
 * The moment the runner's answer lands in `done/`, this drains **that
 * job** immediately — no waiting for the five-minute scheduler tick that
 * remains the safety net for a run nobody is watching (a closed tab, a
 * locked phone; see `agent/drain.ts`). `drainCompletedJobs` is not
 * scoped to one job — it sweeps every job currently in `done/` — but
 * processing whatever else happens to be ready at the same time is
 * strictly eager, never wrong: the scheduler would have done the same
 * work a few minutes later regardless.
 *
 * Closes cleanly on client disconnect (`request.signal`) and, failing
 * that, after a generous absolute cap: a runner process wedged deeper
 * than its own model call — never even reaching its own timeout — must
 * not hold this request open forever. The cap is derived from
 * `RUNNER_MODEL_TIMEOUT_MS`, the runner's own configured per-call
 * timeout (`runner/config.ts`'s `modelTimeoutMs`, read directly here the
 * same way `RUNNER_QUEUE_DIR` already is in `contracts/+page.server.ts`
 * and `api/agent/run/+server.ts` — importing `loadRunnerConfig` itself
 * would drag in its `RUNNER_DATABASE_URL` requirement, a credential this
 * route has no business needing just to read one number), doubled: a
 * normally-behaving runner already has up to `modelTimeoutMs` before it
 * even notices its own timeout and writes `failed/`.
 */
import { error } from '@sveltejs/kit';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import * as m from '$lib/paraglide/messages';
import { drainCompletedJobs } from '$lib/server/agent/drain';
import { persistRunProgress, readFailedJobReason } from '$lib/server/agent/run-progress';
import {
	failRun,
	getExtractionRun,
	getExtractionRunByJobId,
	listRunEvents,
	type ExtractionRunRow
} from '$lib/server/repositories/extraction-run';
import type { RequestHandler } from './$types';

const POLL_INTERVAL_MS = 500;
// `runner/config.ts`'s own `DEFAULT_MODEL_TIMEOUT_MS` — not exported, so
// mirrored here as the fallback for the same env var, the same way this
// file already reads `RUNNER_QUEUE_DIR` without importing that module.
const DEFAULT_MODEL_TIMEOUT_MS = 120_000;

function delay(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

export const GET: RequestHandler = async ({ params, request }) => {
	const run = await getExtractionRun(params.id);
	if (!run) error(404, m.extraction_run_not_found());

	const queueDir = env.RUNNER_QUEUE_DIR || './data/runner-queue';
	const modelTimeoutMs = Number(env.RUNNER_MODEL_TIMEOUT_MS) || DEFAULT_MODEL_TIMEOUT_MS;
	const absoluteCapMs = modelTimeoutMs * 2;
	const doneMarkerPath = join(queueDir, 'done', `${run.jobId}.json`);

	const encoder = new TextEncoder();
	let closed = false;

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (data: unknown) => {
				if (closed) return;
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
			};
			// A named reference, not an inline arrow, because it has to be the
			// exact same function passed to both `addEventListener` and the
			// `removeEventListener` cleanup below.
			const onAbort = () => {
				closed = true;
			};
			request.signal.addEventListener('abort', onAbort);

			try {
				// Replay first: a reconnect, or a page opened on a run that was
				// already partway through, gets the full transcript so far
				// before anything live.
				const storedEvents = await listRunEvents(run.id);
				let lastSeq = -1;
				for (const event of storedEvents) {
					send({
						type: 'event',
						seq: event.seq,
						at: event.at.toISOString(),
						kind: event.kind,
						payload: event.payload
					});
					lastSeq = event.seq;
				}
				send({ type: 'status', status: run.status, error: run.error, proposalId: run.proposalId });

				if (run.status === 'applied' || run.status === 'failed') {
					// Already finished — reopening a finished run replays the
					// identical rows (design doc, "The agent run (B)") and there
					// is nothing left to watch.
					return;
				}

				let status: ExtractionRunRow['status'] = run.status;
				const watchStartedAt = Date.now();

				while (!closed) {
					if (Date.now() - watchStartedAt > absoluteCapMs) {
						const current = await getExtractionRunByJobId(run.jobId);
						if (current && (current.status === 'applied' || current.status === 'failed')) {
							send({
								type: 'status',
								status: current.status,
								error: current.error,
								proposalId: current.proposalId
							});
						} else {
							const reason = `the runner did not finish within ${absoluteCapMs}ms of this run being watched`;
							await failRun(run.jobId, 'timed_out', reason);
							send({ type: 'status', status: 'failed', error: reason, proposalId: null });
						}
						break;
					}

					const lines = await persistRunProgress(queueDir, run);
					for (const line of lines) {
						if (line.seq <= lastSeq) continue;
						send({
							type: 'event',
							seq: line.seq,
							at: line.at,
							kind: line.kind,
							payload: line.payload
						});
						lastSeq = line.seq;
					}
					if (status === 'queued' && lines.length > 0) {
						status = 'running';
						send({ type: 'status', status: 'running', error: null, proposalId: null });
					}

					const failureReason = await readFailedJobReason(queueDir, run.jobId);
					if (failureReason !== null) {
						await failRun(run.jobId, 'agent_failed', failureReason);
						send({ type: 'status', status: 'failed', error: failureReason, proposalId: null });
						break;
					}

					let jobIsDone: boolean;
					try {
						await access(doneMarkerPath);
						jobIsDone = true;
					} catch {
						jobIsDone = false;
					}

					if (jobIsDone) {
						if (status !== 'extracted') {
							status = 'extracted';
							send({ type: 'status', status: 'extracted', error: null, proposalId: null });
						}
						try {
							await drainCompletedJobs(queueDir);
						} catch (err) {
							await failRun(
								run.jobId,
								'write_refused',
								err instanceof Error ? err.message : String(err)
							);
						}
						const finalRun = await getExtractionRunByJobId(run.jobId);
						if (finalRun?.status === 'applied') {
							send({
								type: 'status',
								status: 'applied',
								error: null,
								proposalId: finalRun.proposalId
							});
						} else {
							send({
								type: 'status',
								status: 'failed',
								error: finalRun?.error ?? 'the drain did not resolve this run',
								proposalId: null
							});
						}
						break;
					}

					await delay(POLL_INTERVAL_MS);
				}
			} finally {
				request.signal.removeEventListener('abort', onAbort);
				closed = true;
				try {
					controller.close();
				} catch {
					// Already closed by a client disconnect racing this same
					// cleanup — nothing left to do.
				}
			}
		},
		cancel() {
			closed = true;
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive',
			// Reverse proxies (nginx-shaped, per AGENTS.md's "a reverse proxy
			// as the only edge") buffer a response by default, which would
			// turn this into one giant delayed write instead of a live
			// stream. Harmless to send when the proxy in front is something
			// else.
			'x-accel-buffering': 'no'
		}
	});
};
