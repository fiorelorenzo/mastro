// The jurisdiction pack interface (issue #30) and the pure, pack-agnostic
// functions that read it. Nothing in this file may name a concrete pack —
// see `engine.test.ts` for the standing proof. A pack is a plain object: if
// the engine ever needs an `if (pack.id === ...)` to do its job, the
// interface below is missing a capability and should grow one, per
// AGENTS.md invariant 1.

import type { LabelBundle, LegalText } from './label';

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

/** An amount in the currency's minor unit (cents for EUR). Never a float —
 * fiscal amounts must not lose precision to binary rounding. */
export type MinorUnits = number;

/** A revenue ceiling the pack imposes. Enforcement is the ceiling engine's
 * job (#36); this is the declaration it reads. */
export interface Ceiling {
	readonly id: string;
	readonly label: LabelBundle;
	readonly legalBasis?: LegalText;
	readonly amount: MinorUnits;
	/** The period the ceiling resets over. One member today; add more here,
	 * never as a special case in a consumer. */
	readonly period: 'fiscal_year';
}

/** A tax treatment code the pack defines, with the legal text an invoice
 * under it must carry verbatim. */
export interface TaxTreatment {
	readonly code: string;
	readonly label: LabelBundle;
	readonly legalText: LegalText;
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
}

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
	return Math.round(base * amount.rate);
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
