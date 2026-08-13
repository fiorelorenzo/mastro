# Day lifecycle: recording and reading days

Scope: `/day/new`, `/day/calendar`, `/day/[id]`, `/day/date/[date]`, the state machine
(`src/lib/server/db/schema/work-unit.ts`, `drizzle/0012_work_unit_state_machine.sql`,
`drizzle/0013_worked_without_approval.sql`), and the offline entry queue
(`src/lib/pwa/offline-queue*`). Not in scope: how proposals arrive from email
(`/proposals`, Ingestion's area) or how a day gets invoiced (Invoicing's area) — both are
named only where a link from a day surface is missing.

## What is there now

**`day/new` (`src/routes/day/new/+page.svelte` + `+page.server.ts`)** — a single
uncontrolled `<form>`: native `<input type=date>` defaulting to today or a `?date=`
query param; a native `<select>` of active contracts defaulting to whichever contract was
most recently recorded on (`getMostRecentContractId`); a conditional native `<select>` of
approvals that only renders when the _currently selected_ contract has
`requiresPriorApproval` (`+page.svelte:134-150`); a `Giornata intera`/`Mezza giornata`
segmented control (two `<button>`s bound to the same `quantity` state) sitting directly
above a numeric `<input>` bound to the _same_ state and labelled with its own
implementation detail, `Quantità (giorni, oppure ore su un contratto orario)`
(`+page.svelte:152-186`, `messages/en.json:323`); a required scope text field
autofocused via a Svelte action; a single outlined `Save` button; and a permanent
0.75rem "Ctrl+Enter saves from anywhere" hint underneath it. Below the form, an
`OfflineQueuePanel` lists any day this device has queued but the server has not yet
recorded, each with a `pending`/`syncing`/`failed` `StatusIndicator`, deliberately styled
to never be mistaken for a saved ledger row. Screenshots: `desktop-it/day-new.png`,
`mobile-it/day-new.png`, `dark-it/day-new.png`, `desktop-en/day-new.png` — the seeded
default contract does not require prior approval, so all four show the form with no
approval control and no money anywhere on the page.

**`day/calendar` (`src/routes/day/calendar/+page.svelte` + `+page.server.ts` +
`month-grid.ts`)** — a Monday-first month grid built by pure date arithmetic
(`month-grid.ts`), rendered _inside_ `ChartFrame.svelte`, the same wrapper every actual
chart on the dashboard uses: a card with a title, a screen-reader caption
("Giornate di agosto 2026, una riga per giornata"), and a `Grafico`/`Tabella` toggle.
Each occupied cell is a link carrying a `DayStateBadge` at `compact` size (10px label,
13×13px glyph) chosen by `mostAttentionNeedingState` when a date carries more than one
work unit; empty in-month cells are a bare day number, but are still a live link to
`/day/new?date=…` (`+page.svelte:129-137`) with no visual sign of it. Above the grid, one
line reads "Giornate lavorate: 0 giorni" (`day_calendar_total_days_label` +
`formatDays`), plus a currency-grouped amount total when any exists. Below 640px,
`ChartFrame` swaps the grid for `DataTable` automatically (`ChartFrame.svelte:35,44-52`)
— the calendar disappears and every day in the month becomes a table row instead.
Screenshots: `desktop-it/day-calendar.png` (grid, "0 giorni" despite August having four
recorded days — the total legitimately excludes `proposed`, see
`dayCountsTowardDays`), `mobile-it/day-calendar.png` (table, defaulted to `Tabella`,
contract names wrapping five lines deep and the amount column cut off after "Imp"),
`dark-it/day-calendar.png` (grid, same layout, dark tokens).

**`day/[id]` (`src/routes/day/[id]/+page.svelte` + `+page.server.ts`)** — a `DayStateBadge`
at full size, a definition list (contract, quantity, scope, amount, approval), then,
_only_ when `state === 'worked_without_approval'` and at least one approval exists for
the contract, a bordered form to link one (`?/link` action); otherwise, if the state is
the risk state with nothing to link, one line of plain text. Below that, a `Cronologia`
table of every transition (`work_unit_transition`, append-only) with when/change/reason/
actor. Screenshots: `desktop-it/day-detail.png` and `mobile-it/day-detail.png` (both show
a `Proposta` day: badge, five-row definition list, one history row, no action of any
kind), `desktop-it/day-date.png` (also a detail page — see below).

**`day/date/[date]`** exists to disambiguate the rare case of two work units sharing a
date on different contracts (`work_unit`'s uniqueness is `(contract_id, date)`, not
`(date)`). Its `load` redirects to `/day/new?date=` when there are zero entries and
straight to `/day/[id]` when there is exactly one (`+page.server.ts:19-25`); the actual
list template (a plain `<ul>` of bordered `<li><a>` rows, `+page.svelte:17-26`) only
renders for ≥2 entries. Neither `day-date.png` screenshot (desktop-it: "17 ago 2026",
dark not checked, mobile-it) hit that branch — both landed on the redirect target, a
`day/[id]` page — so this template has had no visual QA at all in this pass.

**The offline queue (`src/lib/pwa/offline-queue.ts` / `offline-queue.svelte.ts` /
`offline-queue-db.ts`)** — genuinely well engineered: a client-generated `workUnitId`
makes replay idempotent (`createWorkUnit`'s insert is a no-op if the id already exists),
`classifyReplay` distinguishes "never reached the server" (queue it) from "the server
refused it" (surface the refusal, never retry silently) from "it landed" (drop it), and
`OfflineQueuePanel` never lets a queued entry look like a saved one. It is wired up by a
single `onMount(() => offlineQueue.init())` inside `day/new/+page.svelte` only.

## What is wrong

1. **BLOCKER — the offline queue is invisible everywhere except the one page that
   created it.** `offlineQueue` (`src/lib/pwa/offline-queue.svelte.ts`) is imported from
   exactly two files, both under `src/routes/day/new/` (verified by repo-wide grep); its
   `online`-event listener is registered in `onMount` and torn down the moment that
   component unmounts (`offline-queue.svelte.ts:41-52`). The root layout
   (`src/routes/+layout.svelte:33`) mounts `OfflineDataBanner` globally but nothing that
   reads `offlineQueue.entries`. A day recorded offline on-site and never revisited on
   `/day/new` specifically has no indicator anywhere in the shell, sidebar, or bottom bar
   that it is still pending, syncing, or was rejected. This is not "ugly" — it is a
   trust failure in exactly the promise the product exists to keep: a day the consultant
   believes is recorded can silently never make it into the ledger, and the interface
   gives no sign that anything is wrong.
2. **BLOCKER — the primary monthly instrument disappears at the primary target width.**
   `ChartFrame.svelte:35,44-52` defaults to a flat `DataTable` below 640px, so the whole
   week/weekday spatial structure — the entire point of a calendar — is gone on every
   phone (`mobile-it/day-calendar.png`). The replacement table wraps a contract label
   across five lines per row and truncates the amount column to "Imp" with no page-level
   overflow to catch it (`report.json`'s `ovf:false` for `day-calendar` at `sw:390`
   confirms the cropping is inside the table, invisible to that check). A day biller
   checking "am I caught up this month" from a phone gets a worse view than the one this
   component was actually built for (a bar chart).
3. **BLOCKER — the risk state's only non-recovery resolution has no UI anywhere.**
   The state machine legally allows `worked_without_approval → unbillable`
   (`0012_work_unit_state_machine.sql:69-70`) exactly as much as it allows
   `worked_without_approval → worked` via a linked approval. `day/[id]/+page.server.ts`
   implements the recovery path (`?/link` → `linkApprovalToWorkUnit` →
   `transitionWorkUnit`) and nothing else — a repo-wide grep for `transitionWorkUnit`
   finds exactly one caller. There is no way, anywhere in the interface, to say "no
   approval is coming, write this day off" for a day flagged as the single most
   important state in the product. It either sits flagged critical forever, or someone
   edits the database directly.
4. **MAJOR — recording a day is not one tap from wherever you are.** The bottom bar
   (`src/lib/nav/BottomBar.svelte`, items from `src/lib/nav/items.ts:22-23`) is
   Oggi/Calendario/Clienti/Fatture/Altro — no add-a-day tab. The only paths in are (a)
   the dashboard's `record-day-cta` (`src/routes/+page.svelte:34`), sharing the fold with
   three chart cards and a tagline (Dashboard's territory, flagged separately by that
   review), or (b) a calendar cell that is a live link with zero visual affordance
   (finding 9). On a phone, path (b) doesn't exist at all below 640px because the grid
   itself is gone (finding 2). Every version of the 30-second promise starts with
   finding the door.
5. **MAJOR — one value, two controls.** The `Giornata intera`/`Mezza giornata` segmented
   buttons and the numeric `Quantità` input both write the same `quantity` state
   (`+page.svelte:152-186`); nothing breaks, but the highest-frequency action in the
   product presents two controls for one decision, the second one labelled with a
   developer's parenthetical rather than a person's question, on every single day
   entered (`desktop-it/day-new.png`, `mobile-it/day-new.png`).
6. **MAJOR — no money on the one page where a day is created.** `loadActiveContracts`
   (`+page.server.ts:17-28`) returns `id`/`clientName`/`title`/`requiresPriorApproval` —
   never a rate. `priceWorkUnitOnDate` is already called from both `day/calendar` and
   `day/[id]`; `day/new` is the one day surface that never shows what the day being
   recorded is worth, and the offline queue list on the same page repeats the omission
   (`OfflineQueuePanel.svelte:36-40`: date, days, contract — no amount). A person who
   bills by the day cannot see, at the moment of recording, whether they got the day
   right.
7. **MAJOR — the one sentence explaining the risk state is dead code.**
   `day_state_worked_without_approval_description` is written and translated
   (`messages/en.json:350`, `messages/it.json:350`) and imported nowhere (repo-wide
   grep, zero hits). `day/[id]` shows the hatched badge and, if approvals exist to link,
   a bare form — never the explanation, including to the person who is meant to act on
   it right there.
8. **MINOR — the approval field never guesses.** `approvalId` always starts at `''`
   (`+page.svelte:22`), even when exactly one approval exists for the selected contract
   — an open-then-choose on a native `<select>` for a decision with only one sane
   answer. There is also no visual cue, before a contract is chosen, that picking a
   different one might reveal an approval control at all.
9. **MINOR — calendar cells that do something look identical to cells that don't.**
   An empty in-month cell is a real link to `/day/new?date=…`; a padding cell from the
   adjacent month is not. Both render as a plain day number in the same weight and
   color (`+page.svelte:215-224`); the difference is discoverable only by hovering or
   tapping and seeing what happens — invisible on a touchscreen, which has no hover.
10. **MINOR — the summary line drops the period it's summarizing.** "Giornate lavorate:
    0 giorni" doesn't name the month; harmless directly under an `agosto 2026` heading,
    but it is the only thing in the row and duplicates work the `h1` already does
    instead of adding, say, a per-contract breakdown.
11. **MINOR — `day/[id]` gives no reason for its own silence.** A `proposed` or
    `approved` day (`day-detail.png`, `desktop-it/day-date.png`) renders with zero
    actions and no text explaining whether that's intentional (accept/reject genuinely
    lives on `/proposals`) or missing. A user landing here from the calendar has no way
    to tell "nothing to do here" from "this looks unfinished."
12. **POLISH — the keyboard hint renders on phones with no keyboard.** "Ctrl+Invio
    (⌘+Invio su Mac) salva…" appears under Save on `mobile-it/day-new.png` exactly as on
    desktop, describing a shortcut that cannot exist on that device.
13. **POLISH — `day/date/[date]`'s real template is unverified and looks like a stub.**
    Per its own code comment it renders only for the rare multi-contract-same-date case;
    neither screenshot pass exercised it. Its markup (bare `<ul>`/`<li>`, no shared list
    component) has had no design attention next to its two siblings.

## Options

### `day/new` — entry form

- **A. Restyle in place** — Collapse quantity to one segmented control (`Giornata
intera` / `Mezza giornata` / `Altra…`, the third option revealing the numeric field
  only on demand); drop the internals-labelled custom-quantity string; add a live amount
  preview (contract's rate × quantity, using the pricing function already used
  elsewhere) next to the contract row; pre-select the approval `<select>` to the most
  recent match when exactly one exists. Effort **S**. Risk: low, no new components. Does
  not fix: the entry point problem (finding 4) or the phone-keyboard autofocus gap
  below.
- **B. Restructure the page** — Rebuild as a compact single card in a fixed field order
  (date chip row incl. "Oggi"/"Ieri" one-tap presets → contract as a resolved summary
  row with a "cambia" link, not an always-open `<select>` → live amount → quantity
  segmented control → approval as a resolved summary row, same pattern → scope → sticky
  Save). Removes the redundant field, surfaces money, and turns two multi-step native
  selects into zero-tap defaults with an explicit override. Effort **M**. Risk: medium —
  new "resolved value + change" pattern needs a shared component (see Cross-cutting
  asks) so it isn't invented once here. Unlocks: the tap counts below.
- **C. Rethink the flow** — Make day entry a persistent action, not a page you navigate
  to: a bottom-bar/FAB entry point reachable from anywhere (closes finding 4), and on
  submission, a lightweight confirmation state on the _same_ screen (amount, state,
  "add another" / "done") instead of a full navigation to `/day/[id]`, so recording
  three days in a row (a common Friday-afternoon catch-up pattern) doesn't cost three
  full-page loads. Effort **M/L** — the entry-point half is a nav change; the
  submit-without-navigate half changes the server action's contract. Risk: medium.

  **Concrete redesign + tap count at 390px** (folds B and the entry-point half of C
  together):
  1. A persistent entry point (bottom-bar tab or FAB) visible on every screen — **1 tap**
     to reach `/day/new` from anywhere, replacing "scroll the dashboard past three chart
     cards" or "find the right invisible calendar cell" as the only routes in today.
  2. Date: "Oggi" pre-selected — **0 taps** for the common case.
  3. Contract: shown resolved ("Bellani & Partners — Assistenza continuativa data
     platform · cambia"), already the most-recently-used one — **0 taps** when correct,
     **2 taps** (open, choose) when not.
  4. Live amount preview updates with every change — **0 taps**, pure feedback, closes
     finding 6.
  5. Quantity: `Giornata intera` pre-selected — **0 taps** for a full day.
  6. Approval: resolved to the best match when the contract requires one and exactly one
     candidate exists; hidden entirely otherwise — **0 taps** in both common cases.
  7. Scope: the one field that must always be typed. Being honest about mobile focus
     behavior — `node.focus()` on mount (`+page.svelte:64-66`) reliably raises no
     on-screen keyboard on iOS Safari without a prior user gesture, so budget **1 tap**
     to focus it, not 0 — plus **~15–25 keystrokes** for a short scope phrase
     ("sprint 4 – API migration").
  8. Save, sticky at the bottom — **1 tap**.

  **Total: 3 taps + one short typed phrase**, versus today's honest baseline of
  **1–2 taps to arrive** (dashboard CTA or a discovered calendar cell) **+ 1 tap to
  focus + type + 1 tap to save** — numerically similar in the single unencumbered
  happy path. The 30-second promise is not actually threatened by tap count in that
  path; it is threatened by (a) not finding the entry point at all (finding 4), (b) the
  cost of any deviation — a different contract, a half day via the hidden custom field,
  an approval to pick — being a full native-`<select>` round trip instead of a resolved
  default to just glance at and accept, and (c) having nothing on screen (no amount) to
  catch a wrong contract or wrong quantity before submitting, which matters most
  precisely when the person entering the day is tired and moving fast.

- **Recommendation**: B now (removes the redundant control, surfaces money, low
  structural risk), with the FAB/entry-point half of C bundled in — it's a nav change,
  not a form change, and directly fixes finding 4 without waiting on the rest of C.

### `day/calendar` — the month view

- **A. Restyle in place** — Stop routing the grid through `ChartFrame`'s chart/table
  toggle (it is not a chart); render it directly in a plain `Card`. Give occupied cells a
  filled state chip with the amount inline, not just a 10px label. Give every empty
  in-month cell a faint always-visible "+" so the add affordance in finding 9 stops
  needing to be discovered. Keep it a grid, not a table, all the way down to 390px —
  cells shrink to date + colored dot, full-cell tap target unchanged. Effort **S**. Risk:
  low, CSS/markup only. Does not fix: a month grid is 28–31 cells for what is typically a
  handful of entries a month — low information density for the primary read of "am I
  caught up."
- **B. Restructure the page** — Make a dense list the default view: one row per recorded
  day (date, contract, state chip, quantity, amount), a running "days so far / amount so
  far" total that updates as you read down, reusing `RecordList.svelte`
  (`src/lib/layout/RecordList.svelte`), which already is the dual table/card responsive
  primitive this needs — no ChartFrame, no breakpoint hack, same rendering at every
  width. Demote the month grid to an optional "overview" toggle for people who want the
  spatial view (a real content toggle between two views of the same rows, not a
  chart-vs-its-own-data-table). Effort **M**. Risk: medium, new default view, but the
  underlying component already exists. Unlocks: a natural home for
  amount-so-far/days-so-far and, later, "days remaining before the 35% concentration cap"
  (cross-link with Dashboard/Ceilings) right at the top instead of buried in a chart
  card.
- **C. Rethink the flow** — A week strip as the primary view: the current week expanded
  inline (contract, state, amount per day), past/future weeks collapsed to a small
  colored-dot rail, running week and month-to-date totals permanently above the fold on
  a phone. Matches "am I caught up this week" better than a full month grid does.
  `month-grid.ts`'s Monday-first week math (`monthRange`/`buildMonthGrid`) covers most of
  the boundary logic already. Effort **M/L** — new component and interaction pattern, the
  biggest behavior change for a returning user to relearn. Risk: highest.
- **Recommendation**: B. It reuses an existing shared primitive instead of inventing one,
  never collapses on mobile because it never depended on a chart breakpoint, and leads
  with the actual read ("what did I do, what's it worth") instead of a mostly-empty grid.
  Keep the grid as an opt-in secondary view rather than deleting it, so anyone who does
  like the spatial layout doesn't lose it outright.

### `day/[id]` + `day/date/[date]` — the detail and disambiguation pages

- **A. Restyle in place** — Move amount next to the state badge, not fourth in a
  definition list. Render the per-state explanatory copy
  (`day_state_*_description`-style, currently only written for the risk state and
  unused) directly under the badge. Link the archived approval document from the day
  detail page — `getWorkUnitDocument` (`repositories/work-unit.ts:146-159`) already
  exists server-side and is simply never called from this route, so "the source document
  is always reachable" is one query away, not a new feature. Restyle
  `day/date/[date]`'s bare `<ul>` with `RecordList.svelte` instead of hand-rolled
  markup. Effort **S**. Risk: low. Does not fix: three separate route trees for one
  concept.
- **B. Restructure the page** — Fold `day/date/[date]` into `day/[id]`: when a date maps
  to more than one work unit, show a compact "other entries on this date" strip above the
  fold on the detail page instead of a whole separate route/template for a case the
  code itself calls rare. Give the remaining detail page a fixed order: state + one-line
  explanation → amount → approval + proof link → invoice link once invoiced (today there
  is a foreign key but no link from the day side at all) → history last. Effort **M**.
  Risk: medium, touches routing. Unlocks: one mental model ("open a day") consistent
  with the calendar already linking straight to `/day/[id]` for the common
  single-entry case.
- **C. Rethink the flow** — Present the day as a timeline, not a form-adjacent record: a
  single vertical thread (created → approval attached/missing, with the excerpt inline,
  not just sender + date → worked → invoiced → paid), each step showing its own evidence
  and actor, replacing the separate `Cronologia` table underneath. The highest-value read
  for a product whose promise is a paper trail, but real content work, not a restyle —
  worth sequencing after the state-language decisions below, since the thread's per-step
  copy depends on them. Effort **L**. Risk: medium — no data model change, all
  presentation, but a genuinely new pattern.
- **Recommendation**: B, plus both concrete fixes from A (source-document link,
  per-state explanation) done immediately regardless of B's timeline — they resolve
  the worst "cannot be found" complaints (approval label 4, finding 11) at close to zero
  risk, and B removes a route that will only get more awkward once invoice linking is
  added on top of it.

### State system (`DayStateBadge.svelte`, `work-unit-state.ts`)

The shape-coded badge (distinct outline + glyph + color per state, the
`worked_without_approval` hatch pattern) is the right foundation and should not be
rebuilt — it already satisfies "never color alone" the same way
`StatusIndicator.svelte` does for the four-level status scale, and both should converge
on one shared primitive (see Cross-cutting asks) rather than staying two parallel
implementations.

There are 10 states in the `work_unit_state` enum
(`src/lib/server/db/schema/work-unit.ts:28-39`) plus one pre-persistence pseudo-state a
day visibly passes through before it is ever a database row at all — `queued offline`
(`QueuedDayStatus`, `src/lib/pwa/offline-queue.ts:19`, itself split into
`pending`/`syncing`/`failed` in the UI) — eleven states a day-recording UI actually has
to represent.

| State                      | Label (EN)              | Label (IT)                    | Visual treatment                                                                                          | Action offered here                                                                                                                                          |
| -------------------------- | ----------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| _(offline, not yet saved)_ | Queued — will sync      | In coda — verrà sincronizzata | Warning-level `StatusIndicator`, dashed/outline chip, never the same shape as a saved-day badge           | Wait, or dismiss once failed                                                                                                                                 |
| `proposed`                 | Proposed                | Proposta                      | Neutral dotted-circle outline, no fill                                                                    | None on day surfaces today (recommend: read-only, with a link to `/proposals` when it came from an agent proposal, per finding 11)                           |
| `approved`                 | Approved                | Approvata                     | Solid circle + check, neutral accent color                                                                | None today (recommend: a "mark as worked" affordance once the date has passed, or leave to the day the work actually happens and is recorded via `/day/new`) |
| `worked`                   | Worked                  | Lavorata                      | Solid circle + check, filled at low opacity                                                               | Read-only — the day's steady state pre-invoice                                                                                                               |
| `worked_without_approval`  | Worked without approval | Lavorata senza approvazione   | Hatched fill, bold border, critical color, triangle+exclamation glyph (existing, correct — do not soften) | **Two actions, both currently only one is built**: link an approval (recovery) _and_ mark unbillable (closure) — see BLOCKER 3                               |
| `invoiced`                 | Invoiced                | Fatturata                     | Solid diamond outline, "projected" accent                                                                 | Link to the invoice (missing today — cross-link with Invoicing)                                                                                              |
| `paid`                     | Paid                    | Pagata                        | Solid diamond, filled at low opacity, "good" accent                                                       | Link to the invoice                                                                                                                                          |
| `disputed`                 | Disputed                | Contestata                    | Rounded square outline, "serious" accent                                                                  | Read-only from the day side; resolution lives on the invoice                                                                                                 |
| `revoked`                  | Revoked                 | Revocata                      | Dashed rounded square, muted                                                                              | Read-only — terminal, the approval was withdrawn before work happened                                                                                        |
| `rejected`                 | Rejected                | Rifiutata                     | Solid triangle outline, warning accent                                                                    | Read-only — terminal, a proposal that was never approved                                                                                                     |
| `unbillable`               | Unbillable              | Non fatturabile               | Rounded square, faint fill, muted                                                                         | Read-only — terminal, the risk state's "no recovery" outcome                                                                                                 |

**Recovery flow (linking an approval to a day already in the risk state)**, as it should
read once finding 7 is fixed: badge (hatched, critical) → the one-sentence explanation
(`day_state_worked_without_approval_description`, already written, just needs a
`<p>`) directly under it, every time this state is seen, not only implicitly via the
form → the existing `?/link` form, unchanged functionally → **new**, a sibling
"Mark unbillable" action for when no approval is coming, with a required reason
(reuse the `reason` column every transition already carries) so the append-only log
keeps explaining itself the way it does for every other transition.

### Offline/PWA legibility for day entry

- **A. Restyle in place** — Nothing to restyle; the panel itself is fine. Not a real
  option here.
- **B. Restructure the page(s)** — Hoist `offlineQueue.init()` out of `day/new` into the
  root layout (`src/routes/+layout.svelte`) so the listener and replay survive
  navigation, and add a small persistent badge (count of pending/failed entries) to the
  shell — sidebar on desktop, the "Altro" tab or a dedicated slot on the bottom bar on
  mobile — that links back to `/day/new`'s panel (or a standalone `/day/queue` view) to
  see and act on them. Effort **M**. Risk: low — the store already supports being read
  from anywhere; this is wiring, not new logic. Directly closes BLOCKER 1.
- **C. Rethink the flow** — Route background sync through the Service Worker's Background
  Sync API instead of an `online` listener scoped to a mounted component, so a queued day
  can be retried even if the tab/app isn't open at all when connectivity returns. Real
  gain in reliability, but a new browser API surface and a new dependency on
  service-worker message-passing beyond what `sw-client.svelte.ts` does today for the
  freshness banner. Effort **L**. Risk: medium-high, cross-browser Background Sync
  support is inconsistent.
- **Recommendation**: B immediately — it is a small, low-risk change that fixes the
  single worst finding in this review. Consider C only if real-world usage shows queued
  days going stale because the app was fully closed, not just navigated away from.

## Cross-cutting asks

- **State/status badge, unified.** `DayStateBadge.svelte` and
  `StatusIndicator.svelte` implement the same "shape + glyph + color, never color alone"
  guarantee twice, for two different state vocabularies (work-unit states, four-level
  status). Promote one shared primitive (label, level/state, glyph slot, compact
  variant) that both — and Invoices' and Alerts' own state chips — build on, so a new
  state anywhere in the product inherits the accessibility guarantee for free instead of
  reimplementing it.
- **Resolved-value field** (`value shown as text + "cambia"/"change" link`, opening to
  an explicit chooser only on request). Needed by day/new's contract and approval
  fields, and likely by other forms picking from a short list with a strong recent-use
  default (rate card selection, mail template selection). States: resolved (default
  shown), open/choosing, no-candidates (explicit empty state, not a disabled control).
- **Amount/money display primitive.** Consistent currency placement, tabular figures,
  and an "unpriced" fallback — used ad hoc today via `formatAmount` with no shared
  markup. Needed everywhere a day, invoice, or expense shows a number: this area alone
  touches it on the calendar table, the day detail definition list, and the proposed
  amount-preview on day/new.
- **List/table responsive primitive, generalized.** `RecordList.svelte` already solves
  "cards on phone, table on desktop, one caption, one set of rows" — the calendar
  redesign (Option B) and `day/date/[date]`'s restyle (Option A) both want it directly.
  Worth confirming with whoever owns Invoices/Proposals that they can adopt the same
  component rather than each area cutting its own list markup.
- **Persistent background-task indicator** in the shell (sidebar + bottom bar) for
  "N items waiting to sync" — currently nothing like it exists; the offline queue needs
  it first, but any future queued/background write (a large import, a bulk mail send)
  will want the same slot.
- **Empty-cell "add" affordance.** A small, always-visible (not hover-only) plus glyph
  for any grid cell that is a live "create here" link — the calendar needs it now; any
  future date-scoped grid (e.g. an availability or capacity view) will too.

## Verification notes

- `/day/new` at 390px and 1440px, IT and EN, light and dark, with both seeded contract
  archetypes selected in turn (`requiresPriorApproval` true and false) — confirm the
  approval control and (once built) the money preview both appear/disappear correctly
  and that IT's longer strings (`day_form_approval_hint`, the quantity custom label) do
  not wrap awkwardly against the ~15% EN→IT growth.
- Autofocus on a **real** phone browser (not just headless Chromium) — confirm whether
  `node.focus()` on mount actually raises the on-screen keyboard on iOS Safari and
  Android Chrome; the screenshot pass cannot answer this, and the tap-count analysis
  above assumes it currently does not.
- Offline: throttle to "offline" in devtools on `/day/new`, submit, confirm the queued
  notice and panel entry; reload and confirm the entry survived (IndexedDB); go back
  online and confirm replay via the network tab. Then, critically, queue an entry and
  **navigate to `/day/calendar` or `/`** before reconnecting — today nothing will
  indicate a day is still pending; after the fix (Cross-cutting ask, PWA option B),
  confirm the shell badge shows it and following it back reaches the panel.
- `/day/calendar` for the seeded month containing `worked_without_approval`, an
  `invoiced`, and a `paid` day together, at 390px — confirm grid vs. redesigned list
  behavior, that state and amount are both legible without truncation, and that the
  running total updates correctly across `dayCountsTowardDays`/`dayCountsTowardAmount`'s
  state split.
- `/day/[id]` for a `worked_without_approval` day both with and without linkable
  approvals present (the two branches at `+page.svelte:84` and `:103`), and after the
  fix, exercising the new "mark unbillable" action and confirming it lands in
  `Cronologia` with its reason.
- `/day/date/[date]` forced with two seeded same-date, different-contract entries — this
  branch was not exercised by any of the four screenshot passes; look at it for the
  first time before deciding how much of Option A/B is actually needed.
- Recount taps against the redesigned `/day/new` flow with a stopwatch on an actual
  phone, not just a tap tally, for both the happy path (today, full day, default
  contract) and one deliberately awkward path (different contract, half day, approval
  to choose) to see how far the 30-second promise stretches once it's not just the
  common case.
