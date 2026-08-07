import { expect, test } from 'vitest';
import {
	certaintyBreakdown,
	collectedAmount,
	committedAmount,
	irrevocabilityWindowEnd,
	projectedAmount,
	renewalAssumptionContribution,
	type ApprovedWorkUnit,
	type RecurringFeeContract,
	type RecurringFeeOccurrence,
	type RenewalAssumption
} from './certainty';
import type { LedgerRow } from './ledger';

test('collected is money in the bank: cash basis, unconditionally', () => {
	const rows: LedgerRow[] = [
		{
			invoiceId: 'a',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2024-03-01',
			paidOn: '2024-04-10',
			amount: 70_000
		},
		{
			invoiceId: 'b',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2024-05-01',
			paidOn: null,
			amount: 20_000
		}
	];
	const figure = collectedAmount(rows, '2024-01-01', '2025-01-01');
	expect(figure).toEqual({
		level: 'collected',
		from: '2024-01-01',
		to: '2025-01-01',
		amount: 70_000
	});
});

test('an issued unpaid invoice counts as committed, by issue date', () => {
	const rows: LedgerRow[] = [
		{
			invoiceId: 'a',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2024-03-01',
			paidOn: null,
			amount: 50_000
		}
	];
	const figure = committedAmount(rows, [], [], '2024-06-01', '2024-01-01', '2025-01-01');
	expect(figure.amount).toBe(50_000);
});

test('approved but not yet invoiced days count as committed', () => {
	const approvedWorkUnits: ApprovedWorkUnit[] = [{ date: '2024-06-20', amount: 60_000 }];
	const figure = committedAmount(
		[],
		approvedWorkUnits,
		[],
		'2024-06-01',
		'2024-01-01',
		'2025-01-01'
	);
	expect(figure.amount).toBe(60_000);
});

test('an unpriced approved day (no rate card covers it) contributes nothing, never a guess', () => {
	const approvedWorkUnits: ApprovedWorkUnit[] = [{ date: '2024-06-20', amount: null }];
	const figure = committedAmount(
		[],
		approvedWorkUnits,
		[],
		'2024-06-01',
		'2024-01-01',
		'2025-01-01'
	);
	expect(figure.amount).toBe(0);
});

test('a proposed day never reaches this module at all — only pre-filtered approved units are counted', () => {
	// `ApprovedWorkUnit` has no state field to check: the caller
	// (`fiscal/forecast.ts`) already filtered to `state = 'approved'`
	// before building this list, so an empty list here is exactly what a
	// contract with only proposed days produces.
	const figure = committedAmount([], [], [], '2024-06-01', '2024-01-01', '2025-01-01');
	expect(figure.amount).toBe(0);
});

test('irrevocabilityWindowEnd: a 30-day notice from today runs 30 days out', () => {
	expect(irrevocabilityWindowEnd({ terminationNoticeDays: 30, endsOn: null }, '2024-06-15')).toBe(
		'2024-07-15'
	);
});

test("irrevocabilityWindowEnd clips to the contract's own end when notice would run past it", () => {
	expect(
		irrevocabilityWindowEnd({ terminationNoticeDays: 30, endsOn: '2024-06-25' }, '2024-06-15')
	).toBe('2024-06-25');
});

test('irrevocabilityWindowEnd is null once the contract has already ended', () => {
	expect(
		irrevocabilityWindowEnd({ terminationNoticeDays: 30, endsOn: '2024-01-01' }, '2024-06-15')
	).toBeNull();
});

// The epic's own acceptance scenario (epic #5, "Done when"): a year-long
// contract with a 30-day notice period shows only the period within
// notice as committed, and everything else it would otherwise have
// earned this year — beyond notice, up to its own end date — as
// projected, never committed.
test('a year-long contract with a 30-day notice period contributes only the current period to committed', () => {
	const monthStarts = [
		'2024-01-01',
		'2024-02-01',
		'2024-03-01',
		'2024-04-01',
		'2024-05-01',
		'2024-06-01',
		'2024-07-01',
		'2024-08-01',
		'2024-09-01',
		'2024-10-01',
		'2024-11-01',
		'2024-12-01'
	];
	const occurrences: RecurringFeeOccurrence[] = monthStarts.map((date) => ({
		date,
		amount: 100_000
	}));
	const contract: RecurringFeeContract = {
		terminationNoticeDays: 30,
		endsOn: '2024-12-31',
		occurrences
	};

	const asOfDate = '2024-06-15';
	const from = '2024-01-01';
	const to = '2025-01-01';

	const committed = committedAmount([], [], [contract], asOfDate, from, to);
	const projected = projectedAmount([contract], asOfDate, from, to);

	// Window: [2024-06-15, 2024-07-15]. Only the 2024-07-01 occurrence
	// falls inside it — June's fee is already in the past, August's is
	// beyond the 30-day guarantee.
	expect(committed.amount).toBe(100_000);
	// Beyond the window through the contract's own end (2024-12-31):
	// August through December, five occurrences.
	expect(projected.amount).toBe(5 * 100_000);
});

test('an indefinite contract (no end date) projects nothing beyond the notice window — no renewal assumed', () => {
	const occurrences: RecurringFeeOccurrence[] = [
		{ date: '2024-08-01', amount: 100_000 },
		{ date: '2024-09-01', amount: 100_000 }
	];
	const contract: RecurringFeeContract = { terminationNoticeDays: 30, endsOn: null, occurrences };
	const projected = projectedAmount([contract], '2024-06-15', '2024-01-01', '2025-01-01');
	expect(projected.amount).toBe(0);
});

test('the three levels are separately queryable and also composable into one breakdown', () => {
	const rows: LedgerRow[] = [
		{
			invoiceId: 'a',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2024-02-01',
			paidOn: '2024-02-10',
			amount: 10_000
		}
	];
	const approvedWorkUnits: ApprovedWorkUnit[] = [{ date: '2024-03-01', amount: 5_000 }];
	const contract: RecurringFeeContract = {
		terminationNoticeDays: 10,
		endsOn: '2024-12-31',
		occurrences: [
			{ date: '2024-06-15', amount: 2_000 },
			{ date: '2024-09-01', amount: 3_000 }
		]
	};
	const asOfDate = '2024-06-10';
	const from = '2024-01-01';
	const to = '2025-01-01';

	const breakdown = certaintyBreakdown(rows, approvedWorkUnits, [contract], asOfDate, from, to);

	expect(breakdown.collected.amount).toBe(10_000);
	expect(breakdown.committed.amount).toBe(5_000 + 2_000); // approved day + the in-window occurrence
	expect(breakdown.projected.amount).toBe(3_000); // the September occurrence, beyond the window

	expect(breakdown.collected).toEqual(collectedAmount(rows, from, to));
	expect(breakdown.committed).toEqual(
		committedAmount(rows, approvedWorkUnits, [contract], asOfDate, from, to)
	);
	expect(breakdown.projected).toEqual(projectedAmount([contract], asOfDate, from, to));
});

// #39: explicit per-contract renewal assumptions. Beyond a contract's
// known term (its own `endsOn`, or the irrevocability window when it has
// none) any number is an assumption, so it is recorded rather than
// inferred — these tests are the acceptance criteria themselves: empty
// with nothing recorded, and, once recorded, feeding the projected band
// only, scaled by probability and prorated across its own horizon.

test("with no renewal assumption recorded, nothing projects past a fixed-term contract's own end date — not even a stray occurrence dated after it", () => {
	const occurrences: RecurringFeeOccurrence[] = [
		{ date: '2024-05-20', amount: 7_000 }, // between the window and endsOn: scheduled
		{ date: '2024-06-15', amount: 9_000 } // after endsOn: never scheduled, never guessed
	];
	const contract: RecurringFeeContract = {
		terminationNoticeDays: 15,
		endsOn: '2024-05-31',
		occurrences
	};
	const projected = projectedAmount([contract], '2024-05-01', '2024-01-01', '2025-01-01');
	// Window: notice from 2024-05-01 runs to 2024-05-16. Scheduled beyond
	// it, through endsOn (2024-05-31): only the 05-20 occurrence, 7,000.
	// The 06-15 occurrence is dated after endsOn and contributes nothing —
	// with no renewalAssumption, that is the whole figure.
	expect(projected.amount).toBe(7_000);
});

test('renewalAssumptionContribution is zero with none recorded', () => {
	const contract: RecurringFeeContract = {
		terminationNoticeDays: 30,
		endsOn: null,
		occurrences: []
	};
	expect(renewalAssumptionContribution(contract, '2024-06-15', '2024-01-01', '2025-01-01')).toBe(0);
});

test('a renewal assumption fills exactly its own horizon when the query window fully contains it', () => {
	const assumption: RenewalAssumption = {
		probability: 0.4,
		expectedVolumeMinorUnits: 100_000,
		horizonEndsOn: '2024-02-10'
	};
	const contract: RecurringFeeContract = {
		terminationNoticeDays: 30,
		endsOn: null,
		occurrences: [],
		renewalAssumption: assumption
	};
	// asOfDate 2024-01-01 + 30 days' notice = window through 2024-01-31, so
	// the assumption's own horizon starts 2024-02-01. It runs 10 days
	// (Feb 1 through Feb 10 inclusive) — 100,000 * 0.4 = 40,000 spread
	// evenly across those 10 days is 4,000/day, and the query window below
	// contains the whole horizon: 10 * 4,000 = 40,000.
	const contribution = renewalAssumptionContribution(
		contract,
		'2024-01-01',
		'2024-01-01',
		'2025-01-01'
	);
	expect(contribution).toBe(40_000);
	expect(projectedAmount([contract], '2024-01-01', '2024-01-01', '2025-01-01').amount).toBe(40_000);
});

test('a renewal assumption prorates by day when the query window only partly overlaps its horizon', () => {
	const assumption: RenewalAssumption = {
		probability: 0.4,
		expectedVolumeMinorUnits: 100_000,
		horizonEndsOn: '2024-02-10'
	};
	const contract: RecurringFeeContract = {
		terminationNoticeDays: 30,
		endsOn: null,
		occurrences: [],
		renewalAssumption: assumption
	};
	// Same 10-day, 4,000/day horizon as above, but the query window here
	// is [2024-02-01, 2024-02-06) — the first 5 of the 10 days — so it
	// gets half: 5 * 4,000 = 20,000.
	const contribution = renewalAssumptionContribution(
		contract,
		'2024-01-01',
		'2024-02-01',
		'2024-02-06'
	);
	expect(contribution).toBe(20_000);
});

test('a renewal assumption contributes nothing to a query window that misses its horizon entirely', () => {
	const assumption: RenewalAssumption = {
		probability: 0.4,
		expectedVolumeMinorUnits: 100_000,
		horizonEndsOn: '2024-02-10'
	};
	const contract: RecurringFeeContract = {
		terminationNoticeDays: 30,
		endsOn: null,
		occurrences: [],
		renewalAssumption: assumption
	};
	const contribution = renewalAssumptionContribution(
		contract,
		'2024-01-01',
		'2024-03-01',
		'2024-04-01'
	);
	expect(contribution).toBe(0);
});

test('a renewal assumption already past its own horizon by the query window contributes nothing', () => {
	const assumption: RenewalAssumption = {
		probability: 1,
		expectedVolumeMinorUnits: 50_000,
		horizonEndsOn: '2024-01-15' // before the window even opens (2024-02-01)
	};
	const contract: RecurringFeeContract = {
		terminationNoticeDays: 30,
		endsOn: null,
		occurrences: [],
		renewalAssumption: assumption
	};
	const contribution = renewalAssumptionContribution(
		contract,
		'2024-01-01',
		'2024-01-01',
		'2025-01-01'
	);
	expect(contribution).toBe(0);
});

test('a renewal assumption never reaches committedAmount — it feeds the projected band only', () => {
	const assumption: RenewalAssumption = {
		probability: 1,
		expectedVolumeMinorUnits: 1_000_000,
		horizonEndsOn: '2025-12-31'
	};
	const occurrences: RecurringFeeOccurrence[] = [{ date: '2024-06-20', amount: 4_000 }];
	const contract: RecurringFeeContract = {
		terminationNoticeDays: 30,
		endsOn: null,
		occurrences,
		renewalAssumption: assumption
	};
	const committed = committedAmount([], [], [contract], '2024-06-15', '2024-01-01', '2025-01-01');
	// The 06-20 occurrence falls inside the notice window (2024-06-15
	// through 2024-07-15) and is the only thing committedAmount reads off
	// a recurring contract — a huge assumption sitting on the same
	// contract must not leak into it.
	expect(committed.amount).toBe(4_000);
});

test("a fixed-term contract's renewal assumption starts the day after its own end date, not the day after the notice window", () => {
	// Notice from 2024-06-01 (10 days) runs only to 2024-06-11, well
	// before the contract's own end on 2024-06-30 — so the known,
	// scheduled fee between the two is still `projectedAmount`'s own
	// territory, and the assumption must not double-count it by starting
	// at 2024-06-12.
	const assumption: RenewalAssumption = {
		probability: 1,
		expectedVolumeMinorUnits: 31_000, // 1,000/day over the 31-day horizon below
		horizonEndsOn: '2024-07-31'
	};
	const occurrences: RecurringFeeOccurrence[] = [
		{ date: '2024-06-15', amount: 5_000 }, // between the window and endsOn: scheduled
		{ date: '2024-07-01', amount: 9_999 } // after endsOn: excluded from "scheduled"
	];
	const contract: RecurringFeeContract = {
		terminationNoticeDays: 10,
		endsOn: '2024-06-30',
		occurrences,
		renewalAssumption: assumption
	};
	const projected = projectedAmount([contract], '2024-06-01', '2024-01-01', '2025-01-01');
	// Scheduled: 5,000 (06-15, the only occurrence in (06-11, 06-30]).
	// Assumed: the horizon runs 2024-07-01 through 2024-07-31, 31 days,
	// fully inside the query window — the whole 31,000 at probability 1.
	// 5,000 + 31,000 = 36,000, and the 9,999 stray occurrence is in
	// neither figure.
	expect(projected.amount).toBe(5_000 + 31_000);
});
