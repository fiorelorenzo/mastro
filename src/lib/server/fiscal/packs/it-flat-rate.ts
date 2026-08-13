import type { FiscalPack } from '../pack';
import { legalText } from '$lib/legal/legal-text';
import { minorUnits } from '$lib/money';

/**
 * Italy's flat-rate regime (`regime forfettario`): cash basis, calendar
 * fiscal year, a soft ceiling that loses the regime from the following
 * year and a hard one that loses it immediately with VAT due from the
 * crossing, the VAT-exempt treatment code, virtual stamp duty above the
 * small-invoice threshold, and the INPS surcharge that counts towards
 * revenue even though it is not taxable income (#33).
 *
 * Every figure below was checked against the consolidated text of Legge
 * 23 dicembre 2014, n. 190, art. 1, as currently in force (normattiva.it,
 * "vigente al 07/08/2026" — the government's own point-in-time text,
 * incorporating every amendment up to and including the 2026 budget law,
 * which left commi 54, 58 and 71 unchanged from the 2023 budget law). The
 * two ceiling figures and the immediate-exit rule both date to Legge 29
 * dicembre 2022, n. 197 (Legge di Bilancio 2023); nothing since has moved
 * them, including the 2026 budget law, which the trade press reported as
 * having considered and rejected a rise to 100.000 for the soft ceiling.
 * `effectiveFrom` is that 2023 commencement date, not this pack's authoring
 * date: a pack version is pinned to when its rules took legal effect, so
 * history keeps computing under the rules that applied then.
 *
 * Sources, checked at implementation time (2026-08-07):
 * - Soft ceiling (85.000 EUR) and hard ceiling (100.000 EUR): Legge
 *   190/2014, art. 1, commi 54 (lett. a) and 71, consolidated text at
 *   https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2014-12-23;190
 *   ("Testo in vigore dal: 19-3-2026 al: 31-12-2026", read in full on
 *   2026-08-07); both figures introduced by Legge 197/2022, art. 1, comma
 *   54, corroborated independently by multiple 2026-dated practitioner
 *   guides (e.g. fiscoetasse.com, regime-forfettario.it) confirming the
 *   2026 budget law left them unchanged.
 * - VAT-exempt treatment (no rivalsa, "operazione senza applicazione
 *   dell'IVA"): Legge 190/2014, art. 1, comma 58, same consolidated text.
 *   SDI Natura code N2.2 ("operazioni non soggette – altri casi"):
 *   corroborated by multiple 2025/2026 practitioner guides describing
 *   Agenzia delle Entrate's FatturaPA technical specifications; not read
 *   directly against the XSD, flagged here rather than asserted as
 *   independently verified.
 * - Virtual stamp duty (2 EUR above 77,47 EUR per document): D.P.R. 26
 *   ottobre 1972, n. 642, art. 6 della Tabella allegata (Allegato A) and
 *   art. 13 della Tariffa, parte prima; corroborated by multiple
 *   practitioner guides quoting the same articles and figures.
 * - INPS surcharge counting towards the ceiling: the "rivalsa" is Legge 23
 *   dicembre 1996, n. 662, art. 1, comma 212 (4 per cento); Agenzia delle
 *   Entrate's circolare n. 10/E del 4 aprile 2016 is the source cited by
 *   practitioners for it counting towards ricavi/compensi despite not
 *   being taxable income — not read directly, corroborated by multiple
 *   independent practitioner guides quoting it consistently.
 * - `unresolvedRevenue: 'carries_forward'` (#122): an invoice issued
 *   under this regime but still unpaid when a fiscal profile switches
 *   to a different pack keeps being governed by this regime's cash
 *   principle — recognised, by its payment date, whenever it is
 *   eventually collected. Legge 190/2014, art. 1, comma 72 (in force
 *   since 01/01/2015, unaffected by any amendment to date): "i ricavi e
 *   i compensi che ... non hanno concorso a formare il reddito
 *   imponibile del periodo assumono rilevanza nei periodi di imposta
 *   successivi nel corso dei quali si verificano i presupposti previsti
 *   dal regime forfetario" — read in the Agenzia delle Entrate PDF
 *   consolidating commi 54-89 (agenziaentrate.gov.it, read in full on
 *   2026-08-07), corroborated by Agenzia delle Entrate's own "Regime
 *   forfetario (le regole 2020)" guidance page, "Conseguenze della
 *   fuoriuscita" (same domain, same read date), which restates the same
 *   outcome for the immediate-exit case: "ai fini delle imposte dirette
 *   ... rileva il momento di incasso della fattura", taxed "con la
 *   dichiarazione dell'anno successivo" under ordinary rules. This is
 *   the concrete case #122 was filed for.
 */
export const itFlatRatePack: FiscalPack = {
	id: 'it-flat-rate',
	version: '1',
	effectiveFrom: '2023-01-01',
	displayName: { en: 'Italy — flat-rate regime (regime forfettario)', it: 'Regime forfettario' },
	basis: 'cash',
	fiscalYear: { startMonth: 1, startDay: 1 },
	ceilings: [
		{
			id: 'it-flat-rate-revenue-ceiling',
			origin: 'pack',
			label: {
				en: 'Flat-rate regime revenue ceiling',
				it: 'Soglia di ricavi e compensi del regime forfettario'
			},
			consequence: {
				en: 'Crossing this ceiling loses the flat-rate regime from the following fiscal year.',
				it: 'Il superamento di questa soglia comporta la fuoriuscita dal regime forfettario a partire dall’anno successivo.'
			},
			legalBasis: legalText(
				'it',
				"Art. 1, comma 54, lettera a), legge 23 dicembre 2014, n. 190, come modificato dall'art. 1, comma 54, legge 29 dicembre 2022, n. 197"
			),
			measure: 'absolute_amount',
			value: minorUnits(8_500_000),
			basis: 'cash_received_calendar_year',
			perimeter: { kind: 'all_clients' },
			alertLevels: [
				{
					ratio: 0.8,
					label: {
						en: 'Approaching the revenue ceiling',
						it: 'In avvicinamento alla soglia di ricavi'
					}
				},
				{
					ratio: 1,
					label: { en: 'Revenue ceiling reached', it: 'Soglia di ricavi raggiunta' }
				}
			]
		},
		{
			id: 'it-flat-rate-immediate-exit-ceiling',
			origin: 'pack',
			label: {
				en: 'Flat-rate regime immediate-exit ceiling',
				it: 'Soglia di fuoriuscita immediata dal regime forfettario'
			},
			consequence: {
				en: 'Crossing this ceiling loses the flat-rate regime immediately, in the same fiscal year, with VAT due from the operation that crosses it and on every operation after.',
				it: "Il superamento di questa soglia comporta la fuoriuscita immediata dal regime forfettario nello stesso anno, con IVA dovuta a partire dall'operazione che determina il superamento e su quelle successive."
			},
			legalBasis: legalText(
				'it',
				"Art. 1, comma 71, legge 23 dicembre 2014, n. 190, come modificato dall'art. 1, comma 54, legge 29 dicembre 2022, n. 197"
			),
			measure: 'absolute_amount',
			value: minorUnits(10_000_000),
			basis: 'cash_received_calendar_year',
			perimeter: { kind: 'all_clients' },
			alertLevels: [
				{
					ratio: 0.9,
					label: {
						en: 'Approaching immediate exit from the regime',
						it: 'In avvicinamento alla fuoriuscita immediata dal regime'
					}
				},
				{
					ratio: 1,
					label: {
						en: 'Immediate exit ceiling reached',
						it: 'Soglia di fuoriuscita immediata raggiunta'
					}
				}
			]
		}
	],
	treatments: [
		{
			code: 'N2.2',
			label: {
				en: 'VAT exempt — flat-rate regime',
				it: "Operazione senza applicazione dell'IVA — regime forfettario"
			},
			legalText: legalText(
				'it',
				"Operazione senza applicazione dell'IVA, ai sensi dell'articolo 1, comma 58, della legge 23 dicembre 2014, n. 190"
			),
			// The regime never charges VAT, on anything — the reasoning
			// `defaultTreatment` below relies on to apply this treatment
			// unconditionally, rather than only when some condition holds.
			taxRate: 0
		}
	],
	charges: [
		{
			id: 'it-flat-rate-virtual-stamp-duty',
			label: { en: 'Virtual stamp duty', it: 'Imposta di bollo virtuale' },
			legalBasis: legalText(
				'it',
				'D.P.R. 26 ottobre 1972, n. 642, art. 6 della Tabella allegata (Allegato A) e art. 13 della Tariffa, parte prima'
			),
			// 2.00 EUR, due once a document not subject to VAT exceeds 77.47 EUR.
			amount: { kind: 'fixed', minorUnits: minorUnits(200) },
			appliesWhen: { fact: 'invoiceTotal', comparator: 'gt', value: 7747 },
			slot: 'stamp_duty'
		},
		{
			id: 'it-flat-rate-social-security-surcharge',
			label: {
				en: 'Social-security surcharge (INPS rivalsa)',
				it: 'Rivalsa contributiva INPS'
			},
			legalBasis: legalText(
				'it',
				"Art. 1, comma 212, legge 23 dicembre 1996, n. 662; l'importo concorre al limite dei ricavi e compensi del regime forfettario ai sensi della circolare dell'Agenzia delle Entrate n. 10/E del 4 aprile 2016, pur non costituendo reddito imponibile"
			),
			// 4%, unconditional: whether a given invoice actually elects to
			// charge it is an invoicing-time decision outside this pack's
			// job. What the pack fixes is the rate and its one statutory
			// effect that matters here — it counts towards the ceilings
			// above even though it is not taxable income.
			amount: { kind: 'percentage', rate: 0.04, of: 'invoiceTotal' },
			slot: 'social_charge'
		}
	],
	// FatturaPA, format id 'FPR12' (fattura verso privati) — shared with
	// it-standard, coordinated with #41 (the format adapter, out of scope
	// here): both regimes' consultants file the same national format.
	formats: ['FPR12'],
	// #122: see the header comment's last source entry.
	unresolvedRevenue: 'carries_forward',
	// Comma 58 draws no exception for any kind of operation this regime
	// invoices — N2.2 is not one exceptional case among others, it is what
	// every invoice under this pack takes (#216).
	defaultTreatment: { kind: 'treatment', code: 'N2.2' }
};
