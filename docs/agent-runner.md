# The ACP runner (#82)

A separate process that speaks [ACP](https://agentclientprotocol.com) (the Agent
Client Protocol) to a CLI agent, holds its own credentials, and connects to the
database with a role that cannot write to the ledger and cannot read anything
beyond the one column it filters by. Epic #15's whole shape —
`document/thread → ACP agent → proposed diff → human review → applied` — depends
on this process actually being isolated, not merely conventionally separate; this
page is what a self-hoster configures to run it, and what it does and does not do.

## What it is, concretely

`src/lib/server/runner/` is the runner's code. `scripts/runner.ts` is its
plain-`node` entrypoint (`node scripts/runner.ts watch`), the same "no build step,
no dev dependency" shape `scripts/migrate.ts` already uses — the deployed image
runs it directly, and every internal import in `src/lib/server/runner/` carries an
explicit `.ts` extension for exactly this reason (extensionless relative imports
only resolve under Vite's bundler resolution, not under plain node's ESM loader —
see `scripts/record-backup-run.ts`'s own comment for the general rule this works
around).

The runner watches a durable, filesystem-only job queue
(`RUNNER_QUEUE_DIR`, `src/lib/server/runner/queue.ts`): a job is a JSON file in
`pending/`, moved atomically (`rename(2)`) into `done/` or `failed/` once it is
actually finished. There is no database-backed queue and no in-memory state that
matters — a crash at any point, including mid-job, loses nothing: the job file is
either still whole in `pending/`, or it has already moved. `queue.test.ts` proves
this by killing a running runner process with `SIGKILL` mid-job and checking the
directory afterward, not by reasoning about it.

For each job, the runner:

1. Re-reads the job's `documentId` from its own scoped database read and checks
   its `contractId` matches what the job claims — a producer bug naming the wrong
   contract cannot have that document extracted against it. `job.test.ts` proves
   this with a test that patches the real global `fetch` to throw if reached, then
   asserts the refusal happens without that throw ever firing.
2. Calls the model (`model.ts`) over a real ACP connection
   (`acp-client.ts`): spawns the configured CLI agent as a subprocess, completes
   the `initialize`/`session/new` handshake, sends one prompt, reads back the
   agent's text.
3. Parses that text as `{ proposedFields, excerpt, confidence, confidenceReason? }`
   (`job.ts`) — `confidenceReason` is optional, present when the model had a
   reason for a lowered confidence (#244). Anything that does not parse into
   exactly this shape is a thrown error naming what was wrong — never a
   best-effort guess.
4. Prints the result as one JSON line on stdout and moves the job file to
   `done/`.

That is the runner's entire output. It never calls `createProposal`
(`repositories/proposal.ts`) itself — it has no database grant to write anywhere,
so it could not even if the code tried to. A producer (#85/#86/#87, none of which
exist yet) reads this process's stdout, or imports `enqueueJob`/the queue
directly, and is the one thing with a real, write-capable connection that turns a
runner's output into a `proposal` row through the normal repository and the
normal database triggers.

## Why the app works with the runner stopped

Nothing in `src/routes/` or the web app's own request path depends on the runner
being up. Stopping it (`docker compose -f compose.prod.yaml stop runner`, or just
never starting the service at all) does not take anything else down: the web app,
authentication, day recording, invoicing and the proposal review screen all work
exactly as before. What disappears is only the ability for the runner to keep
producing new proposals from ingested documents — invariant 3's other half, "a
runner failure degrades to manual entry, not to a broken product."

## What has and has not been exercised

There is no local model here and there never will be: #81's decision was revised
on 2026-08-08 to Claude, with no local LLM at all.

- **Claude, driven through this runner's own ACP client, works.** Verified with
  `AcpAgentModel` unmodified, spawning
  `npx -y @zed-industries/claude-code-acp`, against #85's actual task:
  `"Ciao, ti confermo le giornate del 3 e 4 febbraio 2026, la seconda mezza."`
  came back as `{"days":[{"date":"2026-02-03","quantity":1},{"date":"2026-02-04","quantity":0.5}]}`
  in 8.6 seconds. Both days, and the half resolved onto the right one.
- The genuine ACP transport (subprocess spawn, JSON-RPC handshake, prompt/response
  round trip) is also covered by a minimal ACP-speaking test fixture
  (`src/lib/server/runner/__fixtures__/fake-acp-agent.ts`, never wired into any
  production path), which is what the suite runs: the probe above is a one-off
  against the real model, not something CI repeats on every push.
- `AcpAgentModel.call()` with no agent configured throws
  `RunnerConfigurationError` immediately, before any spawn — the "fail loudly"
  half of #82's acceptance, never a fabricated proposal.
- Whether extraction quality is usable across a real corpus is #85/#86/#87's own
  acceptance to prove, not this page's.

## Configuration

All of this lives in `.env` (local) or `.env.prod` (production) — see those files'
own comments for the exact variables. In short:

- `RUNNER_DB_PASSWORD` / `RUNNER_DATABASE_URL` — the runner's own credentials,
  rotated into the `mastro_runner` role (`drizzle/0035_acp_runner_role.sql`) by
  `scripts/migrate.ts` on every migration run, local or in the deployed image.
  Never the same role as `DATABASE_URL`.
- `RUNNER_QUEUE_DIR` — where the durable job queue lives on disk. Defaults to
  `./data/runner-queue`; `compose.prod.yaml` mounts a named volume there so it
  survives a container recreate.
- `RUNNER_AGENT_COMMAND` / `RUNNER_AGENT_ARGS` (JSON array) / `RUNNER_AGENT_ENV`
  (JSON object) — Claude. Claude Code speaks ACP through Zed's adapter, so the
  command is `npx` with `["-y","@zed-industries/claude-code-acp"]`, and the env
  carries a long-lived `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` plus
  the `PATH` and `HOME` the adapter needs. That token is the only credential the
  agent receives.

`RUNNER_AGENT_ENV` is the _only_ environment the spawned agent subprocess gets —
never this process's own environment. `RUNNER_DATABASE_URL` and everything else
this process holds cannot reach the model agent, even by accident.

## Deploying it

`compose.prod.yaml` builds a second, much smaller image from the same
`Dockerfile` (`target: runner`) — no SvelteKit build, no Better Auth secret, no
web-facing port at all. It depends on `db` being healthy and reaches it the same
way `web` does, over the compose network, with its own role. Leaving
`RUNNER_AGENT_COMMAND` unset is a legitimate way to run the rest of the
stack without the runner doing anything yet; removing the `runner` service from
`compose.prod.yaml` entirely works identically.
