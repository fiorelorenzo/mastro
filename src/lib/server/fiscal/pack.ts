// The jurisdiction pack interface (issue #30) and the pure, pack-agnostic
// functions that read it. Nothing in this file may name a concrete pack —
// see `engine.test.ts` for the standing proof. A pack is a plain object: if
// the engine ever needs an `if (pack.id === ...)` to do its job, the
// interface below is missing a capability and should grow one, per
// AGENTS.md invariant 1.

import { minorUnits, scaleMinorUnits, sumMinorUnits, type MinorUnits } from '$lib/money';
import type { LegalText } from '$lib/legal/legal-text';
import type { LabelBundle } from './label';

export type FiscalBasis = 'cash' | 'accrual';

/**
 * Where a fiscal year starts. `{ startMonth: 1, startDay: 1 }` is a
 * calendar year; nothing here assumes it is. `fiscalYearOf` and
 * `fiscalYearBounds` below work for any start date.
 */
export interface FiscalYearDefinition {
	/** 1–12. */
	readonly startMonth: number;
	/** 1–31, valid for `startMonth`. */
	readonly startDay: number;
}

/** Which side of AGENTS.md invariant 2 a ceiling came from: a `pack`
 * ceiling follows the money and vanishes when the fiscal profile changes
 * regime; a `contract` ceiling follows the counterparty and survives any
 * such change. Both normalise into the same `Ceiling` shape below and run
 * through the same evaluator (`fiscal/ceiling.ts`) — this field is what a
 * dashboard reads to label the two differently, never a reason to branch
 * on how one is computed. */
export type CeilingOrigin = 'pack' | 'contract';

/** `absolute_amount`: `value` is a `MinorUnits` cap, compared directly
 * against revenue. `percentage_share`: `value` is a ratio (`0.3` for
 * 30%), compared against one client's share of the perimeter's total —
 * see `perimeter` and `fiscal/ceiling.ts`'s `evaluateCeiling`. */
export type CeilingMeasure = 'absolute_amount' | 'percentage_share';

export type CeilingLimit =
	| { readonly measure: 'absolute_amount'; readonly value: MinorUnits }
	| { readonly measure: 'percentage_share'; readonly value: number };

/**
 * Which reading of the ledger a ceiling resets over (#36/#37). The
 * `_calendar_year` bases reset every January 1st regardless of which pack
 * is active; `cash_received_contract_year` resets on the owning
 * contract's own start-date anniversary instead — the shape a contract
 * ceiling needs, since a client-share cap has no reason to reset on the
 * calendar rather than the relationship's own anniversary.
 * `cash_received_*` reads the ledger by payment date, `invoiced_*` by
 * issue date — see `fiscal/ledger.ts`'s `LedgerBasis`, which this maps
 * onto one-to-one.
 */
export type CeilingBasis =
	'cash_received_calendar_year' | 'invoiced_calendar_year' | 'cash_received_contract_year';

/** Whose revenue a ceiling counts: everyone (`all_clients`, what every
 * pack ceiling today uses — the practitioner's whole regime is at stake)
 * or one named client (`client`, what a contract's own share cap uses —
 * it is that client's relationship being capped, not the practitioner's
 * total). */
export type CeilingPerimeter =
	{ readonly kind: 'all_clients' } | { readonly kind: 'client'; readonly clientId: string };

/** One threshold a ceiling's usage ratio can cross, each with its own
 * label — "approaching" reads differently from "reached". Enforcement and
 * notification are the alert engine's job (#74, next wave); this is the
 * data it will read, declared here so a pack or a contract ceiling
 * carries its own thresholds rather than the alert engine inventing
 * one-size-fits-all defaults. */
export interface CeilingAlertLevel {
	/** 0–1, e.g. `0.8` for "80% of the way to the ceiling". */
	readonly ratio: number;
	readonly label: LabelBundle;
}

/**
 * A revenue ceiling, from a pack or a contract (#36). Enforcement is the
 * ceiling engine's job (`fiscal/ceiling.ts`'s `evaluateCeiling`, the one
 * function both origins run through — AGENTS.md invariant 2's acceptance
 * test); this is the declaration it reads. A contract ceiling normalises
 * into exactly this same shape (`fiscal/ceiling.ts`'s
 * `ceilingFromContractRow`) rather than a parallel type, so the evaluator
 * never needs to know which origin it is looking at.
 */
export type Ceiling = {
	readonly id: string;
	readonly origin: CeilingOrigin;
	readonly label: LabelBundle;
	readonly legalBasis?: LegalText;
	readonly basis: CeilingBasis;
	readonly perimeter: CeilingPerimeter;
	readonly alertLevels: readonly CeilingAlertLevel[];
	/**
	 * What crossing the ceiling does, in plain interface-language copy —
	 * e.g. "the regime is lost from the following year" versus "the regime
	 * is lost immediately, VAT applies from here on" (#33). A jurisdiction
	 * can carry more than one ceiling with different consequences, so the
	 * dashboard (#57) needs this alongside `label` to tell them apart. Not
	 * a legal string — nothing here is mandated wording — so it is a
	 * `LabelBundle` like `label`, never a `LegalText`.
	 *
	 * Added by #33: the interface as #30 shipped it had no way to say what
	 * happens when a ceiling is crossed, and the Italian flat-rate regime
	 * has two ceilings whose consequences differ in kind, not just degree.
	 * That is a capability every future pack's ceilings will want, so it
	 * belongs here, not as a per-pack workaround.
	 */
	readonly consequence: LabelBundle;
} & CeilingLimit;

/** A tax treatment code the pack defines, with the legal text an invoice
 * under it must carry verbatim. */
export interface TaxTreatment {
	readonly code: string;
	readonly label: LabelBundle;
	readonly legalText: LegalText;
	/** The rate an invoice line under this treatment carries — 0 for an
	 * exemption or an out-of-scope operation, the only cases either shipped
	 * pack declares today; the interface does not assume 0 for every future
	 * treatment (a reduced rate is still "a treatment"). */
	readonly taxRate: number;
}

export type ChargeAmount =
	| { readonly kind: 'fixed'; readonly minorUnits: MinorUnits }
	| { readonly kind: 'percentage'; readonly rate: number; readonly of: string };

export type RuleComparator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq';

/**
 * A declarative condition the engine evaluates against a caller-supplied
 * fact table. `fact` names whatever the caller passes in `facts` (e.g.
 * `'invoiceTotal'`) — the engine does not know or care what facts exist, so
 * a pack that needs a new one does not require an engine change, only a
 * caller that supplies it.
 */
export interface FiscalRuleCondition {
	readonly fact: string;
	readonly comparator: RuleComparator;
	readonly value: number;
}

/** Which invoice-level charge slot a statutory charge fills. `invoice`
 * carries exactly two named charge columns (`stamp_duty`, `social_charge`)
 * — a charge declares which one it is so `evaluateInvoiceCharges` can sum
 * into them without the engine ever matching a pack's own charge `id`
 * (AGENTS.md invariant 1: no country-specific logic outside a pack, and an
 * id like `it-flat-rate-virtual-stamp-duty` is exactly that). */
export type StatutoryChargeSlot = 'stamp_duty' | 'social_charge';

/**
 * A statutory charge (stamp duty, a social-security surcharge). The
 * canonical example is a stamp duty that applies only once an invoice total
 * crosses a threshold: that is `appliesWhen`, a condition, not a callback —
 * the engine evaluates it, the pack never runs code.
 */
export interface StatutoryCharge {
	readonly id: string;
	readonly label: LabelBundle;
	readonly legalBasis?: LegalText;
	readonly amount: ChargeAmount;
	/** Absent means the charge always applies. */
	readonly appliesWhen?: FiscalRuleCondition;
	readonly slot: StatutoryChargeSlot;
}

/**
 * #122: an invoice issued while a cash-basis pack governed can still be
 * unpaid when a later fiscal profile takes over — a practitioner exiting
 * Italy's flat-rate regime for the standard one mid-year is the concrete
 * case this exists for, since an invoice issued shortly before the switch
 * is often still unpaid at that point. Once it is paid, which basis
 * governs it?
 *
 * `'carries_forward'` is the only value defined so far: this pack's cash
 * basis keeps governing the invoice — it is recognised, still by its
 * payment date, in whichever later sub-period's window actually contains
 * that date, however many regime changes later (`ledger.ts`'s
 * `sumLedgerAcrossPeriods`). This is not a default invented for the
 * engine's convenience: it is what Italian law requires on exit from
 * Italy's flat-rate regime (Legge 23 dicembre 2014, n. 190, art. 1, comma
 * 72 — see `packs/it-flat-rate.ts`'s header for the full citation and
 * the scheme's own name), and it is also the only value that keeps the
 * invariant every other figure in this engine already keeps: revenue
 * that really happened is never silently dropped. Only a `'cash'` basis
 * can ever leave a row unresolved — an accrual basis recognises revenue
 * the instant it is issued — so the value has no effect under `basis:
 * 'accrual'`, but every pack still declares one: the engine never fills
 * in a missing capability by branching on `basis` instead, per AGENTS.md
 * invariant 1. A jurisdiction whose law instead deems such revenue
 * realised at the moment of transition (a closing adjustment valued at
 * issuance rather than at collection) would need a second value here;
 * none is modelled because no pack this product ships needs one yet.
 */
export type UnresolvedRevenueTreatment = 'carries_forward';

/**
 * What an invoice takes when nothing about it calls for one of
 * `treatments`'s exceptional cases (#216/#217) — resolved by
 * `resolveDefaultTaxTreatment`, never by the engine branching on a pack's
 * `id`.
 *
 * `'ordinary'`: the jurisdiction's unannotated default case (it-standard's
 * domestic, standard-rate invoice, which needs no code or statutory text
 * at all) — `taxRate` is the rate that applies.
 *
 * `'treatment'`: `code` names one of `treatments` that applies to every
 * invoice under this pack, unconditionally (it-flat-rate's regime never
 * charges VAT on anything it invoices — comma 58 draws no exception) — its
 * own `taxRate`/`legalText` are read off that entry, never duplicated
 * here.
 *
 * Absent on the pack itself: this jurisdiction is not modelled deeply
 * enough to have an opinion (`generic`, and every ad-hoc pack this
 * engine's own tests build for something unrelated to tax) — the caller
 * falls back to asking a human, the "manual fallback for a document that
 * doesn't match a modelled pack entry" the UX review's recommendation
 * names.
 */
export type DefaultTaxTreatment =
	| { readonly kind: 'ordinary'; readonly taxRate: number }
	| { readonly kind: 'treatment'; readonly code: string };

/**
 * A jurisdiction pack: basis, fiscal year, ceilings, treatments, charges,
 * invoice formats and labels, all as data. `id` plus `version` identify it
 * (by convention `<country>-<regime>`, resolved case by case in
 * `registry.ts` — this interface has no opinion on what a valid id looks
 * like); a rule change becomes a new `version`, never a mutation of an old
 * one, so historical calculations keep using the pack that was actually in
 * force.
 */
export interface FiscalPack {
	readonly id: string;
	readonly version: string;
	/** ISO date this version entered into force. */
	readonly effectiveFrom: string;
	/** ISO date it stopped, absent if still in force. */
	readonly effectiveTo?: string;
	readonly displayName: LabelBundle;
	readonly basis: FiscalBasis;
	readonly fiscalYear: FiscalYearDefinition;
	readonly ceilings: readonly Ceiling[];
	readonly treatments: readonly TaxTreatment[];
	readonly charges: readonly StatutoryCharge[];
	/** Invoice format identifiers this pack supports. Opaque to the engine:
	 * it carries them through without needing to know what any of them
	 * mean. Empty for a pack with no national format. */
	readonly formats: readonly string[];
	/** #122: see `UnresolvedRevenueTreatment`. */
	readonly unresolvedRevenue: UnresolvedRevenueTreatment;
	/** Absent means this pack has no opinion — see `DefaultTaxTreatment`. */
	readonly defaultTreatment?: DefaultTaxTreatment;
}

function parseIsoDate(date: string): Date {
	const parsed = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) throw new Error(`not an ISO date: ${date}`);
	return parsed;
}

/**
 * The fiscal year `date` falls in, labelled by the calendar year it starts
 * in. Works for any `FiscalYearDefinition`, calendar-aligned or not.
 */
export function fiscalYearOf(definition: FiscalYearDefinition, date: string): number {
	const parsed = parseIsoDate(date);
	const calendarYear = parsed.getUTCFullYear();
	const startOfThisCalendarYear = Date.UTC(
		calendarYear,
		definition.startMonth - 1,
		definition.startDay
	);
	return parsed.getTime() >= startOfThisCalendarYear ? calendarYear : calendarYear - 1;
}

/** The inclusive `[start, end]` bounds, as ISO dates, of the fiscal year
 * labelled `year` under `definition`. */
export function fiscalYearBounds(
	definition: FiscalYearDefinition,
	year: number
): { readonly start: string; readonly end: string } {
	const start = Date.UTC(year, definition.startMonth - 1, definition.startDay);
	const nextStart = Date.UTC(year + 1, definition.startMonth - 1, definition.startDay);
	return {
		start: new Date(start).toISOString().slice(0, 10),
		end: new Date(nextStart - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
	};
}

function compare(comparator: RuleComparator, actual: number, value: number): boolean {
	switch (comparator) {
		case 'lt':
			return actual < value;
		case 'lte':
			return actual <= value;
		case 'gt':
			return actual > value;
		case 'gte':
			return actual >= value;
		case 'eq':
			return actual === value;
	}
}

function conditionHolds(
	condition: FiscalRuleCondition,
	facts: Readonly<Record<string, number>>
): boolean {
	const actual = facts[condition.fact];
	if (actual === undefined) {
		throw new Error(`fact '${condition.fact}' was not supplied`);
	}
	return compare(condition.comparator, actual, condition.value);
}

function amountOf(amount: ChargeAmount, facts: Readonly<Record<string, number>>): MinorUnits {
	if (amount.kind === 'fixed') return amount.minorUnits;
	const base = facts[amount.of];
	if (base === undefined) {
		throw new Error(`fact '${amount.of}' was not supplied`);
	}
	return scaleMinorUnits(minorUnits(base), amount.rate);
}

export interface EvaluatedCharge {
	readonly charge: StatutoryCharge;
	readonly amount: MinorUnits;
}

/**
 * The statutory charges of `pack` that apply given `facts`, with their
 * computed amounts. The only "behaviour" a pack carries: a list of
 * conditions and amounts, evaluated here, never a function the pack itself
 * defines.
 */
export function evaluateCharges(
	pack: FiscalPack,
	facts: Readonly<Record<string, number>>
): readonly EvaluatedCharge[] {
	return pack.charges
		.filter(
			(charge) => charge.appliesWhen === undefined || conditionHolds(charge.appliesWhen, facts)
		)
		.map((charge) => ({ charge, amount: amountOf(charge.amount, facts) }));
}

export interface ResolvedTaxTreatment {
	readonly code: string | null;
	readonly taxRate: number;
	readonly legalText: LegalText | null;
}

/**
 * The tax treatment and rate an invoice takes under `pack` absent any
 * reason to pick one of its exceptional `treatments` by hand — the pure
 * read of `defaultTreatment` a caller resolves against, never a second
 * copy of "which treatment applies" logic per pack (#216).
 *
 * `null` when the pack declares no `defaultTreatment` at all: the
 * caller's manual fallback, per `DefaultTaxTreatment`'s own doc.
 */
export function resolveDefaultTaxTreatment(pack: FiscalPack): ResolvedTaxTreatment | null {
	const defaultTreatment = pack.defaultTreatment;
	if (defaultTreatment === undefined) return null;
	if (defaultTreatment.kind === 'ordinary') {
		return { code: null, taxRate: defaultTreatment.taxRate, legalText: null };
	}
	const treatment = pack.treatments.find((t) => t.code === defaultTreatment.code);
	if (!treatment) {
		throw new Error(
			`pack ${pack.id}@${pack.version} names '${defaultTreatment.code}' as its default treatment but declares no treatment with that code`
		);
	}
	return { code: treatment.code, taxRate: treatment.taxRate, legalText: treatment.legalText };
}

export interface EvaluatedInvoiceCharges {
	readonly stampDuty: MinorUnits | null;
	readonly socialCharge: MinorUnits | null;
}

/**
 * `evaluateCharges`'s results, summed into the two named charge columns
 * `invoice` carries (`stamp_duty`, `social_charge`) by each charge's own
 * `slot` — `null` when nothing in `pack.charges` fills a slot, so a caller
 * can assign the result straight onto `invoice.stampDuty`/
 * `invoice.socialCharge` without inventing a zero for a pack (like
 * `it-standard`) that charges neither.
 */
export function evaluateInvoiceCharges(
	pack: FiscalPack,
	facts: Readonly<Record<string, number>>
): EvaluatedInvoiceCharges {
	const evaluated = evaluateCharges(pack, facts);
	const bySlot = (slot: StatutoryChargeSlot): MinorUnits | null => {
		const matches = evaluated.filter((e) => e.charge.slot === slot);
		return matches.length > 0 ? sumMinorUnits(matches.map((e) => e.amount)) : null;
	};
	return { stampDuty: bySlot('stamp_duty'), socialCharge: bySlot('social_charge') };
}
