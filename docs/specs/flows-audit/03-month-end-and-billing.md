# Month-end and billing: turning worked days into an invoice a client will pay

## The job

Once a month (or whenever a contract's billing cadence says so), for each active
contract the consultant asks one question: _what happened here that I haven't
been paid for yet, and can I prove it?_ "Done" means an invoice exists whose
figures would survive an audit — quantities that match approved days, prices
that match the rate card that was actually in force, tax treatment that
matches the regime he is actually registered under — the client has received
it by email with the register that justifies it attached, its due date is
now tracked by the ageing/dunning machinery, and next month's version of the
same ritual costs less than this month's did. For a retainer client (Fermata
Digitale, €1.800/mese, no days at all) the job is even simpler in principle:
there is nothing to reconcile, only a number to repeat.

## Today, step by step

Evidence below is read from the real routes and repositories, cross-checked
against the running seed (`postgres://mastro:mastro@localhost:5436/mastro`)
and, where noted, verified by direct queries against it.

1. **Navigate to `/invoices/new`.** Blank page, one `<select>` of every
   contract (`routes/invoices/new/+page.svelte:77-94`), no days, no money, no
   indication of which contracts even have anything to bill.
2. **Pick a contract, submit the `GET` form ("Carica giornate").** Full page
   reload to `?contractId=…`. `load` calls
   `listEligibleWorkUnitsForInvoicing(contractId)`
   (`repositories/work-unit.ts:207-222`) — `worked`/`disputed` days with no
   `invoiceLineId` yet, correctly excluding a day still stuck in
   `worked_without_approval`. The creation form now renders: **13
   document-level inputs** (`repositories/invoice-form.ts:19-35`:
   `number`, `issueDate`, `documentType`, `currency`, `dueDate`,
   `taxTreatmentCode`, `statutoryReferenceLanguage`, `statutoryReferenceText`,
   `stampDuty`, `socialCharge`, `paymentMethod`, `iban`, `transmissionId`)
   plus **6 hardcoded blank line rows × 6 fields = 36 more inputs**
   (`routes/invoices/new/+page.svelte:40-51,202-265` — the array is always
   `[emptyLine ×6]`; there is no "add a line" button, so a one-line invoice
   still renders 5 unused blocks to scroll past).
3. **Reconcile by hand, outside this screen, in two other places.** A day
   worked without approval this month is invisible here by design (correctly
   excluded from the query) but nothing on this page says so — the person
   has to already know to check the calendar/alerts first. An expense to
   rebill (`repositories/expense.ts:24-29`, `listExpensesForContract`) is
   only visible on `/clients/[id]/contracts/[id]`, a page this form never
   links to or from.
4. **Per line: tick which days it bills, then type four numbers that could
   all have been derived from the ticks.** Checkboxes exist
   (`lineDays_{i}`, `routes/invoices/new/+page.svelte:249-259`) and are
   genuinely well designed — but `quantity`, `unitPrice`, `amount` and
   `taxRate` (`repositories/invoice-form.ts:108-163`) are typed by hand with
   **zero** connection to the ticks, to each other, or to
   `domain/rate-card.ts`'s `resolveRateCard`/`priceRateCard` — the exact
   functions `import/day-mapping.ts` already calls to auto-price an
   _imported_ invoice's lines. Grepping the whole repo confirms
   `resolveRateCard`/`priceWorkUnitOnDate` are never imported by
   `invoice-form.ts`, `invoice.ts`, or anything under `routes/invoices/`.
5. **Type the fiscal fields by hand.** `taxTreatmentCode`,
   `statutoryReferenceLanguage`, `statutoryReferenceText`, `stampDuty`,
   `socialCharge` — all five exist as verbatim data in the active pack
   (`fiscal/packs/it-flat-rate.ts`) and are read from it nowhere in this
   file. See "The fiscal shape" below for the live proof this is not
   theoretical.
6. **Type payment method and IBAN by hand.** There is no settings/profile
   table anywhere in `db/schema/*.ts` to hold a default — every invoice,
   forever, retypes the same string from memory or a copy-paste source
   outside the app.
7. **Submit.** `createInvoice` (`repositories/invoice.ts:72-150`) sums the
   typed line amounts into `taxableAmount`/`taxAmount`/`total`, resolves
   `dueDate` from the contract's payment terms if left blank
   (`resolveDueDate`, `domain/invoice.ts:19-27`), links every ticked day to
   the new `invoice_line` and flips it to `invoiced`. This step is careful —
   the arithmetic from _typed lines_ to _invoice total_ is correct and
   tested. Nothing upstream of it is.
8. **Redirect to `/invoices/[id]`.** If an expense needs rebilling, that is
   a second trip: navigate to `/clients/[id]/contracts/[id]`, find the
   expense, pick the invoice line just created from a dropdown
   (`listInvoiceLinesForContract`), submit a second, unrelated form
   (`rebillExpense`, `repositories/expense.ts:135-142`, which by its own
   constraint can only target a line that already exists — an expense can
   never be included at invoice-creation time, only bolted on after).
9. **Navigate to `/mail`**, then the contract, then the template's send
   screen (`/mail/contracts/[id]/templates/[templateId]/send`). Nothing on
   `/invoices/[id]` links here — the only action on that page is "remind,"
   for an overdue invoice; sending the fresh one is not offered anywhere.
10. **Retype invoice number, amount, due date, and the billing period's
    `from`/`to`.** `mail-send-form.ts:8-25` — the exact figures the invoice
    just created already carries, in `invoice.number`/`total`/`dueDate`.
    The on-screen hint even says why, in both languages
    (`messages/{en,it}.json:609`): _"Numero fattura, importo e scadenza si
    inseriscono a mano finché non esiste la tabella invoice di #26 da cui
    leggerli"_ — confirmed live at
    `/mail/contracts/[id]/templates/[id]/send` (screenshot
    `mail-template-send.png`). `#26`'s invoice table has existed since the
    same wave — `render.ts`'s own header comment says `amount`/`dueDate`
    come from "the persisted invoice row (#26)" — but the send form was
    never rewired to read it.
11. **Submit `?/preview`** (page reload, renders subject/body + attachment
    sizes — `+page.server.ts:29-63`), review, **submit `?/send`** (page
    reload, dispatches over SMTP — `mail/send.ts`).

No form in this entire path uses `use:enhance` (confirmed by grep — only
`alerts` and `day/new` do), so every submit above is a genuine full-page
round trip, not a client-side transition.

**Totals: 4 distinct routes, 9–11 full page loads (9 without a rebilled
expense, 11 with one), 55 rendered `<input>`/`<select>` elements across the
two forms (49 on invoice creation + 6 on send), of which 14 are the money/tax
figures tabulated below — 11 of the 14 (79%) the product already has the
data to fill in and fills in none of them.**

### Every figure the invoice form asks for

All 14 money/tax figures across the two forms, with what actually already
exists in the codebase to fill them in. "Yes" means a call site exists today
that could supply the value without asking; the invoice-creation code simply
never calls it.

| Figure                                                   | Typed where                                                                    | Product already knows it?                                                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invoice number                                           | `invoice-form.ts` `number`                                                     | **Partially** — no global next-number counter exists, but the constraint that should stop a collision doesn't (see BLOCKER below); nothing suggests a value                                                                             |
| Currency                                                 | `invoice-form.ts` `currency`                                                   | **Yes** — `contract.currency`; pre-filled into the input's default value but re-submitted as free text, not read-only                                                                                                                   |
| Due date                                                 | `invoice-form.ts` `dueDate`                                                    | **Yes** — `resolveDueDate`/`computeDueDate` already derive it from `contract.paymentTerms` when left blank (`domain/invoice.ts:19-27`) — the one field in the whole form that is genuinely optional today                               |
| Line quantity                                            | `invoice-form.ts` `lineQuantity_{i}`                                           | **Yes** — equals the count/sum of that same line's ticked `lineDays_{i}` checkboxes, already present on the same screen                                                                                                                 |
| Line unit price                                          | `invoice-form.ts` `lineUnitPrice_{i}`                                          | **Yes** — `resolveRateCard` + `priceRateCard`/`priceWorkUnitOnDate` (`domain/rate-card.ts`, `domain/work-unit-pricing.ts`), already used by `import/day-mapping.ts` for the exact same computation on an imported invoice               |
| Line amount                                              | `invoice-form.ts` `lineAmount_{i}`                                             | **Yes** — quantity × unit price, or the sum of `priceWorkUnitOnDate` per ticked day; `createInvoice` trusts whatever is typed with no cross-check either way                                                                            |
| Line tax rate                                            | `invoice-form.ts` `lineTaxRate_{i}`                                            | **Yes, for the active pack** — `it-flat-rate`'s one treatment is 0% (VAT-exempt, `N2.2`); the seed's real invoices show 22% was typed instead, undetected                                                                               |
| Tax treatment code (doc + line)                          | `invoice-form.ts` `taxTreatmentCode` / `lineTaxTreatmentCode_{i}`              | **Yes** — `itFlatRatePack.treatments[0].code === 'N2.2'`, the pack's only treatment                                                                                                                                                     |
| Statutory reference language                             | `invoice-form.ts` `statutoryReferenceLanguage`                                 | **Yes** — `itFlatRatePack.treatments[0].legalText.language === 'it'`                                                                                                                                                                    |
| Statutory reference text                                 | `invoice-form.ts` `statutoryReferenceText`                                     | **Yes** — `itFlatRatePack.treatments[0].legalText.text`, the exact verbatim citation the law requires                                                                                                                                   |
| Stamp duty                                               | `invoice-form.ts` `stampDuty`                                                  | **Yes** — `evaluateCharges(pack, { invoiceTotal })` returns the fixed €2.00 once the total exceeds €77.47                                                                                                                               |
| Social charge                                            | `invoice-form.ts` `socialCharge`                                               | **Yes** — `evaluateCharges` returns 4% of `invoiceTotal`                                                                                                                                                                                |
| Payment method                                           | `invoice-form.ts` `paymentMethod`                                              | **No** — no settings/profile entity stores a default anywhere in the schema; a genuine missing capability, not just a wiring gap                                                                                                        |
| IBAN                                                     | `invoice-form.ts` `iban`                                                       | **No** — same: nowhere for it to live centrally                                                                                                                                                                                         |
| Invoice number, amount, due date, period (retyped again) | `mail-send-form.ts` `invoiceNumber`/`amount`/`dueDate`/`periodFrom`/`periodTo` | **Yes, all of them** — verbatim off the `invoice` row and `buildRegister`'s own `from`/`to` created two screens earlier; the send form's own on-screen copy still says the invoice table "does not exist" (it has, since the same wave) |

## What is wrong

**BLOCKER — [wrong model] The active fiscal pack is never consulted when
creating an invoice, and the seed proves the cost of that.** The running
instance's `fiscal_profile` is `it-flat-rate` v1, effective `2026-01-01`
(verified: `select * from fiscal_profile` → `pack_id = 'it-flat-rate'`). That
pack's one tax treatment is VAT-exempt (`N2.2`, `art. 1, comma 58, legge
190/2014`). Yet all three real invoices in the seed
(`select tax_treatment_code, ... from invoice`) charge **22% standard VAT**
with `tax_treatment_code = null` — the wrong regime, on every invoice ever
issued in this instance, undetected, because nothing in
`invoice-form.ts`/`createInvoice` ever imports `fiscal/pack.ts` or
`fiscal/registry.ts`. `evaluateCharges` (`fiscal/pack.ts:297-306`), which
would also compute the 4% INPS surcharge and the €2 virtual stamp duty
above €77.47, is likewise never called from anywhere near an invoice. This
is not a hypothetical edge case; it is what actually happened.

**BLOCKER — [wrong model] Invoice-number uniqueness doesn't enforce what its
own comment says it does.** `invoice.ts:104-105`: `unique
('invoice_contract_number_unique').on(table.contractId, table.number)`,
commented _"Invoice numbers are unique per issuer's own series, not
globally."_ There is one issuer (this is single-tenant). The constraint is
scoped per **contract**, not per issuer, so the same number can legally be
issued to two different clients. Verified live: inserting `2026/999-TEST`
for both the Bellani and the Fermata contract in the same transaction
**succeeded** — both rows exist simultaneously — until rolled back on
purpose. A duplicated or gapped numbering series is a real fiscal defect
for most single-series regimes; the form's duplicate check
(`invoice_validation_number_duplicate`, `+page.server.ts:37-42`) only ever
fires within one contract and would never catch this.

**BLOCKER — [missing] Rate-card pricing exists and is wired everywhere
except the one screen that creates a manual invoice.** `resolveRateCard` +
`priceRateCard`/`priceWorkUnitOnDate` are fully built, tested, and already
used by `import/day-mapping.ts` (to auto-propose an _imported_ invoice's day
mapping) and `fiscal/forecast.ts` (to project future revenue). The one place
a human actually creates most invoices — `/invoices/new` — imports none of
it. The gap is not a missing capability in the codebase; it is a missing
`import` statement in one file.

**MAJOR — [friction] Rebilling an expense is a second visit to a second
page, and can only happen after the invoice exists.** `rebillExpense`
requires an existing `invoiceLineId` (`expense.ts:128-134`, enforced by the
DB constraint `expense_forbid_rebill_twice`). There is no way to select
"also bill this expense" while creating the invoice; it is bolted on
afterward from the contract page, one expense and one form submission at a
time.

**MAJOR — [wrong model] The invoice total is arithmetically self-consistent
and factually unverified.** `createInvoice` sums whatever `amount` each line
was typed as; the DB checks non-negativity and range
(`invoice_line_quantity_positive`, `..._tax_rate_range`, etc.,
`invoice.ts:146-149`) but nothing checks `amount ≈ quantity × unitPrice`
(the schema comment at `invoice.ts:120-129` explains this is deliberate, to
allow rounding/discounts — a legitimate reason, but it also means a
fat-fingered 10× typo in `unitPrice` sails straight through), and nothing
checks either figure against what the ticked days' rate card actually says
they are worth.

**MAJOR — [missing] Nothing generates the invoice as a document.** The day
register has both a PDF and a CSV renderer (`register/pdf.ts`,
`register/csv.ts`) and can be attached to an outbound email automatically
(`EMAIL_ATTACHMENT_KINDS = ['day_register_pdf', 'day_register_csv']`,
`mail/attachments.ts:24-54`). There is no equivalent for the invoice itself
— `invoice_pdf` is a name that appears only in tests asserting it is
_rejected_ as an unknown attachment kind
(`email-template-form.test.ts:123`, `email-template.test.ts:107-109`). A
client who receives the send-screen's email gets a register and a typed
number, never a document that looks like an invoice.

**MAJOR — [missing] No link, either direction, between an invoice and
sending it.** `/invoices/[id]` offers exactly one action — "remind" — for
an overdue invoice. There is no "send this" action on a fresh invoice, and
the send screen has no "load this invoice" affordance. The two halves of
one job live in unconnected parts of the sidebar (Fatture vs.
Comunicazioni).

**MINOR — [friction] Amount fields on both screens reject the format the
app itself prints.** `decimalStringToMinorUnits`'s `DECIMAL` regex
(`import/decimal.ts:12`) requires a literal `.`; every displayed amount in
the app uses `,` (`700,00 €`). This is the main UX review's defect #6,
reproduced here because it directly compounds every hand-typed money field
in this journey (`lineUnitPrice`, `lineAmount`, `stampDuty`,
`socialCharge`, the send screen's `amount`) — not a new finding, just
double taxation on top of everything above.

## What is missing entirely

- **A billing/practitioner profile.** IBAN, default payment method, and a
  single global invoice-number series belong to the person, not to any one
  invoice. Today there is nowhere in the schema for them to live, so they
  are retyped identically, forever, invoice after invoice — for a solo
  consultant this is pure waste with no upside.
- **A "ready to bill" view.** Nothing in the product answers "which
  contracts have something to invoice right now" without opening each
  contract's `/invoices/new?contractId=…` one at a time and checking. For
  three contracts that is tolerable; the promise is a 30-second-a-day
  product, and month-end is exactly the moment that promise is tested
  hardest.
- **Recurring/fixed-fee billing as a first-class concept.** `fixed_recurring`
  rate cards and `recurringFeeOccurrences` compute exactly what a retainer
  invoice should say, and are used only for revenue _forecasting_
  (`fiscal/forecast.ts`). Nothing turns an occurrence into an invoice. See
  the dedicated proposal below.
- **An invoice document.** No PDF, no FatturaPA XML, nothing that could be
  handed to an accountant or a client as "the invoice" rather than "an email
  that mentions a number."
- **Cross-checks tying an invoice back to the days and the pack it should
  agree with.** No warning when a typed tax rate contradicts the active
  fiscal profile's own treatment; no warning when a typed amount disagrees
  with the rate card in force for the days ticked.

## The journey redesigned

**Target shape: pick a contract → review a pre-computed invoice → confirm →
review a pre-composed email → send.** Every figure that today gets typed
starts pre-filled from data the product already owns; typing survives only
where a human judgment call genuinely belongs (excluding a day, overriding a
description, choosing recipients).

### Step by step

1. **A "Ready to bill" list** (new: could live at `/invoices/new` itself, or
   as a Money-area dashboard card) — one row per contract with something
   unbilled: eligible days grouped by month with their rate-card total
   already summed (`listEligibleWorkUnitsForInvoicing` +
   `priceWorkUnitOnDate`, both already exist), un-rebilled expenses counted
   in, and (new) the next unbilled `fixed_recurring` occurrence for a
   retainer. **0 fields, 1 page load.**
2. **"Create invoice" on one row** opens a review screen, not a blank form.
   Pre-filled: `number` (next in a genuinely global series — see below),
   `issueDate` (today), `documentType` (`invoice`), `currency` (read-only,
   from the contract), one line per rate card in force with `quantity`
   (= sum of the pre-ticked days), `unitPrice` and `amount` (from
   `resolveRateCard`/`priceRateCard`), `taxRate`/`taxTreatmentCode`/
   `statutoryReference*`/`stampDuty`/`socialCharge` (from
   `evaluateCharges` + the pack's own `treatments[]`), `dueDate` (from
   `resolveDueDate`), `paymentMethod`/`iban` (from the new billing profile,
   see below). Un-rebilled expenses appear as a pre-checked list on the
   same screen, each rebilling onto this invoice's line at creation time
   instead of a second visit. **1 page load; typically 0 fields actually
   touched — every input is editable, none is required to be typed.**
3. **Confirm.** One submit creates the invoice, rebills the checked
   expenses, and (contract-level toggle, mirroring `autoSendMail` that
   already exists on `contract`) either queues the composed email
   immediately or lands on a send-preview populated entirely from the row
   just created. **1 page load, 1 decision.**
4. **Send-preview (only when not auto-sent).** `invoiceNumber`, `amount`,
   `dueDate`, `period` read straight off the new `invoice` row and
   `buildRegister` — exactly what `render.ts`'s placeholders already expect,
   just wired to the real table instead of a hand-typed stand-in. The only
   remaining inputs are recipients (defaulted from the client's contacts,
   already the case today) and which template. Preview, send. **2 page
   loads, 0 figures typed.**

### New totals

**3–4 page loads (2 with auto-send), 0 money/tax fields typed from memory,
2 real decisions (which exceptions to make, who to email) — down from
9–11 page loads and 14 hand-typed figures today.**

### Where the choice is genuinely open

| Option                                                                                                                                                                                                                                                                                                           | What it does                                                                                                                                                                                                                                          | Effort |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **A. Pre-fill only** — keep today's two screens (`/invoices/new`, the send screen) exactly where they are, but populate every field listed above from the rate card, the pack, and the persisted invoice instead of leaving them blank; add the missing invoice→send link.                                       | Fastest path to removing the retyping and the fiscal blind spot without touching the IA. No new table, no new screen — just new default values and one repository call each in `invoice-form.ts`'s server load and `mail-send-form.ts`'s replacement. | **S**  |
| **B. "Ready to bill" list + review-and-confirm** — the full redesign above, still one invoice at a time, still fully human-confirmed per invariant 3.                                                                                                                                                            | Needs the new aggregation query (days + expenses + recurring occurrences per contract) and the review-screen rework, plus the billing-profile table.                                                                                                  | **M**  |
| **C. Scheduled recurring templates** — persist a `recurring_invoice_schedule` per `fixed_recurring` rate card (mirrors `email_template`'s own trigger model) that surfaces in the alert engine each period exactly like a worked-without-approval day does today, one click to confirm-and-optionally-auto-send. | Genuinely automates the retainer case end to end; needs a new table and a new alert kind, but no new worker process (none exists today, and none is required — surfacing is enough per invariant 3).                                                  | **L**  |

**Recommendation: B first (it fixes the day-rate contracts, which are the
majority of the money), then C once B has been used for a month and the
"next occurrence" bookkeeping it needs (see below) has proven itself for
Fermata.**

### The recurring-invoice proposal for the retainer archetype (Fermata Digitale, €1.800/mese, no days)

Today Fermata gets nothing: `listEligibleWorkUnitsForInvoicing` only ever
returns `work_unit` rows, and Fermata has none by design
(`invoice_form_no_eligible_days` fires every single month). The person
retypes `quantity=1`, `unitPrice=1800.00`, `amount=1800.00` from memory,
twelve times a year, forever — verified against the one real Fermata
invoice in the seed (`2026/015`: `quantity 1.00`, `unit_price 180000`,
matching the card's `amount` only because the person did the arithmetic
correctly, not because the product did).

**Concrete mechanism, no new worker process required (none exists today —
`email-template.ts`'s own comment confirms it, and invariant 3 does not
need one):**

1. **Compute "next unbilled occurrence" from what already exists.** For a
   `fixed_recurring` rate card, call the existing
   `recurringFeeOccurrences(card, card.validFrom, today)`
   (`domain/recurring-fee.ts:55-84`) and drop every occurrence whose date
   is `<=` the `issueDate` of the contract's most recent invoice (a single
   `max(issue_date)` query — no schema change needed for this half). What's
   left is exactly the occurrences due and not yet invoiced, in order —
   the same "here is what's outstanding, oldest first" shape
   `listEligibleWorkUnitsForInvoicing` already gives day-rate contracts.
2. **Surface it on the "Ready to bill" list from option B** as its own row
   kind: _"Fermata Digitale — retainer agosto 2026 — €1.800,00 — pronta"_ —
   no days to tick, no rate to compute, one line pre-filled from
   `priceRateCard(card)`, same review-and-confirm screen as a day-rate
   invoice. This is the _simplest_ case once the aggregation exists, not a
   special one.
3. **Flag a gap, don't silently skip it.** If more than one unbilled
   occurrence exists (a month was missed), list all of them rather than
   only the newest — the same "don't let a gap disappear" discipline the
   product already applies to `worked_without_approval` days.
4. **Optional escalation (effort L, option C above):** once occurrences are
   tracked this way, a scheduled trigger becomes a small addition — a
   `recurring_invoice_schedule` row per card with the same `on_issue`/
   `days_before_due`-shaped trigger `email_template` already models, feeding
   the same alert-engine surface every other "needs you" item uses, with
   `contract.autoSendMail` (already a column) deciding whether confirming
   also sends automatically.

This turns Fermata's monthly ritual from "retype three numbers you memorized
and hope they're still right" into "confirm the number the product already
computed" — with the audit trail (which occurrence, which card, which
invoice) intact throughout.

## What it needs from elsewhere

- **A billing/practitioner-profile entity** (new table): default `iban`,
  `paymentMethod`, and the seed for a single global invoice-number series —
  none of this exists in the schema today, and the redesign's pre-filled
  `iban`/`paymentMethod`/`number` in step 2 depend on it.
- **A genuinely global invoice-number sequence**, replacing or
  supplementing today's per-contract `unique(contractId, number)` — needed
  both to fix the duplicate-number defect and to offer a "next number"
  default.
- **`resolveRateCard`/`priceRateCard`/`priceWorkUnitOnDate`** (exist,
  `domain/rate-card.ts`, `domain/work-unit-pricing.ts`) — reused as-is, just
  imported into the invoice-creation path for the first time.
- **`evaluateCharges` + `FiscalPack.treatments`** (exist, `fiscal/pack.ts`,
  `fiscal/packs/it-flat-rate.ts`) plus a way to read the _currently active_
  pack for "today" (`fiscal/profile.ts`'s `resolvePackAt`, already used by
  the ceiling engine) — reused as-is.
- **`recurringFeeOccurrences`** (exists, `domain/recurring-fee.ts`) — reused
  as-is; only the "which occurrences are still unbilled" bookkeeping is new.
- **An invoice PDF/document renderer**, mirroring `register/pdf.ts`'s
  existing shape, and a new `invoice_pdf` `EmailAttachmentKind` to go with
  it — the one piece with no existing analogue to lean on.
- **A "ready to bill" aggregation query** spanning `work_unit`, `expense`
  and the new recurring-occurrence bookkeeping, per contract — the one
  genuinely new read path the whole redesign depends on.
