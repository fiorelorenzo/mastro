import { expect, test } from 'vitest';
import {
	certaintyBreakdown,
	collectedAmount,
	committedAmount,
	irrevocabilityWindowEnd,
	projectedAmount,
	type ApprovedWorkUnit,
	type RecurringFeeContract,
	type RecurringFeeOccurrence
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
