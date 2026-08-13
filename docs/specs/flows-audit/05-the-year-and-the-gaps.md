# The year and the gaps

Four journeys that only happen at the scale of a year — or that only happen once,
badly, when something breaks — plus one list of everything the product has no
answer for at all. Verified against the running instance (`http://localhost:5187`,
Postgres on `localhost:5436`, container `mastro-db-1`) as of 2026‑08‑13, not just the
source. Where a number in this document depends on the seed, it was queried live;
where a screenshot in `/tmp/shots` disagreed with the live database (the dashboard
shot shows a single-client 100% concentration bar that three real invoices no longer
produce), the live database wins and the discrepancy is called out.

---

## 1. Staying under the ceiling

### The job

A forfettario consultant's whole regime — the VAT exemption, the flat 5–15% tax
rate, no ritenuta d'acconto — depends on one number: cash collected this calendar
year. Crossing €85,000 loses the regime _next_ year; crossing €100,000 loses it
_this instant_, with VAT due retroactively on the invoice that crossed it and every
one after (`src/lib/server/fiscal/packs/it-flat-rate.ts:78-147`). The job this
journey has to do, several times a year and always under time pressure, is: "am I
close, and can I say yes to the thing in front of me without finding out the hard
way." "Done" is a yes/no answer the person can act on before they reply to the
client, not after.

### Today, step by step

1. **Home screen loads three widgets from one query.** `evaluateActiveCeilings`
   (`src/lib/server/fiscal/ceiling-status.ts:31-53`) resolves the active pack,
   fetches every persisted contract ceiling and the whole ledger, and evaluates all
   of them through one function. `src/routes/+page.server.ts:87` calls it once per
   page load; there is no caching and no explicit refresh — it is exactly as current
   as the last invoice row.
2. **The hero meter filters to whole-practice pack ceilings** (`origin === 'pack'`,
   `perimeter.kind === 'all_clients'`, `src/routes/+page.server.ts:108-111`): the two
   forfettario thresholds, nothing else. It shows, per ceiling: current value, limit,
   usage ratio, whether it's crossed, which alert levels are active, and a dashed
   "projected year-end" figure (`currentValue + committed + projected`,
   `src/routes/+page.server.ts:139-144`).
3. **The projection is not a run-rate extrapolation.** `forecastCommitted` +
   `forecastProjected` (`src/lib/server/fiscal/certainty.ts:128-165,222-243`) sum
   exactly three things: invoices already issued but unpaid, days already
   _approved_ but not yet invoiced, and recurring-fee schedule occurrences that fall
   inside a contract's own irrevocability window (or an explicit, human-recorded
   "renewal assumption," prorated by probability and days,
   `src/lib/server/fiscal/certainty.ts:181-212`). It never looks at how fast the
   person has been billing and says "at this pace." For a client billed purely by
   the day with no recurring-fee schedule — which is exactly what Nordwind and
   Bellani are — nothing about _future, not-yet-worked_ days ever enters the
   projection. Verified live: as of today the flat-rate ceiling reads collected
   ≈ €3,150 (Nordwind's one paid invoice) against an €85,000 soft cap, projecting to
   only ≈ €6,750 by year end — 8% of the threshold, on a practice billing €620–700 a
   day. The number is not wrong, it is honest about what it refuses to guess; but it
   also cannot warn "you'll cross this by November at this pace," which is the
   actual question a person asks in August.
4. **The person reads a static snapshot and closes the tab.** There is no action on
   this widget — no "what if," no link from the ceiling meter to "can I take this
   engagement." It exists purely to be looked at.
5. **A separate decision, days or weeks later: a new engagement lands** (email, a
   phone call, whatever — outside the product entirely). The person has to _mentally_
   combine what they just saw on the dashboard with a number they're doing in their
   head (day rate × expected days) to decide whether accepting pushes them over
   85k/100k. mastro computes none of this. `src/routes/clients/[id]/contracts/new`
   (screenshot `contract-new.png`) has no ceiling-aware field, warning, or preview —
   the form that actually creates the commitment knows nothing about the ceiling the
   commitment might break.
6. **Alerts are the only push mechanism**, and they are retrospective, not
   decision-time: `detectCeilingApproaching` and `detectYearEndOverrunRisk`
   (`src/lib/server/alerts/detectors.ts:356-432`) fire once usage crosses 80% (warning),
   90% (serious, `CEILING_SERIOUS_RATIO`,
   `src/lib/server/alerts/thresholds.ts:41`) or the crossing itself (critical) — or,
   for the forward-looking one, once _committed+projected_ revenue would overshoot
   the cap by 5%/20% (`OVERRUN_SERIOUS_RATIO`/`OVERRUN_CRITICAL_RATIO`,
   `src/lib/server/alerts/thresholds.ts:46-47`). Both read the same
   committed/projected figures that step 3 already showed cannot see un-worked
   day-rate income. An overrun alert on a pure day-rate contract will, in practice,
   never fire until the cash is already collected and the ceiling is already close
   — by which point "can I accept this" has become "did I already cross it."

**Totals: 1 page (home), 0 dedicated fields, 0 decisions the product can answer
directly** — "can I accept this new engagement" is answered nowhere; the person
does the arithmetic by hand, on a number the dashboard doesn't even feed them (it
shows totals, not "room remaining before the soft/hard ceiling").

### What is wrong

- **BLOCKER [missing].** No "room remaining" figure and no accept/decline
  simulator. The ceiling meter answers "where am I," never "if I add X, where would
  I be" — the one question a ceiling exists to let a person answer _before_ signing.
- **BLOCKER [wrong model].** The forecast structurally cannot see future ad-hoc
  day-rate income. `committedAmount`/`projectedAmount` only count work already
  approved, invoices already issued, or a recurring-fee schedule + an explicit
  renewal assumption row (`src/lib/server/fiscal/certainty.ts:128-243`). Nordwind and
  Bellani — the two clients actually driving this practice's ceiling risk — are both
  pure day-rate, so their future months contribute exactly €0 to "projected" no
  matter how predictable their volume actually is. The projection understates risk
  precisely for the archetype the ceiling exists to protect.
- **MAJOR [missing].** The one lever that _could_ fix the above — a
  `contract_renewal_assumption` row, which the forecast already knows how to read
  (`forecastRenewalAssumptions`, `src/lib/server/fiscal/forecast.ts:155-186`) — has
  no creation form anywhere in `src/routes`. It is dashboard-read, database-write
  only, the same "built the read side, never shipped the write side" pattern this
  whole fiscal area repeats (see §2 and §3).
- **MAJOR [friction].** The ceiling meter and the contract-creation form are two
  unconnected screens. Deciding whether to accept work means opening one tab to read
  a number, doing the multiplication by hand, then opening another tab to commit to
  the contract — with nothing carrying the number across.
- **MINOR [friction].** No history: the meter shows today's ratio, not the trend
  ("you were at 60% a month ago, now 87%") that would make "approaching" feel urgent
  rather than abstract.

### What is missing entirely

A **headroom answer**: given the ceiling, today's collected total, and a proposed
new engagement's expected value, "yes / yes but watch it / no" — computed, not
mentally approximated. Nothing in the product produces this number today.

### The journey redesigned

**Step 1 — the dashboard states headroom in one sentence**, not just a bar:
"€81,850 of room before the soft ceiling, €96,850 before the hard one, at today's
collected total." Pure derivation from data already fetched
(`limitValue - currentValue`); zero new fields.

**Step 2 — "would this fit?" lives on the new-contract form itself.** As soon as a
day rate and an expected monthly volume are entered (fields the form barely asks
for today beyond the rate card, see the Nordwind screenshot), show a live line:
"at 4 days/month, this adds ≈ €33,600/year — would still leave €48,250 of room" or
"— would cross the soft ceiling around September 2027." No new decision for the
person: it's arithmetic on fields already being typed, surfaced at the moment the
decision is actually made, not on a separate screen.

- _Option A (S)._ A read-only computed line under the rate-card fields on
  `contract-new`, no persistence, recalculated on every keystroke. Reuses
  `evaluateCeiling` as-is with a synthetic extra `LedgerRow`. Effort: small — one new
  derived field, no schema change.
- _Option B (M)._ The same line, but backed by a real "assumption" the person can
  save (finally giving `contract_renewal_assumption` — or a lighter-weight sibling —
  a UI), so it also feeds the year-end projection everywhere else instead of living
  only on this one form. Effort: medium — one new form + wiring into the existing
  forecast read path, no new fiscal-engine logic.

**Step 3 — the ceiling meter's projection separates "certain" from "assumed."**
Today it hides the difference (committed+projected reads as one dashed line); the
redesign shows collected / committed / projected-from-schedule /
projected-from-assumption as four visibly different shades, so "8% projected" is
never mistaken for "8% is realistic" when it is actually "8% is everything we're
willing to promise you without your own input."

**New totals:** 1 page, the same fields already being typed for the contract, 1
sentence of live feedback, 0 extra navigations. Compare to today's 0 answers across
2 unconnected screens.

### What it needs from elsewhere

A cheap way to enter "expected monthly volume" without building a full quoting
tool (see §5's "quotes and proposals" row) — even a single optional number on the
new-contract form is enough to drive Step 2. No new fiscal-engine primitive: every
number above already comes from `evaluateCeiling` and `certainty.ts`.

---

## 2. Changing regime

### The job

A forfettario consultant who crosses the hard ceiling, or who chooses to leave the
regime for any other reason, has one thing to do the day it happens: point the
product at a new set of rules from that date forward, without corrupting how last
year's — or last month's — invoices are read. This is not hypothetical color; it is
the literal event the ceiling in §1 exists to warn about. "Done" is: a new fiscal
profile is in force, the old one is closed on the right date, and every ceiling,
treatment and forecast reads correctly on both sides of the seam.

### Today, step by step

1. **The engine can do it correctly.** `fiscal_profile` rows are `[valid_from,
valid_to)` periods (`src/lib/server/fiscal/profile.ts:16-51`);
   `resolvePackOverRange` (`src/lib/server/fiscal/resolve.ts:68-84`) and
   `sumLedgerAcrossPeriods` split any query range at the seam and read each
   sub-period under its own pack, including the #122 edge case (an invoice issued
   under cash-basis flat-rate but still unpaid when the profile switches keeps being
   recognised on its own cash-basis rule, not the new pack's —
   `src/lib/server/fiscal/packs/it-flat-rate.ts:52-69`). This is well tested
   (`year-boundary-edge-cases.test.ts`, `it-standard.test.ts`).
2. **Nothing in `src/routes` ever inserts a `fiscal_profile` row.** Every insert in
   the codebase is a test fixture (`grep` across `src/lib/server/fiscal/*.test.ts` —
   a dozen hits, zero outside `.test.ts`). The settings page
   (`src/routes/settings/+page.server.ts:15-22`) reads the active profile and
   renders it; it has no form, no action, nothing that writes.
3. **The settings page says so, in both languages**, deliberately:
   `settings_fiscal_configured_note` — "Configured directly in the database; there
   is no interface for this yet" (`messages/en.json:784`,
   `messages/it.json:784`). This is at least honest, which most silently-missing
   features aren't.
4. **What "directly in the database" actually requires**, verified against the
   schema: because `fiscal_profile` periods cannot overlap, switching regimes needs
   _two_ statements in the same transaction — close the old row (`UPDATE ... SET
valid_to = '2026-11-03'`) and open the new one (`INSERT ... VALUES ('it-standard',
'1', '2026-11-03', NULL)`) — with the right `pack_id`/`pack_version` pair known in
   advance from `src/lib/server/fiscal/registry.ts:37-41` (three packs registered
   today: `generic`, `it-flat-rate@1`, `it-standard@1`). Get the date wrong by one
   day, or forget the `UPDATE`, and either a query throws ("N fiscal profiles are
   active on date, expected at most one",
   `src/lib/server/fiscal/profile.ts:29-31`) or two profiles silently overlap.
5. **Today's seed confirms the shape of the problem rather than the theory of it:**
   the running instance has exactly one `fiscal_profile` row —
   `it-flat-rate@1`, valid from 2026-01-01, `valid_to` null — queried live from
   `mastro-db-1`. No regime change has ever actually happened in this instance, so
   the "database-only" path has never been exercised end to end outside tests
   either.

**Totals: 0 pages, 0 fields, 1 raw SQL transaction** — on a production database, by
someone who is not a developer, on the single day of the year this decision has
real legal consequences (VAT becomes due from the crossing invoice onward the
moment the hard ceiling is crossed — there is no grace period to fix a
misconfigured transition).

### What is wrong

- **BLOCKER [missing].** No UI path exists at all. The gap is not "clunky," it is
  "does not exist" for an event that is not optional or rare in kind — every
  forfettario either ages out of the regime eventually or gets forced out by
  crossing 100k, and the moment it happens is exactly the moment the person is
  least equipped to write a correct two-statement SQL transaction under a legal
  deadline.
- **MAJOR [wrong model].** The self-hoster is expected to know which of three
  `packId`/`packVersion` pairs applies and to get the boundary date right by hand,
  when the product itself already knows the domain rules well enough to validate
  this (a pack registry, an exclusion constraint, a documented #122 edge case) —
  it just never turns that knowledge into a guided action.
- **MINOR [friction].** Even the read-only settings display doesn't show _history_
  — if a profile had changed in the past, there's no page listing "flat-rate until
  March, standard since," only "whatever is active today."

### What is missing entirely

A **regime-change wizard**, one screen, gated the same way any invariant-4-grade
action would be: pick the new pack, pick the effective date (defaulting to today),
show what changes (which ceilings disappear, which appear, which invoice treatment
codes become available), confirm, and the product performs the close-old/open-new
transaction atomically. This is not a general settings CRUD screen — it is a single
documented action with exactly the shape `resolve.ts` already models.

### The journey redesigned

1. **Settings → "Change fiscal profile."** One page.
2. **Pick a pack** from the registry (3 options today, radio group with each pack's
   `displayName` and a one-line summary of its ceilings — reads
   `defaultRegistry` directly, no new data).
3. **Pick an effective date**, defaulting to today, with a note if it falls inside
   an already-invoiced period.
4. **Preview**, computed before commit: "From 3 Nov 2026: no more revenue ceiling.
   VAT becomes ordinary (22%) instead of exempt. Ritenuta d'acconto starts applying
   to invoices to Italian business clients" (see §5's withholding gap — this is
   exactly where that omission would bite first).
5. **Confirm** writes the two-statement transaction server-side, in one
   `db.transaction`, so partial application is impossible.

**New totals: 1 page, 2 fields (pack, date), 1 confirm — down from 0 pages / 1 raw
SQL transaction requiring domain knowledge the UI never surfaces.**

- _Option A (S)._ No preview step, just pack + date + confirm with inline
  validation reusing the existing exclusion-constraint error. Effort: small.
- _Option B (M, recommended)._ Include the preview step above — it is the whole
  point of doing this in the product rather than in `psql`, and every fact in it is
  already sitting in `FiscalPack` and `CeilingLimit`.

### What it needs from elsewhere

Nothing new from the fiscal engine — `resolvePackAt`/`resolvePackOverRange` and the
registry already carry everything the preview needs. It needs one thing this
product doesn't have anywhere yet: a confirmation pattern for an action with
legal/financial consequences (heavier than a normal form submit, lighter than the
day-approval evidence chain) — worth building once and reusing for #3's
concentration-cap edits and any future "irreversible-ish" settings action.

---

## 3. The contract-origin ceiling (the 35% cap on Bellani)

### The job

Some contracts contain their own concentration clause — a client protecting itself
from over-dependence on one supplier by capping how much of the supplier's
_overall_ income it will represent, with the contractual consequence usually being
"we can walk away without notice if you let this happen." The job is the same as
§1's — "am I close, what do I do" — but scoped to one relationship instead of the
whole practice, and with a different, contractual (not statutory) consequence.

### Today, step by step

1. **The cap is a `ceiling` row**, not a pack constant: `measure:
'percentage_share'`, `perimeter: {kind: 'client'}`
   (`src/lib/server/db/schema/ceiling.ts:59-97`), created only through
   `createCeiling` (`src/lib/server/repositories/ceiling.ts:33-36`) — called from
   exactly one place in the whole repository: `ceiling.test.ts`. There is no route,
   no action, no form anywhere under `src/routes` that calls it (`grep -r
ceiling src/routes/clients` — zero hits). Attaching a concentration clause to a
   contract is exactly as database-only as changing a fiscal profile.
2. **It is evaluated through the identical `evaluateCeiling` function** §1's pack
   ceilings use (invariant 2's whole point,
   `src/lib/server/fiscal/ceiling.ts:110-154`): `currentValue` is Bellani's own
   revenue for the year, `limitValue` is 35% of _every_ client's revenue combined
   (`scaleMinorUnits(sumLedger(rows, ...).amount, 0.35)`,
   `src/lib/server/fiscal/ceiling.ts:124-127`) — so the cap moves whenever any
   other client's billing moves, not just Bellani's.
3. **Verified live**, querying the actual invoiced-calendar-year figures the code
   reads (`taxable_amount + social_charge`, accrual/issue-date basis, per
   `src/lib/server/fiscal/revenue.ts:19-52`): three invoices exist in 2026 —
   Bellani €2,170, Nordwind €3,150, Fermata €1,800, total €7,120. Bellani's share is
   **30.5%**, i.e. a `usageRatio` (share ÷ 35%) of **87%** — inside the pack's own
   "approaching" band (≥80%,
   `src/lib/server/db/schema` `alert_levels` on this row) but **not crossed**. This
   does not match the "today it is at 41%" figure this task was briefed with — I
   could not reproduce 41% from the live instance under any reading of the code
   (share of total, or usage-ratio-vs-limit); the honest number, evidenced against
   both the running database and the exact formula the product uses, is 30.5%/87%.
   The underlying risk the brief is pointing at is real regardless of the exact
   figure: with only three invoices issued all year, one slow month for Nordwind or
   Fermata (whose combined revenue is the _denominator_) tips Bellani over 35%
   without Bellani's own billing changing at all — a client-concentration cap that
   moves when you don't touch the client it's about.
4. **Where it surfaces:** exactly one place, the dashboard's "Quota dell'anno per
   cliente" chart, as a reference line plus the ceiling's own `consequence` text
   underneath the bar (`src/routes/+page.svelte:73-80`,
   `src/routes/+page.server.ts:185-200`) — literally "Il cliente può recedere senza
   preavviso" ("the client may terminate without notice"), read verbatim from the
   `consequence` column. It also feeds `detectCeilingApproaching` (same code path as
   §1) and `detectYearEndOverrunRisk`, so it can produce an alert on
   `/alerts` once thresholds are crossed.
5. **Where it does _not_ surface: the contract itself.** `grep -r ceiling
src/routes/clients/[clientId]/contracts/[contractId]` returns nothing — opening
   Bellani's own contract page (see `contract-detail.png` for the equivalent
   Nordwind page's layout) shows Identity, dates, payment terms, clause notes, rate
   cards and expenses, and nothing about the one clause in that contract that can
   end it without notice. The person has to already know to go check the dashboard
   chart, on a different page, to see a number about a specific contract's own
   named risk.
6. **What the person is supposed to do when it's crossed: nothing the product
   suggests.** The `consequence` text states the contractual fact; there is no
   guidance, no "here's what other practices do" (raise Nordwind/Fermata billing to
   dilute the ratio, slow down Bellani work, renegotiate the clause) — and no way to
   simulate any of those options before acting, the same missing capability as §1's
   accept/decline question, here scoped to one relationship.

**Totals: 1 dashboard widget shows the number; 0 places show the risk on the
contract it belongs to; 0 database writes are possible from the UI; 0 suggested
actions when crossed.**

### What is wrong

- **BLOCKER [missing].** No way to create, edit, or remove a contract-origin
  ceiling from the UI. Every one of these clauses in this product exists because
  someone ran SQL by hand.
- **MAJOR [friction].** The one ceiling that is _about_ a specific contract is
  invisible on that contract's own page. Someone reviewing Bellani's contract for
  any other reason has no way to notice this clause is there, let alone how close
  it is.
- **MAJOR [wrong model].** The denominator is every other client's revenue, which
  the person managing Bellani's relationship has no visibility into from Bellani's
  own contract page — the number that matters for this decision lives on a
  different page, computed from data this page never shows.
- **MINOR [missing].** No suggested remediation when a share-of-total cap is
  approached or crossed, unlike the absolute-amount ceilings in §1 which at least
  carry a plain-language legal consequence sourced from statute.

### What is missing entirely

Per-contract visibility of any ceiling attached to it (pack- or contract-origin
alike), and a form to create one — this is the same "read-only widget, no write
path" pattern as §2, on a different table.

### The journey redesigned

1. **A "Ceilings" section on the contract-detail page**, shown whenever
   `listCeilingsByContract` returns rows for this contract (already exists,
   `src/lib/server/repositories/ceiling.ts` — just never rendered): label, current
   value, limit, usage ratio, consequence, right next to the rate cards and clause
   notes that already live there.
2. **"Add concentration clause" as a step inside contract creation**, not a
   separate database action: a single optional block under "Approval and expenses"
   on `contract-new` — measure (amount or share), value, alert levels defaulted from
   the last one used (80%/95%, matching the seeded row) so nobody has to invent
   thresholds from scratch, consequence text as free text mapped into the
   `LabelBundle`. Reuses `createCeiling` as-is.
3. **When crossed, the alert links back to the contract**, not just the dashboard
   — `ceilingId` is already carried on the alert (`detectors.ts:373-381`); the
   missing piece is a link from `ceilingId` to the contract it came from
   (`listCeilingsWithContract` already has the join,
   `src/lib/server/repositories/ceiling.ts` per `ceiling-status.ts:7`).

- _Option A (S)._ Read-only "Ceilings" section on contract-detail only — closes the
  visibility gap, leaves creation to a later change. Effort: small — one query
  already exists, one new template block.
- _Option B (M)._ Add the creation form too, reusing whatever confirmation pattern
  §2's regime-change wizard establishes (this is a similarly consequential, rare
  action). Effort: medium.

**New totals: 1 contract page shows what's at stake on that contract; 1 optional
block at contract-creation time replaces a raw `INSERT` — down from 0 UI surface for
both reading and writing this ceiling.**

### What it needs from elsewhere

The confirmation-pattern component §2 needs too — worth building once.

---

## 4. Backups and continuity

### The job

Two different disasters, with two different real-world weights for a one-person
practice: **the laptop dies** (the person's own device, most days indistinguishable
from "I need a coffee and a new laptop" if the product is actually self-hosted
somewhere else), and **the box dies** (the actual server — the one event that can
lose the ledger itself). "Done" for the first is: sign in from a different device
and keep working. "Done" for the second is: a working instance, on new
infrastructure, with every invoice, approval and source document intact, verified,
inside a time window the person can tolerate.

### Today, step by step — "my laptop died"

1. If mastro is deployed the way `docs/deploy.md`/`compose.prod.yaml` assume — on a
   server, not the practitioner's own machine — this is close to a non-event: get a
   new device, open a browser, sign in. Better Auth's session model
   (`src/lib/server/db/schema/auth.ts:19-29`) has nothing tying a session to a
   device beyond the cookie that was on the dead laptop, so the person re-signs in
   the same way they would after clearing cookies.
2. **The one genuine risk in this path is undocumented**: if the person was relying
   on a local-only draft (an email reply half-composed, a note not yet saved) at
   the moment the laptop died, that's lost the ordinary way any web app loses
   unsaved state — not specific to mastro, not worth inventing a finding around, but
   also not something the product does anything to soften (no draft autosave was
   found anywhere in the routes examined for this journey).

**Totals for this path: effectively 0 mastro-specific steps, provided the instance
itself is not running on the laptop.**

### Today, step by step — "the box died"

1. **A backup has to already exist, offsite.** `scripts/backup.sh` dumps the
   database (`pg_dump -Fc`), copies `BETTER_AUTH_SECRET`, and archives the
   documents directory into one timestamped `.tar.gz`
   (`scripts/backup.sh:56-75`) — but copying that archive _off_ the box being
   backed up is explicitly left to whatever schedules the script
   (`docs/backup.md:51-55`): "this repository cannot reach into whatever offsite
   target a given self-hoster uses." If nobody wired that up, the backup dies with
   the box it lived on.
2. **A `backup_run` row records success/failure**
   (`src/lib/server/db/schema/backup.ts:16-25`), and — contrary to the doc's own
   header comment claiming "#74, not built yet" — the alert engine genuinely reads
   it: `detectBackupFailure` (`src/lib/server/alerts/detectors.ts:440-479`) is wired
   into `detectAlerts` (`src/lib/server/alerts/engine.ts:14,68,84`), checking both an
   unacknowledged failure and staleness (no run in `BACKUP_STALE_HOURS` = 26 hours,
   `src/lib/server/alerts/thresholds.ts:56`). `docs/backup.md` and three schema
   comments (`backup.ts:10`, `document-mirror.ts:13,19`) still say this doesn't
   exist — stale documentation actively contradicting the shipped code, worth fixing
   independent of this audit.
3. **Recovery is entirely command-line.** `scripts/restore.sh` requires: SSH (or
   physical) access to a fresh host, Docker + `docker compose` installed, a
   hand-recreated `.env.prod` (from `.env.prod.example`, with real
   `POSTGRES_USER`/`POSTGRES_DB`, and — if the whole original host is gone —
   freshly reissued Google OAuth credentials the doc explicitly says are _not_ in
   the backup set,
   `scripts/restore.sh:8-12`), the offsite archive copy from step 1, and running one
   script that **unconditionally destroys the current `db` volume first**
   (`scripts/restore.sh:50-51`, `docker compose down -v`) before restoring. There is
   no in-product "restore" action, "download latest backup," "list backups," or
   "trigger a backup now" button anywhere in `src/routes`.
4. **Verification after restore is a manual checklist, not a feature**: the doc's
   own closing line is "verify the restored figures before trusting this
   environment" (`scripts/restore.sh:78`) — with no built-in reconciliation (row
   counts, latest invoice number, latest approval) to check against. The rehearsal
   in `docs/backup.md:110-122` verified by hand: one client row, one file's
   contents, one config value, a migration count, and `/health`. A real restore with
   years of data has no equivalent built-in sanity check; the person re-derives one
   from memory.

**Totals for this path: 0 in-app steps; ~6 CLI/SSH steps against a production
Docker host, requiring credentials and access that are explicitly _not_ part of the
backup set, performed by someone who — per this product's own target user — bills
by the day and may not be a systems administrator.**

### What is wrong

- **This journey is better than the brief assumed on one specific point, and it's
  worth saying so plainly:** the "restore documents alongside the database" case
  _has_ been rehearsed, end to end, with concrete before/after evidence
  (`docs/backup.md:80-127` — a known file, a known secret, a known client row,
  verified byte-for-byte after a real `docker compose down -v` + restore). This is
  not a theoretical claim; it's the one piece of continuity work in this product
  that already meets the bar the rest of the audit asks for elsewhere. Don't
  regress it.
- **BLOCKER [missing].** Offsite copying — the one step that actually makes a
  backup survive the box dying — is explicitly out of scope for the product and
  left to the self-hoster's own cron/systemd setup. A backup that only lives on the
  box it protects against is not a backup for the scenario this journey names.
- **MAJOR [missing].** No in-app backup status, trigger, or download. The person's
  only visibility into "is my data safe" is an alert that fires _after_ something
  has already gone wrong (a failure or 26 hours of silence) — there is no "last
  successful backup: 4 hours ago, 38 MB, verified" line anywhere they'd see day to
  day.
- **MAJOR [friction].** Restore is destructive-by-default with no dry-run path. A
  self-hoster without a spare machine cannot rehearse this themselves without
  temporarily wiping their own working instance — which is precisely why, in
  practice, most people in this position never rehearse it even once, regardless of
  whether a developer proved it works one time in a disposable environment.
  Documented once, discoverable never.
- **MINOR [missing].** No built-in post-restore reconciliation report (counts of
  clients/contracts/invoices/documents, latest invoice number, latest approval)
  to replace the ad hoc manual checklist the rehearsal used.

### What is missing entirely

- **Offsite delivery as a first-class step**, not an externality — even a minimal
  "upload the archive to S3-compatible storage / another host over SSH" flag on
  `backup.sh` would close the actual failure mode this journey exists to prevent.
- **A non-destructive restore-verification mode**: extract the archive, `pg_restore`
  into a throwaway database, run the reconciliation counts against it, and report
  pass/fail — without touching the running `db` volume at all. This is what "rehearse
  it yourself, safely, on a schedule" would actually require.
- **An in-app backup status page** reading `backup_run` directly (the alert engine
  already has the query) rather than only alerting on failure.

### The journey redesigned

1. **`backup.sh` gains an optional offsite step** — one more archive copy, to a
   destination read from `.env.prod` (rclone-compatible remote, or plain `scp` to a
   second host). Off by default, one env var to turn on. Effort: small — the
   archive already exists at the point this would run.
2. **A read-only "Backups" panel under Settings** listing the last N `backup_run`
   rows (status, size if recorded, age) and the acknowledgement control the alert
   engine's `state.ts` already models for every other alert type. Effort: small — one
   new query, reusing existing acknowledgement plumbing.
3. **`restore.sh --verify-only <archive>`**: extracts, spins up a disposable
   Postgres container, restores into it, runs the reconciliation counts, tears it
   down, never touches the live `db` volume. This is the piece that turns "rehearsed
   once by a developer" into "the self-hoster can safely do this themselves, on a
   schedule, without fear." Effort: medium — mechanically similar to the existing
   restore path, but must not share the "always destroys the current `db`" line.

- _Option A (S, do first)._ Steps 1 and 2 only — visibility and the actual offsite
  gap, both cheap.
- _Option B (M)._ Add step 3. This is the one that actually makes "rehearse this
  yourself" true instead of aspirational.

### What it needs from elsewhere

Nothing new from the domain model — this is entirely operational tooling around
data the product already has full ownership of (`backup_run`, the documents
directory, the alert engine's existing acknowledgement pattern).

---

## 5. The gap list

Every capability evaluated below is grounded either in the three archetypes this
product is built around (agents propose/humans confirm, no day worked without
approval goes unnoticed, every derived datum keeps its source document) or in the
concrete fiscal reality of an Italian forfettario, checked against what the
jurisdiction packs in this repository already model (`it-flat-rate.ts`,
`it-standard.ts`).

**On electronic invoicing specifically, stated plainly up front:** Italian law
requires _every_ forfettario, since 1 July 2022 (the transitional exemption for
practitioners under the old €25,000 threshold ended then), to issue invoices
through the Sistema di Interscambio (SdI) in FatturaPA XML format — a paper or PDF
invoice is not legally sufficient. This is not a corner case; it is the baseline
requirement for every invoice this product's own target user issues. What this
repository already models toward that requirement: `formats: ['FPR12']` on both
`it-flat-rate.ts:195` and `it-standard.ts:60` — a bare format identifier, explicitly
commented as coordinating with "#41 (the format adapter, out of scope here)"; the
invoice table carries a `transmission_id` column
(`drizzle/0014_invoice.sql:21`) that no application code anywhere reads or writes
(confirmed by a repo-wide grep — every hit is a migration or schema snapshot); and
issue #41 itself, now closed, built an _import_-direction adapter interface
(`InvoiceFormatAdapter.parse(file) → Invoice`) for reading a client's _incoming_
invoice PDF, not for generating or transmitting this practice's own outbound
FatturaPA XML. In plain terms: the product knows the _name_ of the legally required
format and reserves a _column_ for the SdI receipt id, and has built nothing that
produces the format or talks to SdI. Every invoice this product helps issue today is
not, on its own, a document Italian law accepts as an invoice.

| Capability                                                                         | Who needs it                                                                                                                                                              | Archetype / law                                                                                                                                                                                                                                                          | In scope?                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Size                                              |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Electronic invoicing (SdI / FatturaPA XML generation + transmission)**           | Every user, every invoice                                                                                                                                                 | Legal mandate (D.Lgs. 127/2015 as extended to forfettari from 1 Jul 2022); `formats`/`transmission_id` already reserved in the packs and schema                                                                                                                          | **Yes — this is the single largest gap in the product.** Without it, mastro produces documents the consultant's own regime does not recognise as invoices.                                                                                                                                                                                                                                                                                                                        | L                                                 |
| **Rate change mid-contract**                                                       | Any consultant renegotiating an ongoing engagement                                                                                                                        | Journey B archetype (day billing)                                                                                                                                                                                                                                        | **Already built**, not a gap — `rate_card` rows are date-ranged per contract (`contract-detail.png`'s "Listini" section: `1 gen 2026 – aperto, Giornaliero, 700,00 €/giorno`); a new rate card with a new `validFrom` is the mechanism. Worth a UI polish pass, not a new capability.                                                                                                                                                                                             | —                                                 |
| **A "can I accept this" / headroom simulator**                                     | Every user, every new engagement                                                                                                                                          | §1's own finding — a ceiling exists to answer this and today doesn't                                                                                                                                                                                                     | Yes — see §1's redesign                                                                                                                                                                                                                                                                                                                                                                                                                                                           | S–M                                               |
| **Fiscal-profile and ceiling self-service (regime change, concentration clauses)** | Every self-hoster who ever changes regime or adds a client-concentration clause                                                                                           | §2 and §3's own findings                                                                                                                                                                                                                                                 | Yes — see §2/§3 redesigns                                                                                                                                                                                                                                                                                                                                                                                                                                                         | S–M each                                          |
| **Time off / capacity planning**                                                   | Any consultant, to know how many billable days are actually available before promising a client volume                                                                    | Journey B (day billing) and the headroom question in §1 — "can I accept this" needs to know the person's own remaining capacity, not just the ceiling                                                                                                                    | Yes, in scope, but _unbuilt_: no absence/unavailability concept exists anywhere in the schema (`work_unit` only records worked/approved/proposed days, never "unavailable"). Needed before §1's simulator can say more than "money-wise, yes."                                                                                                                                                                                                                                    | M                                                 |
| **Multi-currency**                                                                 | A consultant with any non-EUR client                                                                                                                                      | Not one of the three archetypes directly, but a real gap against "day-biller" generally                                                                                                                                                                                  | Explicitly out of scope today by design, not oversight: `contract.currency` is free ISO-4217 text, but every fiscal calculation — `LedgerRow`, `evaluateCeiling`, `forecastRevenue` — assumes a single practice currency (documented at `src/routes/+page.server.ts:3-4`). A non-EUR contract today silently corrupts every aggregate figure rather than being rejected. If genuinely out of scope, the contract form should refuse non-EUR input rather than accept it silently. | L (real support) / S (reject at the door)         |
| **A second person (employee, associate, delegate approver)**                       | Any practice that grows past one person, or wants someone else to review during illness/absence                                                                           | Explicitly _contrary_ to this product's stated archetype (a single independent consultant) — but `client_contact.canApprove` already models a second approver on the _client_ side, and there is no equivalent on the practitioner's side, not even a read-only delegate | Deliberately out of scope for this product's stated user; flag as a permanent boundary, not a backlog item.                                                                                                                                                                                                                                                                                                                                                                       | — (out of scope)                                  |
| **Purchase orders / client PO numbers**                                            | Clients (mostly larger ones like Nordwind) whose AP process requires a PO reference on every invoice                                                                      | Not modeled anywhere: no PO field on `contract` or `invoice`, confirmed by schema grep                                                                                                                                                                                   | Yes, small — this blocks getting paid by exactly the kind of enterprise client (Nordwind) this product's own seed data represents.                                                                                                                                                                                                                                                                                                                                                | S                                                 |
| **Quotes / proposals to clients** (pre-contract)                                   | Any consultant pitching new work                                                                                                                                          | Distinct from mastro's own `proposal` table, which is entirely internal AI-extraction (`src/lib/server/db/schema/proposal.ts:19`, `targetType: 'work_unit'`, extended by #86/#87 to `'contract'`/`'invoice'` — never a client-facing document)                           | Arguably out of scope for a _ledger_ — but worth naming explicitly so it isn't confused with the existing `proposal` concept, which does something entirely different despite the same word.                                                                                                                                                                                                                                                                                      | — (name the ambiguity, don't build)               |
| **Timesheet export for clients demanding their own format**                        | Clients whose AP wants a specific column layout, not mastro's own                                                                                                         | Journey B/C                                                                                                                                                                                                                                                              | **Partially built**: `day_register_csv`/`day_register_pdf` (`src/lib/server/db/schema/email-template.ts:56`) can attach a worked-day register to an outgoing templated email — but only mastro's own fixed layout, and only via the email flow, not a standalone "export this contract's register for this date range" download.                                                                                                                                                  | S (standalone export) / M (custom column mapping) |
| **VAT / withholding edge cases (ritenuta d'acconto)**                              | Anyone on the `it-standard` pack (i.e., anyone who has left the forfettario regime — see §2)                                                                              | Legal reality: a professional invoicing an Italian business client under the standard regime is ordinarily subject to 20% ritenuta d'acconto, withheld by the client and remitted on the practitioner's behalf                                                           | `it-standard.ts:44,58` declares `ceilings: []` and `charges: []` — ritenuta is entirely unmodeled. This is a real gap the moment §2's regime-change journey is ever actually used: the pack someone lands on after leaving forfettario has no withholding logic at all.                                                                                                                                                                                                           | M                                                 |
| **Expense receipts as evidence**                                                   | Every consultant claiming reimbursable expenses                                                                                                                           | Invariant 4 (every derived datum keeps its source document)                                                                                                                                                                                                              | **Already built, not a gap** — `expense` rows relate to `document` via `ownerType: 'expense'` (`src/lib/server/db/schema/document.ts:27`), and `contract-detail.png` shows a live expense with a "Treno Milano — Verona, €46,00, Rimborsabile" row tied to a rate-card line.                                                                                                                                                                                                      | —                                                 |
| **Deductible expenses (fiscal side)**                                              | Consultants under `it-standard` (forfettario uses a flat coefficient and cannot deduct real expenses at all — this is correct behavior for forfettario, not a gap for it) | Legal reality specific to the standard regime                                                                                                                                                                                                                            | Same root cause as withholding: `it-standard.ts` has no expense-deductibility modeling at all (`charges: []`), so this only becomes a real gap once §2's regime-change path is used for real.                                                                                                                                                                                                                                                                                     | M                                                 |
| **Annual accountant handover**                                                     | Every consultant, once a year, handing figures to a commercialista for the dichiarazione dei redditi                                                                      | Fiscal reality — this happens to every single user of this product, every year, without exception                                                                                                                                                                        | Nothing in the product produces a year-end package (revenue by treatment code, charges evaluated, ceiling status, invoice register) in a form an accountant can consume. The building blocks all exist (`fetchLedgerRows`, `evaluateCharges`, `evaluateActiveCeilings`) — nothing assembles them into an export.                                                                                                                                                                  | M                                                 |
