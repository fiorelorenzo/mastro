# Extraction runs: making the agent visible

Design, agreed 2026-08-15, before any code was written.

## Why

Uploading a contract appeared to do nothing, and for two days it genuinely
did nothing: the model read the document correctly in 30 seconds and the
drain discarded its answer every five minutes on a schema mismatch, with
the person who uploaded the file shown no trace of any of it. That
particular defect is fixed (v0.6.5). What is not fixed is the reason it
survived two days: **nothing in the product can tell you an extraction
happened, is happening, or failed.**

Measured on the run that exposed it:

| leg                         | duration        |
| --------------------------- | --------------- |
| model extraction            | 30 seconds      |
| wait for the scheduler tick | up to 5 minutes |
| signals shown to a human    | none            |

## The shape of the answer

Three things were asked for — live status, a visible agent run, and a
durable registry. They are not three features. They are **three views of
one object**, and building them as three would produce three versions of
the truth that drift, the way three inline copies of one tab list drifted
earlier the same day.

The object is a **run**.

## Data

Two new tables, both following the conventions in `AGENTS.md`: `id` uuid,
`created_at`, `updated_at`, and the `set_updated_at()` trigger.

### `extraction_run`

| column        | type                      | note                                        |
| ------------- | ------------------------- | ------------------------------------------- |
| `id`          | uuid                      |                                             |
| `job_id`      | uuid, unique              | the id `enqueueJob` already returns         |
| `document_id` | uuid, FK `document`       |                                             |
| `target_type` | text                      | `contract` / `invoice` / `work_unit`        |
| `status`      | text                      | see below                                   |
| `enqueued_at` | timestamptz               |                                             |
| `started_at`  | timestamptz, null         | first update observed from the agent        |
| `finished_at` | timestamptz, null         |                                             |
| `error`       | text, null                | populated exactly when `status = 'failed'`  |
| `proposal_id` | uuid, null, FK `proposal` | populated exactly when `status = 'applied'` |

`status` is `queued` → `running` → `extracted` → `applied` | `failed`.

`extracted` and `applied` are deliberately separate states. The v0.6.5
defect lived precisely in the gap between them — the model had answered
and the write was failing — and no state named that gap, which is why it
was invisible. A CHECK constraint enforces the two pairings above:
`error` non-null iff `failed`, `proposal_id` non-null iff `applied`.

### `extraction_run_event`

| column    | type                                        | note                                                            |
| --------- | ------------------------------------------- | --------------------------------------------------------------- |
| `id`      | uuid                                        |                                                                 |
| `run_id`  | uuid, FK `extraction_run` on delete cascade |                                                                 |
| `seq`     | integer                                     | unique per run                                                  |
| `at`      | timestamptz                                 | when the runner observed it                                     |
| `kind`    | text                                        | `message` / `thought` / `tool_call` / `plan` / `stop` / `error` |
| `payload` | text                                        | the update's own text, verbatim                                 |

Append-only; no update path. This is the transcript, kept indefinitely —
the explicit decision taken in this conversation, over keeping only
outcomes or keeping transcripts only for failures. The consequence
accepted with it: a second copy of contract text lives in the database
alongside the archived PDF, and it inherits the same deny-by-default
route protection as everything else (invariant 6).

## Who writes what

**The runner keeps no database write access** (invariant 3). It writes
newline-delimited JSON to `runs/<jobId>.jsonl` inside `RUNNER_QUEUE_DIR`,
a fourth directory beside `pending/`, `done/` and `failed/`. The web app
remains the only writer to the database.

The jsonl is a transport buffer, never the record: whoever drains the job
stores its events as `extraction_run_event` rows and then deletes the
file. A run's history is read from the database, never from disk.

### The one change to the protocol layer

`acp-client.ts` currently calls `session.readText()`, which accumulates
`agent_message_chunk` text and discards every other update. The ACP SDK's
own docstring points at the replacement: `nextUpdate()` yields each
update — message chunks, thoughts, tool calls, plans — until a `stop`
message.

`runAcpPrompt` gains an optional `onUpdate` sink and loops on
`nextUpdate()`, accumulating exactly the same text it returns today so
its existing contract is unchanged, and handing every update to the sink
as it arrives. The runner passes a sink that appends to the jsonl.

## Making it immediate

- The contract upload action creates the `extraction_run` row (status
  `queued`) keyed by the job id `enqueueJob` returns, then redirects to
  that run's page rather than blindly to `/proposals`.
- The run page opens an SSE connection to `/import/runs/[id]/stream`.
- The stream tails `runs/<jobId>.jsonl`, persists each line as an event
  row, and pushes it to the browser. First line observed moves the run to
  `running`.
- When the runner moves the job into `done/`, the stream drains **that
  one job** immediately — no waiting for a tick — and emits a final event
  carrying the proposal id, or the failure reason.
- The scheduler keeps its five-minute tick unchanged. It is the safety
  net for runs nobody watched: a closed tab, a locked phone.

### The race this creates, and the guard

Two drains can now touch one job: the watching request and the scheduler.
The existing `listProposalsForDocument` check is check-then-act and does
not survive concurrency.

The obvious guard — a partial unique index on `proposal (document_id)` —
is wrong, and worth recording as wrong so nobody reaches for it again:
one document legitimately produces **many** proposals. `applyDayJob`
calls `writeDayProposals`, plural, because one email approving a week of
work is one document and five days.

The guard is instead an atomic claim on the run itself:

```sql
UPDATE extraction_run SET status = 'applied'
 WHERE job_id = $1 AND status = 'extracted'
RETURNING id
```

No row returned means another drainer claimed it first, and this one
skips. The claim and the proposal writes share one transaction, so a
producer that throws rolls the claim back and the run stays `extracted`
for the next attempt — which is what kept the v0.6.5 job retrievable
after two days of failing. A conditional update, not a mutex, because in
this codebase invariants are enforced by the database.

## The three views

- **Live status (A)** — the run page: state, elapsed time, and when it
  lands, the outcome in place with a link to the proposal it created. A
  failure shows its reason on screen.
- **The agent run (B)** — the same page with the transcript expanded,
  events appearing as they arrive. Because events are stored, reopening a
  finished run replays the identical rows: the live view and the history
  are one component reading one source.
- **The registry (C)** — `/import/runs`: every run, newest first, with
  state, duration, document name and outcome. This is the view that makes
  a failure repeating every five minutes visible.

Verified against the incident: an upload at 09:57 would have shown 30
seconds of extraction, reached `extracted`, then turned `failed` with
`client.taxId: Invalid input: expected string, received null` on screen,
and stayed red in the registry until someone looked.

## Not in scope

- No new alert type. The registry makes failures visible; routing them
  into the alert engine is a separate issue.
- No retention or purge policy for transcripts, per the decision above.
- No change to what the model is given, which #81 already settled.
- The CSV day importer and the folder invoice importer keep their own
  flows. A run covers agent extraction jobs, which today means contracts
  and, when #85 lands, days proposed from mail.

## Decisions taken here, and their alternatives

1. **Event rows rather than one transcript column.** Costs a second
   table; buys one rendering path for both live and historical views.
2. **You land on the run's own page, not an inline panel on the upload
   form.** A run has a URL, so closing the tab and coming back still
   shows it. "Verifiable" requires that.
3. **The runner streams through a file, not a socket.** The shared volume
   between `runner` and `web` already exists and already carries the job
   handoff; a second transport would be a second thing to operate.
