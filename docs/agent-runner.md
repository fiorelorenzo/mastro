# The ACP runner (#82)

A separate process that speaks [ACP](https://agentclientprotocol.com) (the Agent
Client Protocol) to a CLI agent, holds its own credentials, and connects to the
database with a role that cannot write to the ledger and cannot read anything
beyond what model routing requires. Epic #15's whole shape —
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
   its `contractId` matches what the job claims — a producer bug pointing a
   document at the wrong contract cannot borrow that contract's hosted-extraction
   consent.
2. Decides local or hosted (`routing.ts`) by reading
   `contract.hosted_extraction_consent_document_id` directly, never trusting the
   job's own say-so. Null (every contract's starting state) means local-only, and
   a request for hosted on a null-consent contract is refused outright — no
   network call is made, no fallback to hosted-anyway. `job.test.ts` proves this
   with a test that patches the real global `fetch` to throw if reached, then
   asserts the refusal happens without that throw ever firing.
3. Calls the resolved model (`model.ts`) over a real ACP connection
   (`acp-client.ts`): spawns the configured CLI agent as a subprocess, completes
   the `initialize`/`session/new` handshake, sends one prompt, reads back the
   agent's text.
4. Parses that text as `{ proposedFields, excerpt, confidence }` (`job.ts`).
   Anything that does not parse into exactly this shape is a thrown error naming
   what was wrong — never a best-effort guess.
5. Prints the result as one JSON line on stdout and moves the job file to
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
on 2026-08-08 to Claude, with no local LLM at all, so a contract with no consent
on file gets no extraction rather than a worse one.

- **Claude, driven through this runner's own ACP client, works.** Verified with
  `AcpAgentModel('hosted', …)` unmodified, spawning
  `npx -y @zed-industries/claude-code-acp`, against #85's actual task:
  `"Ciao, ti confermo le giornate del 3 e 4 febbraio 2026, la seconda mezza."`
  came back as `{"days":[{"date":"2026-02-03","quantity":1},{"date":"2026-02-04","quantity":0.5}]}`
  in 8.6 seconds. Both days, and the half resolved onto the right one.
- The genuine ACP transport (subprocess spawn, JSON-RPC handshake, prompt/response
  round trip) is also covered by a minimal ACP-speaking test fixture
  (`src/lib/server/runner/__fixtures__/fake-acp-agent.ts`, never wired into any
  production path), which is what the suite runs: the probe above is a one-off
  against a real provider, not something CI repeats on every push.
- `AcpAgentModel.call()` on an unconfigured provider throws
  `RunnerConfigurationError` immediately, before any spawn. With no local agent
  configured, that is exactly what a local-routed job does, and it is the correct
  reading of "this contract has no consent, so a human handles it".
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
- `RUNNER_LOCAL_AGENT_COMMAND` / `RUNNER_LOCAL_AGENT_ARGS` (JSON array) /
  `RUNNER_LOCAL_AGENT_ENV` (JSON object) — unset, and expected to stay unset.
  There is no local model, so a local-routed job failing loudly is the design.
- `RUNNER_HOSTED_AGENT_COMMAND` / `RUNNER_HOSTED_AGENT_ARGS` / `RUNNER_HOSTED_AGENT_ENV`
  — Claude, only ever reached for a contract whose
  `hosted_extraction_consent_document_id` is set. Claude Code speaks ACP through
  Zed's adapter, so the command is `npx` with
  `["-y","@zed-industries/claude-code-acp"]`, and the env carries a long-lived
  `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` plus the `PATH` and `HOME`
  the adapter needs. That token is the only credential the agent receives.

`RUNNER_*_AGENT_ENV` is the _only_ environment the spawned agent subprocess gets —
never this process's own environment. `RUNNER_DATABASE_URL` and everything else
this process holds cannot reach a model agent, local or hosted, even by accident.

## Setting or revoking hosted-extraction consent

A human sets `contract.hosted_extraction_consent_document_id` from the contract's
edit screen (`/clients/[id]/contracts/[contractId]/edit`), by archiving the actual
consent (a signed amendment, an email confirming the request) — never a checkbox.
The archived document is owned by the contract (`document.ownerType = 'contract'`),
the same evidentiary shape every other piece of proof in this system carries; a
custom migration trigger (`0034_contract_hosted_extraction_consent_constraints.sql`)
rejects any value that does not point at a document actually archived that way.
Revoking consent clears the link without deleting the archived document — it stays
as a historical record, never silently discarded.

## Deploying it

`compose.prod.yaml` builds a second, much smaller image from the same
`Dockerfile` (`target: runner`) — no SvelteKit build, no Better Auth secret, no
web-facing port at all. It depends on `db` being healthy and reaches it the same
way `web` does, over the compose network, with its own role. Leaving
`RUNNER_LOCAL_AGENT_COMMAND` unset is a legitimate way to run the rest of the
stack without the runner doing anything yet; removing the `runner` service from
`compose.prod.yaml` entirely works identically.
