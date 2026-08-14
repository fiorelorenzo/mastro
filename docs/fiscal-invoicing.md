# Conservazione sostitutiva: what mastro does not do for you (#262)

mastro's document store (`DOCUMENTS_DIR`, the `document` table, already in the
backup set — docs/backup.md) proves what was said and what was signed: invariant
4 in AGENTS.md keeps every derived datum next to its source document, so a client
dispute is settled by the original message, not the row an extraction produced
from it. That is **evidence**. It is not **conservazione sostitutiva** — a
separate, statutory, ten-year process that requires periodic cryptographic
sealing and a named human accountable for it, which storing bytes, even backed
up nightly, does not attempt. #247's spike into electronic invoicing found this
gap and scoped it into this issue
(`docs/specs/2026-08-14-electronic-invoicing.md` §4); this page, plus one
reminder in Settings, is what that finding turns into for a self-hoster who
has to actually discharge the obligation somewhere.

## The obligation

Every VAT-registered issuer of Italian e-invoices — forfettario or not, and
without exception since 1 January 2024 for the flat-rate regime
(`docs/specs/2026-08-14-electronic-invoicing.md` §0) — has to conserve both the
invoices they issue and the ones they receive:

- **Ten years from the date of the last entry.** Art. 2220 of the Codice
  Civile: "Le scritture devono essere conservate per dieci anni dalla data
  dell'ultima registrazione. Per lo stesso periodo devono conservarsi le
  fatture..."
  (https://www.brocardi.it/codice-civile/libro-quinto/titolo-ii/capo-iii/sezione-iii/art2220.html).
- **Electronically, not on paper, specifically because the invoice is
  electronic.** Art. 39, D.P.R. 26 ottobre 1972, n. 633, cited directly in
  Agenzia delle Entrate's own FAQ: conservation must use "modalità di
  conservazione ... elettroniche - obbligatorie per le fatture elettroniche ai
  sensi dell'articolo 39"
  (https://www.agenziaentrate.gov.it/portale/schede/comunicazioni/fatture-e-corrispettivi/faq-fe/risposte-alle-domande-piu-frequenti-categoria/registrazione-e-conservazione-delle-fatture).
- **Completed within three months of the income-tax return deadline** for the
  relevant year (art. 7, comma 4-ter, D.L. 10 giugno 1994, n. 357, as applied
  to conservazione by Agenzia delle Entrate's risoluzione n. 46 del 10 aprile
  2017). Concretely: invoices issued and received in 2024 had to be conserved
  by 31 January 2026
  (https://www.fattureincloud.it/guida-fatturazione-elettronica/conservazione-sostitutiva/;
  mechanics corroborated at
  https://www.informazionefiscale.it/conservazione-fatture-elettroniche-scadenza-2026-forfettari).
- **Fines for not doing it: €1.000–€8.000 per year**, under art. 9, comma 1,
  D.Lgs. 18 dicembre 1997, n. 471 — "Chi non tiene o non conserva secondo le
  prescrizioni le scritture contabili, i documenti e i registri... è punito
  con la sanzione amministrativa da euro 1.000 a euro 8.000" — doubled to
  **€2.000–€16.000** if the tax evasion the missing records would have caught
  exceeds €50.000 in the year (same article, comma 3), read directly from
  Agenzia delle Entrate's own text of the decree
  (https://www.agenziaentrate.gov.it/portale/documents/20143/270670/Decreto+legislativo+18+dicembre+1997+n+471_Decreto+legislativo+del+18_12_1997+n.+471.pdf/441bd764-7997-5332-e3b0-994356c07d5d,
  articolo 9). Secondary guides quote other figures for adjacent, narrower
  provisions of the same decree — the range above is the statute's own text
  for the general case, not a paraphrase.
- **The fine is the smaller risk.** A document that was never conserved a
  norma is, evidentially, as if it never existed: Agenzia delle Entrate can
  disregard it in an audit, opening the door to an accertamento induttivo
  (income reconstructed from presumptions instead of your own records) and to
  a disallowed cost or a disallowed VAT credit
  (https://centrofiscale.com/conservazione-sostitutiva-fatture-elettroniche-2026/;
  corroborated at
  https://www.fattureincloud.it/guida-fatturazione-elettronica/conservazione-sostitutiva/).

## Why a folder of files is not conservation

**Archiviazione** (plain storage — a disk, a synced folder, a nightly backup)
and **conservazione sostitutiva** (the legal process) are not the same thing,
and the difference is exactly the one invariant 4 does not cover
(https://centrofiscale.com/conservazione-sostitutiva-fatture-elettroniche-2026/).
AgID's Linee guida sulla formazione, gestione e conservazione dei documenti
informatici, in force since 1 January 2022, require every conserved document to
keep five properties over time — **autenticità, integrità, affidabilità,
leggibilità, reperibilità** — through "l'adozione di regole, procedure e
tecnologie"
(https://docs.italia.it/AgID/documenti-in-consultazione/lg-documenti-informatici-docs/it/bozza/conservazione.html,
§4.1). In practice that means documents are grouped into batches ("pacchetti
di versamento"/"di archiviazione"), and each batch is closed with a digital
signature and a marca temporale, applied by a named **Responsabile della
Conservazione** — a role the same guidelines define with specific, ongoing
duties: setting the conservation policy, signing the versamento and
distribuzione packets, checking integrity and readability on a cadence no
longer than five years, and watching for format obsolescence (§4.6 of the same
guidelines). Plain file storage, however reliable, proves none of this: it
cannot show when a file was frozen against later change or who is answerable
for it.

## Why mastro does not attempt this itself

mastro already does the part invariant 4 asks for: every invoice-related
document lands in the `document` table and `DOCUMENTS_DIR`, and both are in
the nightly backup set (docs/backup.md) precisely because losing them would
break invariant 4's evidentiary chain. **That is necessary, not sufficient.**
It gives evidentiary completeness inside the product and disaster recovery if
the box dies — not the sealing, not the Responsabile, not the audit cadence
conservazione sostitutiva actually requires.

The spike into electronic invoicing weighed building real conservazione
sostitutiva against the alternative and chose **"generate and hand off"**
(`docs/specs/2026-08-14-electronic-invoicing.md` §5): mastro will produce a
legally correct FatturaPA XML file from an invoice (#260, not built yet) and
stop there — transmission, receipt handling, and conservazione all stay the
self-hoster's own responsibility, discharged through a channel of their own
choosing. This is not an oversight; it is the same boundary epic #3 already
drew: "mastro does **not** issue invoices and does not talk to any tax
authority... issuance stays with whatever service the user already pays for."
Building real conservazione would mean maintaining a second, ongoing
regulatory subsystem indefinitely — a Responsabile role, periodic sealing, an
audit trail that survives a `docker compose down -v` — on top of the fiscal
engine mastro already maintains, for a single-maintainer, self-hosted product.
It would also put mastro in the business either of becoming an AgID-accredited
conservatore itself or of reimplementing the pacchetto/versamento interchange
format those conservatori already share (UNI 11386) — machinery with nothing
to do with tracking a consultant's billable days.

## The free route

Agenzia delle Entrate itself runs a conservation service for exactly this
population, and it costs nothing:

- **Free, opt-in, for anyone who transmits through SdI.** "Ai sensi dell'art.
  1, comma 1, del D.Lgs. 127/2015 l'Agenzia delle Entrate offre gratuitamente
  un servizio di conservazione delle fatture elettroniche, ai soggetti IVA che
  decidono, autonomamente di aderire"
  (https://www.agenziaentrate.gov.it/portale/schede/comunicazioni/fatture-e-corrispettivi/faq-fe/risposte-alle-domande-piu-frequenti-categoria/registrazione-e-conservazione-delle-fatture).
- **You become the Responsabile della Conservazione automatically.** On
  opt-in, "il titolare dell'azienda... in qualità di titolare dell'oggetto di
  conservazione accetta di essere individuato quale Responsabile della
  Conservazione" — no separate appointment, no accreditation of your own
  (same source).
- **Fifteen years, not merely the statutory ten**, and it survives closing
  the partita IVA: "Se il soggetto chiude la partita iva, la conservazione
  elettronica con l'Agenzia delle Entrate è assicurata?... Si per 15 anni"
  (same source).
- **Not conditional on the invoice itself being digitally signed.** "Il
  servizio dell'AE non è subordinato alla firma digitale della FE" (same
  source) — a real difference from the DIY path, which needs its own firma
  digitale to work at all.
- **Scope limit worth knowing:** it conserves only invoices actually
  transitate dal Sistema di Interscambio — not paper invoices, not documents
  received outside SdI (e.g. from a supplier who was legitimately exempt from
  e-invoicing), and not the other documents mastro's own store holds
  (contracts, approval evidence): "il servizio di conservazione
  dell'Agenzia delle Entrate... è utilizzabile solo per le fatture
  elettroniche emesse e ricevute tramite SdI" (same source).
- **How to enroll**, read directly off Agenzia delle Entrate's own page: sign
  into the "Fatture e Corrispettivi" portal, follow "Fatturazione elettronica
  e Conservazione" → "Accedi alla sezione conservazione", review the Manuale
  del servizio di Conservazione and the Accordo di servizio, and sign
  (https://www.agenziaentrate.gov.it/portale/aree-tematiche/fatturazione-elettronica/guida-fatturazione-elettronica/i-servizi-dell-agenzia-fe/servizio-conservazione-elettronica).
  The same page confirms retroactive coverage is available for invoices
  already transmitted through SdI before enrollment, back to no earlier than
  1 January of the second calendar year before the enrollment date; without
  requesting a retroactive date, only invoices from the day after enrollment
  onward are picked up.

This is the natural complement to mastro's own "generate and hand off"
decision: neither step asks the self-hoster to run any infrastructure of
their own.

## If you already pay for an alternative

Plenty of invoicing subscriptions and AgID-accredited conservatori already
bundle conservazione into what you pay for — Aruba, Fatture in Cloud,
Namirial, InfoCert, TeamSystem and other accredited conservatori, roughly
€24–€200+/year depending on volume and whether the provider is your
invoicing software or a dedicated conservatore
(https://centrofiscale.com/conservazione-sostitutiva-fatture-elettroniche-2026/).
If that is already true for you, there is nothing to change on mastro's
side: mastro's own document store keeps doing exactly what it already does
(evidence, inside the backup set), your existing subscription keeps
discharging the statutory obligation the way it already does, and mastro
does not integrate with any of them — under "generate and hand off," the
self-hoster's own transmission and conservation channel is out of scope by
design (`docs/specs/2026-08-14-electronic-invoicing.md` §5). The one thing
worth checking periodically either way, AdE's free service or a paid one, is
that the enrollment is still active and not silently lapsed — which is what
the reminder below is for.

## The reminder

mastro is not the party that transmits your invoices (#261's transmission-
status lifecycle is not built yet either), so it has no way to see whether
you ever opted in anywhere, and cannot alert on a lapse the way it does for
its own backups (docs/backup.md). What it can do is stop "did I ever actually
opt in" from being a fact that lives only in your memory: Settings carries a
permanent note pointing back to this document, so the answer is something you
look up, not something you try to recall.
