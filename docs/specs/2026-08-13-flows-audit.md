# Audit of the journeys, and what the product cannot do at all

2026-08-13. Companion to [the UX/UI review](2026-08-13-ux-ui-review.md), which
judged screens. This one judges **work**: the jobs a person opens mastro to do,
how many steps each takes, how much of it the product already knows and asks
anyway, and what it has no answer for.

Five journeys were walked in the real code against the running seeded instance.
Full findings, with file and line citations and step-by-step walkthroughs, are
in [`flows-audit/`](flows-audit/). This is the part to read.

---

## The short version

The UX review's conclusion was that the product presents the database instead of
the work. This audit says something worse and more specific: **several of the
journeys do not complete.** Not "are unpleasant" — do not complete. A day
proposed by the agent and accepted by a human never becomes a day the ledger
counts. An approval that arrives by any route other than IMAP cannot be recorded
at all. A payment cannot be partial. A dispute has no path in or out.

Everything else here is ordinary friction, and the friction is fixable. The
first list is not.

## 1. Nine things that do not complete

Ranked by what they cost. Every one is traced in the appendices.

1. **An accepted proposal is not a day.** `acceptProposal` creates a `work_unit`
   in `proposed`, and no production caller of `transitionWorkUnit` ever advances
   `proposed → approved → worked`. So the loop that was shipped and celebrated —
   email arrives, agent proposes, human accepts — produces rows that are
   invisible to the calendar totals and ineligible for invoicing, with no UI to
   finish them. This is the actual cause of the "Giornate lavorate: 0 giorni" the
   UX review noticed and did not explain. _(appendix 02)_
2. **There is no way to record an approval that did not arrive by IMAP.**
   `createApproval` is called only from test fixtures. A client who confirms by
   WhatsApp, by phone followed by a scanned letter, or in a meeting, cannot be
   recorded — on a contract that requires prior approval, that day can only ever
   be `worked_without_approval`. _(appendix 02)_
3. **`recordPayment` takes a date and no amount.** A partial payment cannot be
   represented at all, and the schema's CHECK constraints forbid the obvious
   workarounds. _(appendix 04)_
4. **Credit notes corrupt the ledger.** `/invoices/new` offers `credit_note` as a
   document type, but nothing links it to the invoice it corrects and
   `fetchLedgerRows` sums every invoice row identically regardless of type.
   Issuing one _overstates_ revenue, ceiling usage and concentration — the exact
   opposite of its purpose. _(appendix 04)_
5. **The `disputed` state is unreachable.** It is fully wired through the state
   machine, the register, the invoicing-eligibility query and two label
   components, and has no write path anywhere in the app. The product's whole
   reason to exist is surviving an argument with a client, and the state that
   represents the argument can only be entered with raw SQL. _(appendix 04)_
6. **The approval excerpt is written and never read.** The verbatim sentence a
   disputed day rests on is stored at creation and displayed nowhere. Same for
   the archived original: `/documents/[id]` works, is auth-gated, and is linked
   from nothing. _(appendix 04)_
7. **No scheduling ships with the product.** Mail polling, the agent drain and
   the alert engine are all HTTP endpoints expecting cron, and there is no
   crontab, systemd timer or workflow anywhere in the repo. Out of the box,
   nothing ingests, nothing alerts, nothing proposes. _(appendix 02)_
8. **The fiscal profile, contract ceilings and renewal assumptions have no UI.**
   All three are modelled, read by the engine, surfaced on the dashboard — and
   writable only by hand in SQL. The settings page says so about the first one in
   its own copy. _(appendix 05)_
9. **A year of history cannot be loaded.** `/import` is invoice-only, FatturaPA
   XML only, and its day-mapping links _pre-existing_ `work_unit` rows; it never
   creates one. There is no bulk path for days at all, which is v0's own
   acceptance criterion ("this year's history is loaded"). _(appendix 01)_

A tenth, found by accident while doing this work and worth the same list:
**the test suite only passes against an almost-empty database.** Seeding a
realistic instance to do the review turned 20 tests red across
`fiscal/profile`, `fiscal/revenue`, both jurisdiction packs,
`mailbox-poll-run` and `work-unit-calendar` — not because anything broke, but
because they assume no `fiscal_profile` row exists, or that the most recent
row of a table is one they inserted. `AGENTS.md` claims the suite "leaves
nothing behind and does not care about order"; it does not care about order,
and it very much cares about what was there first. That has to be fixed
before a demo seed can be committed, which the UX review wants for exactly
this kind of work.

## 2. The friction, measured

| Journey                                           | Today                                                                                                                                                                                                                           | After the redesign in the appendix                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Empty instance → a contract that can accept a day | 7 page loads, 3 submissions, 52–57 rendered fields, 17 required, **5 silently wrong defaults**, plus an undocumented 8th step (re-edit the contract to flip `status` from `draft` to `active`, or it is invisible to `day/new`) | 1 page, ~14 fields, or 1 upload + 1 review screen if the contract PDF is used |
| Record a day, phone, happy path                   | 3 taps + ~20–25 keystrokes; 5 taps when an approval is required                                                                                                                                                                 | 2 taps + a short phrase                                                       |
| Client confirms → the ledger knows                | runner off: **never**; on a schedule: ~15–20 min to a human tap                                                                                                                                                                 | unchanged, but it has to actually be scheduled                                |
| Month end → invoice sent                          | 4 routes, 9–11 page loads, 55 inputs, **14 money/tax figures of which 11 the product already has**                                                                                                                              | 3–4 page loads, 0 typed figures, 2 decisions                                  |
| Owed → paid                                       | 1 page for "what's owed" with no per-client breakdown, up to 5 page loads to chase                                                                                                                                              | one money surface, chasing with a memory of what was sent                     |

Three numbers are worth staring at. **Five silently wrong defaults** in
onboarding, of which the worst two are `status: draft` (the contract exists and
cannot be used, with nothing saying why) and `requiresPriorApproval: false` (the
central protection, off). **Eleven of fourteen** figures on the invoice screen
are retyped from data the product holds. And **zero** is the number of days the
product can currently produce end to end from an approval email.

## 3. Wrong model, not just friction

Four places where the product asks the wrong question, or asks it at the wrong
time. These do not get better with fewer fields.

- **The client form asks for four contacts before it asks for one.** Twenty of
  its thirty-one inputs are four fixed blank contact cards, rendered whether you
  need them or not, and you cannot have a fifth. It also asks a human to type
  `Paese (ISO alpha-2)` as free text, and asks for the tax id and the country
  separately when the first begins with the second.
- **The contract form asks at the wrong moment.** Renewal notice days, expense
  policy, tax treatment and template language are questions you answer with the
  signed PDF open in the other hand — which is an argument for reading the PDF
  (#86), and, until then, for letting the form be filled in two passes rather
  than pretending it is one sitting.
- **The invoice screen asks you to be the calculator.** Quantity, unit price and
  amount are three independently typed numbers that nothing reconciles against
  the days ticked, and the statutory reference is retyped by hand although the
  active jurisdiction pack holds it verbatim as data. The live instance proves
  the cost: all three seeded invoices charge 22% VAT under a **flat-rate,
  VAT-exempt** profile, because `invoice-form.ts` never reads the pack.
- **The alert engine delivers once and goes quiet.** Detection is correct and
  live, but dedup is keyed on severity rank, and `worked_without_approval` never
  escalates. So Friday does not tell you that Tuesday is still unapproved: the
  one time it told you was Tuesday.

## 4. What is missing entirely

From appendix 05's gap table, the ones that matter, with my verdict on scope.

| Capability                                 | Verdict                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Electronic invoicing (SdI / FatturaPA)** | **In scope, and the biggest single gap.** Mandatory for forfettari since 1 July 2022. The product produces invoices, holds a `formats: ['FPR12']` string and an unused `transmission_id`, and has no generator and no transmission. Today the invoices it produces are not the invoices the law recognises. |
| Time off and capacity                      | In scope, small. "How many billable days are actually left this quarter" is unanswerable, and it is the question behind every ceiling decision.                                                                                                                                                             |
| Purchase orders / client PO numbers        | In scope, small. Larger clients will not pay an invoice without one, and there is no field.                                                                                                                                                                                                                 |
| Partial payments, credit notes             | In scope, already listed above as broken rather than missing.                                                                                                                                                                                                                                               |
| Dispute evidence bundle                    | In scope, medium. The data all exists; nothing assembles it.                                                                                                                                                                                                                                                |
| Quotes and proposals to clients            | Out of scope. Different product.                                                                                                                                                                                                                                                                            |
| Multi-currency                             | Out of scope for now, deliberately. Worth revisiting only with a real non-EUR client.                                                                                                                                                                                                                       |
| A second person                            | Out of scope. It is a single-tenant ledger by design.                                                                                                                                                                                                                                                       |
| Accountant handover / annual export        | In scope, small, and the cheapest trust-builder in the list.                                                                                                                                                                                                                                                |

## 5. What I would do, in order

Nothing here needs the visual redesign to be finished first, and the first group
should not wait for it at all.

**Now — the journeys that do not complete.** Items 1, 2 and 5 of section 1
(accepted proposals stuck in `proposed`, no manual approval path, unreachable
dispute), plus the two onboarding defaults. These are small, independent, and
each one closes a hole that makes the product untrustworthy rather than
unpleasant.

**Next — stop asking for what we know.** The invoice built from ticked days with
computed totals and pack-supplied legal text; the fiscal profile with a UI; the
contract `status` default; the country derived from the tax id.

**Then — the two that need a decision from you.** Electronic invoicing is a
milestone of its own and changes what "issue an invoice" means. Scheduling has
to be answered before ingestion is real in production: a systemd timer shipped
with the compose stack, or a documented cron, or an in-process scheduler.

**Alongside — the redesign**, which is where the friction numbers in section 2
actually get paid off.

---

Appendices: [01 setup and onboarding](flows-audit/01-setup-and-onboarding.md) ·
[02 the daily loop](flows-audit/02-the-daily-loop.md) ·
[03 month end and billing](flows-audit/03-month-end-and-billing.md) ·
[04 getting paid](flows-audit/04-getting-paid.md) ·
[05 the year and the gaps](flows-audit/05-the-year-and-the-gaps.md)
