# Electronic invoicing: what it actually requires of us

Spike for #247. No code in this change — this is the recommendation the issue asked
for, plus the follow-up issues it asked to be sized and filed. Every factual claim
below carries the URL it was checked against, fetched while writing this document
(2026-08-14).

## 0. The finding, stated once

Electronic invoicing through the Sistema di Interscambio (SdI), in FatturaPA XML,
has been mandatory for every forfettario since 1 July 2022, with no revenue
exception remaining
(https://www.profattura.it/guide/fattura-elettronica-regime-forfettario — "Dal 1°
gennaio 2024 la fattura elettronica è obbligatoria per tutti i contribuenti in
regime forfettario, senza eccezioni di fatturato", corroborating that even the last
transitional case, practitioners under the old €25.000 threshold exempted through
30 June 2022, has since lapsed). `mastro` holds `formats: ['FPR12']` on both
Italian packs (`src/lib/server/fiscal/packs/it-flat-rate.ts:201`,
`it-standard.ts:75`) and an unused `transmission_id` column
(`drizzle/0014_invoice.sql:21`, confirmed unread anywhere in application code by
grep), and has no generator and no transmission. A row in the `invoice` table is
bookkeeping about a document, not the document Italian law recognises as an
invoice. This is not a new discovery — `docs/specs/flows-audit/05-the-year-and-the-gaps.md`
§5 already named it "the single largest gap in the product" — this spike is what
turns that finding into a decision and a scoped plan.

## 1. What the XML must contain for a forfettario

**`RegimeFiscale`: `RF19`.** The code identifying the flat-rate regime in
`CedentePrestatore`'s `RegimeFiscale` field
(https://www.fattureincloud.it/glossario/regime-forfettario/rf-19/ — "La sigla
RF19 identifica all'interno della fattura elettronica che l'emittente applica il
regime forfettario"; the full RF01–RF20 table, including `RF01` for the ordinary
regime `it-standard` uses, at
https://centrofiscale.com/codice-rf19-730-2026-regime-forfettario/). Omitting or
misstating it is exactly the kind of formal defect SdI's own validation rejects
(§3 below) — Agenzia delle Entrate's own guidance confirms the check runs against
"i dati minimi obbligatori previsti per legge (art. 21 ovvero 21-bis del Dpr n.
633/1972)"
(https://www.agenziaentrate.gov.it/portale/aree-tematiche/fatturazione-elettronica/guida-fatturazione-elettronica/come-predisporre-inviare-ricevere-fe/cosa-fa-sistema-interscambio-fe).
Nothing in `mastro` carries this value today — see §5's pack-interface change.

**`Natura`: `N2.2`.** "Operazioni non soggette – altri casi", the code for the
flat-rate regime's VAT-exempt treatment
(https://www.freeinvoice.it/blog/fattura-elettronica-forfettari-2026-guida/ —
"Il codice N2.2 ... è il codice natura corretto per le operazioni in regime
forfettario"). This one is **already correctly modelled**: `it-flat-rate.ts:151`
declares `treatments: [{ code: 'N2.2', ... }]` with the exact statutory citation
(art. 1, comma 58, legge 190/2014) as `legalText`, and `defaultTreatment: { kind:
'treatment', code: 'N2.2' }` applies it unconditionally, matching comma 58 drawing
no exception. `resolveDefaultTaxTreatment(pack)` already returns everything a
generator needs to populate `<Natura>` and `<AliquotaIVA>0.00</AliquotaIVA>` — no
pack change required for this field.

**Stamp duty above 77,47 €.** Also **already correctly modelled**:
`it-flat-rate.ts:166-178` declares a `StatutoryCharge` of 2,00 € (`minorUnits(200)`)
with `appliesWhen: { fact: 'invoiceTotal', comparator: 'gt', value: 7747 }`, cited
to D.P.R. 26 ottobre 1972, n. 642 — the same threshold and figure independently
confirmed by current practitioner guides
(https://www.softwaresemplice.it/blog/regime-forfettario-fatturazione-elettronica/1212).
`evaluateInvoiceCharges` already sums this into the invoice's own `stamp_duty`
column. A generator only has to read that column and emit
`<DatiBollo><BolloVirtuale>SI</BolloVirtuale><ImportoBollo>2.00</ImportoBollo></DatiBollo>`
when it is non-null — no pack change needed here either.

**Progressive numbering.** Art. 21, comma 2, lett. b) of D.P.R. 633/1972, in its
current formulation, requires "un numero progressivo che la identifichi in modo
univoco" (unique identification, not the older "per anno solare" reset rule —
https://www.studiosantacroce.eu/Contenuti/Articoli/Articolo/61/forma-libera-per-la-numerazione-delle-fatture,
consolidated article text at
https://i2.res.24o.it/pdf2010/Editrice/ILSOLE24ORE/QUOTIDIANO_FISCO/Online/_Oggetti_Correlati/Documenti/2014/07/28/DPR-633-1972-ART-21.pdf).
Agenzia delle Entrate's own FAQ confirms numbering may even continue uninterrupted
across paper and electronic documents, "a condizione che sia garantita
l'identificazione univoca della fattura"
(https://www.agenziaentrate.gov.it/portale/schede/comunicazioni/fatture-e-corrispettivi/faq-fe/risposte-alle-domande-piu-frequenti-categoria/registrazione-e-conservazione-delle-fatture).
**This is where the spike found a real, already-shipped defect, unrelated to
whether a generator exists at all**: `invoice`'s unique constraint is
`unique('invoice_contract_number_unique').on(table.contractId, table.number)` —
scoped per **contract** — while the comment directly above it claims "Invoice
numbers are unique per issuer's own series, not globally"
(`src/lib/server/db/schema/invoice.ts:118`). `mastro` is single-tenant (one fiscal
profile, one issuer), so "per issuer" and "global" name the same set here, and the
constraint enforces neither: two different contracts can be issued the same
invoice number today, which is exactly what SdI would reject on ingest. Filed as
its own defect: **#257**.

**FatturaPA version currently in force: not stale, but the schema underneath it
has moved.** `formats: ['FPR12']` is **not** the stale string the issue worried it
might be — `FPR12` is the `FormatoTrasmissione` value for a B2B/B2C invoice (as
opposed to `FPA12` for the Pubblica Amministrazione;
https://biblus.acca.it/fattura-b2b-cos-e-come-si-differenzia-dalla-b2c-pa/), and it
is still exactly that value in the current schema — the XSD is still literally
named `Schema_VFPR12` in Agenzia delle Entrate's newest published documentation
(https://www.agenziaentrate.gov.it/portale/specifiche-tecniche-versione-1.9.1-%C2%A0-utilizzabili-dal-15-maggio-2026-).
What _has_ moved, three times in the period this research could observe, is the
**specifiche tecniche version** the XSD is drawn from: v1.8.1 → v1.9 (in force
from 1 April 2025, per
https://finom.co/it-it/blog/codici-fattura-elettronica/) → **v1.9.1, the version
currently in force, mandatory from 15 May 2026**
(https://www.agenziaentrate.gov.it/portale/specifiche-tecniche-versione-1.9.1-%C2%A0-utilizzabili-dal-15-maggio-2026-
— "Da tale data, il Sistema di Interscambio applicherà automaticamente le nuove
regole e le fatture predisposte con il precedente tracciato saranno scartate";
summary of what changed at
https://www.edotto.com/articolo/fatturazione-elettronica-nuove-specifiche-tecniche-dal-15-maggio-2026).
The practical consequence: **a generator has to track the specifiche-tecniche
version as its own concern, on Agenzia delle Entrate's release calendar, separate
from `formats`'s stable identifier and separate from any jurisdiction-pack
version** — see §5 for why this must not become a pack field.

## 2. Transmission routes for a one-person self-hoster

Agenzia delle Entrate names four official channels
(https://www.fatturapa.gov.it/it/comefare/operatori-economici/inviare-la-fatturapa/index.html),
and transmission through any of them is free — commercial cost, where it exists,
comes entirely from third-party software or intermediary subscriptions, never from
SdI itself:

| Channel                                            | Accreditation                                                   | Certificate needed           | Size limit        | Cost                                                                                                                                                                                                                                                                                                            | Fit for a one-person self-hoster                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------- | ---------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **PEC** (`sdi01@pec.fatturapa.it`)                 | None — "non presuppone alcun tipo di accreditamento preventivo" | No (see below)               | 30 MB per message | A PEC mailbox, ~5–25 €/year from a certified provider (Aruba's own price list: 5,00 €/year entry, 9,90 €/year renewal for Standard, 25 €/year for Pro — https://www.pec.it/comparazione-pec.aspx; provider registry at https://www.agid.gov.it/it/piattaforme/posta-elettronica-certificata/elenco-gestori-pec) | **Good** — same shape as the IMAP/SMTP mailbox `mastro`'s worker already polls                                                    |
| **Invio via web** (Fatture e Corrispettivi portal) | None; needs Entratel/Fisconline/SPID/CNS login                  | No                           | 5 MB per file     | Free                                                                                                                                                                                                                                                                                                            | Poor to automate — an interactive browser login (SPID/CNS/2FA), not a headless API                                                |
| **SDICoop** (web service)                          | Required, through AdE's own Sistema di Accreditamento           | Yes, to accredit the channel | 5 MB per file     | Free to accredit; a self-hoster would otherwise pay a provider that already holds accreditation                                                                                                                                                                                                                 | Poor for one person — accreditation is built for software vendors, not a single practice                                          |
| **SDIFTP**                                         | Required, same accreditation                                    | Yes                          | —                 | Free to accredit                                                                                                                                                                                                                                                                                                | Explicitly not for this use: AdE's own docs say it "risulta pertanto adatta a soggetti che movimentano elevati volumi di fatture" |

Source for the table's technical facts:
https://www.fatturapa.gov.it/it/comefare/operatori-economici/inviare-la-fatturapa/index.html.

**On the certificate, precisely** — the issue's framing ("SdI direct with a
certificate") turns out to be only half right. A **qualified digital signature is
mandatory for invoices to the Pubblica Amministrazione**, but **not for B2B/B2C
invoices**, which is the entire population `mastro`'s target user bills — confirmed
directly on Agenzia delle Entrate's own page: "Per tutte le fatture elettroniche
inviate a soggetti Iva o consumatori finali, il **SdI accetta anche file non
firmati digitalmente**"
(https://www.agenziaentrate.gov.it/portale/aree-tematiche/fatturazione-elettronica/guida-fatturazione-elettronica/come-predisporre-inviare-ricevere-fe/cosa-fa-sistema-interscambio-fe).
So "SdI direct with a certificate" is really two different things: PEC needs no
certificate and no accreditation at all; SDICoop/SDIFTP need accreditation
(commonly satisfied with a certificate as part of that process) regardless of
whether the invoice itself ends up signed.

**Commercial intermediaries**, for comparison: Aruba's entry-level plan (aimed at
forfettari) runs ~30 €/year after an introductory period, its full package
~135–165 €/year
(https://www.softwaresemplice.it/blog/aruba-fatture-in-cloud-prezzi-a-confronto/1203);
Fatture in Cloud's forfettari plan is ~48 €/year the first year, ~96 €/year on
renewal (same source). Both also handle conservazione as part of the
subscription — see §4.

## 3. Receipts and rejections, and what the product must do with each

Sourced directly from Agenzia delle Entrate's own guide to what SdI does on
receipt
(https://www.agenziaentrate.gov.it/portale/aree-tematiche/fatturazione-elettronica/guida-fatturazione-elettronica/come-predisporre-inviare-ricevere-fe/cosa-fa-sistema-interscambio-fe),
corroborated by https://fiscomania.com/ricevute-fattura-elettronica/:

- **Ricevuta di scarto (rejection).** One or more of SdI's formal checks fails
  (missing mandatory field, VAT-id not found in Anagrafe Tributaria, inconsistent
  imponibile/aliquota/IVA, a duplicate). SdI's own rule: a scarto invoice **"non è
  mai stata emessa"** — it legally never existed. The issuer gets an error code and
  description, and Agenzia delle Entrate's guidance is to resend with the **same
  date and number** as the rejected attempt. **What the product must do**: treat a
  rejected invoice as not-issued — it must drop out of revenue/ceiling calculations
  until a corrected resubmission is accepted, and the resubmission must be
  traceable back to the same invoice row, not a new one. Filed as **#261**.

- **Ricevuta di consegna (RC).** SdI delivered the file to the counterpart's own
  channel (their `CodiceDestinatario`/PEC). Carries `IdSdI` (SdI's own file
  identifier — this is what `transmission_id` should actually hold once it is
  populated), the file name, and a hash for integrity. From this point the invoice
  is legally issued, with exigibility dated to the invoice's own issue date.
  **What the product must do**: record `IdSdI` and mark the invoice accepted.

- **Ricevuta di impossibilità di recapito.** The counterpart's channel wasn't
  reachable (full PEC mailbox, momentarily-down server) or `CodiceDestinatario` was
  the default `'0000000'`. SdI still parks the file in the counterpart's own "area
  riservata" on the AdE portal, and — critically — **the invoice still counts as
  issued for the supplier**; only the _customer's_ VAT-deduction date shifts to
  when they actually view it there. The supplier is expected to notify the
  customer out-of-band that the document is waiting. **What the product must do**:
  mark the invoice accepted (same as RC), but surface a reminder that the client
  has not been notified through the normal channel — this is exactly the routing
  gap named in #259.

- **Notifica di esito committente**, PA-only (positive/negative acceptance by the
  receiving public body) — out of scope, `mastro`'s target user never invoices a
  PA under this pack.

None of this exists in `mastro` today beyond the unread `transmission_id` column.
Filed as **#261**.

## 4. Conservazione sostitutiva

**The obligation.** Ten years, from the last relevant entry (art. 2220 c.c.), for
every invoice issued and received, and conservation must be **electronic**, not
paper, for e-invoices specifically — art. 39, D.P.R. 633/1972, cited directly in
Agenzia delle Entrate's own FAQ
(https://www.agenziaentrate.gov.it/portale/schede/comunicazioni/fatture-e-corrispettivi/faq-fe/risposte-alle-domande-piu-frequenti-categoria/registrazione-e-conservazione-delle-fatture
— "potendo avvalersi di modalità di conservazione ... elettroniche - obbligatorie
per le fatture elettroniche ai sensi dell'articolo 39"). It must complete within
three months of the income-tax return deadline for the relevant period
(https://linkware.it/gestionale/conservazione-sostitutiva-documenti). Fines for
non-compliance run up to €12.000
(https://factorial.it/blog/come-rispettare-la-scadenza-conservazione-sostitutiva-per-il-2026/).

**What it requires in storage terms**, per AgID's Linee guida sulla formazione,
gestione e conservazione dei documenti informatici (in force since 1 January 2022
— https://guide.pec.it/docfly-conservazione-digitale/linee-guida-agid-sulla-conservazione.aspx):
every preserved document must keep five properties over time — autenticità,
integrità, affidabilità, leggibilità, reperibilità — and each conservation "batch"
is closed with a digital signature plus a timestamp, applied by a named
**Responsabile della Conservazione**, which cryptographically freezes it against
further change
(https://www.fattureincloud.it/guida-fatturazione-elettronica/conservazione-sostitutiva/).
Plain file storage — bytes on a disk, even backed up — does not satisfy this: it
proves nothing about when a file was frozen or who is answerable for it.

**How this interacts with invariant 4 and the backup set.** Invariant 4 ("never
keep only the extracted fields — every derived datum keeps its source document")
and conservazione sostitutiva are related but not the same obligation, and it
matters that `mastro` not conflate them. Invariant 4 is about evidentiary
completeness inside the product: a `document` row backing an `invoice`, itself
inside the backup set (`docs/backup.md` already names `DOCUMENTS_DIR` for exactly
this reason — invariant 4 is cited by name in that doc). Conservazione sostitutiva
is a distinct, formal legal process with its own actors (a named Responsabile),
its own cryptographic sealing step, and its own ten-year clock, running whether or
not `mastro`'s own backups are healthy. **Storing the generated XML as a
`document` and including it in nightly backups is necessary but not sufficient**
— it gives invariant 4 and disaster recovery, not conservazione. Building actual
conservazione sostitutiva (a Responsabile role, periodic sealing, an audit trail
that survives a `docker compose down -v`) would be a second, ongoing regulatory
subsystem, on its own compliance-audit cadence, for a single-maintainer open-source
project to carry forever.

**The way out, concretely**: Agenzia delle Entrate itself runs a **free**
conservazione service for exactly this population, opt-in, no separate
infrastructure —
"ai sensi dell'art. 1, comma 1, del D.Lgs. 127/2015 l'Agenzia delle Entrate offre
gratuitamente un servizio di conservazione delle fatture elettroniche, ai soggetti
IVA che decidono, autonomamente di aderire"
(https://www.agenziaentrate.gov.it/portale/schede/comunicazioni/fatture-e-corrispettivi/faq-fe/risposte-alle-domande-piu-frequenti-categoria/registrazione-e-conservazione-delle-fatture).
On opt-in, the sole proprietor is automatically the Responsabile della
Conservazione (same source), retention runs **fifteen years**, not merely the
statutory ten, is **not conditional on the XML itself being digitally signed**
(same FAQ page: "Il servizio dell'AE non è subordinato alla firma digitale della
FE"), and every invoice actually transmitted through SdI is picked up
automatically once enabled. This is the natural complement to "generate and hand
off" — see §5 — and costs the self-hoster nothing beyond remembering to opt in
once, which #262 turns into a visible reminder rather than a fact living only in
the person's memory.

## 5. The decision: generate and hand off

**Generate and hand off** — `mastro` produces a legally correct FatturaPA XML file
from an invoice, using data the jurisdiction pack and the practice/client records
already carry (§1), and stops there. Transmission, receipt handling, and
conservazione stay the self-hoster's own responsibility, discharged through a
channel of their choosing (§2) — most naturally the free Agenzia delle Entrate web
portal, since it needs neither a certificate nor accreditation, or PEC if they want
`mastro`'s worker to eventually help. `mastro` records what actually happened
(`transmitted` / `accepted` / `rejected`) only once the self-hoster reports it back
— by hand, or by uploading the receipt SdI actually sent them (§3) — never by
guessing or by treating "generated" as "issued."

**Why, against "generate and transmit"**, weighing the concrete tradeoff:

1. **It is what epic #3 already decided, for a reason that still holds.** The
   epic's own closing framing is explicit: "`mastro` does **not** issue invoices
   and does not talk to any tax authority: issuance stays with whatever service
   the user already pays for. What it does is _read_ what was issued... and know
   when the money is due." "Generate and transmit" reverses that decision —
   `mastro` would become the thing talking to a tax authority's system. "Generate
   and hand off" keeps the boundary the epic already drew, while finally closing
   the actual gap (today `mastro` generates nothing at all, so even a
   hand-off-only generator is a large step forward, and it is legally sufficient:
   the law requires the taxpayer to have transmitted a compliant document through
   SdI by _some_ channel, not that any particular piece of their own software be
   the one that did it).

2. **A live transmission integration cannot be expressed as pack data, and that is
   a structural problem, not a style preference.** Every fiscal capability
   `FiscalPack` carries today is a plain, declarative value or a pure function over
   one — `pack.ts`'s own header states the standing rule: "the engine ever needs
   an `if (pack.id === ...)` ... the interface below is missing a capability", and
   `StatutoryCharge`'s own comment goes further: `appliesWhen` "is a condition, not
   a callback — the engine evaluates it, **the pack never runs code**." SdI
   transmission is not a fact about a jurisdiction; it is a live network protocol
   with retries, timeouts, and side effects, and receipt parsing is stateful
   (§3's four distinct outcomes, each demanding a different write to the ledger).
   Forcing it into the pack interface would require the interface to grow a
   fundamentally different _kind_ of member — an adapter with I/O, not a field —
   the first time anything in this codebase would need that, and it would tie a
   fiscal-pack version (which changes on Italian budget-law cadence) to an
   SdI-transport concern that changes on Agenzia delle Entrate's own release
   calendar (§1: three specifiche-tecniche bumps in the period checked for this
   spike alone). Transmission code, if it existed, would have to live beside the
   pack interface, not inside it — and "generate and hand off" is what avoids
   having to answer that question at all.

3. **The maintenance load does not fit this project's shape.** "Generate and
   transmit" is not one feature; it is an ongoing regulatory-protocol
   subsystem — PEC-channel reliability, four receipt types each with different
   ledger consequences, resubmission-on-scarto with number/date preserved,
   schema-version churn (§1) — sized comparably to the fiscal engine itself, for a
   single self-hosted open-source product whose stated user "bills by the day and
   may not be a systems administrator" (`AGENTS.md`). "Generate and hand off" costs
   that same person one manual step per invoice (an upload, or copying a receipt
   id back) in exchange for `mastro` never being the thing that goes quietly
   out of spec when Agenzia delle Entrate revises a schema.

**What "generate and hand off" does not solve, named plainly**: it does not give
the self-hoster live per-invoice SdI status inside `mastro` the way a commercial
e-invoicing SaaS would, and it leaves one more manual step in the invoicing
workflow (the actual transmission click, wherever they do it) than "generate and
transmit" would. That is the real cost of this decision, accepted deliberately
against a maintenance burden the product's own single-maintainer, self-hosted
shape cannot carry indefinitely.

## 6. Pack-interface changes

Read against `src/lib/server/fiscal/pack.ts` as it exists today (`FiscalPack`,
lines 236–257; `TaxTreatment`, 116–125; `StatutoryCharge`, 160–168), the honest
finding is that **the pack interface needs exactly one new field**, because the
authors of `it-flat-rate.ts`/`it-standard.ts` already shaped `treatments` and
`charges` as if a generator were coming (the header comment on `it-flat-rate.ts`
even flags the Natura code as "not read directly against the XSD" — a note that
only makes sense if generation was already in view):

- **`FiscalPack.taxRegimeCode?: string`** — the one FatturaPA field with nowhere
  to live: `RegimeFiscale` (§1). Absent means the pack has no opinion, the same
  shape `defaultTreatment` already uses for exactly this reason. `'RF19'` on
  `it-flat-rate`, `'RF01'` on `it-standard`, absent on `generic`. Filed as **#256**.

**Everything else a generator needs is already there, and should stay exactly
where it is** — naming this explicitly matters as much as naming the one gap,
because it is the proof invariant 1 was actually followed while these packs were
built, not merely intended:

- `Natura`/tax rate ← `TaxTreatment.code` + `resolveDefaultTaxTreatment` (no
  change).
- Stamp duty ← `StatutoryCharge` (slot `'stamp_duty'`) + `evaluateInvoiceCharges`,
  already summed onto the invoice row (no change).
- Progressive numbering ← `invoice.number`, a domain/schema concern, not a pack
  one — uniqueness is universal, not Italy-specific, so nothing about it belongs
  in a pack (fixed as a plain schema defect, **#257**, independent of this spike's
  main thread).
- The specifiche-tecniche schema **version** (§1) — deliberately **not** a pack
  field. It is a transport/format-infrastructure fact tied to Agenzia delle
  Entrate's own release calendar, unrelated to which fiscal regime governs an
  issuer, and belongs beside the #41 import-adapter interface (`InvoiceFormatAdapter`)
  as a generation-direction sibling selected by `pack.formats`'s existing opaque
  id — never inside `pack.ts` itself. Filed as **#260**.
- The issuer's own identity (P.IVA, codice fiscale, address) and a client's SDI
  routing address — neither is jurisdiction data either: one is the practice's own
  identity (parallel to how `client.taxId` already isn't pack data), the other is
  counterparty data, per invariant 2's own test ("contract rules follow the
  counterparty"). Filed as **#258** and **#259**.

## 7. Follow-up issues filed

All seven filed against `fiorelorenzo/mastro`, milestone `v0`, linked as GitHub
sub-issues of epic #4 (Jurisdiction packs) or epic #3 (Invoices, payments and
ageing) as noted, with `Status`/`Priority`/`Effort`/`Parallel` set on the project
board (Project #8):

| #                                                         | Title                                                                       | Scope                                                                                                           | Effort | Epic |
| --------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ | ---- |
| [#256](https://github.com/fiorelorenzo/mastro/issues/256) | `feat(fiscal): give the pack interface an issuer tax-regime code`           | Add `FiscalPack.taxRegimeCode`; `'RF19'`/`'RF01'` on the two Italian packs                                      | S      | #4   |
| [#257](https://github.com/fiorelorenzo/mastro/issues/257) | `fix(domain): invoice numbering is unique per contract, not per issuer`     | Fix the numbering-uniqueness constraint to match the law and the code's own comment                             | S      | #3   |
| [#258](https://github.com/fiorelorenzo/mastro/issues/258) | `feat(domain): the practice's own fiscal identity`                          | A singleton `practice_profile` (legal name, VAT id, codice fiscale, address) for the invoice's own issuer block | S      | #3   |
| [#259](https://github.com/fiorelorenzo/mastro/issues/259) | `feat(domain): client SDI routing address (codice destinatario / PEC)`      | `client.sdiCode`/`pecAddress` so a handed-off invoice can be routed                                             | S      | #3   |
| [#260](https://github.com/fiorelorenzo/mastro/issues/260) | `feat(fiscal): generate FatturaPA XML for the active pack's invoice format` | The generator itself: a generation-direction sibling to the #41 import adapter                                  | L      | #3   |
| [#261](https://github.com/fiorelorenzo/mastro/issues/261) | `feat(invoices): record hand-off transmission status and SdI receipts`      | Transmission-status lifecycle on `invoice`; a rejected invoice drops out of revenue                             | M      | #3   |
| [#262](https://github.com/fiorelorenzo/mastro/issues/262) | `docs(fiscal): conservazione sostitutiva guidance for a self-hoster`        | Point the self-hoster at AdE's free conservazione service; one visible reminder                                 | S      | #3   |

Dependency order: #256, #257, #258, #259 are independent of each other; #260
depends on all four; #261 depends on #260; #262 depends on #261.
