# AI trial fixtures — contract-from-PDF (#86) and invoice-from-PDF (#87)

Preparation material only. No product code touched; nothing committed. Nine PDFs live in
`/tmp/ai-trial/`: the required 4 contracts + 4 invoices, plus one bonus scanned-image PDF
flagged as the hard OCR case per the assignment's "5th case" allowance.

## How these were generated

1. **Source content** was hand-written HTML per document (Italian contract/invoice prose,
   full field layout, `docs/specs` visual conventions not used — these are source documents
   the _product_ would ingest, not mastro UI). Built with a shared print stylesheet
   (`Liberation Serif`, justified body, A4, 2.2cm margins) to look like a real
   Word/LibreOffice-exported contract or invoicing-software invoice, not a styled web page.
2. **HTML → PDF**: `weasyprint <file>.html <file>.pdf` (WeasyPrint 62.3, confirmed present on
   this box; chosen over `pandoc`/Chrome headless because its print CSS support gave the most
   reliable control over the letterhead/table layout with the least fighting). All 8 required
   PDFs report `Producer: WeasyPrint 62.3` in `pdfinfo`.
3. **Scanned-image bonus case**: the 9th document was first rendered normally, rasterized to a
   200dpi PNG with `pdftoppm -r 200 -png`, then re-encoded as an **image-only** PDF via
   `PIL.Image.save(..., "PDF")` — i.e. one JPEG/PNG-backed page with no text layer at all, the
   same shape a phone photo or flatbed scan of a paper letter produces. Confirmed below:
   `pdftotext` returns zero characters for it.
4. **Validity + extractability check**: `pdfinfo` (poppler) on every file confirms a well-formed
   PDF (page count, page size, producer, no corruption); `pdftotext` on every file confirms the
   8 required documents have real, non-trivial extractable text, and confirms the 9th does not.

### Text extraction proof

Method: `pdfinfo <file>` for structural validity, `pdftotext <file> -` for extractable text
(non-whitespace character count). Table below is the literal command output.

| file                                        | pages | extractable non-whitespace chars |
| ------------------------------------------- | ----- | -------------------------------- |
| bonus-scan-nord-meccanica-notice.pdf        | 1     | 0                                |
| contract-a-day-rate-approval.pdf            | 2     | 3247                             |
| contract-b-continuous-concentration-cap.pdf | 2     | 3040                             |
| contract-c-monthly-retainer.pdf             | 2     | 2334                             |
| contract-d-awkward-addendum-renewal.pdf     | 3     | 3750                             |
| invoice-1-outgoing-ordinario.pdf            | 1     | 1059                             |
| invoice-2-outgoing-forfettario.pdf          | 1     | 996                              |
| invoice-3-outgoing-rounding-mixed.pdf       | 1     | 1110                             |
| invoice-4-incoming-reverse-charge.pdf       | 1     | 771                              |

`pdfinfo` for `invoice-1-outgoing-ordinario.pdf` (structural validity):

```
Title:           Fattura 2026-018 Vetraria del Garda
Producer:        WeasyPrint 62.3
Custom Metadata: no
Metadata Stream: no
Tagged:          no
UserProperties:  no
Suspects:        no
Form:            none
JavaScript:      no
Pages:           1
Encrypted:       no
Page size:       595.276 x 841.89 pts (A4)
Page rot:        0
File size:       14339 bytes
Optimized:       no
PDF version:     1.7
```

First 200 characters of `pdftotext -layout invoice-1-outgoing-ordinario.pdf -` (proof of
extractable text, as required by the acceptance criteria):

```
dott. Elia Fontana                                                                                         Spett.le
Consulente indipendente
```

`pdfinfo` for the bonus scan (still a structurally valid, single-page PDF — the _text layer_
is what's missing, not the file):

```
Title:           bonus-scan-nord-meccanica-notice
CreationDate:    Thu Aug 13 17:45:50 2026 CEST
ModDate:         Thu Aug 13 17:45:50 2026 CEST
Custom Metadata: no
Metadata Stream: no
Tagged:          no
UserProperties:  no
Suspects:        no
Form:            none
JavaScript:      no
Pages:           1
Encrypted:       no
Page size:       595.44 x 842.04 pts (A4)
Page rot:        0
File size:       119118 bytes
Optimized:       no
PDF version:     1.4
```

### File list

```
bonus-scan-nord-meccanica-notice.pdf: 119118 bytes
contract-a-day-rate-approval.pdf: 20590 bytes
contract-b-continuous-concentration-cap.pdf: 20407 bytes
contract-c-monthly-retainer.pdf: 19849 bytes
contract-d-awkward-addendum-renewal.pdf: 22785 bytes
invoice-1-outgoing-ordinario.pdf: 14339 bytes
invoice-2-outgoing-forfettario.pdf: 13543 bytes
invoice-3-outgoing-rounding-mixed.pdf: 13967 bytes
invoice-4-incoming-reverse-charge.pdf: 13812 bytes
```

No document was left ungenerated — all 9 planned files (8 required + 1 bonus) exist and pass
the checks above.

## Shared identity used across every fixture

The consultant (the product's account holder, matching `.env`'s
`ACCOUNT_HOLDER_TAX_ID=01234567890`) is invented as:

**dott. Elia Fontana**, consulente indipendente, Via Solferino 14, 20121 Milano (MI),
C.F./P.IVA `01234567890`, IBAN `IT60X0542811101000000123456`, PEC `elia.fontana@pec.it`.
Regime varies by contract (ordinario for contracts A/B/D, forfettario for C) — realistic,
since a sole consultant's regime doesn't change per-client, but the annual-revenue threshold
that keeps someone in regime forfettario is exactly the kind of thing this test set does not
resolve; treat the regime label per contract as given, not cross-checked.

Every client and every counterparty (Vetraria del Garda, Bramante Costruzioni, Ottavia Media
Group, Nord Meccanica, NimbusFlow Technologies) is fully invented: names, P.IVA/tax ids,
addresses and amounts are fictitious. Contractual structure and phrasing (Premesse, Oggetto,
Corrispettivo, Durata e rinnovo, Recesso, Riservatezza, Foro competente) follows real Italian
consulting-contract convention.

## Ground truth per document

Each block below names exactly the fields the corresponding proposal (`#86`'s `contract` +
`rate_card` rows, `#87`'s `invoice` + `invoice_line` rows) would need, using the schema in
`src/lib/server/db/schema/{contract,rate-card,invoice}.ts`. Monetary columns typed
`MinorUnits` in the schema (`invoice.taxableAmount/taxAmount/total/stampDuty/socialCharge`,
`invoice_line.unitPrice/amount`) are given as `*Cents` integers; `rate_card.amount` is a plain
decimal (its own column is `numeric(12,2)`, not `MinorUnits`) — this distinction is itself
worth an extractor getting right. `outOfScope` lists fields the schema has but no PDF could
ever supply (operator-set mailbox/UI concerns, per the schema's own doc comments) — a
proposal that invents values for these instead of leaving them unset would be worse than one
that leaves them blank.

### Contract A — Vetraria del Garda S.p.A. (day rate + prior approval)

`contract-a-day-rate-approval.pdf` — the plain-vanilla archetype: fixed 12-month term, no
renewal, day-rate with prior-approval gate and half-days.

```json
{
	"sourceDocument": "contract-a-day-rate-approval.pdf",
	"proposal": {
		"targetType": "contract",
		"contractId": null
	},
	"client": {
		"legalName": "Vetraria del Garda S.p.A.",
		"taxId": "02871450230",
		"contactName": "ing. Chiara Bellonio",
		"address": "Via Industriale 8, 25015 Desenzano del Garda (BS)"
	},
	"contract": {
		"title": "Contratto di Consulenza Professionale — Vetraria del Garda S.p.A. (Rep. n. 14/2025)",
		"signedDocumentReference": "Rep. n. 14/2025",
		"startsOn": "2025-09-01",
		"endsOn": "2026-08-31",
		"renewalType": "none",
		"renewalNoticeDays": null,
		"terminationNoticeDays": 45,
		"paymentTerms": {
			"kind": "net",
			"days": 30
		},
		"invoicingCadence": "monthly",
		"currency": "EUR",
		"taxTreatment": "IVA ordinaria 22% (nessun regime agevolato indicato nel contratto)",
		"requiresPriorApproval": true,
		"requiresExpensePreAuthorisation": true,
		"expensePolicy": {
			"kind": "reimbursed_at_cost"
		},
		"status": "draft"
	},
	"rateCards": [
		{
			"validFrom": "2025-09-01",
			"validTo": null,
			"kind": "daily",
			"amount": 650.0,
			"unit": "day",
			"allowedFractions": [1, 0.5],
			"minimumHours": null,
			"disbursementPeriod": null
		}
	],
	"outOfScope": ["autoSendMail", "templateLanguage", "mailFolder"],
	"hard": [
		"Art. 5 says the contract ends 31/08/2026 'senza tacito rinnovo' (renewalType='none') but also invites the parties to sign 'un nuovo contratto' afterward — a reader could mistake this for a scheduled renewal obligation. It is not: it is an option, not a term. Flag rather than infer a follow-on contract.",
		"Expense pre-authorisation is required ('previamente autorizzate per iscritto') but the document names no channel, form or deadline for that authorisation — cannot be operationalised beyond the boolean flag.",
		"'IVA esclusa' appears on the rate but the document never states the applicable rate or the consultant's VAT regime; 22% (Italy's standard rate) is inferred, not read, and should be flagged as an inference, not fact."
	]
}
```

### Contract B — Bramante Costruzioni S.r.l. (continuous engagement + concentration cap)

`contract-b-continuous-concentration-cap.pdf` — no per-day approval, hourly billing with a
per-intervention minimum, tacit annual renewal, and a concentration-cap clause that is
informational, not a hard rule.

```json
{
	"sourceDocument": "contract-b-continuous-concentration-cap.pdf",
	"proposal": {
		"targetType": "contract",
		"contractId": null
	},
	"client": {
		"legalName": "Bramante Costruzioni S.r.l.",
		"taxId": "03456781098",
		"contactName": "dott.ssa Livia Marchetti",
		"address": "Via dei Mille 22, 40121 Bologna (BO)"
	},
	"contract": {
		"title": "Contratto di Assistenza Tecnica Continuativa — Bramante Costruzioni S.r.l. (Rep. n. 3/2026)",
		"signedDocumentReference": "Rep. n. 3/2026",
		"startsOn": "2026-01-01",
		"endsOn": "2026-12-31",
		"renewalType": "tacit",
		"renewalNoticeDays": 60,
		"terminationNoticeDays": 90,
		"paymentTerms": {
			"kind": "net",
			"days": 30
		},
		"invoicingCadence": "monthly",
		"currency": "EUR",
		"taxTreatment": "IVA ordinaria 22% (nessun regime agevolato indicato nel contratto)",
		"requiresPriorApproval": false,
		"requiresExpensePreAuthorisation": false,
		"expensePolicy": {
			"kind": "reimbursed_with_cap",
			"capAmount": 50000
		},
		"status": "draft"
	},
	"rateCards": [
		{
			"validFrom": "2026-01-01",
			"validTo": null,
			"kind": "hourly",
			"amount": 95.0,
			"unit": "hour",
			"allowedFractions": [1],
			"minimumHours": 2.0,
			"disbursementPeriod": null
		}
	],
	"outOfScope": ["autoSendMail", "templateLanguage", "mailFolder"],
	"hard": [
		"Two different notice periods appear for what could be read as the same act: 60 days to block renewal (Art. 6) vs 90 days for 'recesso anticipato... anche nel corso della sua vigenza' (Art. 7). A model that collapses these into one terminationNoticeDays will silently drop one of the two real numbers — they are genuinely different clauses (non-renewal vs mid-term withdrawal) and both must survive extraction.",
		"Art. 3's 35% concentration cap is described as informational ('formerà oggetto di reciproca informativa'), explicitly NOT a termination trigger. A model that reads 'tetto di concentrazione' and proposes it as a hard ceiling or as grounds for termination would misrepresent the clause; this is a contract term to store as text, not a number to feed the fiscal ceiling engine (the ceiling is computed by the product from real revenue, never asserted by a contract clause).",
		"allowedFractions [1] is assigned by convention for an hourly rate card since the concept ('half day at half fee') is a daily-rate idea the document never addresses for hourly billing — this is a schema default applied in the absence of any text on point, not something read off the document; a reviewer should confirm it rather than trust it as extracted fact.",
		"minimumHours=2.00 is the *per-intervento* minimum stated in Art. 2 ('minimo fatturabile di 2 ore per singolo intervento'), which is a different concept from a monthly minimum — worth flagging so the accept dispatcher doesn't read it as 2 billable hours per month."
	]
}
```

### Contract C — Ottavia Media Group S.r.l. (flat monthly retainer)

`contract-c-monthly-retainer.pdf` — no days or hours at all, `fixed_recurring` rate card only,
regime forfettario, advance (not arrears) monthly invoicing.

```json
{
	"sourceDocument": "contract-c-monthly-retainer.pdf",
	"proposal": {
		"targetType": "contract",
		"contractId": null
	},
	"client": {
		"legalName": "Ottavia Media Group S.r.l.",
		"taxId": "04521367890",
		"contactName": "dott. Tommaso Reguzzi",
		"address": "Corso Venezia 45, 20121 Milano (MI)"
	},
	"contract": {
		"title": "Contratto di Consulenza Strategica in Comunicazione — Ottavia Media Group S.r.l. (Rep. n. 1/2026)",
		"signedDocumentReference": "Rep. n. 1/2026",
		"startsOn": "2026-01-01",
		"endsOn": "2026-12-31",
		"renewalType": "tacit",
		"renewalNoticeDays": 30,
		"terminationNoticeDays": 30,
		"paymentTerms": {
			"kind": "net",
			"days": 15
		},
		"invoicingCadence": "monthly",
		"currency": "EUR",
		"taxTreatment": "regime forfettario (L. 190/2014) — operazioni senza applicazione dell'IVA, senza ritenuta d'acconto",
		"requiresPriorApproval": false,
		"requiresExpensePreAuthorisation": false,
		"expensePolicy": {
			"kind": "not_reimbursed"
		},
		"status": "draft"
	},
	"rateCards": [
		{
			"validFrom": "2026-01-01",
			"validTo": null,
			"kind": "fixed_recurring",
			"amount": 2400.0,
			"unit": "month",
			"allowedFractions": [1],
			"minimumHours": null,
			"disbursementPeriod": "monthly"
		}
	],
	"outOfScope": ["autoSendMail", "templateLanguage", "mailFolder"],
	"hard": [
		"Art. 1 explicitly decouples the fee from any days or hours ('non collegata a un numero predeterminato di giornate o di ore') — there is no rate card of kind 'daily' or 'hourly' to propose at all, only 'fixed_recurring'. A model trained mostly on day-rate contracts may default to proposing a daily card anyway; this document has none and shouldn't get one invented.",
		"'Fatturazione mensile anticipata' (invoiced in advance) is stated but nothing in the schema's `invoicingCadence` enum distinguishes advance from arrears billing — the timing-within-cadence detail is lost unless carried in a free-text clause note.",
		"The document states the consultant's own VAT regime (forfettario) as the reason no IVA applies — this is a fact about the *consultant*, not the client, and should not be confused with a client-side tax exemption."
	]
}
```

### Contract D — Nord Meccanica S.p.A. (awkward: addendum + contradictory renewal)

`contract-d-awkward-addendum-renewal.pdf` — one PDF carrying **two** documents in sequence:
the original 24-month contract (Ferrara, 15/01/2025) followed by "Atto integrativo n. 1"
(01/03/2026) that changes only the day rate from 01/04/2026. The original contract's own
Art. 4 and Art. 9 give two irreconcilable readings of whether the contract tacitly renews —
this is deliberately the same scenario issue #86 names as the reason the issue exists at all.
The payment-terms idiom ("60 gg d.f. fine mese") also doesn't fit the schema's `PaymentTerms`
union cleanly. Genuinely hard, not decorative: an extractor that silently resolves either
ambiguity has failed the acceptance criterion ("An ambiguous clause blocks silent acceptance
and requires an explicit choice").

```json
{
	"sourceDocument": "contract-d-awkward-addendum-renewal.pdf",
	"proposal": {
		"targetType": "contract",
		"contractId": null
	},
	"client": {
		"legalName": "Nord Meccanica S.p.A.",
		"taxId": "01987654321",
		"contactName": "ing. Davide Orsini",
		"address": "Via Ferrarese 120, 44122 Ferrara (FE)"
	},
	"contract": {
		"title": "Contratto di Consulenza Tecnica — Nord Meccanica S.p.A. (Rep. n. 2/2025)",
		"signedDocumentReference": "Rep. n. 2/2025",
		"startsOn": "2025-02-01",
		"endsOn": "AMBIGUOUS — see hard[0]; literal next boundary named in the document is 2027-01-31",
		"renewalType": "AMBIGUOUS — see hard[0]",
		"renewalNoticeDays": "AMBIGUOUS — 60 under the Art. 4 reading, null under the Art. 9 reading",
		"terminationNoticeDays": 30,
		"paymentTerms": "AMBIGUOUS — see hard[1]; not cleanly net-N nor day-of-month",
		"invoicingCadence": "monthly",
		"currency": "EUR",
		"taxTreatment": "IVA ordinaria 22% (nessun regime agevolato indicato nel contratto)",
		"requiresPriorApproval": true,
		"requiresExpensePreAuthorisation": true,
		"expensePolicy": {
			"kind": "reimbursed_with_cap",
			"capAmount": 30000
		},
		"status": "draft"
	},
	"rateCards": [
		{
			"validFrom": "2025-02-01",
			"validTo": "2026-03-31",
			"kind": "daily",
			"amount": 580.0,
			"unit": "day",
			"allowedFractions": [1, 0.5],
			"minimumHours": null,
			"disbursementPeriod": null,
			"source": "Art. 3 of the original contract, 15/01/2025"
		},
		{
			"validFrom": "2026-04-01",
			"validTo": null,
			"kind": "daily",
			"amount": 620.0,
			"unit": "day",
			"allowedFractions": [1, 0.5],
			"minimumHours": null,
			"disbursementPeriod": null,
			"source": "Atto integrativo n. 1, Art. 1, signed 01/03/2026, effective 01/04/2026"
		}
	],
	"outOfScope": ["autoSendMail", "templateLanguage", "mailFolder"],
	"hard": [
		"THE CENTRAL CASE (issue #86's own example): Art. 4 says the contract 'si intende tacitamente rinnovato per ulteriori 12 mesi... salvo disdetta' (tacit renewal, 60 days' notice to block it) naming the term expiring 31/01/2027. Art. 9 ('Disposizioni finali') says the opposite in the same document: the contract 'cesserà automaticamente alla scadenza... senza necessità di disdetta e senza possibilità di rinnovo tacito o automatico'. These cannot both be true. Reading A (Art. 4 controls, tacit renewal, notice governs): renewalType='tacit', renewalNoticeDays=60, endsOn effectively extends past 2027-01-31 absent notice. Reading B (Art. 9 controls, the later/more specific 'disposizioni finali' article, fixed term): renewalType='none', renewalNoticeDays=null, endsOn=2027-01-31 firm. The addendum (Art. 2) explicitly leaves 'quanto disposto dagli Artt. 4 e 9' untouched, so it resolves nothing. This must produce a proposal with both readings and a required human choice, recorded in the contract's clause notes, exactly as #86 specifies — not a silent pick of either article.",
		"Art. 6's payment term, 'a 60 giorni data fattura fine mese' ('60 gg d.f. fine mese'), is a common Italian idiom that does not map cleanly onto either `PaymentTerms` variant the schema defines ({kind:'net', days} or {kind:'day_of_month', day, monthOffset:1}): it means the 60-day count starts from the end of the invoice's month, not from the invoice date itself, and lands on a date, not a fixed day-of-month. Forcing it into {kind:'net', days:60} understates the real due date by up to 30 days — worth flagging as a term the schema's two-variant union cannot represent losslessly, not silently approximating one of the two.",
		"The addendum changes only Art. 3 (the rate) and says so explicitly ('resta fermo... la formulazione originaria' for periods before 01/04/2026) — a model must produce two adjacent, non-overlapping rate_card rows (validTo of the first = day before validFrom of the second, per the exclusion-constraint convention documented on rate_card), not overwrite the original rate or merge the two into one card.",
		"The addendum itself is undated relative to 'today' only by inference — it is dated 01/03/2026, safely in the past relative to the fixture's 'today' of 13/08/2026, so both rate periods are already in effect; a reviewer should not assume the second card is a future, not-yet-active rate."
	]
}
```

### Invoice 1 — outgoing, regime ordinario, ritenuta d'acconto

`invoice-1-outgoing-ordinario.pdf` — three-line invoice against Contract A (6 full days, 1
half day, one reimbursed-expense line), with a printed ritenuta d'acconto deduction the
schema has no column for.

```json
{
	"sourceDocument": "invoice-1-outgoing-ordinario.pdf",
	"proposal": {
		"targetType": "invoice"
	},
	"direction": {
		"kind": "outgoing",
		"reasoning": "supplier.taxId 01234567890 == ACCOUNT_HOLDER_TAX_ID 01234567890"
	},
	"supplier": {
		"legalName": "Elia Fontana",
		"taxId": "01234567890",
		"country": "IT",
		"addressLine1": "Via Solferino 14",
		"addressCity": "Milano",
		"addressPostalCode": "20121"
	},
	"customer": {
		"legalName": "Vetraria del Garda S.p.A.",
		"taxId": "02871450230",
		"country": "IT",
		"addressLine1": "Via Industriale 8",
		"addressCity": "Desenzano del Garda",
		"addressPostalCode": "25015"
	},
	"invoice": {
		"contractReference": "Contratto di Consulenza Professionale Rep. n. 14/2025 del 20/08/2025",
		"number": "2026/018",
		"issueDate": "2026-08-05",
		"documentType": "invoice",
		"currency": "EUR",
		"taxableAmountCents": 440500,
		"taxAmountCents": 96910,
		"totalCents": 537410,
		"taxTreatmentCode": null,
		"statutoryReference": null,
		"stampDutyCents": null,
		"socialChargeCents": null,
		"dueDate": "2026-09-04",
		"dueDateSource": "computed",
		"paymentMethod": "bonifico bancario",
		"iban": "IT60X0542811101000000123456"
	},
	"lines": [
		{
			"description": "Attività di consulenza — luglio 2026 — giornate intere approvate",
			"quantity": 6,
			"unitPriceCents": 65000,
			"amountCents": 390000,
			"taxRate": 22
		},
		{
			"description": "Attività di consulenza — luglio 2026 — mezza giornata approvata",
			"quantity": 1,
			"unitPriceCents": 32500,
			"amountCents": 32500,
			"taxRate": 22
		},
		{
			"description": "Rimborso spese di trasferta (vitto, trasporto) — luglio 2026",
			"quantity": 1,
			"unitPriceCents": 18000,
			"amountCents": 18000,
			"taxRate": 22
		}
	],
	"hard": [
		"The document prints two 'total' lines: 'TOTALE FATTURA' € 5.374,10 and, below a ritenuta d'acconto deduction, 'NETTO A PAGARE' € 4.493,10. The `invoice.total` column must be the document's own stated total (5374.10, the pre-withholding figure epic #3 names), not the net-to-pay figure a naive reader would grab as 'the number the client actually transfers' — the two are 881.00 apart and picking the wrong one silently understates revenue.",
		"The schema's `invoice` table has NO column for ritenuta d'acconto (Italian withholding tax): `taxableAmount`, `taxAmount`, `total`, `stampDuty` and `socialCharge` are the only monetary fields, and none of them is 'tax withheld by the client and remitted to the state on the consultant's behalf'. This is a genuine capability gap, not an extraction error — the ritenuta text (20%, art. 25 D.P.R. 600/1973) should be flagged as present-but-unrepresented rather than silently dropped or misfiled into `taxAmount` (which is IVA, a different tax).",
		"The expense reimbursement line is taxed at 22% here (bundled into the professional invoice as ordinary revenue) rather than treated as a VAT-excluded pass-through under art. 15 D.P.R. 633/72 — a plausible alternative reading a reviewer familiar with Italian invoicing practice might expect; the document's own 22% treatment should be read as given, not corrected against that alternative convention."
	]
}
```

### Invoice 2 — outgoing, regime forfettario, imposta di bollo

`invoice-2-outgoing-forfettario.pdf` — single-line monthly retainer invoice against
Contract C, no IVA, statutory exemption text (art. 1, commi 54–89 e 58 e 67, L. 190/2014)
preserved verbatim, and the €2,00 stamp duty required over €77,47.

```json
{
	"sourceDocument": "invoice-2-outgoing-forfettario.pdf",
	"proposal": {
		"targetType": "invoice"
	},
	"direction": {
		"kind": "outgoing",
		"reasoning": "supplier.taxId 01234567890 == ACCOUNT_HOLDER_TAX_ID 01234567890"
	},
	"supplier": {
		"legalName": "Elia Fontana",
		"taxId": "01234567890",
		"country": "IT",
		"addressLine1": "Via Solferino 14",
		"addressCity": "Milano",
		"addressPostalCode": "20121"
	},
	"customer": {
		"legalName": "Ottavia Media Group S.r.l.",
		"taxId": "04521367890",
		"country": "IT",
		"addressLine1": "Corso Venezia 45",
		"addressCity": "Milano",
		"addressPostalCode": "20121"
	},
	"invoice": {
		"contractReference": "Contratto Rep. n. 1/2026 del 15/12/2025",
		"number": "2026/019",
		"issueDate": "2026-08-01",
		"documentType": "invoice",
		"currency": "EUR",
		"taxableAmountCents": 240000,
		"taxAmountCents": 0,
		"totalCents": 240200,
		"taxTreatmentCode": null,
		"statutoryReference": {
			"kind": "legal-text",
			"language": "it",
			"text": "Operazione effettuata ai sensi dell'art. 1, commi 54–89, della Legge 23 dicembre 2014, n. 190 e successive modificazioni (regime forfettario) — operazione non soggetta ad IVA ai sensi dell'art. 1, comma 58, L. 190/2014, e non soggetta a ritenuta d'acconto ai sensi dell'art. 1, comma 67, L. 190/2014."
		},
		"stampDutyCents": 200,
		"socialChargeCents": null,
		"dueDate": "2026-08-16",
		"dueDateSource": "computed",
		"paymentMethod": "bonifico bancario",
		"iban": "IT60X0542811101000000123456"
	},
	"lines": [
		{
			"description": "Canone di consulenza strategica in comunicazione e media relations — agosto 2026",
			"quantity": 1,
			"unitPriceCents": 240000,
			"amountCents": 240000,
			"taxRate": 0
		}
	],
	"hard": [
		"`invoice.total` must include the €2.00 stamp duty on top of the €2.400,00 fee (240200 cents), because the document treats the bollo as a pass-through charged to the client, not a tax withheld from the fee — a model that reports total=taxableAmount (2400.00) because 'there's no IVA' silently drops a real 2€ owed.",
		"The document never states a FatturaPA-style Natura code (e.g. N2.2) for the forfettario exemption — only prose. Any code a model attaches to `taxTreatmentCode` is an inference from the regime description, not a value read off the document, and should be flagged as such rather than presented as extracted fact.",
		"The €2,00 stamp-duty threshold (>€77,47) is itself a computed fact — the document asserts it applies but doesn't show the €77,47 comparison; a reviewer should not treat the presence of the bollo line as proof the extractor understood the threshold rule versus merely copying the printed figure."
	]
}
```

### Invoice 3 — outgoing, rounding discrepancy + free-text concentration claim

`invoice-3-outgoing-rounding-mixed.pdf` — against Contract B; the printed total is one cent
above the sum of taxable + tax (an explicitly-explained printer rounding), and a free-text
note claims a concentration percentage that is not, and must not be treated as, an
authoritative product figure.

```json
{
	"sourceDocument": "invoice-3-outgoing-rounding-mixed.pdf",
	"proposal": {
		"targetType": "invoice"
	},
	"direction": {
		"kind": "outgoing",
		"reasoning": "supplier.taxId 01234567890 == ACCOUNT_HOLDER_TAX_ID 01234567890"
	},
	"supplier": {
		"legalName": "Elia Fontana",
		"taxId": "01234567890",
		"country": "IT",
		"addressLine1": "Via Solferino 14",
		"addressCity": "Milano",
		"addressPostalCode": "20121"
	},
	"customer": {
		"legalName": "Bramante Costruzioni S.r.l.",
		"taxId": "03456781098",
		"country": "IT",
		"addressLine1": "Via dei Mille 22",
		"addressCity": "Bologna",
		"addressPostalCode": "40121"
	},
	"invoice": {
		"contractReference": "Contratto di Assistenza Tecnica Continuativa Rep. n. 3/2026 del 12/12/2025",
		"number": "2026/020",
		"issueDate": "2026-08-04",
		"documentType": "invoice",
		"currency": "EUR",
		"taxableAmountCents": 266000,
		"taxAmountCents": 58520,
		"totalCents": 324521,
		"taxTreatmentCode": null,
		"statutoryReference": null,
		"stampDutyCents": null,
		"socialChargeCents": null,
		"dueDate": "2026-09-03",
		"dueDateSource": "computed",
		"paymentMethod": "bonifico bancario",
		"iban": "IT60X0542811101000000123456"
	},
	"lines": [
		{
			"description": "Assistenza tecnica continuativa — pianificazione cantieri e controllo di gestione — luglio 2026",
			"quantity": 28.0,
			"unitPriceCents": 9500,
			"amountCents": 266000,
			"taxRate": 22
		}
	],
	"hard": [
		"taxableAmount (266000) + taxAmount (58520) = 324520, but the document's own printed 'TOTALE FATTURA' is 324521 — one cent higher — and explicitly explains this as a printing rounding ('arrotondamento di + €0,01 per approssimazione'). Per the schema's own documented design ('the document's own stated total, never derived by summing the fields above'), `total` must be read as 324521, not recomputed as 324520; this is a direct test of whether extraction recomputes instead of reading the printed figure.",
		"The invoice contains a free-text note claiming the client represents '~38% of the consultant's July revenue', next to the contract's own 35% concentration-cap clause. This number is NOT an invoice field (no column models it) and must not be treated as authoritative — mastro's own concentration metric is computed from real revenue across all clients, never asserted by one client's invoice text; a good extraction ignores it for structured fields and, at most, surfaces it as informational.",
		"A closing note says the ritenuta d'acconto is 'già conguagliata... non evidenziata separatamente' (already settled elsewhere, not shown on this invoice) — meaning here, unlike invoice 1, the printed total IS the net amount actually payable. Extraction cannot apply the same 'assume a hidden ritenuta' heuristic learned from invoice 1 to this document; the two invoices deliberately disagree on whether a ritenuta reduces the printed total, and the document's own wording is the only way to tell them apart."
	]
}
```

### Invoice 4 — incoming, EU reverse charge (the direction-detection stress test)

`invoice-4-incoming-reverse-charge.pdf` — a subscription invoice **received** from an Irish
SaaS supplier (NimbusFlow Technologies Ltd, VAT `IE9825613S`), addressed to Elia Fontana.
Correctly classifying this as `incoming` (never revenue) against `ACCOUNT_HOLDER_TAX_ID` is
the whole point; the reverse-charge 0% VAT treatment and the English-language statutory
citation add real complexity a folder-import PDF plausibly carries.

```json
{
	"sourceDocument": "invoice-4-incoming-reverse-charge.pdf",
	"proposal": {
		"targetType": "invoice"
	},
	"direction": {
		"kind": "incoming",
		"reasoning": "supplier.taxId IE9825613S != ACCOUNT_HOLDER_TAX_ID 01234567890 — this is a purchase, not revenue; classifyImportedInvoice must return 'incoming_skipped' and it must never reach revenueEligibleInvoices."
	},
	"supplier": {
		"legalName": "NimbusFlow Technologies Ltd",
		"taxId": "IE9825613S",
		"country": "IE",
		"addressLine1": "1 Grand Canal Quay",
		"addressCity": "Dublin 2",
		"addressPostalCode": "D02 H1V0"
	},
	"customer": {
		"legalName": "Elia Fontana",
		"taxId": "IT01234567890",
		"country": "IT",
		"addressLine1": "Via Solferino 14",
		"addressCity": "Milano",
		"addressPostalCode": "20121"
	},
	"invoice": {
		"contractReference": null,
		"number": "NF-2026-08217",
		"issueDate": "2026-08-03",
		"documentType": "invoice",
		"currency": "EUR",
		"taxableAmountCents": 46800,
		"taxAmountCents": 0,
		"totalCents": 46800,
		"taxTreatmentCode": null,
		"statutoryReference": {
			"kind": "legal-text",
			"language": "en",
			"text": "Reverse charge: VAT to be accounted for by the recipient under Article 44 of Council Directive 2006/112/EC and Article 7-ter, D.P.R. 633/1972. This supply is not subject to Irish VAT."
		},
		"stampDutyCents": null,
		"socialChargeCents": null,
		"dueDate": "2026-08-03",
		"dueDateSource": "document",
		"paymentMethod": "credit card (automatic)",
		"iban": null
	},
	"lines": [
		{
			"description": "NimbusFlow Pro plan — annual subscription, project management software (Aug 2026 – Jul 2027)",
			"quantity": 1,
			"unitPriceCents": 46800,
			"amountCents": 46800,
			"taxRate": 0
		}
	],
	"hard": [
		"This is the direction-detection stress test: the document is addressed TO Elia Fontana and could be superficially mistaken for 'our invoice' by a model that keys on 'who does this document mention as the account holder' rather than 'who is billing whom' — the correct read is that NimbusFlow (IE9825613S) is the supplier, Fontana is the customer, and this must be classified incoming, never added to revenue. Getting this backwards is exactly the ceiling-blindness failure mode the product's invariants exist to prevent.",
		"0% VAT here means something entirely different from invoice 2's 0% (regime forfettario exemption): this is an EU B2B reverse-charge purchase where Fontana, not NimbusFlow, owes Italian VAT via self-assessment (an obligation the product doesn't currently model at all for purchases). Collapsing both cases into one 'taxAmount=0' fact loses which regime is which and, for this one, a compliance obligation this consultant actually has.",
		"The statutory citation is in English (the document's own language), not Italian — invariant 5 requires it preserved verbatim in the language it was written in; a model that helpfully translates it to Italian to match the other fixtures' style would be corrupting the legal text, not normalising it.",
		"There is no IBAN and no 'giorni data fattura' term at all — payment is an automatic card charge on the issue date. dueDateSource must be 'document' (the date is stated, not computed), unlike every outgoing invoice in this set where it's 'computed' from a relative term — a model that defaults to 'computed' whenever it doesn't see an explicit 'Scadenza:' label would mis-tag this one."
	]
}
```

### Bonus — scanned-image PDF, no extractable text

`bonus-scan-nord-meccanica-notice.pdf` — image-only PDF (no text layer at all; confirmed
0 extractable characters above) of a short cover letter from Nord Meccanica transmitting the
Contract D addendum. Not one of the required 8; included because the assignment names a
scanned-image PDF as "a legitimate 5th case ... worth flagging as the hard case", and this is
exactly the artifact a real counterparty produces when they scan a signed paper letter instead
of sending a clean digital original.

```json
{
	"sourceDocument": "bonus-scan-nord-meccanica-notice.pdf",
	"extractable": false,
	"pdftotext_nonwhitespace_chars": 0,
	"whatAHumanCanReadOffTheImage": {
		"kind": "cover letter, not a contract or invoice",
		"from": "Nord Meccanica S.p.A., ing. Davide Orsini",
		"to": "dott. Elia Fontana",
		"date": "2026-03-02",
		"subject": "trasmissione atto integrativo n. 1 al Contratto Rep. n. 2/2025",
		"content": "transmits (as a scanned attachment) the signed addendum reflected in contract-d's Art. 1 rate change effective 2026-04-01 — corroborating, not contradicting, contract D's own addendum text"
	},
	"hard": [
		"Zero extractable text (`pdftotext` returns an empty string; confirmed by direct measurement, not assumed). This is the realistic failure mode for #86's 'first-intake PDF' case: a counterparty mails a phone-scanned or photocopied cover letter instead of a clean digital original. Without OCR or a vision-capable model reading the rendered page images, extraction has nothing to parse — the honest outcome is 'cannot extract', not a best-effort guess from the filename or a blank proposal silently accepted.",
		"Even a model that CAN read the image (Claude has vision) is reading a letter *about* an addendum, not the addendum itself — the actual rate-change terms live in contract-d's own PDF, not this one. A correct extraction of this document alone should propose nothing beyond metadata (from/to/date/subject) and should not fabricate a rate figure it was never shown."
	]
}
```

## Documents not generated

None. All 4 contracts, all 4 invoices, and the bonus scanned-image case were generated and
verified. The one thing genuinely **not** attempted was true OCR text recovery for the scanned
case — that's the capability the trial is supposed to test (can the model read the page image
directly), not something to pre-solve in the fixture.
