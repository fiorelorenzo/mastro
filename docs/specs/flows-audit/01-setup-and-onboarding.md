# Setup & onboarding: from an empty instance to a first billable day

This is a journey audit, not a screen audit — the main review
(`docs/specs/2026-08-13-ux-ui-review.md`) and appendix 05
(`docs/specs/ux-review/05-clients-and-contracts.md`) already did the
screen-by-screen pass on `clients/new`, `contracts/new` and
`rate-cards/new`; this document does not repeat their per-field styling
findings and cites them by number instead of re-deriving them. What follows
is the code path an owner actually walks, end to end, from an instance with
no rows in it to a contract that can legally accept a recorded day — which
is the thing the owner named directly: _"registrare un cliente mi sembrava
molto brutto."_

## The job

A self-hoster who just deployed `mastro`, or an existing user who just
signed a new client, needs to go from "I have a signed contract PDF and a
client's details" to "I can record today as a billable day against this
client" — reliably, in one sitting, without leaving the product to consult
notes about what they typed three screens ago. This happens rarely per
client (a handful of times a year at most) but it is the one journey every
other promise in the product depends on: no day can be worked without
approval, no ceiling can be watched, and no invoice can be raised for a
client that was never fully registered. "Done" means: a `client` row with
enough contact and address data to send a legal notice, a `contract` row
with `status = 'active'`, and a `rate_card` row whose validity period
covers today — the three preconditions `day/new`'s own loader checks
before it will let a human record anything (`src/routes/day/new/
+page.server.ts:17-27`, `20-27`: only `active` contracts are listed; a day
against a contract with no rate card in force prices as `null`, i.e.
unbillable — see `src/lib/server/domain/work-unit-pricing.ts:20-23`).

## Today, step by step

### Step 0 — everything outside the product, before sign-in even works

None of this has an in-product screen. It has to happen before the first
journey below can start at all:

1. **Generate `BETTER_AUTH_SECRET`** (`openssl rand -base64 32`) and set
   `BETTER_AUTH_URL` — `.env.example:37-43`.
2. **Create a Google Cloud OAuth client** by hand in an external console:
   a project, an OAuth consent screen left in "Testing" status, a Web
   application client, one exact redirect URI
   (`docs/self-hosting.md` section 1, steps 1–5). Nothing in `mastro`
   automates or even links to this.
3. **Set `AUTH_ALLOWED_EMAILS`.** Unset or empty admits nobody, not
   everybody (`docs/self-hosting.md` section 2) — the instance is
   provably unusable until this is set correctly, by design.
4. **Set `ACCOUNT_HOLDER_TAX_ID`** — the practice's own tax id, read as a
   plain string, thrown on if unset the moment anything touches import
   (`src/lib/server/import/config.ts:16-24`). Not needed to sign in or
   record a day, but silently required the first time `/import` is
   opened.
5. **Insert a `fiscal_profile` row directly with SQL.** `settings/
+page.svelte:28` says this outright: _"Configured directly in the
   database; there is no interface for this yet."_ There is no seed
   script, no CLI, no admin form — a self-hoster has to open `psql`,
   read `src/lib/server/fiscal/registry.ts:37-41` to learn which three
   pack ids exist (`generic@1`, `it-flat-rate@…`, `it-standard@…`), and
   hand-write `INSERT INTO fiscal_profile (pack_id, pack_version,
valid_from, overrides) VALUES (...)` against the exact shape in
   `src/lib/server/db/schema/fiscal.ts:35-52`. Getting this wrong or
   skipping it does not block client/contract/rate-card/day creation —
   `currency` defaults to a hardcoded `'EUR'`, not a pack figure — but it
   silently turns off every ceiling ("no ceiling crossed blind," the
   product's own second invariant) and makes `/import` refuse to run at
   all (`import_no_active_pack`, `src/routes/import/analyze/
+server.ts:58-61`, a 422).
6. _(Optional, but documented)_ SMTP/IMAP app-password mail credentials
   (`docs/self-hosting.md` section 4) — not required for this journey,
   listed here because a self-hoster reading `.env.example` top to bottom
   has to decide about it before step 5 even though it's unrelated.
7. _(Optional)_ The ACP runner: a second database role, a durable queue
   directory, and an ACP-speaking CLI subprocess configured entirely
   through three environment variables (`docs/agent-runner.md`,
   `.env.example:132-169`). Also unrelated to this journey but presented
   alongside it in the same file.

None of steps 1–5 is discoverable from inside the running application.
Step 5 in particular is the one the product's own settings page admits is
missing, and it is on the critical path for the product's central
ceiling promise, not an edge case.

### Step 1 — first sign-in, empty instance

The dashboard loader (`src/routes/+page.server.ts:68-228`) runs seven
queries unconditionally against `evaluateActiveCeilings`,
`forecastRevenueByMonth`, `listContractsWithClient`,
`fetchClientRevenueBreakdown`, `listClients`,
`forecastRenewalAssumptions`, `listProposals('pending')`. Every one of
these degrades to an empty array or `null` rather than throwing
(`evaluateActiveCeilings` explicitly handles a `null` resolved pack at
`src/lib/server/fiscal/ceiling-status.ts:36-44`), so the empty-instance
dashboard does not crash — it just renders three widgets with nothing in
them and no explanation of why (`docs/specs/ux-review/
03-dashboard-and-ceilings.md` covers that screen's own defects; not
repeated here). There is no "add your first client" prompt, no checklist,
no state that recognises "this instance has zero of everything" as
different from "this instance has data but nothing due today." A grep for
`onboarding`, `wizard`, `getting started`, `first-run` across
`src/routes` and `src/lib/components`/`src/lib/layout` returns nothing.
The only way forward is to already know the URL `/clients/new` — reachable
by clicking "Clients" in the sidebar (`src/lib/nav/items.ts:28`, which
points at the list, not the create form) and then the page's own "Nuovo
cliente" text link.

### Step 2 — register a client (`/clients/new`)

| #     | Field                                                                                   | Group          | Required?                                                                                                | Client-side default                 | Derivable?                                                                                                                                                                                                                |
| ----- | --------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `legalName`                                                                             | Legal identity | Yes                                                                                                      | —                                   | No                                                                                                                                                                                                                        |
| 2     | `taxId`                                                                                 | Legal identity | Yes                                                                                                      | —                                   | No                                                                                                                                                                                                                        |
| 3     | `vatId`                                                                                 | Legal identity | No                                                                                                       | —                                   | No                                                                                                                                                                                                                        |
| 4     | `country` (free text, "Paese (ISO alpha-2)")                                            | Legal identity | Yes, `/^[A-Z]{2}$/`                                                                                      | —                                   | **Partially** — a single consultancy's clients are overwhelmingly in the practice's own country; the practice's country is already known from `ACCOUNT_HOLDER_TAX_ID`'s own prefix (step 0.4) and is never reused here    |
| 5     | `addressLine1`                                                                          | Address        | Yes                                                                                                      | —                                   | No                                                                                                                                                                                                                        |
| 6     | `addressLine2`                                                                          | Address        | No                                                                                                       | —                                   | No                                                                                                                                                                                                                        |
| 7     | `addressCity`                                                                           | Address        | Yes                                                                                                      | —                                   | **Partially** — derivable from postal code for a known country, no lookup table exists                                                                                                                                    |
| 8     | `addressPostalCode`                                                                     | Address        | Yes                                                                                                      | —                                   | No                                                                                                                                                                                                                        |
| 9     | `addressRegion`                                                                         | Address        | No                                                                                                       | —                                   | **Partially** — same as city, from postal code                                                                                                                                                                            |
| 10    | `noticeChannel`                                                                         | Communications | Yes (placeholder is a disabled blank option)                                                             | none shown                          | **Yes** — `email` is the only value used by all three seeded clients, and is literally the default `buildClientContractProposal` already picks for an import-derived client (`src/lib/server/import/client-match.ts:171`) |
| 11–30 | 4 × (`contactName`, `contactEmail`, `contactPhone`, `contactRole`, `contactCanApprove`) | Contacts       | name+email required only for a touched row; a row with neither is silently dropped (`client-form.ts:68`) | 4 fully blank cards always rendered | No — but 3 of the 4 pre-rendered cards are pure rendering cost in the common one-contact case; all three seeded clients render this exact way (appendix 05, finding 4)                                                    |
| 31    | `contactCount` (hidden)                                                                 | —              | plumbing                                                                                                 | —                                   | n/a                                                                                                                                                                                                                       |

Source: `src/routes/clients/ClientForm.svelte:37-159`,
`src/lib/server/repositories/client-form.ts:29-113`.

Walkthrough:

1. **GET `/clients/new`.** 31 rendered inputs, 4 identical blank contact
   cards, no field pre-filled (`+page.svelte:9-26`).
2. Fill in the minimum the validator will accept — 7 top-level fields plus
   one contact's name and email (9 required data points out of 31 fields)
   — and **submit**. `parseClientForm` re-validates all of it server-side
   (`client-form.ts:29-79`); a bad `country` or missing `noticeChannel`
   round-trips the whole 31-field page with the rest preserved.
3. **Redirect to `/clients`** — the list, not the new client's own page
   (`src/routes/clients/new/+page.server.ts:32`). The person who just
   spent two to three minutes filling this in has to find their own row
   in a table and click it to see what they just created. This is the
   exact discontinuity the owner described as feeling bad: the form's
   own "done" state throws away the thing you just did.
4. **Click the new row** → client detail (`GET /clients/[id]`) to reach
   "Nuovo contratto."

**Count: 1 form (31 fields, 9 required), 1 submission, 2 page loads before
a contract can even start.**

### Step 3 — add a contract (`/clients/[id]/contracts/new`)

| #   | Field                             | Group                                    | Required?                                                        | Default               | Derivable?                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `title`                           | Identity                                 | Yes                                                              | `''`                  | No                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2   | `signedDocumentReference`         | Identity                                 | No                                                               | `''`                  | No — and there is no file input anywhere on this form to attach the PDF this reference names; the document itself never enters the product here                                                                                                                                                                                                                                                                               |
| 3   | `status`                          | Identity                                 | Yes (enum)                                                       | **`'draft'`**         | **Yes, and load-bearing** — `day/new`'s own loader only offers `active` contracts (`src/routes/day/new/+page.server.ts:14-27`); a contract left at the default cannot accept a day at all, and nothing on the contract form or the contract detail page says so                                                                                                                                                               |
| 4   | `templateLanguage`                | Identity                                 | Yes (enum)                                                       | **`'en'`, hardcoded** | **Yes** — the client's own country is already on screen data (`data.client`); appendix 05 finding 9                                                                                                                                                                                                                                                                                                                           |
| 5   | `startsOn`                        | Term                                     | Yes (ISO date)                                                   | `''`                  | No (could default to today)                                                                                                                                                                                                                                                                                                                                                                                                   |
| 6   | `endsOn`                          | Term                                     | No                                                               | `''`                  | No                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 7   | `renewalType`                     | Term                                     | Yes (enum)                                                       | `'none'`              | No                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 8   | `renewalNoticeDays`               | Term, shown only if `renewalType ≠ none` | Required when shown                                              | `''`                  | No                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 9   | `terminationNoticeDays`           | Term                                     | Yes (int ≥ 0)                                                    | `''`                  | No                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 10  | `paymentTermsKind`                | Payment                                  | Yes (enum)                                                       | `'net'`               | No                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 11  | `paymentTermsNetDays`             | Payment, shown if kind = net             | Required when shown                                              | `''`                  | No                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 12  | `paymentTermsDayOfMonthDay`       | Payment, shown if kind = day-of-month    | Required when shown                                              | `''`                  | No                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 13  | `invoicingCadence`                | Payment                                  | Yes (enum)                                                       | `'monthly'`           | No                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 14  | `currency`                        | Payment                                  | Yes, `/^[A-Z]{3}$/`                                              | `'EUR'`               | Already defaulted; could follow the client's country/pack instead of a literal                                                                                                                                                                                                                                                                                                                                                |
| 15  | `taxTreatment`                    | Payment                                  | **Always** required, free text, no format check beyond non-empty | `''`                  | **Yes** — the active pack's own valid codes exist as data (`packs/it-flat-rate.ts` etc.), and the field's own hint says so ("Resolved based on the active jurisdiction pack; not interpreted here" — `contract_form_tax_treatment_hint`), but no datalist is offered. Under the **generic pack this field is unanswerable**: `packs/generic.ts:28` declares `treatments: []`, yet the validator still rejects an empty string |
| 16  | `requiresPriorApproval`           | Approval & expenses                      | Checkbox, `false` accepted                                       | **unchecked**         | **Yes, and the highest-stakes miss** — this is a fact about the client relationship, not a coin flip: the seed data itself distinguishes Nordwind ("approvazione preventiva richiesta") from Bellani ("nessuna approvazione richiesta"), but nothing on the client record carries it forward to this checkbox                                                                                                                 |
| 17  | `expensePolicyKind`               | Approval & expenses                      | Yes (enum)                                                       | `'not_reimbursed'`    | No                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 18  | `expensePolicyCapAmount`          | shown if kind = reimbursed-with-cap      | Required when shown                                              | `''`                  | No                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 19  | `requiresExpensePreAuthorisation` | shown unless kind = not-reimbursed       | Checkbox                                                         | unchecked             | No                                                                                                                                                                                                                                                                                                                                                                                                                            |

Source: `src/routes/clients/[id]/contracts/ContractForm.svelte:35-282`,
`src/lib/server/repositories/contract-form.ts:59-222`. In the common case
(`renewalType='none'`, `paymentTermsKind='net'`,
`expensePolicyKind='not_reimbursed'`) exactly **15 of the 19 named
fields render** — the figure the assignment brief itself names.

Walkthrough:

1. **GET `/clients/[id]/contracts/new`.** All six enum selects arrive
   pre-set to a default value (`+page.svelte:9-31`); the validator will
   accept the whole form with only 5 fields actually typed — `title`,
   `startsOn`, `terminationNoticeDays`, `paymentTermsNetDays`,
   `taxTreatment` — because every other field's default is a _valid_
   value, just not necessarily the _right_ one.
2. **Submit.** `parseContractForm` (`contract-form.ts:59-222`) never
   looks at `data.client`, so it cannot cross-check `templateLanguage`
   against the client's own country even though the loader already has
   it (`+page.server.ts:9-15`).
3. **Redirect to the contract detail page**
   (`+page.server.ts:24`, `/clients/[id]/contracts/[contractId]`) — this
   time to the thing just created, unlike step 2's client redirect.
4. The detail page shows `status` read-only in a `<dl>`
   (`.../[contractId]/+page.svelte:161-163`) with no action to flip it.
   The only way to change it is "Modifica contratto" → the full 19-field
   form again.

**Count: 1 form (15 fields shown, ~5 the validator strictly demands, 5
more whose default is silently wrong for at least one of the three seeded
archetypes: `status`, `templateLanguage`, `requiresPriorApproval`, and —
under the generic pack — `taxTreatment`), 1 submission, 1 page load.**

### Step 4 — add a rate card (`.../rate-cards/new`)

| #                                                        | Field                               | Required? | Default                                                                                                                                                                                                                                                                                                      | Derivable? |
| -------------------------------------------------------- | ----------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `validFrom`                                              | Yes (ISO date)                      | `''`      | **Yes** — `data.contract.startsOn` is already loaded by this exact route (`+page.server.ts:11-17`) and unused by `+page.svelte:9-20`; the two dates are the same in the overwhelming common case of "first rate card for a brand new contract"                                                               |
| `validTo`                                                | No                                  | `''`      | No — open-ended is the common case, and the field's own hint already says so                                                                                                                                                                                                                                 |
| `kind`                                                   | Yes (enum)                          | `'daily'` | No                                                                                                                                                                                                                                                                                                           |
| `amount`                                                 | Yes, decimal                        | `''`      | No                                                                                                                                                                                                                                                                                                           |
| `unit`                                                   | Yes (enum)                          | `'day'`   | No — tracks `kind` in every seeded card but is a fully independent select that can silently disagree with it                                                                                                                                                                                                 |
| `allowedFractions`                                       | Yes, comma list, ≥1 positive number | **`'1'`** | **Yes, and wrong for a seeded contract as written** — Nordwind's own contract states "mezze giornate ammesse" (half days admitted); nothing upstream of this text field carries that fact, so a person reading the PDF at the rate-card screen has to remember, unprompted, to widen the default to `1, 0.5` |
| `minimumHours` (shown if `kind='hourly'`)                | No                                  | `''`      | No                                                                                                                                                                                                                                                                                                           |
| `disbursementPeriod` (shown if `kind='fixed_recurring'`) | Required when shown                 | `''`      | No                                                                                                                                                                                                                                                                                                           |

Source: `src/routes/clients/[id]/contracts/[contractId]/rate-cards/
RateCardForm.svelte:26-113`,
`src/lib/server/repositories/rate-card-form.ts:43-132`. Overlap between
validity periods is not checked until the database's own exclusion
constraint rejects it after submit
(`rate-card-form.ts:37-41`, `.../rate-cards/new/+page.server.ts:26-34`).

Walkthrough: **GET** the form (validFrom blank despite the contract date
already being known), fill 5 fields for the common `daily`/`day` case,
**submit**, **redirect back to the contract detail page**
(`+page.server.ts:38`).

**Count: 1 form (6 fields shown, 5 the validator strictly demands), 1
submission, 1 page load — and, separately, the still-unresolved `status`
problem from step 3: the contract is now fully priced and still invisible
to `/day/new` until someone notices and edits it back to `active`.**

### Step 5 — "load this year's history" (`/import`)

The page is titled, honestly, **"Importa fatture"** — import _invoices_,
not days (`import_heading`). Walking the pipeline confirms the title is
literal, not just a translation gap:

- `defaultAdapterRegistry` registers exactly one format:
  `fatturaPaAdapter`, FatturaPA 1.2, the Italian mandatory B2B e-invoice
  XML format (`src/lib/server/import/registry.ts:23`,
  `formats/fattura-pa/adapter.ts:1-14`). Any file that is not that exact
  XML shape returns `false` from `detect()` and is reported as
  `unrecognised_format`; a file that _is_ FatturaPA-shaped but corrupt is
  reported as `malformed_document` with the parser's own error message
  (`skip-reason.ts:10-13`) — both are shown per file in a non-blocking
  "skipped" list; the rest of the batch still proceeds.
- The whole endpoint 422s outright with `import_no_active_pack` if step
  0.5 (the fiscal profile) was skipped (`analyze/+server.ts:58-61`).
- What gets **written** on confirm is an `invoice` and its lines
  (`persist.ts`), plus, when a customer's tax id matches no existing
  client, a **derived** `client` + `contract` pair
  (`buildClientContractProposal`,
  `src/lib/server/import/client-match.ts:151-192` — see the redesign
  section below, this function is the strongest evidence in the codebase
  that derivation-from-a-document already works end to end for one
  document type).
- What imported invoice lines can do to **already-recorded days** is
  _link_ them — `proposeDayMapping`
  (`src/lib/server/import/day-mapping.ts:1-65`) only ever picks among
  `listEligibleWorkUnitsForInvoicing`, days that **already exist** as
  `work_unit` rows. It never creates one. The module comment says this
  outright: "the decision to actually move a day to `invoiced` never
  lives here."

So a self-hoster who has been billing Nordwind, Bellani and Fermata all
year without `mastro` and now wants to load January–August 2026 into it
has **two completely separate, unconnected gaps**: importing the invoices
they already issued (works, if they happen to be FatturaPA — plausible
for Italian B2B, but the only format `mastro` accepts), and reconstructing
the ~160 individual days those invoices billed, for which there is no
import path of any kind — CSV, spreadsheet, or otherwise. The only door is
`/day/new`, one submission per day, four fields each
(`date`, `quantity`, `scope`, `contractId` —
`src/lib/server/repositories/work-unit-form.ts:6-13`), with no
range/repeat helper.

**Count for backfilling roughly six months of history at three clients:
0 pages if only invoices matter (import works, when the files are
FatturaPA); ~160 individual page-visits-and-submissions if the days
themselves need to exist, because nothing else can create a `work_unit`
row in bulk.**

### Totals — today

- **7 page loads**, **3 form submissions**, across **3 separate
  create forms** (client → contract → rate card), plus a dead-end
  redirect after client creation that forces a fourth navigation just to
  find the row just created.
- **52 fields rendered by default** (31 + 15 + 6), **57 counting every
  mutually exclusive branch** (31 + 19 + 7).
- **17 fields the validator will not let you skip.**
- **At least 5 further decisions where a shown default is silently wrong
  for at least one of the three seeded archetypes and nothing flags it**:
  `status` (blocks day entry entirely), `templateLanguage` (wrong
  language on every generated document), `requiresPriorApproval` (the
  product's central protection, off), `allowedFractions` (a contract that
  explicitly allows half days, priced as if it doesn't), `taxTreatment`
  (unanswerable under the pack that needs zero setup).
- **An eighth, undocumented step**: reopening the contract's edit form to
  flip `status` from `draft` to `active`, because nothing in the create
  flow does it and nothing on the detail page offers a one-click fix.
- **Bulk history load**: invoices only, one format, and even then no
  path at all for the days behind them.

## What is wrong

1. **[BLOCKER, wrong model]** A contract created through the standard
   form defaults to `status: 'draft'`
   (`contracts/new/+page.svelte:29`), and `/day/new` only offers
   `active` contracts (`day/new/+page.server.ts:17-27`). A person who
   fills in all four sections top to bottom and submits lands on a
   contract detail page that looks complete and is invisible to the one
   screen whose entire job is recording 30 seconds of work a day. There
   is no error, no warning, no CTA — just a contract that silently does
   nothing until someone happens to reopen "Modifica contratto."
2. **[BLOCKER, missing]** The fiscal profile — the row that turns on
   every ceiling ("no ceiling crossed blind") and unblocks `/import` — has
   no UI at all. `settings/+page.svelte:28` admits this in the product's
   own copy. A brand-new self-hoster has to reverse-engineer a pack
   id/version from `fiscal/registry.ts` and hand-write SQL against a
   table `docs/self-hosting.md` never even mentions.
3. **[BLOCKER, missing]** There is no bulk or CSV path to create
   historical `work_unit` rows. `/import`'s "day mapping" only links
   invoice lines to days that already exist
   (`day-mapping.ts:1-65`); it cannot create one. A self-hoster
   onboarding mid-year with real invoicing history behind them has to
   hand-type every past day, one `day/new` submission at a time, with no
   date-range helper.
4. **[MAJOR, friction]** After client creation the redirect lands on
   `/clients`, the list, not the row just created
   (`clients/new/+page.server.ts:32`). The next required action —
   "Nuovo contratto" — is on the client's own detail page, one extra
   click and one extra query away for no reason; the server already
   holds the new row's id at the point it issues the redirect.
5. **[MAJOR, wrong model]** `requiresPriorApproval` defaults unchecked
   (`contracts/new/+page.svelte:24`, appendix 05 finding 2) and is not
   derivable from anything on the client record, even though the
   seeded relationships (Nordwind: required; Bellani: not) prove it is a
   durable fact about the relationship, not a per-contract coin flip.
   There is nowhere on the client to record it once, so every future
   contract for the same client re-asks the same unchecked-by-default
   question.
6. **[MAJOR, wrong model]** `templateLanguage` hardcodes `'en'`
   (`contracts/new/+page.svelte:28`, appendix 05 finding 9) though the
   client's own `country` is already loaded data at that point in the
   flow (`contracts/new/+page.server.ts:9-15`) and every seeded client
   is Italian.
7. **[MAJOR, wrong model]** `allowedFractions` on a rate card defaults to
   `'1'` (no half days) with no link back to anything the contract or
   client recorded, so a contract whose signed PDF explicitly allows half
   days (Nordwind) prices one at full rate unless the person typing the
   rate card, minutes after reading that PDF, remembers to widen a
   comma-separated text field.
8. **[MAJOR, wrong model]** `taxTreatment` is unconditionally required
   free text with no datalist, even though the active pack's own valid
   codes exist as structured data and the field's own hint says the value
   is "resolved based on the active jurisdiction pack." Under the generic
   pack (`treatments: []`) the field is **unanswerable** — there is no
   correct string to type — yet the validator still rejects a blank one.
9. **[MAJOR, missing]** `signedDocumentReference` is a free-text field
   naming a document that never gets attached anywhere on this form. The
   PDF the entire journey starts from — "a signed contract PDF" — has no
   upload target on the contract screen at all; `/documents/[id]` exists
   and is auth-gated but is reachable from nowhere in this flow (main
   review, defect 9, same root cause in a different area).
10. **[MAJOR, missing]** Nothing cross-checks that a client with
    `contacts` has at least one `canApprove: true` before a contract on
    that client sets `requiresPriorApproval: true`
    (`client-form.ts`, `client.ts:41-52` — no such check anywhere).
    A client can be fully "registered" and still have nobody who can
    legally approve a day, silently.
11. **[MINOR, friction]** `rate-cards/new`'s `validFrom` is left blank
    even though the contract's own `startsOn` is already loaded data on
    that exact page (`+page.svelte:9-20` next to
    `+page.server.ts:11-17`) — a one-line pre-fill, not a redesign.
12. **[MINOR, friction]** `currency` defaults to a hardcoded `'EUR'`
    literal on the contract form rather than reading it from the active
    fiscal pack or the client's own country — correct for every seed
    client today, silently wrong the day a non-euro client is added.
13. **[MINOR, wrong model]** `country` on the client form is free text
    ("Paese (ISO alpha-2)") with no default, though the practice's own
    country is already known from `ACCOUNT_HOLDER_TAX_ID` and is, in
    practice, the right guess for almost every client a single
    consultancy takes on.

## What is missing entirely

- **A fiscal-profile setup screen.** Not a nice-to-have: it is the one
  precondition the product's own copy admits doesn't exist, and it gates
  both the ceiling promise and `/import`.
- **A guided first-run.** Nothing on an empty instance recognises "zero
  clients" as a state worth a different screen than "nothing due today."
  Every self-hoster reaches the same unlabeled starting line the seeded
  demo instance in this review skipped past.
- **Bulk/historical day entry.** A day-rate consultant onboarding
  mid-year with six or twelve months of real work behind them has no way
  to represent that work except one `day/new` submission per day. The
  30-second daily promise has no equivalent for the one-time catch-up
  every self-hoster who isn't starting from zero has to do first.
- **A relationship-level "approval required" and "half days allowed"
  fact.** Both live only inside a signed PDF today and have to be
  re-derived by a human at two different, unconnected screens (the
  contract's checkbox, the rate card's text field) with nothing carrying
  the answer between them.
- **A document attachment on the contract itself.** The form asks for a
  reference to the signed document and never lets the person attach it.
- **A one-click "activate this contract" action.** The only way to change
  `status` after creation is the full 19-field edit form.
- **A country/VAT reference.** The client form asks for a raw two-letter
  code with no picker, no validation against a real ISO-3166 list beyond
  regex shape, and no VAT-format cross-check.

## The journey redesigned

Target: **from a signed contract PDF and a client's details, to a
contract that can accept a day, in as few steps as honesty allows** —
"honesty" meaning every field a human still has to answer is one the
product genuinely cannot know, not one it chose not to bother deriving.

### Option A — fix the defaults and the redirect (effort S)

No new screens, no schema change. Ships inside the existing three forms:

- `status` on contract creation: default `'active'` when `startsOn <= today`
  (the common case — a contract you're registering today, for work
  starting today or already underway), `'draft'` only when `startsOn` is
  in the future; add a one-click "Attiva" action on the contract detail
  page for the rest.
- `templateLanguage` defaults from `client.country`, not a literal.
- `currency` defaults from the active pack / client's country.
- `requiresPriorApproval`: no default at all — render as an explicit
  Yes/No choice with no pre-selected value, so submitting requires a
  decision rather than accepting silence as "no."
- `taxTreatment`: a `<datalist>` sourced from the active pack's
  `treatments`; skip the field entirely (store `''`) when the active
  pack declares none, instead of demanding an unanswerable string.
- `rate-cards/new`'s `validFrom` pre-filled from `contract.startsOn`.
- Client creation redirects to the new client's own detail page, not the
  list.
- `noticeChannel` defaults to `email`; the contact block renders one
  visible card plus "add another" instead of four blank ones (already
  appendix 05's own recommendation for that form; repeated here because
  it is also on this journey's critical path).

Cuts the "silent wrong default" count from 5 to 0, removes one full
navigation (the client-list bounce) and the undocumented eighth step
(re-editing status), without touching field counts. **Does not** address
the fact that the journey is still three separate forms and three
separate submissions, or the missing bulk-history path.

### Option B — one combined "new engagement" flow (effort M)

Merge client + contract + rate card into one page, in four visually
distinct groups (Client / Term & money / Approval & expenses / First rate)
that are all still one `<form>` and one transaction. Field list, with
what's pre-filled:

| Group               | Fields shown                                                                                                                                                                 | Pre-filled / derived                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Client              | legalName, taxId, vatId (opt), country, address (line1/city/postcode required, line2/region opt), one contact (name+email required, phone/role opt, "add another" on demand) | `country` defaults from the practice's own; `noticeChannel` fixed to `email` unless changed |
| Term & money        | title, startsOn, endsOn (opt), renewalType (+ notice days if not none), paymentTermsKind (+ days), invoicingCadence, currency, taxTreatment (datalist or hidden)             | `startsOn` defaults to today; `currency`/`taxTreatment` from the pack                       |
| Approval & expenses | requiresPriorApproval (explicit choice, no default), expensePolicyKind (+ cap/pre-auth)                                                                                      | none — this is exactly the section that must force a decision                               |
| First rate          | kind, amount, unit, allowedFractions                                                                                                                                         | `validFrom` = the term section's `startsOn`; `unit` derived from `kind`                     |

One submission creates `client` + `contract` (`status: 'active'`) +
`rate_card` in one transaction (mirrors the existing pattern in
`confirm.ts:36-50`, which already does client+contract atomically) and
redirects straight to `/day/new?contractId=...`, the actual destination
of this whole journey.

**Redesigned totals: 1 page, 4 sections, ~14 fields the person answers
(down from 52 rendered / 17 required today), 1 submission, 0 dead-end
redirects.** Risk: a single long form re-introduces some of the
"undifferentiated wall of fields" problem the main review already flags
for the individual forms — mitigate with the same visual grouping
appendix 05 already specifies for the contract form (Basics /
Duration & renewal / Approval & expense policy / Administrative
metadata), applied once across the merged page instead of three times.

### Option C — evidence-first, from the PDF itself (effort L)

The exact "agent proposes, human confirms" pattern this codebase already
ships for invoices — `buildClientContractProposal`
(`client-match.ts:151-192`) infers legal name, address, payment terms and
invoicing cadence straight from a parsed document, no human typing —
generalises directly to a **signed contract PDF** dropped at the start of
this journey instead of an invoice XML at the end of it. A human uploads
the PDF; the ACP runner (already-built infrastructure, same
"propose" step `day-extraction.ts` uses for approval emails) extracts a
`ClientProposal` + `ContractProposal` + a first `RateCardProposal`
(amount, unit, `allowedFractions` from the PDF's own "mezze giornate
ammesse"-style language, `requiresPriorApproval` from the PDF's own
approval clause) as one screen to review and correct, not 52 fields to
fill from scratch. The document itself is the `signedDocumentReference`
this journey's contract form asks for today and never lets anyone attach.

**Redesigned totals: 1 upload, 1 review-and-correct screen (same field
list as option B, but pre-filled instead of blank), 1 confirm.** This is
the only option that actually closes the gap between "I have a signed PDF"
and "I have a contract," which is the literal wording of the target this
brief sets. Effort is L specifically because the extraction side (issue
#86, contract-from-PDF) is open and unbuilt — see below.

**Recommendation: A now (cheap, fixes the worst silent defaults and the
dead-end redirect immediately), B once A has shipped and the merged-form
risk can be judged against real usage, C only after #86 lands** — the
same staged reasoning the main review already applies to its own Decision
A.

## What it needs from elsewhere

- **Issue #86 (contract-from-PDF).** Option C's extraction step does not
  exist; it is an open issue in this batch's own shared context, not
  something this document can specify further than "reuse the
  `ClientProposal`/`ContractProposal`/`confirmClientContractProposal`
  shapes already proven for invoices."
- **A jurisdiction pack endpoint** exposing `treatments` as data the
  contract form (in any option) can read for the `taxTreatment`
  datalist — today only `fiscal/packs/*.ts` know this list.
- **A "practice's own country" helper** derived once from
  `ACCOUNT_HOLDER_TAX_ID`'s prefix, for the `country` default in options
  A and B — no such parsing exists yet; `config.ts` treats the value as
  opaque.
- **A shared "activate" mutation** (`setContractStatus` alongside the
  existing narrow setters in `repositories/contract.ts:87-135`) and a
  real button component for it — the main review's own cross-cutting ask
  for a `Button` component (section 6) is the same one this journey's
  missing one-click "Attiva" action needs.
- **A contract-scoped document upload**, reusing the existing
  content-addressed document store (`DOCUMENT_STORAGE_ROOT`,
  `/documents/[id]`) that already exists and is already unreachable from
  every create/edit form in this journey.
