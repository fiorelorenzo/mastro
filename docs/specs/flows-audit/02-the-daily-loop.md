# The daily loop — recording a day, getting it approved, checking you're caught up

Read against `v0.3.0`, the same commit and seeded instance the main UX review
(`docs/specs/2026-08-13-ux-ui-review.md`) was written against — three
contracts (Nordwind Logistics, 700€/day, prior approval required; Bellani &
Partners, 620€/day, no approval required, 35% concentration cap; Fermata
Digitale, retainer, no days), one `worked_without_approval` day, invoices
2026/011 (overdue), 2026/014 (paid) and 2026/015 (due soon). Today is
2026-08-13. Screenshots at `/tmp/shots/{desktop-it,mobile-it,desktop-en,dark-it}/`;
the seeded instance runs locally on port 5187.

This is not a re-read of the UX review's per-screen critique. It is the same
five surfaces (`day/new`, the mail/proposal pipeline, `day/[id]`,
`day/calendar` + `day/date/[date]`, the alert engine) walked as one
continuous job — record, get it approved, catch a miss, check the month,
survive a week of not looking — rather than five unrelated pages.

## The job

Nordwind sends Paola Ricci's team out most weekdays; Bellani is continuous.
Every day the practitioner actually works, on either contract, is a day that
has to end up in the ledger with money attached, a written approval on file
if the contract demands one, and no more than about thirty seconds of
attention spent doing it — that is the product's own v0 promise
(`AGENTS.md:84`: "usable from a phone in under 30 seconds per day"). "Done"
for a single day is: a `work_unit` row exists, in a state that counts toward
both the month's day total and its money total
(`work-unit-state.ts:59-67`), with an `approval_id` if the contract requires
one. "Done" for the loop as a whole is the standing, ambient guarantee the
practitioner never has to hold in their head: if Tuesday's day is still
sitting unapproved on Friday, or an email confirming three days never turned
into three ledger rows, the product — not the person's memory — is the thing
that notices first.

## Today, step by step

### 1. Recording a day, from a phone, cold start

Common case per the assignment: same contract as yesterday, full day, short
scope. `start_url` in `static/manifest.webmanifest:7` is `/`, so a cold
launch (PWA icon tap, app not already open) always lands on the dashboard,
never on the form itself.

1. Launch the app → `/` (dashboard). Not a tap, but the first page load.
2. Tap **"Registra giornata"** (`src/routes/+page.svelte:34`,
   `resolve('/day/new')`) — **1 tap**. This is the _only_ one-tap path to
   `/day/new`; the bottom bar (`src/lib/nav/items.ts:47`,
   `BOTTOM_BAR_HREFS = ['/', '/day/calendar', '/clients', '/invoices']`) has
   no entry tab of its own, so from any other screen the trip is at least
   2 taps (home tab, then this CTA), and the desktop-only "n" shortcut
   (`+page.svelte:17-25`) does nothing on a phone — there is no keyboard.
3. Date: `<input type=date>` defaults to today
   (`day/new/+page.server.ts:63-66`) — **0 taps**.
4. Contract: `<select>` defaults to `getMostRecentContractId()`
   (`work-unit.ts:187-198`, wired at `+page.server.ts:57-60`) — the exact
   "same contract as yesterday" case — **0 taps**.
5. Approval: hidden entirely when the contract does not require one
   (`+page.svelte:134`, `selectedContract?.requiresPriorApproval`) — **0
   taps** for Bellani. For Nordwind it renders and _always_ starts at `''`
   (`+page.svelte:22`, `approvalId = $state(form?.values.approvalId ?? '')`)
   even when exactly one approval exists for the contract — open (1) +
   choose (1) = **+2 taps**.
6. Quantity: two preset buttons (`Giornata intera` / `Mezza giornata`) both
   write the same `quantity` state a plain number input also writes
   (`+page.svelte:152-186`); the initial value is `'1'`
   (`+page.svelte:20`), i.e. `Giornata intera` already selected — **0
   taps** for a full day, but the screen shows two controls for the one
   decision on every single entry (a still-live MAJOR in appendix 04).
7. Scope: the one field that must always be typed. `node.focus()` on mount
   (`+page.svelte:61-66`) does not reliably raise an on-screen keyboard on
   iOS Safari without a prior gesture — budget **1 tap** to focus, then
   roughly **20–25 keystrokes** for something like "monitoraggio
   spedizioni" (24 characters).
8. Save, `type="submit"` — **1 tap**.

**Happy path, no approval required (Bellani): 3 taps + ~20–25 keystrokes.**
**Happy path, approval required, one candidate exists (Nordwind): 5 taps +
~20–25 keystrokes** — purely because of finding 8's dead default, since a
single-candidate `<select>` has only one sane answer.

Two pages load (`/`, `/day/new`); the redirect to `/day/[id]`
(`+page.server.ts:110`) is a third, uninteracted-with page view.

**The case the assignment specifically asks for — the day needs an approval
that doesn't exist yet.** Nothing in the form blocks this: `approvalId`
is optional (`work-unit-form.ts:68-74`), and `requiresPriorApproval` only
gates whether the `<select>` renders, never whether it has any options in
it (`approvalsForContract` can be `[]`, `+page.svelte:39`). The person
submits the same **3 taps + keystrokes** as any other day. Server-side,
`parseDayEntryForm` builds `{ state: 'worked', approvalId: null }`
(`work-unit-form.ts:87-97`), and the `0013_worked_without_approval.sql`
trigger (line 20-21) silently rewrites the row to
`worked_without_approval` before it is ever visible. Recording the day
costs nothing extra. What happens next is where the product goes quiet —
see step 3.

### 2. The approval half: an email arrives

Trace: `mail/poll.ts` → `inbound_thread` → `agent/enqueue.ts` → the ACP
runner → `agent/drain.ts` → `proposal` → `/proposals` → accept.

**Every hop that is not the model call itself needs an external cron
entry, and none is committed to this repository.** `poll.ts:13-19`'s own
doc comment: "nothing here schedules a pass on its own... 'picked up
within the configured interval' is the interval of whichever caller
invokes this." `.env.example:94-97` and `:118-120`: "Nothing in this
repository schedules a poll run itself — see the PR description for the
cron entry a production instance needs." A repo-wide search for an actual
crontab file, systemd timer, or scheduled GitHub Action turns up **none**
— `.github/workflows/` has only `ci.yml` and `deploy-prod.yml`, `deploy/`
has only the Caddyfile. `AGENTS.md:22-23` states the architecture as "a
separate worker process for mailbox polling, mirror publishing and
alerts" — but `engine.ts:1-7`, `poll.ts:13`, and `runner/cli.ts:9` each
independently call this same process "the future worker process AGENTS.md
describes and this repo does not build yet." It is documented
architecture, not shipped infrastructure.

Concretely, three independent on/off switches, each of which can be off
in production without anything failing loudly:

- **`POST /api/mail/poll`** — archives new mail as `document` +
  `inbound_thread` (`mail/poll.ts:225-277`). Needs a bearer-token cron
  call; recommended cadence "every few minutes" (comment,
  `thresholds.ts:59-66`), not configured anywhere in this repo.
- **`POST /api/agent/run`** — drains the runner's `done/` answers into
  `proposal` rows, then enqueues extraction for any archived message that
  still has none (`agent/run/+server.ts:34-49`). Same cron requirement,
  no documented interval, not configured anywhere.
- **`node scripts/runner.ts watch`** — the long-running process that
  actually calls Claude, polling its own `pending/` queue every 2 seconds
  once started (`runner/cli.ts:82-100`). `docs/deploy.md:212-216`:
  "`scripts/deploy-prod.sh` starts the ACP runner only when `.env.prod`
  sets `RUNNER_AGENT_COMMAND`."

**Configuration A — runner off (the state of production today, per the
assignment).** None of the three switches are flipped. The email sits in
the mailbox forever; `document`/`inbound_thread` never gets written;
nothing is ever proposed. `docs/agent-runner.md:56-64` is explicit that
this degrades gracefully — "the web app, authentication, day recording,
invoicing and the proposal review screen all work exactly as before" —
but grace here means the AI half of the loop contributes nothing at all.
The only way the day reaches the ledger is the human noticing the email
themselves and walking through step 1 by hand. **Latency: unbounded,
identical to not having the feature.**

**Configuration B — runner on a schedule (both cron entries wired up,
watch process running).** Assume a 5-minute poll interval and a 5-minute
agent-run interval, both realistic for "every few minutes":
mail poll (≤5 min) → agent-run tick that enqueues (≤5 min) → runner watch
tick picks it up (≤2 s) → one real Claude call, measured at 8.6 s in
`docs/agent-runner.md:71-76` → next agent-run tick that drains and writes
the `proposal` row (≤5 min) → **now on `/proposals`, reachable from
exactly one place in the entire chrome** (`nav/items.ts` has no Proposals
entry in any of its three `NAV_GROUPS`; the only link is the dashboard's
own `proposals-cta`, appendix 07 finding 3) → a human has to independently
open the dashboard, notice it, open the proposal, and tap Accept (1 tap
for the common case, fields already correct). **Mechanical latency: on the
order of 15–20 minutes.** Human latency on top: unbounded, because — see
finding 1 below — a pending proposal raises **no alert of any kind**, so
nothing pushes, digests, or badges it beyond that one dashboard link.

**Configuration C — runner "live"** (watch process running, but the two
HTTP hops still cron-driven — there is no configuration in this codebase
where mail-poll and agent-run are anything other than cron-invoked
endpoints; "live" only shortens the runner's own pickup to ≤2 s). Same
totals as B, since B already assumed the watch process is up.

**Even in the best-wired configuration, "the ledger knows" is the wrong
phrase for what actually happens on Accept.** `applyProposal`
(`repositories/proposal.ts:105-121`) for a `work_unit` target calls
`workUnitInputFromFields`, which returns exactly
`{ contractId, date, quantity, scope, notes }` — **no `state`, no
`approvalId`** (`proposal.ts:79-91`). `createWorkUnit`'s own doc comment:
"`state` defaults to `'proposed'`" (`work-unit.ts:54`). `proposed` does
not count toward the calendar's day total or amount total
(`work-unit-state.ts:59-67`, `dayCountsTowardDays`/`dayCountsTowardAmount`
both exclude it), is not eligible for invoicing
(`listEligibleWorkUnitsForInvoicing` selects only `worked`/`disputed`,
`work-unit.ts:200-222`), and — a repo-wide search for every production
caller of `transitionWorkUnit` finds exactly two: `invoice.ts:136`
(`worked → invoiced`) and `work-unit.ts:130`
(`linkApprovalToWorkUnit`, `worked_without_approval → worked`). **Nothing
in the shipped application ever calls `proposed → approved` or
`approved → worked`.** The proposal repository's own comment admits the
gap exists and is deferred: "whether accepting a day proposal from an
approval thread should also create the `approval` row it rests on is
#85's decision, not this one's" (`proposal.ts:73-77`) — but the practical
effect today is that accepting a proposal produces a row that behaves like
nothing else in the product: not a draft, not a day, not billable, with no
button anywhere to make it one. This is exactly what produced the "0
giorni" reading on the seeded August calendar that appendix 04 flagged
(`04-day-lifecycle.md:44`) without tracing why — four real, accepted days,
permanently invisible.

**So the honest timeline for "client confirms in writing → ledger knows"
is: configuration A, infinite; configuration B/C, roughly 15–20 minutes to
a human's Accept tap, and then never — the accepted day still isn't a day
the rest of the product recognizes.**

### 3. Linking an approval to a day already worked

The recovery path out of `worked_without_approval`
(`day/[id]/+page.server.ts:71-92`, the `?/link` action). Starting from a
cold app, having noticed the risk exists at all (see section 5):

1. Get to `/day/calendar` — 1 tap from the bottom bar.
2. Find the flagged cell (`mostAttentionNeedingState`,
   `work-unit-state.ts:98-102`, puts `worked_without_approval` first —
   `ATTENTION_ORDER`) and tap it — **1 tap**.
3. Land on `/day/[id]`. If `linkableApprovals.length > 0`
   (`+page.server.ts:31-38`), the linking form is already on the page — no
   extra navigation.
4. Open the `<select>` — **1 tap**; choose the one approval (there is
   almost always exactly one, since this is the sole path in) — **1 tap**.
   The `<select>` starts unselected (`day/[id]/+page.svelte:90`,
   `<option value="" disabled selected>`) even for the single-candidate
   case — the same dead-default defect as `day/new`'s approval field.
5. Tap **"Collega"** — **1 tap**.

**5 taps, 2 page loads, once you already know which day is flagged.**
Getting to "know which day is flagged" is itself the harder half — see
section 5; the alert that names this exact day
(`workUnitId`, `types.ts:47-140`) is never linked from `/alerts`, so the
calendar hunt above is the _only_ route in today, appendix 08 finding 1.

**When `linkableApprovals.length === 0` — no approval exists for the
contract at all — there is no recovery.** The page falls to
`{:else if data.workUnit.state === 'worked_without_approval'}` and renders
one line of plain, unstyled text (`day/[id]/+page.svelte:103-105`,
`m.day_detail_approval_link_empty()`). The state machine legally allows
`worked_without_approval → unbillable` (`0012_work_unit_state_machine.sql`
line 70) — a legitimate way to say "no approval is coming, write this
day off" — but `transitionWorkUnit`'s only production callers are the
two named in section 2; nothing ever performs this edge. **The day sits
flagged critical forever, or someone edits the database directly.**

### 4. Reading the month

Three routes; the assignment asks what each actually answers.

- **`/day/calendar`** — "what happened, spatially, this month." A
  Monday-first grid rendered _inside_ `ChartFrame`
  (`day/calendar/+page.svelte:11`), the same wrapper every real chart
  uses; below 640px `ChartFrame` swaps to a flat `DataTable`
  (`ChartFrame.svelte:35,44-52` per appendix 04) — **the grid, the one
  spatial structure that makes a calendar a calendar, does not exist on
  the primary target device.** The replacement table wraps a contract
  label five lines deep and truncates the amount column to "Imp"
  (appendix 04 finding 2). The one summary figure above the grid,
  "Giornate lavorate: N giorni," is a single number with no comparison to
  anything (a typical month, the ceiling, last month) — not a progress
  read, just a count, and — per section 2 — a count that silently
  excludes any day still stuck at `proposed`.
- **`/day/date/[date]`** — exists solely to disambiguate the rare case of
  two work units sharing a date on different contracts (`work_unit`'s
  uniqueness is `(contract_id, date)`, not `(date)`,
  `+page.server.ts:10-18`). Zero entries redirects to `/day/new?date=`;
  exactly one redirects straight to `/day/[id]`
  (`+page.server.ts:24-25`); its own template (a bare `<ul>`/`<li>`, no
  shared list component) only renders for ≥2 entries, a branch neither
  screenshot pass ever hit (appendix 04 finding 13). It answers **no
  question a person asks** — it is plumbing wearing a route.
- **`/day/[id]`** — "what happened on this one day, and is it in order."
  Badge, five-row definition list, and — only for the risk state, only
  when a candidate exists — the link form; otherwise no action of any
  kind (appendix 04 findings 7, 11).

**Verdict: three surfaces are not justified.** `day/date/[date]` is not a
surface, it is a redirect with an unused template attached to it — it
should not exist as a route a person can land on with intent; fold it
into `day/[id]` as a "same-date siblings" strip, exactly appendix 04's own
recommendation (`04-day-lifecycle.md:278-286`), and this audit's own
finding that it never once rendered in four screenshot passes only
strengthens that case. That leaves two real surfaces, and **neither
answers "am I where I should be this month"** on a phone today: the
calendar's spatial view is desktop-only, and its one number is silently
wrong for exactly the days most likely to need checking (freshly accepted
proposals). Nobody opens any of the three mid-month for that question
today, because none of them can answer it.

### 5. The weekly and monthly rhythm

Does the product tell you, on Friday, that Tuesday is still unapproved?

**Detection is live and correct.** `detectAlerts` is "a fresh query every
time... nothing here depends on a background job having run"
(`engine.ts:40-47`); `worked_without_approval` fires the moment the state
is set, no elapsed-day grace period, "always critical... there is no
lower severity for this one" (`detectors.ts:157-161`). Opening `/alerts`,
or any page (the sidebar/bottom-bar unread badge is computed on every
`+layout.server.ts` load, line 11-18), on Friday will show the truth about
Tuesday, as long as you look.

**Delivery is where the promise breaks, by explicit design, not by
accident.** `alertDelivery` dedups per `alertKey` — `${type}:${subjectId}`,
so per specific day (`types.ts:43-44`) — **channel-agnostically**: "the
same alert must not fire daily forever... an urgent alert pushed today is
not repeated in next week's digest at the same severity" — the schema's
own comment (`db/schema/alert.ts:78-86`), enforced by `covers()`
comparing severity rank alone (`state.ts:62-73`). That rule is correct for
alerts that escalate over time (`contract_expiring`,
`approval_unactioned`, `billable_period_closed` all step through
warning → serious → critical as days pass, so a re-notification at a
higher rank clears the dedup). **`worked_without_approval` never
escalates** — it is born critical and stays critical
(`detectors.ts:157-161` again) — so under the dedup rule it can be
delivered by push or digest **exactly once, ever, for that occurrence**,
whichever channel's cron entry reaches it first. Miss that one
notification — the phone was face down, the digest landed in a folder you
don't check on Fridays — and nothing built into this product will surface
that specific day again until you fix it or happen to look.

That leaves the unread badge (the "More" tab's dot,
`nav/BottomBar.svelte:27-30`, and the sidebar count) as the only
genuinely persistent signal, and it is **pull, not push**: it requires
opening the app at all. And this is with push/digest cron fully wired —
today, per the same gap documented in section 2, neither is scheduled by
anything in this repository (`dispatch.ts:1-7`: "Neither `runAlertPush`
nor `runAlertDigest` is scheduled by anything in this repository"), so in
production as it stands, **the badge dot is the entire weekly rhythm.**

**Totals for the loop as scoped** (8 distinct routes: `/`, `/day/new`,
`/day/[id]`, `/day/calendar`, `/day/date/[date]`, `/proposals`,
`/proposals/[id]`, `/alerts`): **9 user-facing fields** across the loop's
three data-entry surfaces (5 on `day/new` — date, contract, approval,
quantity, scope; 1 on `day/[id]`'s link form; 3 on a proposal's accept
form — date, quantity, scope), **roughly 9 real decisions** (one per
field, plus which of the three read surfaces to open), of which **2 are
already-derivable-but-not-derived** (both approval `<select>`s default to
blank when there is exactly one sane answer) — and **1 structural dead
end** that no tap count captures: an accepted proposal never reaches a
state the rest of the product recognizes as a day at all.

## What is wrong

1. **BLOCKER — [wrong model] an accepted day proposal is not a day.**
   `proposal.ts:79-91` builds no `state`, `createWorkUnit` defaults to
   `'proposed'` (`work-unit.ts:54`), and no production code path ever
   advances it. The one AI feature this batch is asked to trial produces
   ledger rows the ledger itself does not count, invoice, or ever prompt
   anyone to finish. Section 2, section 4.
2. **BLOCKER — [missing] there is no way to enter an approval by any
   channel but email.** `createApproval` (`repositories/approval.ts:39`)
   is called from exactly six test files and zero routes — a repo-wide
   search confirms it. A client who confirms by phone, Slack, or in a
   meeting has no representation in this product at all; the day they
   authorize can only ever be recorded as `worked_without_approval` and
   then has nothing to link against, ever (section 1's "approval that
   doesn't exist yet" case, section 3's "no approval exists" dead end).
3. **BLOCKER — [wrong model] the weekly rhythm is a single, deliberate
   notification, not a standing one, for the one alert type that most
   needs standing attention.** `worked_without_approval` never escalates,
   and delivery dedup is channel-agnostic and severity-rank keyed
   (`db/schema/alert.ts:78-86`), so it can be pushed or digested exactly
   once per occurrence. Section 5.
4. **BLOCKER — [missing] no scheduling infrastructure ships with the
   product at all.** Three independent cron dependencies (mail poll,
   agent run, alert push/digest) are each documented as "see the PR
   description" (`.env.example:94-97,118-120`) and none is committed as
   a crontab, systemd timer, or scheduled workflow. `AGENTS.md`'s own
   architecture line describes a worker process the code repeatedly
   admits, in its own comments, "this repo does not build yet." Section 2,
   section 5.
5. **MAJOR — [friction] recording a day is one tap only from the
   dashboard, never from anywhere else.** The bottom bar has no entry tab
   (`nav/items.ts:47`); from any other screen it is at least 2 taps home,
   then the CTA. Section 1.
6. **MAJOR — [friction] both approval `<select>`s in the loop default to
   blank even with exactly one sane answer.** `day/new/+page.svelte:22`
   and `day/[id]/+page.svelte:90`. 2 avoidable taps apiece, on the two
   screens in the loop where an approval decision actually matters.
   Section 1, section 3.
7. **MAJOR — [missing] a pending proposal raises no alert of any kind.**
   `ALERT_TYPES` (`db/schema/alert.ts:16-28`) has 11 entries and none of
   them is "a proposal is waiting." The only entry point is one dashboard
   link (`nav/items.ts`'s three `NAV_GROUPS` have no Proposals item at
   all). Section 2.
8. **MAJOR — [wrong model] the offline queue only protects a session that
   was already open when connectivity dropped.** `service-worker.ts:181-219`,
   `handleNavigate`: a full-page navigation is always fetched fresh, never
   served from cache, with `/offline` — a dead-end static page — as the
   only fallback. A true cold start with no signal (the field case the
   30-second promise is presumably for) cannot even open `/day/new`; the
   well-built offline queue (`pwa/offline-queue.ts`) never gets a chance
   to run. Section 1.
9. **MAJOR — [missing] the recovery for a day nobody will ever get
   approval for has no UI.** `worked_without_approval → unbillable` is a
   legal database edge (`0012_work_unit_state_machine.sql:70`) with zero
   production callers. Section 3.
10. **MINOR — [friction] the alert that names the exact flagged day
    throws the id away.** `worked_without_approval`'s `AlertDetail`
    carries `workUnitId` (`alerts/types.ts`), but `/alerts`
    (`alerts/+page.svelte:36-38`) renders only title/body text. Finding
    it means hunting the calendar grid instead of a deep link the server
    already computed. Section 3.
11. **MINOR — [wrong model] the day form shows two controls for one
    quantity decision on every entry.** `day/new/+page.svelte:152-186`.
    Costs no taps in the common case but is noise on the highest-frequency
    screen in the product. Section 1.
12. **MINOR — [friction] `day/date/[date]` is a route with almost nothing
    behind it.** Redirects for 0 or 1 entries; its own multi-entry
    template never rendered in either this pass or the main review's four
    screenshot passes. Section 4.
13. **MINOR — [friction] the calendar's one summary number carries no
    comparison.** "Giornate lavorate: N giorni" — no typical-month
    baseline, no tie to the ceiling percentage the dashboard computes
    separately. Section 4.

## What is missing entirely

- **A day-entry point that survives a cold start with no signal.** Not
  "the offline queue should be more visible" (already flagged in the main
  review) — the form itself is unreachable offline before it has ever
  been opened once online on that device. A day biller who just finished
  on-site work in a basement server room with no reception cannot record
  anything.
- **A channel-agnostic way to record an approval.** Every day-biller
  archetype gets confirmations by more than email — a phone call
  followed up "as agreed," a Slack thread, a signature on a printed PO.
  Today the product's _only_ representation of "the client said yes" is
  an `inbound_thread` row created by IMAP polling; there is no manual
  "record an approval I received another way" form anywhere, so every
  contract that requires prior approval and gets confirmed off-email is
  permanently in the `worked_without_approval → nowhere` trap this audit
  found in sections 1 and 3.
- **A state-advancing action for a proposal-derived day.** Not "add a
  button that says Approve" — a genuine decision: should accepting a day
  proposal from an approval-confirming email also write the `approval`
  row it rests on and land the day at `worked` directly (the excerpt
  _is_ the approval), or should it land at `worked` on a contract that
  never required approval and stay a manual step only where approval is
  required? Either answer beats today's silent `proposed` dead end.
- **A standing view of "days at risk," distinct from a one-shot alert.**
  The dashboard shows no days at all (main review defect 4); `/alerts`
  shows a flat, undifferentiated list that, once delivered, goes quiet.
  Nothing in the product answers "which of my open items have been
  sitting the longest" as a list you can work down, only "here is one
  more thing" as a stream you can miss.
- **Batch entry for the realistic catch-up case.** The assignment's own
  shared facts describe a person who bills by the day and works most
  weekdays; a Friday afternoon "let me log Wednesday and Thursday too" is
  common and costs a full page load and re-navigation per day today —
  `day/new`'s own form resets and stays on the same page after a queued
  offline save (`+page.svelte:76-90`) but a _live_, successful save always
  redirects away to `/day/[id]` (`+page.server.ts:110`).
- **A visible poll/runner health signal anywhere but a critical alert.**
  `getLatestMailboxPollRun` and the runner's own liveness are computed
  server-side (`detectMailboxPollFailure`, `detectors.ts:549-586`) but
  surfaced nowhere until the alert engine already calls the silence
  critical — by which point the whole point of section 2's timeline has
  already failed once.

## The journey redesigned

Phone-first, in the order a person actually moves through a day.

**Record.** Add a persistent entry point — a fifth bottom-bar tab or a
FAB — so `day/new` is 1 tap from _any_ screen, not only the dashboard
(closes finding 5). Pre-resolve both approval `<select>`s to the sole
candidate when exactly one exists, falling back to today's open picker
only when there is a real choice (closes finding 6). Show the amount the
day is worth as it's entered (already flagged in the main review,
directly relevant here: it is the one signal that would make a wrong
contract or wrong quantity visible before Save, precisely when the
30-second promise is being spent fastest). Redesigned happy path:

1. Tap the entry point from wherever you are — **1 tap** (was 1–2, now
   1 from _anywhere_, closing the "only from home" gap).
2. Date, contract, quantity: pre-resolved, **0 taps** (unchanged — these
   were already right).
3. Approval, when required and unambiguous: pre-resolved, **0 taps**
   (was 2).
4. Scope: focus + type — **1 tap + ~20 keystrokes** (unchanged; this is
   the one field that has to stay human).
5. Save — **1 tap**.

**Total: 3 taps + one short phrase, from anywhere, every time** — the
same 3 taps the happy path already had for a _no-approval_ contract, now
also true for an approval-required one, and now true from every screen
instead of only the dashboard.

For the offline-cold-start gap (finding 8), the honest fix is not "cache
the page" — the service worker's "never cache a document" rule is
correct and load-bearing (`service-worker.ts:11-36`). The fix is a
second, always-precached, stateless route — `/day/new-offline` or a
`/offline` variant that _is_ the entry form's shell (date/contract/
quantity/scope, no server data, contract list drawn from whatever the
data cache still holds from the last online visit) that queues directly
into the existing, well-built offline queue rather than requiring the
live SSR'd page to have loaded first.

**Approve.** Two options, because the underlying decision is a real
product-policy question, not a UI one:

- **Option S (cheap, ships now).** Put Proposals in the persistent nav
  (closes finding 7's navigation half) and add a `proposal_pending` alert
  type so an unreviewed proposal ages the same way `approval_unactioned`
  does — the exact mechanism already exists, it is just never invoked for
  this case. Does not fix the `proposed`-state dead end. Effort **S**.
- **Option M (closes the loop for real).** Decide #85's deferred question
  (`proposal.ts:73-77`): accepting a day proposal whose source document is
  itself the approval writes both the `approval` row and a `work_unit` at
  `worked` (or `worked_without_approval`, correctly, if the contract needs
  one and the excerpt doesn't clearly grant it) — never `proposed`, since
  nothing in the product can ever move a `proposed` day forward today.
  Effort **M** — touches `applyProposal`'s dispatch and its tests, no
  schema change (the `approval`/`work_unit` tables and the `-> worked`
  edge already exist).
- **Option L (the standing signal).** Both of the above, plus retiring
  "acknowledge" as a hide-forever action for `worked_without_approval`
  specifically (the main review's own C option for the alert row,
  `08-alerts-states-and-pwa.md:51`): the alert can only leave the list
  because the day gained an approval or was written off unbillable, so a
  missed one-shot push can never quietly go dark. Effort **L** — a
  product-policy call for the owner, not a default.

**Recommendation: M now, S alongside it** (they are independent), **L as
an explicit question to the owner**, since it changes what "acknowledge"
means product-wide, not just for one alert type.

**Recover.** Add the `unbillable` UI the state machine already allows
(closes finding 9): the same day-detail card that offers "link an
approval" when candidates exist should offer "no approval is coming, mark
unbillable" when they don't, with a required one-line reason (the same
free-text pattern `work_unit_transition.reason` already stores for every
other transition). Effort **S** — one new form action, no schema change.

**Read the month.** Fold `day/date/[date]` into `day/[id]` as a
same-date-siblings strip (closes finding 12); take the calendar out of
`ChartFrame` so the grid survives below 640px, and add the one number
that actually answers "am I where I should be" — days recorded this month
against a rolling average of the prior three, not just a bare count.
Effort **M**, matches appendix 04's own recommendation for the calendar
page; this audit adds the pace comparison as the piece specific to the
"mid-month check" question this journey was scoped to answer.

## What it needs from elsewhere

- **`Button`, `Field`, resolved-value + "cambia" pattern** — the shared
  components section 6 of the main review already specs; the redesigned
  approval/contract fields in `day/new` need the same pattern this batch's
  other journeys will also ask for.
- **A deep-link contract from alerts to their subject** — `worked_without_
approval`'s `AlertDetail` already carries `workUnitId`; the redesigned
  recovery flow assumes `/alerts` links straight to `/day/{workUnitId}`,
  which is the main review's own appendix 08 option B, not a new ask.
- **A real scheduler.** Every timeline in section 2 and section 5 assumes
  mail-poll, agent-run and alert push/digest are actually being invoked.
  Nothing in this document's redesign can make the 30-second promise real
  without that infrastructure existing somewhere outside application code
  — a systemd timer, a committed crontab, or the "separate worker
  process" `AGENTS.md` already describes but the repository does not yet
  contain.
- **A product decision on approval provenance** (#85's deferred question,
  section 2 and "What is missing entirely") — this is a policy call for
  the owner, not something a redesign can default its way past, since it
  changes what "accept" means for every future document-derived proposal
  type (#86 contracts, #87 invoices included).
