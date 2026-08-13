# UX/UI review of the whole product

2026-08-13. Written against `v0.3.0` (`86836ba`), read on a running production
build with a realistic instance: three contract archetypes, days in every state
including one worked without approval, a paid invoice, an invoice 34 days
overdue, two pending proposals from one email, two critical alerts.

Every screen was captured four ways (1440px Italian, 1440px English, 390px
Italian, 1440px dark) — 140 screenshots across 35 routes. Eight parallel
reviews then went through the code and the captures area by area; their full
findings are the appendices in [`ux-review/`](ux-review/), and this document is
the part you actually have to read and decide on.

The verdict is not "it needs a coat of paint".

---

## 1. Why it looks like this

Four root causes. Everything else in this review is downstream of them.

**The product has a chart design system and no interface design system.**
`src/lib/design/` is genuinely excellent: eight categorical hues in fixed order,
a certainty ramp, a four-level status scale, all validated by
`palette-validator.ts` for OKLCH lightness, chroma floor, colour-blind
separation and contrast, with `palette.test.ts` asserting the CSS and the
TypeScript never drift. `/design` renders it for review. It documents **charts
only**. There is no type scale, no spacing scale, no interface colour, no
button, no input, no focus ring. So every screen invented its own, and 47 files
each made a slightly different guess.

**Nothing responds to the pointer.** Across the entire app: 2 `:hover` rules, 3
`:focus-visible` rules, 1 disabled style, 0 `aria-live` regions. A form that is
saving looks exactly like a form that has hung. That single fact explains most
of the "it feels unfinished" reaction, independently of colour or type.

**Austerity was a deliberate choice, and it went one step too far.**
`Card.svelte`'s own comment: _"A hairline on the page surface, and nothing else:
no shadow, no radius, no token that does not already exist."_ That instinct is
right for a financial ledger. But with no type scale and no interaction states
underneath it, restraint reads as unfinished rather than as composure — and it
was already quietly broken anyway, by three components that do use radius
(6px, 8px, 10px) and one that uses a shadow.

**The screens present the database, not the work.** The contract page is five
definition lists of column names ("Preavviso di rinnovo (giorni)", "Codice del
regime fiscale"), and shows no days and no invoices. The dashboard's `h1` is the
product's own name plus a marketing tagline, with three charts and not one day
under it. The day form asks for a quantity in a field labelled with its own
internals, next to a control that already sets it. Nobody asked "what is this
person here to do".

## 2. What is good and must survive

- **The chart palette and its validator.** Keep verbatim. The interface layer
  should sit beside it, in a new file, never inside the block `palette.test.ts`
  asserts exactly.
- **`StatusIndicator`**: structurally cannot render colour without an icon and a
  label. That discipline should govern every badge in the product.
- **The chart/table twin in `ChartFrame`**, and `RecordList`'s table/card twin.
  The rule "every dense view has an accessible alternate rendering" is right;
  it just needs to reach the eight raw `<table>`s that bypass it.
- **The PWA layer.** Service worker, install prompt, offline banner and the
  offline queue are well built, and the worker already survived one production
  incident. One real defect: `InstallPrompt.svelte` has hardcoded English.
- **`day/new`'s touch sizing** (`text-base`, `py-3`) is the only place someone
  clearly thought about thumbs. It should become the rule, not the exception.
- **Dark mode.** It is designed rather than inverted, and it currently looks
  better than light. It has no user-facing switch.

## 3. The evidence, in numbers

| Measure                                                   | Value                                       |
| --------------------------------------------------------- | ------------------------------------------- |
| Routes                                                    | 35                                          |
| Distinct button class strings                             | 21 (top one used 14 times)                  |
| Inputs styled inline as `class="border px-2 py-1"`        | 46                                          |
| Occurrences of `class="border px-…"`                      | 107                                         |
| `:hover` rules / `:focus-visible` rules / disabled styles | 2 / 3 / 1                                   |
| `aria-live` regions                                       | 0                                           |
| Distinct font sizes, unnamed                              | 15+                                         |
| Distinct radii, unnamed                                   | 6 (0, 4, 6, 8, 10, 999px)                   |
| Native `<select>` / `<input type=date>`                   | 19 / 16                                     |
| Raw `<table>` outside a shared component                  | 8                                           |
| `+error.svelte` files                                     | 0                                           |
| Message keys to keep in sync per string                   | 2 (en, it)                                  |
| Horizontal overflow at 390px                              | `invoices/[id]` — 410px in a 390px viewport |

## 4. Twenty things that are broken, not ugly

These are defects with or without a redesign. Ranked by what they cost.

**Protection promises that the interface silently drops**

1. `requiresPriorApproval` **defaults to unchecked** on every new contract
   (`contracts/new/+page.svelte`). The product's central protection is off
   unless you notice a checkbox in the middle of a 15-field form.
2. **Alerts cannot be acted on.** Every alert kind except the two system ones
   already carries its subject's id server-side (`alerts/types.ts`:
   `workUnitId`, `invoiceId`, `contractId`, …). The page renders title and body
   text and throws the ids away. The only button is "acknowledge", which is a
   severity-rank silencer.
3. **Proposals are in no navigation** — not the sidebar, not the bottom bar,
   not the More sheet. The human half of "agents propose, humans confirm" is
   reachable only from a conditional card on the dashboard.
4. **The dashboard shows no days**, and does not surface days worked without
   approval, though `fetchWorkedWithoutApprovalRows` already exists for exactly
   that.
5. **The `worked_without_approval → unbillable` edge has no UI at all.** The
   state machine allows it; nothing in the product can perform it.

**Money and legal correctness**

6. **Every amount field rejects the format the app itself prints.**
   `decimalStringToMinorUnits`'s regex refuses `700,00` while the whole UI
   renders `700,00 €`. Typing back what you see is a validation error.
7. **Invoice totals are three independently hand-typed numbers** (quantity,
   unit price, amount) with no reconciliation against the days actually
   selected.
8. **Statutory text is retyped by hand** on invoice creation, though the exact
   verbatim strings exist as data in the active jurisdiction pack. Invariant 5
   says legal strings are data; this screen makes them typing.
9. **An imported invoice's archived original is stored and unreachable.** Same
   for a proposal's source document: `/documents/[id]` exists, is auth-gated,
   and is linked from nowhere. That is invariant 4 broken in the UI.
10. **`templateLanguage` defaults to `en`** on every new contract, unrelated to
    the client's own language — the language a real client email goes out in.

**Cannot be found**

11. `/invoices` means _unpaid only_. A paid invoice is reachable only by typing
    its URL. The nav label says "Fatture".
12. The **contract page shows no days and no invoices** — the two things a
    contract produces.
13. Neither the client list nor the client detail shows **anything financial**:
    no exposure, no unpaid total, no concentration against the cap.
14. **No rate card is marked as the one in force today.**
15. The sidebar's first item is **"Oggi" and it does not go to today**.

**Does not work at the size it claims to support**

16. **The month calendar disappears below 640px**, because it is built inside
    `ChartFrame`, which swaps to a flat table on phones. The primary monthly
    instrument is missing on the primary device.
17. **`invoices/[id]` overflows horizontally at 390px** — a fixed two-column
    `<dl>` with no `min-w-0`, blown out by the IBAN. The fix exists verbatim in
    two other files.
18. **Recording a day is not one tap from anywhere**, despite the 30-second
    promise; and the day form shows no money and no approval context.
19. **The offline queue is invisible** outside the one page that writes to it.
20. **There is no `+error.svelte`.** A reminder for an invoice that is not
    overdue renders a bare, chromeless `400` as its `h1`.

## 5. The two decisions

Everything else follows from these. They are independent.

### Decision A — how far the redesign goes

|                       | **A1. Re-skin**                                                       | **A2. Rebuild the surfaces**                                                                                                                                                         | **A3. Rethink the product's shape**                                                                                                                 |
| --------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| What changes          | Tokens, a real component set, states. Every page keeps its structure. | A1, plus each page is recomposed around the question it answers. Contract page gains days and invoices; invoice list gains ageing and filters; dashboard becomes an attention queue. | A2, plus the information architecture: proposals/import/mail merge into one inbox, day surfaces consolidate, a command palette and a global period. |
| Routes touched        | 0 new, 47 files restyled                                              | ~12 pages recomposed                                                                                                                                                                 | ~8 routes moved or merged                                                                                                                           |
| Effort                | 1 wave                                                                | 3–4 waves                                                                                                                                                                            | 5–6 waves                                                                                                                                           |
| Fixes the 20 defects? | 6 of 20                                                               | 17 of 20                                                                                                                                                                             | all 20                                                                                                                                              |
| Risk                  | Very low                                                              | Low; each page lands independently                                                                                                                                                   | Medium; URLs change, muscle memory changes                                                                                                          |

**My recommendation: A2, sequenced so that A1 lands first and completely.** The
foundation is the thing blocking everything else, and A3's IA changes are worth
deciding _after_ you have lived with A2 for a couple of weeks — by then you will
know whether three ingestion destinations actually bother you.

### Decision B — what it looks like

Three directions, all buildable on Tailwind 4 with no runtime dependency. All
three keep the chart palette untouched.

**B1. "Ledger" — quiet, document-like.** System font stack, no web font. Two
sizes do 90% of the work (15px data, 13px meta) plus one 28px figure per screen.
Near-monochrome: warm off-white page, near-black text, exactly one accent (a
deep blue borrowed from `--series-1`) for links and the single primary action
per screen. Compact rows (36px), flat cards, hairlines. Looks like a
well-typeset financial document.
_Cheapest, closest to today's DNA, and the one most at risk of still reading as
"unstyled" to you — it is the current look done properly rather than a different
look._

**B2. "Ledger with confidence" — structured, banking-app adjacent.**
Self-hosted IBM Plex Sans for chrome and IBM Plex Mono for money, dates and
reference numbers, on a real six-step scale. A genuine surface hierarchy: grey
page, white cards with a soft shadow at 8px radius, a primary brand colour
independent of the text colour, semantic danger and warning that are siblings of
the chart status scale rather than the same tokens. Comfortable density,
generous around figures.
_The most work of the three, and the one that most decisively stops it looking
like a wireframe._

**B3. "Console" — dense, keyboard-first, dark by default.** IBM Plex Mono
throughout. Dark is the default scheme and light is the override. Very compact
32px rows, high contrast, chart colours reading vividly against near-black.
Keyboard shortcuts promoted from 9px grey afterthoughts to first-class `kbd`
affordances next to the action they trigger.
_Fits the product's existing keyboard culture and your own dark preference; the
riskiest for a document you may one day show a client, and mono at 13px in
Italian is tight._

**My recommendation: B2.** You read this daily on a phone and weekly on a
desktop, and it has to look trustworthy in two languages. B2 is the only one of
the three that buys real typographic identity, and Plex ships true tabular
figures, which a table of money needs and the system stack only sometimes
provides.

## 6. What gets built once, for everyone

Whatever you choose, this is the shared layer. Nothing else can start until it
exists, and every area review asked for it independently.

**Tokens** — a new `src/lib/design/tokens.css`, imported after `palette.css`,
never inside it (`palette.test.ts` asserts that block exactly): spacing scale,
three radii, one overlay shadow, a 6–7 step type scale, `--font-ui` /
`--font-mono`, `--color-primary(-ink)`, `--color-danger(-ink)`, `--color-focus`,
`--surface-2`, `--surface-overlay`, and a 44px touch minimum.

**Components** — in priority order, with the states each must carry:

| Component                                         | States                                                                                        | Needed by                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `Button`                                          | default, hover, focus-visible, disabled, **loading**; primary / secondary / tertiary / danger | everything (35 buttons, 29 links acting as buttons)     |
| `Field`                                           | label, hint, error wired via `aria-invalid` + `aria-describedby`, required, disabled          | every form (30+ hand-rolled label/error blocks)         |
| `Amount` (display) + `AmountInput`                | three display sizes, tabular, `MinorUnits`-safe; input accepts the locale's own decimal comma | invoices, rate cards, expenses, ceilings — and defect 6 |
| `Input` / `Select` / `DateInput` / `Textarea`     | focus, invalid, disabled; natives kept for OS pickers                                         | all forms                                               |
| `Table`                                           | sortable, empty state, mandatory mobile-card twin                                             | 8 raw tables + `RecordList` consumers                   |
| `Badge`                                           | count and status variants, always icon + label                                                | nav, day states, ageing, proposals                      |
| `EmptyState` / `ErrorState`                       | with a CTA, not a bare sentence                                                               | ~12 list surfaces, plus the missing `+error.svelte`     |
| `Dialog` / `Sheet`, `Toast`, `Banner`, `Skeleton` | —                                                                                             | destructive confirmations, save feedback, loading       |
| `KeyboardHint`                                    | visible affordance                                                                            | replaces the 9px "Premi N" spans                        |

**Two policies**: a focus ring token applied by every control, and a loading
state on every submit that does not change the button's box size.

**One prerequisite**: a repeatable demo seed (`scripts/seed-demo.ts`) so any
screen can be looked at with realistic data. This review used a throwaway one;
a redesign needs it committed.

## 7. Per-area options

Condensed. Each row's detail, with file and line evidence, is in the appendix
named at the head of the section.

### Shell and IA — [appendix 01](ux-review/01-shell-and-ia.md)

| Screen                 | A                                                                           | B                                                                                                              | C                                       | Rec.              |
| ---------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------- |
| Sidebar                | Icons, tighter groups, proper active state                                  | Regroup around the daily loop: **Today / Inbox / Ledger / Money / Setup**, promoting proposals into the chrome | Collapsible rail with a command palette | **B**             |
| Bottom bar             | Restyle, fix the More sheet                                                 | Five destinations matching B, with a persistent "record a day" action                                          | Thumb-zone FAB                          | **B**             |
| Breadcrumbs and titles | Stop concatenating parent names into the `h1`; the trail carries the parent | Sticky context header on scroll                                                                                | —                                       | **A now**         |
| Page width             | Give the four dense pages `width="wide"` today                              | A per-page width contract so a new table cannot regress it                                                     | —                                       | **A now, B next** |
| Global                 | —                                                                           | Notification popover on the alert badge; one shared period switcher                                            | Command palette (`⌘K`)                  | **B**, C later    |

### Design system — [appendix 02](ux-review/02-design-system.md)

Covered in section 6. The appendix carries the full control inventory with
counts, the token table, the 22-component table and the three directions
specified to build-from-description level.

### Dashboard and ceilings — [appendix 03](ux-review/03-dashboard-and-ceilings.md)

Three concepts for the home screen:

- **Attention queue** — the screen is a list of what needs you today: days at
  risk, proposals pending, invoices overdue, ceilings approaching. Charts move
  to their own page.
- **Period ledger** — this month's days, money and remaining capacity, with the
  charts as supporting evidence below.
- **Money-and-risk cockpit** — today's charts, fixed: one ceiling card instead
  of two duplicates, labelled ticks, a headline that changes colour with
  severity, a projection note that escalates.

Recommended: **the cockpit's fixes first (cheap, they are chart bugs), then the
attention queue as the actual home.** Specific chart fixes, all named in the
appendix: axis-label pitch and skipping, nice-number ticks, marker-line labels,
a labelled concentration reference line, and one chart/table preference for the
whole page rather than per widget.

### Day lifecycle — [appendix 04](ux-review/04-day-lifecycle.md)

| Screen                         | A                                      | B                                                                                                                        | C                                           | Rec.  |
| ------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ----- |
| `day/new`                      | Restyle the controls                   | Drop the redundant quantity field, show the rate and the approval status for the chosen date, keep the segmented control | Sheet from anywhere, prefilled from context | **B** |
| `day/calendar`                 | Restyle the grid, keep the chart frame | Take it out of `ChartFrame` so it survives on a phone; dense agenda list below 640px via `RecordList`                    | Week strip with a running total             | **B** |
| `day/[id]` + `day/date/[date]` | Restyle                                | Merge into one day surface showing approval excerpt, money, invoice and the transition log                               | —                                           | **B** |
| States                         | —                                      | One badge component, eleven states, icon + label, each offering its own next action                                      | —                                           | **B** |

The appendix has the full state-to-visual table (state, EN label, IT label,
treatment, action offered) and an honest tap count for entry at 390px.

### Clients and contracts — [appendix 05](ux-review/05-clients-and-contracts.md)

| Screen                  | A                                                                                                  | B                                                                                                                  | C               | Rec.              |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------- | ----------------- |
| Client form (31 inputs) | One contact by default with "add another"; group the rest                                          | A, plus progressive disclosure per group and a country picker instead of an ISO field                              | Two-step wizard | **A now, B next** |
| Contract form           | Group into Identity / Term / Money / Approvals / Expenses; conditional fields appear when relevant | A, plus approval requirement promoted to the top as an explicit choice, not a buried default                       | —               | **B**             |
| Contract detail         | Restyle the definition lists                                                                       | Recompose around what a contract produces: days, invoices, money, then terms                                       | Tabs            | **B**             |
| Client list and detail  | Restyle                                                                                            | Add exposure, unpaid, days this year, concentration against cap — the computation already exists for the dashboard | —               | **B**             |
| Rate cards              | Mark which card is in force today                                                                  | A timeline of periods                                                                                              | —               | **A**             |
| Expenses / clause notes | Fix the duplicated rebill row; drop the empty column                                               | Rebill inline from the row                                                                                         | —               | **A/B**           |

### Invoices and money — [appendix 06](ux-review/06-invoices-and-money.md)

| Screen          | A                                                                                                         | B                                                                                                                                 | C                                  | Rec.  |
| --------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----- |
| `/invoices`     | Add severity to the ageing cell (`ageingStatus` already returns the level, both call sites throw it away) | Status filter, paid view, ageing bands with subtotals                                                                             | Full ledger with search and export | **B** |
| Invoice detail  | Fix the 390px overflow (`min-w-0`, copy the fix from `day/[id]`)                                          | A, plus the archived original, the days behind each line, and one action rail                                                     | Document-style rendering           | **B** |
| `/invoices/new` | Restyle                                                                                                   | Build lines from selected days; totals computed, never typed; statutory text from the pack                                        | Guided flow                        | **B** |
| `/remind`       | —                                                                                                         | Replace the bare `400` with the screen's own good empty-state pattern: "this invoice is not overdue", and what you can do instead | —                                  | **B** |

### Ingestion and mail — [appendix 07](ux-review/07-ingestion-and-mail.md)

| Screen             | A                                                                                                                                          | B                                                                                                                                                     | C                       | Rec.                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------- |
| Proposal review    | Link the source document, fill the evidence panel with the surrounding message and highlight the excerpt, differentiate accept from reject | A, plus queue awareness: siblings from the same email, prev/next, batch accept                                                                        | Inline review in a list | **B**                   |
| Proposals list     | Restyle                                                                                                                                    | Group by source email, with per-thread accept                                                                                                         | —                       | **B**                   |
| `/import`          | Dropzone polish                                                                                                                            | Report per-file outcomes, partial results, what failed and why                                                                                        | —                       | **B**                   |
| `/mail`            | Show poll-run health (the repository already exists)                                                                                       | Per-contract ingestion state                                                                                                                          | —                       | **A**                   |
| Template editor    | Add the missing `days_late` placeholder to the hint                                                                                        | Insertable placeholder chips with a live preview                                                                                                      | —                       | **A now**               |
| Template send      | —                                                                                                                                          | Read the figures from the invoice instead of asking a human to retype them onto a real client email; the invoice table it was waiting for has shipped | —                       | **B**                   |
| Three destinations | Keep, cross-linked                                                                                                                         | Merge into one "Inbox"                                                                                                                                | —                       | **A**, revisit under A3 |

### Alerts, states, PWA — [appendix 08](ux-review/08-alerts-states-and-pwa.md)

| Screen            | A                                                                        | B                                                                                                                                    | C                                                                   | Rec.                              |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------- |
| Alert row         | Severity treatment beyond a 14px glyph                                   | Deep link to the subject plus a real primary action per kind ("link an approval", "draft a reminder"); acknowledge becomes secondary | Alerts that resolve themselves when the underlying condition clears | **B**, C as a policy question     |
| Alert preferences | Restyle the 22 checkboxes                                                | Collapse to a few meaningful choices; protections that the product's promises depend on should not be silently switchable            | —                                                                   | **B**                             |
| Settings          | Restyle                                                                  | Make it "am I healthy": fiscal profile, backup state, mail poll, runner, allowlist, theme                                            | —                                                                   | **B**                             |
| Theme             | Add the switch — the whole scheme is built and tested and has no control | —                                                                                                                                    | —                                                                   | **A**                             |
| Errors            | One `+error.svelte` reusing the sign-in/offline standalone shell         | —                                                                                                                                    | —                                                                   | **A**, cheapest fix in the review |
| Empty states      | Sentence per surface                                                     | `EmptyState` component with a CTA, per the table in the appendix                                                                     | —                                                                   | **B**                             |
| Loading           | —                                                                        | Pending state on every submit                                                                                                        | —                                                                   | **B**                             |
| PWA               | Translate `InstallPrompt`                                                | —                                                                                                                                    | —                                                                   | **A**                             |

## 8. Sequence

**Wave 0 — prerequisites (small).** Committed demo seed. `+error.svelte`. Theme
switch. The mobile overflow fix. The `days_late` placeholder. These are
independent, cheap, and none of them wait on a direction being chosen.

**Wave 1 — the foundation.** Tokens, `Button`, `Field`, the input family,
`Amount`, `Badge`, `Table`, `EmptyState`, focus and loading policy. `/design`
grows an interface section and becomes the regression surface. Nothing visible
changes for the user except that everything starts responding to the pointer.

**Wave 2 — the protection defects.** Items 1–10 in section 4. Mostly small, all
independent, each one a real bug.

**Wave 3 — the surfaces, in the order they hurt.** Alerts and dashboard first
(they are the product's promise), then day lifecycle, then invoices, then
contracts, then ingestion.

**Wave 4 — IA, if you still want it.** Decision A3.

Waves 2 and 3 parallelise cleanly across agents; wave 1 does not, and should be
one person's work so the component API stays coherent.

## 9. What I need from you

1. **Decision A**: re-skin, rebuild the surfaces, or rethink the shape.
   (Recommended: rebuild, A1 first.)
2. **Decision B**: B1 quiet, B2 Plex, or B3 console. If none of the three is
   right, tell me what you _do_ like the look of and I will specify a fourth.
3. **Dark first, or light first?** Dark currently looks better and you may
   simply prefer it.
4. **Wave 0 now?** It is cheap and none of it depends on 1–3.
5. Anything in section 4 you want me to **file as issues today**, redesign or
   not. My instinct is all twenty.

## 10. How this gets verified

Not by looking at one screen in one language. The sweep that produced this
review is repeatable and should gate every wave: 35 routes × {1440 light IT,
1440 light EN, 390 IT, 1440 dark} against a seeded instance **and** an empty
one, checking horizontal overflow at 320px, a keyboard-only pass with the mouse
unplugged, and `palette.test.ts` still green to prove the interface tokens
stayed out of the validated block. The current baseline captures are the
before-picture.
