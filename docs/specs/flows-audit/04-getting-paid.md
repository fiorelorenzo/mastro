# Getting paid: from an issued invoice to money in the bank

## The job

Lorenzo issues an invoice once a period's days are billed — that part is a
different journey. From the moment `invoice.paid_on` is `null`, the job is:
notice it's outstanding, know who owes what and since when, chase it without
duplicating a chase or forgetting one, record the payment the instant it
lands, and — the case the whole product exists to survive — produce
something you can put in front of a client who says "we never agreed to
this" or "that day never happened." It runs continuously in the background
of every week, spikes once a month when invoices are issued, and "done"
means: the unpaid list is empty, or every non-empty row is either not yet
due or has a chase in flight that you know about. Today (13 Aug 2026) the
seed instance has exactly two rows in that state — 2026/011 (Bellani &
Partners, €2,647.40, 34 days overdue) and 2026/015 (Fermata Digitale,
€2,196.00, due in 3 days) — which is small enough to hold in your head. The
audit below is about whether it still works at thirty.

## Today, step by step

### 1 — Knowing what is owed

**Step 1.1.** `/invoices` loads. The loader (`src/routes/invoices/+page.server.ts:10-29`)
calls `listUnpaidInvoices()` (`src/lib/server/repositories/invoice.ts:222-239`),
which joins `invoice → contract → client → invoiceLine → workUnit`, filters
`isNull(invoice.paidOn)`, and groups. Every row is stamped with `daysLate`
(`domain/invoice.ts:37-42`) and the list is sorted worst-first
(`+page.server.ts:14`). This is the **one and only query in the codebase**
that answers "what is unpaid" — nothing else recomputes it, nothing caches
it, so it's always correct on read.

**Step 1.2.** The page renders two summary figures — `totalOutstandingByCurrency`
(one number per currency, grouped by _currency_, not by client) and
`awaitingPaymentCount` — plus a 6-column table: number, client name, due
date, an ageing chip (`src/routes/invoices/status.ts:15-24`), day count,
total. **1 page load, 0 fields, 0 decisions** — this step is fine.

**Step 1.3.** To answer "how much am I owed **by Bellani specifically**" you
read the client-name cell of every row and add the matching totals in your
head. Nothing groups by client — `listUnpaidInvoices` returns flat rows with
a `clientLegalName` string column (`invoice.ts:227`) and no caller ever
`GROUP BY`s it. At 2 rows this is free; at 30 it is real, error-prone work
with no tool support.

**Step 1.4.** I checked every other surface that could plausibly answer "who
owes me money" and none of them do:

- **Dashboard** (`src/routes/+page.server.ts:68-228`) issues seven queries —
  `evaluateActiveCeilings`, `forecastRevenueByMonth`, `listContractsWithClient`,
  `fetchClientRevenueBreakdown`, `listClients`, `forecastRenewalAssumptions`,
  `listProposals`. None of them is `listUnpaidInvoices` or anything derived
  from it. `grep` for `invoice|overdue|unpaid` in `src/routes/+page.svelte`
  returns **zero matches** — confirmed directly, not just cited from the UX
  review.
- **Client detail** (`src/routes/clients/[id]/+page.svelte:44-113`) has three
  sections — legal identity, contacts, contracts (title/status/start
  date/renewal type only). No money in any of them, independently confirmed
  by reading the file.
- **Contract detail** (`.../contracts/[contractId]/+page.svelte`) has six
  sections — Identity, Clause notes, Payment (terms, not transactions),
  Approval and expenses, Rate cards, Expenses. Not one of them lists an
  actual invoice or a day's billing state. Confirmed by reading the file,
  independent of appendix 05.

**Step 1.5. The near-miss.** The dashboard's "Concentrazione clienti" card
(`+page.server.ts:185-201`, `fetchClientRevenueBreakdown`,
`src/lib/server/fiscal/revenue.ts:121-143`) _looks_ like a per-client money
answer and isn't one, for a reason worth stating precisely: it reads through
`fetchRevenueOverRange` → `sumLedgerAcrossPeriods` → `sumLedger`, which under
a cash-basis pack (the seed's `it-flat-rate`, confirmed by the dashboard
screenshot's own "Base di calcolo: incassato" label) sums by **`paidOn`**
(`fiscal/ledger.ts:59-78`). An unpaid invoice contributes **nothing** to this
chart. That's exactly why the seed's concentration card shows Nordwind at
100% and Bellani at 0%, despite Bellani owing €2,647.40, 34 days late — the
card answers _"what counts toward my flat-rate ceiling"_ (a tax question,
correctly cash-basis), not _"what is my exposure to one client not paying"_
(a business-risk question, which wants the accrual figure, i.e. issued
totals regardless of `paidOn`). The product has one number and uses it to
answer two different questions; for the risk question it is silently wrong
by construction, not approximately wrong.

### 2 — Chasing

**Step 2.1.** From the invoice row, `/invoices/[id]` shows a "Prepara un
sollecito" action, but only when `data.overdue` is true
(`invoices/[id]/+page.svelte:112`, computed by `isOverdue` in
`+page.server.ts:21`). For 2026/015 (due in 3 days) this link does not
render at all; typing the URL directly reaches `loadOverdueInvoice`
(`remind/+page.server.ts:23-33`), which throws `error(400,
m.mail_dunning_not_overdue())` — confirmed in code, and there is no
`+error.svelte` anywhere in the app, so this is a bare, chromeless `400`
(already flagged as review defect #20; re-verified here directly).

**Step 2.2.** For 2026/011 (actually overdue), `/invoices/[id]/remind`
loads. `loadOverdueInvoice` filters the contract's templates to
`trigger.kind === 'days_after_due'` only (`remind/+page.server.ts:29-31`).
Bellani's contract has none — confirmed against the running instance
(`invoice-remind.png`, `invoice-overdue.png`): the screen renders **"Questo
contratto non ha ancora un modello di sollecito"** with a single link,
"Nuovo modello", to `/mail/contracts/[id]/templates/new`. The single most
overdue invoice in the whole seed is, right now, un-chaseable through the
product's own reminder screen.

**Step 2.3. The trap in the detour.** Following that link lands on a
7-field form (`TemplateForm.svelte`: name, subject, body, attachment kinds,
trigger kind, trigger-days, trigger-days-after-due) with **`triggerKind`
defaulted to `'manual'`** (`templates/new/+page.svelte:15`). The radio group
presents four trigger kinds with no indication that only one —
`days_after_due` — will ever make the template reappear on the dunning
screen you just came from; the route carries no query parameter and the
form carries no contextual hint (confirmed: no `days_after_due` string
anywhere outside `TemplateForm.svelte`'s own radio value and the filter in
`remind/+page.server.ts`). A person who saves with the pre-checked default,
or with `on_issue` (equally plausible for "a template about this invoice"),
returns to `/remind` and sees the exact same "no template" screen with no
explanation of why the template they just built didn't count.

**Step 2.4.** Once a usable template exists: select it (defaults to the
first, `remind/+page.svelte:17`), confirm/edit recipients (pre-filled from
`client.contacts`, `remind/+page.server.ts:37-38`) — **2 fields**. Submit
`?/preview` — server re-validates, re-loads the invoice, rebuilds the
register for `[issueDate, dueDate]` (`dunning.ts:62-63`), and renders the
literal subject/body that would be sent, read-only. Submit `?/send` (a
second POST, replaying the same two fields as hidden inputs,
`remind/+page.svelte:96-97`) — dispatches for real. **2 clicks, 2 fields,
correct preview-before-send discipline** (`send.ts:1-6`) — this part of the
mechanism is sound.

**Step 2.5. What the reminder actually contains.** `buildDunningContext`
(`mail/dunning.ts:52-81`) renders against the contract's own
`templateLanguage` (never the operator's session locale — verified at
`render.ts:2-6`), with real figures: invoice number, total, due date, the
day list and day total for the billed period (from `buildRegister`, the
same register the invoice's own detail page reads), and `days_late`
computed fresh against "now" (`render.ts:62`, `daysLate` from
`domain/invoice.ts`) — never a stale number. This is genuinely well built:
**every placeholder is a live read of the real row**, no manual retyping.

**Step 2.6. What stops a duplicate reminder.** Nothing. `sent_email`
(`db/schema/email-template.ts:94-107`) is written on every dispatch
(`send.ts:82-95`) but keyed only by `contractId` and `emailTemplateId` —
**there is no `invoiceId` column at all.** Even if a screen wanted to show
"you already chased this", the schema cannot answer "which invoice was this
send about" for a contract that has billed more than one. And no screen
tries: `grep`ing the whole `src/routes` tree for `sentEmail` returns **zero
matches** — the table is written to and never read back anywhere in the
application. The dunning screen has no memory, structurally, of its own
past sends. The only thing preventing a second reminder going out the same
afternoon is Lorenzo's own memory.

### 3 — Recording a payment

**Step 3.1.** `invoices/[id]`'s "Pagamento" section is a collapsed
`<details>` (`invoices/[id]/+page.svelte:168-180`) — one field (`paidOn`,
defaulting to today), one submit. The action
(`invoices/[id]/+page.server.ts:34-41`) calls `recordPayment(invoiceId,
paidOn)` (`repositories/invoice.ts:205-212`), which updates **exactly one
column** — `invoice.paid_on` — and redirects back to the same page. No
amount field exists anywhere in this path.

**Step 3.2. What it does not update, on purpose.** The comment at
`invoice.ts:198-204` documents the choice explicitly: `work_unit` rows on
this invoice's lines are never bulk-transitioned; "paid" for a day is
derived at read time from its line's invoice, never stored — see step 4.2
for where that derivation goes wrong.

**Step 3.3. Does the person see the fiscal effect?** The ceiling basis is
`cash_received_calendar_year` (`fiscal/pack.ts:56-57`), read through
`sumLedger(rows, 'cash', ...)`, which sums by `paidOn`
(`fiscal/ledger.ts:72`) — so the moment this write commits, the dashboard's
ceiling card, on its **next load**, reflects it correctly; nothing here is
stale. But nothing on the payment-recording screen itself says so. The
"Segna come pagata" form is one date input and one button
(`invoices/[id]/+page.svelte:170-178`) — no "this will move you to X% of
your threshold" note, no link to the dashboard, no warning if the payment
would cross a ceiling. The person who most needs to know that recording
this payment matters fiscally — because they're close to a threshold — is
given no signal at the one moment they could still, in principle, react
(e.g. by delaying issuing further invoices this year).

### 4 — When a client disputes

**Step 4.1. There is no invoice-level dispute state.** I read the full
`invoice` table definition (`db/schema/invoice.ts:70-118`): id, contract,
number, dates, amounts, tax fields, payment method, IBAN, `paid_on`. No
`status`, `state`, or `disputed` column, and **no free-text `notes` column
either** — the table cannot record even an unstructured "client disputes
this, see email of 10 Aug" against an invoice. The word "disputed" in this
codebase names a `work_unit` (day) state, not an invoice property.

**Step 4.2. The day-level state exists in the schema and is dead in the
application.** The state machine
(`drizzle/0012_work_unit_state_machine.sql:63-77`) declares two real edges:
`invoiced → disputed` and `disputed → invoiced`. `register.ts:15` counts a
`disputed` day as billed; `work-unit.ts:217` keeps it eligible to be
re-invoiced; `DayStateBadge.svelte:54-57` and `work-unit-state.ts:40-41`
render a dedicated icon and label for it; `invoices/[id]/+page.svelte:33-34`
switches on it in the per-day status column. Every downstream consumer was
built as if this state is reachable. I grepped every caller of
`transitionWorkUnit` across the whole `src/` tree
(`repositories/invoice.ts` → sets `'invoiced'`; three `*.test.ts` files) —
**not one production code path ever writes `state: 'disputed'`.** There is
no route, no form, no button, anywhere in the product, that can put a day
into dispute, or bring it back out. The only way to reach this state today
is a raw SQL `UPDATE`, which is not a workflow a solo consultant has.

**Step 4.3. Even if it could be entered, the invoice screen would hide it.**
`invoices/[id]/+page.svelte:82`:

```
format: (d) => (invoice.paidOn ? m.invoice_day_status_paid() : dayStateLabel(d.state))
```

Once `invoice.paidOn` is set, **every day on that invoice displays "Paid",
unconditionally** — overriding whatever the day's real `state` column says,
including a hypothetical `disputed`. This is a genuine, independently
reachable bug in the making: `recordPayment` (step 3.2) never touches
`work_unit.state`, so a day that was disputed before the invoice was marked
paid stays `disputed` in the database and in its own transition log
forever — but the one screen built to show per-day billing status inside an
invoice would silently claim it was paid. (`day/[id]`'s own page reads
`workUnit.state` directly and is not affected — the masking is specific to
the invoice-detail column.)

**Step 4.4. What evidence exists, and how reachable it is.**

| Evidence                                                                                                                                | Exists?                                                                   | Reachable from a dispute conversation?                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The approval itself (sender, channel, received-at)                                                                                      | Yes, `approval` table                                                     | Yes — `day/[id]` shows sender + timestamp (`day/[id]/+page.svelte:74-81`)                                                                                                                                                                                                                                                                                                                       |
| The approval's **excerpt** — "the verbatim text the interpretation rests on" (`approval.ts:20-22`)                                      | Yes, stored on every approval at creation (`repositories/approval.ts:60`) | **No.** `getApproval` is read in exactly one place (`day/[id]/+page.server.ts:56-58`) and the returned object is narrowed to `{id, sender, receivedAt}` — `excerpt` is dropped. `buildRegister` (`register.ts:61-71`) selects `channel/sender/receivedAt/messageId` — also never `excerpt`. The one field the schema exists to hold as evidence is written once and never read back, anywhere.  |
| The archived original (`.eml`/PDF)                                                                                                      | Yes, `document` table, content-addressed                                  | **No.** `documents/[id]/+server.ts` exists, is auth-gated, and its own header comment says exactly this matters for a dispute (`+server.ts:12-14`) — but it is linked from nowhere. `day/[id]` shows the approval's sender/date, never a link to `getApprovalDocument`. Confirmed independently: `grep` for `documents/[id]` or `getApprovalDocument` across `src/routes` returns zero matches. |
| A clause interpretation note ("a later dispute is resolved by rereading a decision instead of re-guessing one", `clause-note.ts:13-14`) | Yes, `clause_note` table                                                  | Yes, on the contract detail page                                                                                                                                                                                                                                                                                                                                                                |
| A day-and-approval register, exportable                                                                                                 | Yes — `/mail/contracts/[id]/register`, PDF/CSV                            | Reachable, but three clicks deep under **Comunicazioni → a contract → register**, not linked from the invoice or the day it would defend                                                                                                                                                                                                                                                        |
| Anything on the invoice itself naming the dispute                                                                                       | No column exists                                                          | N/A                                                                                                                                                                                                                                                                                                                                                                                             |

**Step 4.5. Verdict on step 4.** The product's central promise — every
derived datum keeps its source document, agents propose and humans confirm
— is built correctly at the data layer (immutable approvals, content-hashed
documents, an append-only transition log with actor and reason on every
day). None of it is assembled into anything you could put in front of a
client. If Bellani disputed 2026/011 tomorrow, the honest answer is: there
is no button to press, no field to fill, and even the "print the evidence"
path (the register) omits the one field — the approval's own quoted text —
that the schema was built specifically to hold for this exact conversation.

### 5 — What the ledger can and cannot represent

**Partial payments: cannot be represented, at all.** `recordPayment`
writes a date, never an amount (`invoice.ts:205-212`); the form that calls
it has no amount field (`invoices/[id]/+page.svelte:170-178`). The moment
you tick "paid", `isOverdue` returns `false` forever (`domain/invoice.ts:51-57`)
and the row leaves every unpaid/ageing/owed surface — regardless of whether
the full €2,647.40 landed or only part of it. There is no remaining-balance
concept anywhere in the schema (`invoice.total` is fixed at issue time,
`invoice.taxable_amount`/`tax_amount`/`total` all carry `>= 0` CHECK
constraints, `invoice.ts:106-108`, so there isn't even room to store a
negative adjustment). **Plain verdict: if a client pays 1,000 of a 2,647.40
invoice, recording that payment as "paid" makes the remaining 1,647.40
invisible everywhere — the ageing table, the dashboard, the ceiling, all of
it — with no error, no warning, and no way back short of a raw SQL edit.**

**Credit notes: the type exists and using it corrupts the ledger.**
`invoiceDocumentType` includes `'credit_note'` (`db/schema/invoice.ts:26-33`)
and `/invoices/new` lets you pick it (`invoices/new/+page.svelte:14,27-29`).
But a credit note is stored as an ordinary `invoice` row with **no column
linking it back to the invoice it corrects** (no `correctsInvoiceId`, no
`relatedInvoiceId` — confirmed against the full table definition). Worse:
`fetchLedgerRows`, the single query every ceiling/certainty/forecast figure
in the product reads through (`fiscal/revenue.ts:30-52`), selects
`taxableAmount`/`socialCharge` off every `invoice` row **without ever
reading `documentType`** — a credit note's amount is _added_ to revenue
exactly like a real invoice, because the schema forces it to be
non-negative (same CHECK constraints as above) and nothing downstream
distinguishes it. **Plain verdict: issuing a credit note in this product
today would overstate revenue, overstate the flat-rate ceiling usage, and
overstate the concentration figure — the opposite of what a credit note is
for.** This is not a missing nicety; the document type is offered in a
dropdown and is actively dangerous to use.

**Write-offs: no representation.** No status, flag, or document type for
"I am not going to collect this." The only way to make an uncollectable
invoice stop appearing as owed is to record a payment that never happened —
which is a data-integrity lie, or to leave it aging forever, which pollutes
every ageing/owed figure indefinitely.

**Foreign currency: represented per-invoice, never netted.** `invoice.currency`
is a free ISO 4217 string (`db/schema/invoice.ts:81`) and every money
figure in the product — `MinorUnits`, the ageing list, the dashboard — is
computed and displayed **per currency, never converted** (`totalOutstandingByCurrency`
is literally `Record<string, MinorUnits>`, `+page.server.ts:16-22`). This
is the right call for a fiscal ledger (never invent an exchange rate) and
is applied consistently everywhere I checked. The only gap: if a second
currency ever appears, "how much am I owed, total" stops being one number
and nothing tells the reader that — the summary `<dl>` just grows a second
`<dd>` silently (`invoices/+page.svelte:60-66`).

### The weekly money questions, and where they're answered today

| Question a solo consultant asks weekly                         | Answered today                   | Where                                                                                                                                                                          |
| -------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| How much am I owed, in total?                                  | Yes                              | `/invoices` summary `<dl>`                                                                                                                                                     |
| Who owes me the most, and since when?                          | Partially, by hand               | `/invoices` table, unsorted by client — manual scan/tally                                                                                                                      |
| What's my exposure to one client if they don't pay?            | **Nowhere**                      | Dashboard's concentration card answers a different (cash-basis, tax) question — see step 1.5                                                                                   |
| Which invoice is most overdue?                                 | Yes                              | `/invoices`, sorted worst-first                                                                                                                                                |
| Have I already chased this one?                                | **Nowhere**                      | `sent_email` exists, has no `invoiceId`, and is never read by any route                                                                                                        |
| Am I close to my flat-rate ceiling this year?                  | Yes                              | Dashboard "Soglia" cards, correctly cash-basis                                                                                                                                 |
| Is one client over my concentration cap?                       | Yes, on a cash basis             | Dashboard "Concentrazione clienti"                                                                                                                                             |
| What's coming in over the next month?                          | Yes, on desktop                  | Dashboard cash calendar (chart-only below 640px — appendix 03)                                                                                                                 |
| Did invoice X get paid, and when?                              | Only if you already know its URL | `/invoices/[id]` — a paid invoice has no click path from anywhere once it leaves the unpaid list (independently confirmed: no nav, no client-page link, no contract-page link) |
| If this invoice gets disputed, what do I show the client?      | **Nowhere**                      | No invoice field, no day-dispute UI, evidence assembled nowhere (step 4)                                                                                                       |
| What if I collect this specific invoice before/after year-end? | **Nowhere in the UI**            | `sumLedger` supports this exact hypothetical (`ledger.ts:59-78`, tested at `ledger.test.ts:63-79`) but no route ever calls it with a hypothetical date                         |

**Totals for today's journey (owed invoice → paid, happy path):** 1 page for
"what's owed" (no per-client breakdown), up to 5 page loads to chase an
overdue invoice with an existing template (`/invoices` → `/invoices/[id]` →
`/remind` → preview → send) or **12+ if the template has to be built first**
(the same 3, plus a 7-field detour with a mistakable default, then back to
`/remind`), 1 field and 1 click to record a payment. **0 of the fields
involved are derivable that aren't already derived** — this journey's
problem is not field count, it's the three capabilities that don't exist
(per-client owed, chase memory, dispute path) and the one that actively
lies once you use it (credit notes).

## What is wrong

1. **BLOCKER [wrong model]** — Recording a payment has no amount field;
   `paidOn` is a boolean-shaped date that removes an invoice from every
   owed/overdue/ceiling surface the instant it's set, whether the full
   total arrived or not. A partial payment cannot be told apart from a full
   one anywhere in the product. (Step 5.)
2. **BLOCKER [wrong model]** — Credit notes are offered in
   `/invoices/new`'s document-type picker but are stored as ordinary
   positive-amount invoice rows with no link to what they correct. Every
   ledger figure — ceiling usage, concentration, revenue — treats a credit
   note as new revenue. Using the feature the UI offers actively corrupts
   the fiscal numbers the product exists to protect. (Step 5.)
3. **BLOCKER [missing]** — There is no dispute path. The day-level
   `disputed` state is fully wired into the register, the invoicing
   eligibility query, and two badge/label components, and has **zero**
   production write path. Nothing in the product can enter or exit it.
   (Step 4.2.)
4. **BLOCKER [missing]** — The one field the schema holds specifically as
   dispute evidence — an approval's verbatim `excerpt` — is written once at
   creation and read back nowhere in the application. Same for the archived
   original document: an auth-gated, working download endpoint exists and
   is linked from nothing. (Step 4.4.)
5. **MAJOR [missing]** — The dunning flow has no memory. `sent_email` has
   no `invoiceId` column and is never queried by any route. Nothing warns
   of, or even records against a specific invoice, a duplicate chase.
   (Step 2.6.)
6. **MAJOR [wrong model]** — Nothing on the product answers "what is my
   exposure to one client" — the dashboard's concentration card looks like
   an answer and is actually a different (cash-basis, tax-ceiling) question
   wearing the same UI. An overdue-but-unpaid invoice from a client near
   the cap is invisible to the one widget built to catch concentration
   risk, until it's paid — at which point the risk it was meant to flag has
   already been taken. (Step 1.5.)
7. **MAJOR [friction/wrong model]** — The chase-template detour
   (`templates/new`) defaults to a trigger kind (`manual`) that will never
   make the template usable from the screen that sent you there, with no
   hint anywhere in the form about which of the four choices is required.
   (Step 2.3.)
8. **MAJOR [missing]** — No per-client "who owes me" figure exists as a
   computed value anywhere — `listUnpaidInvoices` returns ungrouped rows
   and no caller groups them. (Step 1.3–1.4.)
9. **MINOR [friction]** — Recording a payment gives no feedback about its
   fiscal effect, even though the ceiling basis is cash and the write is
   exactly the kind of event that could cross a threshold. (Step 3.3.)
10. **MINOR [missing, already flagged]** — Re-verified directly: a
    non-overdue invoice's `/remind` renders a bare `400` (no
    `+error.svelte` anywhere in the app); a paid invoice has no click path
    from anywhere in the UI once it leaves the unpaid list. (Steps 2.1,
    "weekly questions" table.)

## What is missing entirely

- **A dispute lifecycle a human can actually operate.** Not just a button
  to flip `work_unit.state` to `disputed` (the state machine already
  supports the edge) — a screen that, given a disputed day or invoice, asks
  what happened, records who raised it and when, and offers a resolution
  path (`disputed → invoiced`, already legal) once it's settled.
- **A dispute evidence bundle.** One rendered artifact — PDF or a print
  view — that pulls the approval excerpt, the approval's archived original,
  any clause note that governs the disputed day's contract, and the
  register entry for that day, into one document a human can attach to a
  reply email. Every piece exists as data today; nothing assembles them.
- **A per-client owed/exposure figure.** `SUM(invoice.total) WHERE paid_on
IS NULL GROUP BY client`, exposed on the client list, the client detail
  page, and as a distinct card from the (correctly cash-basis) concentration
  widget — this is a business-risk number, not a tax number, and the
  product currently has no way to compute it at all.
- **A chase log keyed to the invoice it chased.** `sent_email` needs an
  `invoice_id` column (nullable, for the non-dunning sends) before "have I
  already chased this" can be answered by anything but memory.
- **A partial-payment ledger.** At minimum, an `amount` alongside `paid_on`
  — potentially multiple payment rows per invoice — so "2,647.40 owed,
  1,000 received" is a representable fact, not a lie you have to choose
  between telling.
- **A linked credit note.** A `corrects_invoice_id` (or equivalent) on
  `invoice`, and a ledger read that nets a linked credit note against its
  parent rather than adding it.
- **The hypothetical-collection tool already half-built.** `sumLedger`'s
  own design already supports "what if this lands on date X" — wire it to
  a one-field "if I collect this by ___" control on the invoice detail
  page, right where the ceiling context in finding 9 belongs anyway.

## The journey redesigned

**A. A single money surface.** Not the current `/invoices` (unpaid-only,
no grouping) plus dashboard (adjacent-but-different figures) plus nothing
on the client page. One screen, reachable from the sidebar (today "Fatture"
already exists as the natural home) with four numbers up top — **Owed**
(everything unpaid, today's total, the number `/invoices` already
computes), **Overdue** (the subset past due date, already computed by
`ageingStatus`), **Collected** (this year, cash-basis, already computed by
`collectedAmount` in `fiscal/certainty.ts` — reused, not reimplemented),
**At risk** (a new, explicit computation: overdue past 30 days AND either
no chase ever recorded against it, or the owing client is within one
alert-band of its concentration cap — both facts the engine already has,
just never combined) — each a link into a filtered table, and the existing
per-invoice table below it gains a **client subtotal row** (a client-name
`GROUP BY` on data already in hand) and a persistent client filter driven
by the same `clientLegalName` the rows already carry.
_Option 1 (S):_ recompose `/invoices` in place — add the three missing
totals and the client grouping, no new route, no schema change.
_Option 2 (M):_ promote it to a `/money` route that also absorbs the
dashboard's ceiling/concentration cards, so "money" stops being split
across two pages with two different bases silently disagreeing (finding 6).

**B. A chasing flow with memory.** Add `sent_email.invoice_id` (nullable —
manual/general sends still have none). `/invoices/[id]` gains a "Chased"
line: last sent date, template name, recipients — pulled from the same
table dunning already writes to, just finally read back. The
`/remind` screen shows that history above the compose form and requires an
explicit confirmation ("send again — already sent 3 days ago") rather than
silently allowing a duplicate. Separately, fix the template-trigger trap
(finding 7): when `/remind`'s empty state links to "Nuovo modello", pass
the intent along (a query param is enough) and have the new-template form
pre-select `days_after_due` and explain, next to the radio group, that this
is the one that will make it usable from where you came from.
_Effort: S_ — one nullable column, one query, one pre-selected default, no
new concepts.

**C. A dispute path that assembles the evidence.** From either the day
detail page (`day/[id]`, for a day still `invoiced`) or the invoice detail
page, a "Mark disputed" action calls the state machine's already-legal
`invoiced → disputed` edge (no migration needed — the edge exists today and
is simply unused) via a small form: who raised it, what they said, when.
That single action assembles the **evidence bundle** proposed above — a
print/PDF view containing:

1. The invoice's own figures (number, period, amount, due date — already
   on the invoice detail page).
2. The register entry for the disputed day(s): date, quantity, scope,
   approval channel and sender (`buildRegister` already returns this).
3. The approval's own **verbatim excerpt** (`approval.excerpt` — stored
   since day one, never surfaced until now) — the actual sentence the
   client is being held to.
4. A download link to the approval's archived original
   (`documents/[id]`, already auth-gated and working — just finally
   linked).
5. Any clause note on the governing contract whose `clause_reference`
   overlaps the disputed period, so an ambiguous-renewal or ambiguous-scope
   argument is answered with the interpretation already on record, not
   re-argued from scratch.
   A "Resolve" action on a disputed day exercises the equally-legal
   `disputed → invoiced` edge back, with its own reason, closing the loop the
   audit log already tracks.
   _Option 1 (S):_ the bundle as a server-rendered read-only page (same
   `RecordList`/`Section` components already used elsewhere) with a browser
   print stylesheet — no PDF library, reuses `LegalText`/`formatDate`.
   _Option 2 (M):_ a proper PDF (the register already has `renderRegisterPdf`
   to model the assembly off) attachable to a reply email through the
   existing `send.ts` pipeline.

## What it needs from elsewhere

- **Schema migrations** (new work, none of it destructive): `sent_email.invoice_id`
  (nullable uuid, FK to `invoice`); an `invoice.amount_paid`/a `payment`
  child table for partial payments; `invoice.corrects_invoice_id` (nullable
  uuid, self-referencing) for credit notes.
- **A per-client owed/exposure query**, the accrual-basis sibling of
  `fetchClientRevenueBreakdown` — same shape, `WHERE paid_on IS NULL`
  instead of reading `paid_on` as the summed date.
- **The "at risk" definition** needs one decision from the owner: is it
  purely age-based (overdue > N days), chase-based (no `sent_email` row
  against it), concentration-based (client near cap), or a combination —
  the redesign above assumes a combination but the exact threshold is a
  business call, not a technical one.
- **The evidence bundle's clause-note matching** ("any note whose reference
  overlaps the disputed period") needs a decision on whether that's a date
  range on `clause_note` (none exists today — it's currently just a
  reference string and two blocks of text) or a manual pick at
  dispute-creation time; the former is more useful but is new schema.
- Both B and C are additive (new column, new action, new route) and can
  ship independently of Decision A/B in the main review — they don't touch
  visual direction at all, only capability.
