// #40: the engine's failure mode is silent and expensive — a wrong
// ceiling or revenue figure looks exactly like a right one. These five
// cases are the ones the issue names, each with the arithmetic worked
// out by hand in a comment next to the assertion it backs, not a number
// copied from a first run of the code. Every fixture is built in memory:
// nothing here needs a database, migrated or otherwise.

import { expect, test } from 'vitest';
import { evaluateCeiling } from './ceiling';
import { minorUnits } from '$lib/money';
import { committedAmount, projectedAmount, type RecurringFeeContract } from './certainty';
import { sumLedgerAcrossPeriods, type LedgerPeriod, type LedgerRow } from './ledger';
import type { Ceiling, FiscalPack } from './pack';
import { buildRegistry } from './registry';
import { resolvePackOverRange } from './resolve';

// ─── Case 1: an invoice issued 28 December, paid 3 January ────────────────
//
// The same invoice, read two ways. Under a cash-basis ceiling the payment
// date is what counts, and 2025-01-03 is unambiguously in 2025, not 2024
// — the year it was issued in is irrelevant. Under an accrual-basis
// ceiling the issue date is what counts, and 2024-12-28 is unambiguously
// in 2024. Nothing is prorated or split: the whole 250,000 lands in
// exactly one calendar year under each basis, and the two years disagree.

test('an invoice issued 28 December and paid 3 January counts in different calendar years under cash and accrual', () => {
	const rows: LedgerRow[] = [
		{
			invoiceId: 'year-end-invoice',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2024-12-28',
			paidOn: '2025-01-03',
			amount: minorUnits(250_000)
		}
	];

	const cashCeiling: Ceiling = {
		id: 'cash-cap',
		origin: 'pack',
		label: { en: 'Cash cap', it: 'Tetto incassi' },
		measure: 'absolute_amount',
		value: minorUnits(1_000_000),
		basis: 'cash_received_calendar_year',
		perimeter: { kind: 'all_clients' },
		alertLevels: [],
		consequence: { en: 'x', it: 'x' }
	};
	const accrualCeiling: Ceiling = {
		...cashCeiling,
		id: 'accrual-cap',
		basis: 'invoiced_calendar_year'
	};

	// Cash basis, evaluated as of a date in 2025: the payment
	// (2025-01-03) falls inside the 2025 window — the full 250,000.
	const cash2025 = evaluateCeiling(cashCeiling, rows, '2025-06-01');
	expect(cash2025.period).toEqual({ from: '2025-01-01', to: '2026-01-01' });
	expect(cash2025.currentValue).toBe(250_000);

	// Cash basis, evaluated as of a date in 2024: the payment has not
	// happened yet inside that window (it lands the following year) — 0.
	const cash2024 = evaluateCeiling(cashCeiling, rows, '2024-06-01');
	expect(cash2024.period).toEqual({ from: '2024-01-01', to: '2025-01-01' });
	expect(cash2024.currentValue).toBe(0);

	// Accrual basis, evaluated as of a date in 2024: the issue date
	// (2024-12-28) falls inside the 2024 window — the full 250,000, the
	// opposite year from the cash reading of the very same invoice.
	const accrual2024 = evaluateCeiling(accrualCeiling, rows, '2024-06-01');
	expect(accrual2024.period).toEqual({ from: '2024-01-01', to: '2025-01-01' });
	expect(accrual2024.currentValue).toBe(250_000);
});

// ─── Case 2: a regime change mid-year, correct basis in each sub-period ───
//
// A cash-basis pack in force through the end of June, an accrual-basis
// pack from July on. Four rows, each landing in exactly one place once
// each sub-period reads the date its own basis calls for, plus a fifth
// (#122) that no single sub-period's own window resolves on its own:
//
//   A  issued 2024-03-01, paid 2024-03-15, 40,000
//        → cash sub-period reads paidOn (03-15, inside Jan–Jun): counted.
//        → accrual sub-period reads issueDate (03-01, outside Jul–Dec):
//          not counted there. Counted once, in the cash sub-period.
//   B  issued 2024-05-01, paid 2024-08-01, 35,000
//        → cash sub-period reads paidOn (08-01, outside Jan–Jun): not
//          counted there — still unpaid when that sub-period's own
//          window ends.
//        → accrual sub-period reads issueDate (05-01, outside Jul–Dec):
//          not counted there either.
//        → #122: B was issued while the cash-basis pack governed, and
//          that pack declares `unresolvedRevenue: 'carries_forward'`
//          (Legge 190/2014, art. 1, comma 72, for the real
//          `it-flat-rate` case this fixture stands in for), so its cash
//          basis keeps governing B: recognised, by its payment date
//          (08-01), in whichever period's window actually contains that
//          date — the accrual sub-period's, here. Counted once, in a
//          third figure that carries the CASH basis that actually
//          produced it, not the accrual sub-period's own.
//   C  issued 2024-09-01, unpaid, 55,000
//        → cash sub-period: unpaid, contributes nothing under any window.
//        → accrual sub-period reads issueDate (09-01, inside Jul–Dec):
//          counted. Counted once, in the accrual sub-period.
//   D  issued 2024-06-15, paid 2024-06-20, 20,000
//        → cash sub-period reads paidOn (06-20, inside Jan–Jun): counted.
//        → accrual sub-period reads issueDate (06-15, outside Jul–Dec):
//          not counted there. Counted once, in the cash sub-period.
//
// Cash sub-period total:      A 40,000 + D 20,000 = 60,000.
// Accrual sub-period total:   C 55,000.
// Carried-forward cash total: B 35,000.
// Grand total:                60,000 + 55,000 + 35,000 = 150,000.
test('a regime change mid-year sums each sub-period under its own basis, resolved from the fiscal profiles on record', () => {
	const cashPack: FiscalPack = {
		id: 'test-cash-regime',
		version: '1',
		effectiveFrom: '2024-01-01',
		displayName: { en: 'Cash regime', it: 'Regime di cassa' },
		basis: 'cash',
		fiscalYear: { startMonth: 1, startDay: 1 },
		ceilings: [],
		treatments: [],
		charges: [],
		formats: [],
		unresolvedRevenue: 'carries_forward'
	};
	const accrualPack: FiscalPack = { ...cashPack, id: 'test-accrual-regime', basis: 'accrual' };
	const registry = buildRegistry([cashPack, accrualPack]);
	const profiles = [
		{
			packId: 'test-cash-regime',
			packVersion: '1',
			validFrom: '2024-01-01',
			validTo: '2024-07-01'
		},
		{ packId: 'test-accrual-regime', packVersion: '1', validFrom: '2024-07-01', validTo: null }
	];

	const resolved = resolvePackOverRange(registry, profiles, '2024-01-01', '2025-01-01');
	// The same mapping `fiscal/revenue.ts`'s `fetchRevenueOverRange` uses
	// to turn a resolved pack period into a `LedgerPeriod` — reused here
	// rather than hand-built, so this test exercises the real seam
	// between `resolve.ts` and `ledger.ts`.
	const periods: LedgerPeriod[] = resolved.map((period) => ({
		basis: period.pack.basis,
		from: period.from,
		to: period.to ?? '2025-01-01',
		packId: period.pack.id,
		unresolvedRevenue: period.pack.unresolvedRevenue
	}));
	expect(periods).toEqual([
		{
			basis: 'cash',
			from: '2024-01-01',
			to: '2024-07-01',
			packId: 'test-cash-regime',
			unresolvedRevenue: 'carries_forward'
		},
		{
			basis: 'accrual',
			from: '2024-07-01',
			to: '2025-01-01',
			packId: 'test-accrual-regime',
			unresolvedRevenue: 'carries_forward'
		}
	]);

	const rows: LedgerRow[] = [
		{
			invoiceId: 'A-within-cash',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2024-03-01',
			paidOn: '2024-03-15',
			amount: minorUnits(40_000)
		},
		{
			invoiceId: 'B-straddles-the-switch',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2024-05-01',
			paidOn: '2024-08-01',
			amount: minorUnits(35_000)
		},
		{
			invoiceId: 'C-within-accrual',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2024-09-01',
			paidOn: null,
			amount: minorUnits(55_000)
		},
		{
			invoiceId: 'D-within-cash-near-boundary',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2024-06-15',
			paidOn: '2024-06-20',
			amount: minorUnits(20_000)
		}
	];

	const result = sumLedgerAcrossPeriods(rows, periods);

	expect(result.subFigures[0].amount).toBe(40_000 + 20_000); // A + D
	expect(result.subFigures[1].amount).toBe(55_000); // C
	expect(result.subFigures[2]).toEqual({
		basis: 'cash',
		from: '2024-07-01',
		to: '2025-01-01',
		packId: 'test-cash-regime',
		amount: 35_000 // B, carried forward
	});
	expect(result.amount).toBe(60_000 + 55_000 + 35_000);

	// B in isolation resolves to a single cash-basis figure, 35,000, not
	// the 0 it would have contributed before #122: this is the direct,
	// row-level proof that the carry-forward does not depend on A, C or
	// D being present, and that it is not a miscount either — B is
	// counted exactly once, still under the cash basis that governed it
	// at issuance, in the sub-period its payment date actually falls in.
	const bAlone = sumLedgerAcrossPeriods(
		rows.filter((row) => row.invoiceId === 'B-straddles-the-switch'),
		periods
	);
	expect(bAlone.amount).toBe(35_000);
});

// ─── Case 3: a contract-year basis that does not align with the calendar year ─
//
// Contract starts 2024-04-15, so its contract-year ceiling resets on
// April 15th, not January 1st: the window evaluated as of 2024-10-01 is
// [2024-04-15, 2025-04-15). Four payments straddle that boundary on both
// ends:
//
//   R1  paid 2024-03-01, 10,000 — before the window opens: excluded.
//   R2  paid 2024-04-20, 20,000 — inside: included.
//   R3  paid 2025-03-01, 30,000 — still inside (window runs into 2025):
//       included.
//   R4  paid 2025-04-20, 40,000 — on/after the window's exclusive end
//       (2025-04-15): excluded.
//
// Contract-year total: R2 + R3 = 20,000 + 30,000 = 50,000.
//
// A calendar-year read of the same rows over 2024 would instead give
// R1 + R2 = 10,000 + 20,000 = 30,000 — a different figure that silently
// includes a payment from the *previous* contract year and drops one from
// the *current* one. That contrast is asserted directly below.
test("a contract-year basis anchored off the contract's own start date disagrees with a naive calendar-year read", () => {
	const rows: LedgerRow[] = [
		{
			invoiceId: 'r1-previous-contract-year',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2024-02-15',
			paidOn: '2024-03-01',
			amount: minorUnits(10_000)
		},
		{
			invoiceId: 'r2-current-contract-year-start',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2024-04-10',
			paidOn: '2024-04-20',
			amount: minorUnits(20_000)
		},
		{
			invoiceId: 'r3-current-contract-year-late',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2025-02-15',
			paidOn: '2025-03-01',
			amount: minorUnits(30_000)
		},
		{
			invoiceId: 'r4-next-contract-year',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2025-04-10',
			paidOn: '2025-04-20',
			amount: minorUnits(40_000)
		}
	];

	const contractYearCeiling: Ceiling = {
		id: 'contract-year-cap',
		origin: 'contract',
		label: { en: 'x', it: 'x' },
		measure: 'absolute_amount',
		value: minorUnits(1_000_000),
		basis: 'cash_received_contract_year',
		perimeter: { kind: 'all_clients' },
		alertLevels: [],
		consequence: { en: 'x', it: 'x' }
	};

	const evaluated = evaluateCeiling(contractYearCeiling, rows, '2024-10-01', '2024-04-15');
	expect(evaluated.period).toEqual({ from: '2024-04-15', to: '2025-04-15' });
	expect(evaluated.currentValue).toBe(50_000); // R2 + R3

	const calendarYearCeiling: Ceiling = {
		...contractYearCeiling,
		basis: 'cash_received_calendar_year'
	};
	const calendarRead = evaluateCeiling(calendarYearCeiling, rows, '2024-10-01');
	expect(calendarRead.period).toEqual({ from: '2024-01-01', to: '2025-01-01' });
	expect(calendarRead.currentValue).toBe(30_000); // R1 + R2 — the wrong figure
});

// ─── Case 4: a percentage-share ceiling when the denominator is zero ──────
//
// No revenue at all has landed in the period yet: the perimeter's own
// current value is 0, and the whole-book total the share is computed
// against is also 0, so the limit itself computes to round(0 * 0.5) = 0.
// 0 divided by 0 is undefined, not 0% and not 100%; `evaluateCeiling`
// floors `usageRatio` at 0 for exactly this reason, and (as of this PR)
// derives `crossed` from that same ratio, so a ceiling with nothing yet
// to measure reads as not crossed.
//
// Before this PR, `crossed` was `currentValue >= limitValue` directly:
// with both at 0, `0 >= 0` is `true`, so every percentage-share ceiling
// reported itself crossed from the very first instant of its own period,
// before a single invoice existed — silently, and exactly as
// convincingly as a real crossing. That was the defect; this test is
// its regression guard.
test('a percentage-share ceiling with zero revenue in the period is not reported crossed', () => {
	const rows: LedgerRow[] = [
		// Real revenue, but entirely outside the period being evaluated —
		// what actually makes the denominator zero is not an empty ledger,
		// it is an empty *window*.
		{
			invoiceId: 'outside-the-period',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2023-06-01',
			paidOn: '2023-06-10',
			amount: minorUnits(500_000)
		}
	];

	const shareCeiling: Ceiling = {
		id: 'client-a-share-cap',
		origin: 'contract',
		label: { en: 'x', it: 'x' },
		measure: 'percentage_share',
		value: 0.5,
		basis: 'cash_received_calendar_year',
		perimeter: { kind: 'client', clientId: 'client-a' },
		alertLevels: [{ ratio: 0.8, label: { en: 'x', it: 'x' } }],
		consequence: { en: 'x', it: 'x' }
	};

	const evaluated = evaluateCeiling(shareCeiling, rows, '2024-06-01');
	expect(evaluated.period).toEqual({ from: '2024-01-01', to: '2025-01-01' });
	expect(evaluated.currentValue).toBe(0);
	expect(evaluated.limitValue).toBe(0);
	expect(evaluated.usageRatio).toBe(0);
	expect(evaluated.crossed).toBe(false);
	expect(evaluated.activeAlertLevels).toEqual([]);
});

// ─── Case 5: a contract terminated mid-period ──────────────────────────────
//
// Notice served 2024-06-20 on a contract with 30 days' notice and its own
// end already fixed at 2024-07-15 (the shorter of the two, so
// `irrevocabilityWindowEnd` clips to it): the window is
// [2024-06-20, 2024-07-15]. Four monthly occurrences, one per month
// May–August, 100,000 each — August's is a stale card entry dated after
// the contract's own end, the kind of data error this case exists to
// catch:
//
//   05-01  before asOfDate: not committed (already past, and precedes the
//          window regardless).
//   06-01  before asOfDate: same.
//   07-01  inside [asOfDate, windowEnd]: committed, 100,000.
//   08-01  after the contract's own end (07-15): must not be committed,
//          and must not be projected either — the termination is real,
//          not a 30-day guess, so nothing beyond it is invented.
//
// Committed total: 100,000 (07-01 only).
// Projected total: 0 — `windowEnd` and `endsOn` are the same date here
// (07-15), so `projectedAmount`'s own "beyond the window, through
// endsOn" range is empty by construction, and with no renewal assumption
// recorded (#39) nothing fills in beyond that either.
test('a contract terminated mid-period commits only what notice still guarantees and projects nothing beyond its own end', () => {
	const occurrences = [
		{ date: '2024-05-01', amount: minorUnits(100_000) },
		{ date: '2024-06-01', amount: minorUnits(100_000) },
		{ date: '2024-07-01', amount: minorUnits(100_000) },
		{ date: '2024-08-01', amount: minorUnits(100_000) } // stale — dated after the contract's own end
	];
	const contract: RecurringFeeContract = {
		terminationNoticeDays: 30,
		endsOn: '2024-07-15',
		occurrences
	};

	const asOfDate = '2024-06-20';
	const from = '2024-01-01';
	const to = '2025-01-01';

	const committed = committedAmount([], [], [contract], asOfDate, from, to);
	const projected = projectedAmount([contract], asOfDate, from, to);

	expect(committed.amount).toBe(100_000);
	expect(projected.amount).toBe(0);
});

// #129, the mirror of the straddle #122 covers. Accrual first, cash
// second: the invoice is issued while the accrual regime governs and paid
// after the switch to a cash one. Accrual recognises revenue at issuance,
// unconditionally, so the invoice is already revenue of the first
// sub-period; a later cash period reading `paidOn` must not recognise it
// a second time. Legge 190/2014 art. 1 comma 72 says the same in the
// other direction ("corrispondenti criteri si applicano per l'ipotesi
// inversa"), and no jurisdiction counts one invoice's revenue twice.
//
// Arithmetic, worked by hand:
//   accrual sub-period [2024-01-01, 2024-07-01): issueDate 2024-03-01 is
//     inside it, so 50,000 is recognised here.
//   cash sub-period [2024-07-01, 2025-01-01): paidOn 2024-08-01 is inside
//     it, but the row was already recognised above, so 0 here.
//   carry-forward pass: the row was claimed, so nothing to attribute.
//   total = 50,000 + 0 = 50,000, not the 100,000 the old code returned.
test('an invoice issued under accrual and paid under a later cash regime is revenue exactly once', () => {
	const rows: LedgerRow[] = [
		{
			invoiceId: 'issued-under-accrual-paid-under-cash',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2024-03-01',
			paidOn: '2024-08-01',
			amount: minorUnits(50_000)
		}
	];
	const periods: LedgerPeriod[] = [
		{
			basis: 'accrual',
			from: '2024-01-01',
			to: '2024-07-01',
			packId: 'accrual-first',
			unresolvedRevenue: 'carries_forward'
		},
		{
			basis: 'cash',
			from: '2024-07-01',
			to: '2025-01-01',
			packId: 'cash-second',
			unresolvedRevenue: 'carries_forward'
		}
	];

	const total = sumLedgerAcrossPeriods(rows, periods);

	expect(total.amount).toBe(50_000);
	expect(total.subFigures.find((figure) => figure.packId === 'accrual-first')?.amount).toBe(50_000);
	expect(total.subFigures.find((figure) => figure.packId === 'cash-second')?.amount).toBe(0);
});

// The claim goes to the earlier regime whatever order the caller passes
// the sub-periods in: `resolvePackOverRange` returns them in order today,
// and a total that depended on that would be a trap for the next caller.
test('the earlier regime keeps a straddling invoice even when the periods arrive out of order', () => {
	const rows: LedgerRow[] = [
		{
			invoiceId: 'issued-under-accrual-paid-under-cash',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2024-03-01',
			paidOn: '2024-08-01',
			amount: minorUnits(50_000)
		}
	];
	const periods: LedgerPeriod[] = [
		{
			basis: 'cash',
			from: '2024-07-01',
			to: '2025-01-01',
			packId: 'cash-second',
			unresolvedRevenue: 'carries_forward'
		},
		{
			basis: 'accrual',
			from: '2024-01-01',
			to: '2024-07-01',
			packId: 'accrual-first',
			unresolvedRevenue: 'carries_forward'
		}
	];

	const total = sumLedgerAcrossPeriods(rows, periods);

	expect(total.amount).toBe(50_000);
	expect(total.subFigures.find((figure) => figure.packId === 'accrual-first')?.amount).toBe(50_000);
});
