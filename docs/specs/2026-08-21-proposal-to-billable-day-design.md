# From a proposal to a billable day

Design, agreed 2026-08-21, before any code was written.

## Why

The complaint was that the flow feels long: accept a proposal, maybe review
it first, then mark every day by hand. Measured, it is worse than long. It
does not finish.

`accepted proposal → work_unit at 'approved'` works. Nothing moves a day
from `approved` to `worked`. The database allows the edge:

```sql
('approved', 'worked'),
```

and the application has no path to it. The day detail page posts to
`dispute`, `link`, `reject`, `resolveDispute`, `revoke` and `unbillable`.
The repository has `markWorkUnitUnbillable`, `disputeWorkUnit`,
`revokeWorkUnit`, `rejectWorkUnit`, `linkApprovalToWorkUnit` — and no
function that records a day as worked. Invoicing reads only `worked` and
`disputed`:

```ts
inArray(workUnit.state, ['worked', 'disputed']),
```

So on the live instance right now:

```
work_unit  2026-08-04  0.5  approved   accepted by a human, not invoiceable, no way forward
```

The dashboard even holds `APPROVED_AWAITING_WORK_STATES = ['approved']`: it
shows days waiting to be worked, and offers nothing to do about them. The
only route to a billable day is `/day/new` by hand — which is exactly the
step that felt too slow, and doing it for a day already accepted creates
the duplicate `/day/new` now warns about.

**Recording every day by hand was not a preference for the long road. It
was the only road that arrives.**

## Decisions taken

Four, in conversation, before this document:

1. **Accepting a proposal means the day is agreed.** Once its date has
   passed, the day becomes `worked` on its own. No action per day.
2. **Every proposal is still seen by a human**, judged from the queue row
   rather than by opening it. Invariant 3 is unchanged; no confidence
   threshold auto-accepts anything.
3. **Scope is the proposal path only.** Days no email mentions keep using
   `/day/new`, one at a time, and are revisited once this is in use.
4. **A re-read updates rather than duplicates**: a pending proposal is
   revised in place, a rejected date may be proposed again, and a date
   already recorded raises an alert instead of touching the ledger.

## The flow, after

```
mail arrives (inbox or sent)
  → extraction proposes a day
  → the queue row carries the client's own words          one tap: accept
  → work_unit at 'approved', linked to its approval
  → the date passes
  → the settle sweep records it 'worked'                  no action
  → invoicing picks it up
```

Human interactions per day: **one**. Corrections stay where they are:
revoke, dispute, unbillable, and `/day/[id]` for anything else.

## Components

### The missing function, and who calls it

`markWorkUnitWorked(id, actor, reason, tx?)` in
`src/lib/server/repositories/work-unit.ts`, beside the six transition
helpers already there (`linkApprovalToWorkUnit`, `markWorkUnitUnbillable`,
`disputeWorkUnit`, `resolveWorkUnitDispute`, `revokeWorkUnit`,
`rejectWorkUnit`) and delegating to `transitionWorkUnit` exactly as they do.
The database already permits the edge, so this adds no constraint and no
migration.

Two callers:

- **`/api/days/settle`**, a new cron-shaped route beside the five that
  exist. Not folded into `/api/agent/run`: that route is the extraction
  drain, and hiding a ledger write inside a job about something else is how
  it stops being found. `scripts/scheduler.test.ts` parses both
  `scripts/scheduler.ts`'s route list and the `image` job's sweep in
  `.github/workflows/ci.yml` and fails naming the route if either omits it,
  so the new route arrives with a caller in CI by construction.
- **A button on `/day/[id]`**, "mark as worked", for a day approved for
  today that is already finished. This is also the honest repair: that
  action was simply missing.

### The rule the sweep applies

A `work_unit` in `approved` whose `date` is **strictly before today** becomes
`worked`. Nothing else moves:

| state                             | what the sweep does | why                                       |
| --------------------------------- | ------------------- | ----------------------------------------- |
| `approved`, date passed           | → `worked`          | agreed in writing, and the day is over    |
| `approved`, date today/future     | nothing             | the day has not happened yet              |
| `proposed`                        | nothing             | nobody agreed to it; there is no approval |
| `worked_without_approval`         | nothing             | already its own honest state              |
| `revoked`/`rejected`/`unbillable` | nothing             | decided, and not by a sweep               |

Recorded with actor `{ kind: 'system' }` — already in `TransitionActor` —
and a reason naming why. `work_unit_transition` is append-only by trigger,
so this is never a silent write: it is a row that says who and why, visible
on the day.

**Timezone.** mastro configures none. "Before today" is computed in UTC, so
in Italy a day becomes billable at 01:00 or 02:00 the following night. Being
late is safe and being early is not: no day becomes billable while it is
still in progress anywhere. A local midnight needs a timezone on the fiscal
profile, which is a separate decision and deliberately not taken here.

### The queue row that can be judged

`/proposals` already accepts and rejects per row, and shows confidence with
its reason. It does not show the excerpt, which is the one thing that forces
the detail screen open. Add the client's own words to the row, clamped to
about three lines with an expander when longer. The detail screen keeps its
job: changing something, not understanding it.

### A re-read updates instead of dropping

Today `datesAlreadyDecided` returns the dates a contract already holds and
`validateDays` refuses a day on one of them. That deliberately stopped
duplicates and accidentally dropped updates: a client writing "half a day,
not one" while the proposal is still pending has that reading discarded,
visible only in the extraction run.

Split the one fact into the two it always was:

- **a recorded `work_unit` on that date** — still suppressed, and now
  reported (below);
- **a pending `proposal` on that date** — no longer suppressed. The producer
  finds that proposal and rewrites its reading: `proposed_fields`, `excerpt`,
  `confidence`, `confidenceReason`, and the `document_id` the day's evidence
  now points at. **The `id` does not change**, so a link somebody already has
  open still resolves.

**How "revised" is visible, with no new column.** Every table carries
`updated_at`, maintained by trigger. For a row still `pending`, the only
thing that can make `updated_at` differ from `created_at` is a re-read
rewriting it — accepting and rejecting both move the row out of `pending`.
The queue reads "revised" from that comparison. Implementation must confirm
nothing else writes to a pending proposal; if something does, this needs an
explicit marker instead, and that is a change to this design worth stating
rather than absorbing.

**A rejected date may be proposed again**, which is already the behaviour and
stays deliberate: a rejection says "not this proposal", not "never this day".
It gains a test so it is a decision on the record rather than a side effect.

### When a reading disagrees with the ledger

The contradiction is discovered by the producer in a moment that then passes.
Alerts are detectors that query the database and cannot re-invoke the model,
so the reading has to be written down. This is the same shape
`backup_failure` and `mirror_failure` already have: an alert type whose
evidence is a row on a table of its own.

**New table `day_reading_conflict`**, one row per `(contract_id, date)`,
upserted so the newest reading supersedes the previous one:

| column                           | notes                                                                     |
| -------------------------------- | ------------------------------------------------------------------------- |
| `id`, `created_at`, `updated_at` | house columns and the `set_updated_at` trigger                            |
| `contract_id`                    | `ON DELETE RESTRICT`                                                      |
| `date`                           | the day the reading is about                                              |
| `document_id`                    | `ON DELETE RESTRICT` — the message the reading came from                  |
| `extraction_run_id`              | `ON DELETE RESTRICT` — the run, whose transcript is the full record       |
| `proposed_fields`                | `jsonb`, **null means the newest reading proposes nothing for this date** |
| `excerpt`                        | `text`, null in the same case                                             |

Unique on `(contract_id, date)`.

**Two new alert types**, because `AlertDetail` is a discriminated union and
`render.ts` switches on it, so two conditions with different sentences are
two members rather than one member with prose branching inside it:

- `recorded_day_contradicted` — a `work_unit` exists for that date and the
  newest reading disagrees with it.
- `pending_proposal_unconfirmed` — a pending proposal exists and the newest
  reading no longer proposes that day at all. Not withdrawn automatically:
  that would be the agent deciding.

Both are metadata-only additions — `ALERT_TYPES` is text with a widened
CHECK, explicitly so a new type is never an `ALTER TYPE ... ADD VALUE`.

**They resolve themselves.** The detectors compare the stored reading against
the ledger every run, so an alert disappears when the two agree again. And
"seen, my version stands" is the acknowledgement the engine already has,
keyed by `alertKey` — no second kind of acknowledge button, which is the
mistake `alert_acknowledgement`'s own doc comment exists to prevent.

## Data flow

Two loops, both already scheduled:

```
/api/mail/poll     → archives inbound and sent mail
/api/agent/run     → enqueues, drains, writes or revises proposals,
                     and records a conflict when the ledger disagrees
/api/days/settle   → moves approved days whose date has passed to worked
/api/alerts/run/*  → reads day_reading_conflict and raises the two alerts
```

Nothing new runs on a request path. The queue row change is a read.

## What must not happen

- **A day must never become billable while it is still in progress.** The
  strict `date < today` comparison and the UTC choice both exist for this.
- **A day nobody agreed to must never advance.** `proposed` is untouched by
  the sweep; only `approved`, which by construction carries an approval, is.
- **The ledger must never move on a decision a human made.** A reading that
  contradicts a recorded day raises an alert and writes nothing else.
- **A re-read must never duplicate a day.** The pending path rewrites one
  row; the recorded path writes no proposal at all.
- **A revision must not lose evidence.** The archived documents and the
  extraction run transcripts both survive, so a superseded reading remains
  readable in the run that produced it.

## Testing

- `markWorkUnitWorked`: the edge is allowed, the transition row names the
  `system` actor and the reason, and an illegal source state is refused by
  the database rather than by an application check.
- The settle sweep: a table-driven test over every state in the table above,
  including the boundary — a day dated today does not move, a day dated
  yesterday does.
- The revision path: a pending proposal is rewritten in place with the same
  `id`; a recorded date produces no proposal and one conflict row; a rejected
  date produces a new proposal.
- The mirror case: a reading that proposes nothing for a date with a pending
  proposal writes a conflict row with null `proposed_fields`.
- Both detectors: they fire while the disagreement stands and stop when the
  ledger and the reading agree, without an acknowledgement.
- The queue row: the excerpt is rendered, and a proposal whose `updated_at`
  differs from `created_at` reads as revised.
- `scripts/scheduler.test.ts` covers the new route by construction; the
  `image` job POSTs it against the real runtime image.
- Browser: accept from the queue without opening the detail, then confirm the
  day is `approved`; and a day dated yesterday reaching `worked` after the
  sweep, in both interface languages.

## Out of scope, deliberately

- **Days no email mentions.** They keep `/day/new`, one at a time. Revisited
  once this path is in use, judged on something real rather than a guess.
- **Auto-accepting anything.** Invariant 3 stays as written: agents propose,
  humans confirm.
- **Invoicing and extraction.** Untouched.
- **A timezone on the fiscal profile.** Named as a decision, not taken.
