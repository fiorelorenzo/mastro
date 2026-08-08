import { expect, test } from 'vitest';
import { sumLedger, sumLedgerAcrossPeriods, type LedgerPeriod, type LedgerRow } from './ledger';
import { minorUnits } from '$lib/money';

// A December invoice paid the following January — the exact case
// AGENTS.md's epic #5 calls out: "an invoice issued in December and paid
// in January belongs to the following year", which is what makes the
// payment date a lever a "what if I collect this in January" projection
// can pull.
const rows: LedgerRow[] = [
	{
		invoiceId: 'december-issue-january-pay',
		contractId: 'c1',
		clientId: 'client-a',
		issueDate: '2024-12-20',
		paidOn: '2025-01-05',
		amount: minorUnits(100_000)
	},
	{
		invoiceId: 'paid-same-year',
		contractId: 'c1',
		clientId: 'client-a',
		issueDate: '2024-06-01',
		paidOn: '2024-06-15',
		amount: minorUnits(50_000)
	},
	{
		invoiceId: 'still-unpaid',
		contractId: 'c1',
		clientId: 'client-a',
		issueDate: '2024-11-01',
		paidOn: null,
		amount: minorUnits(30_000)
	}
];

test('accrual sums by issue date, counting an unpaid invoice as revenue', () => {
	const figure = sumLedger(rows, 'accrual', '2024-01-01', '2025-01-01');
	expect(figure.amount).toBe(100_000 + 50_000 + 30_000);
	expect(figure.basis).toBe('accrual');
});

test('cash sums by payment date, excluding an invoice never paid', () => {
	const figure = sumLedger(rows, 'cash', '2024-01-01', '2025-01-01');
	expect(figure.amount).toBe(50_000);
});

test('a December invoice paid in January lands in next year under cash, this year under accrual', () => {
	const cash2024 = sumLedger(rows, 'cash', '2024-01-01', '2025-01-01');
	const cash2025 = sumLedger(rows, 'cash', '2025-01-01', '2026-01-01');
	const accrual2024 = sumLedger(rows, 'accrual', '2024-01-01', '2025-01-01');

	expect(cash2024.amount).toBe(50_000);
	expect(cash2025.amount).toBe(100_000);
	expect(accrual2024.amount).toBe(180_000);
});

test('every figure carries the basis, and the period, that produced it', () => {
	const figure = sumLedger(rows, 'cash', '2024-01-01', '2025-01-01');
	expect(figure).toEqual({ basis: 'cash', from: '2024-01-01', to: '2025-01-01', amount: 50_000 });
});

test('"what if I collect this in January" is one extra row through the same function, never a second one', () => {
	// A window the December-issued invoice's actual payment (2025-01-05)
	// falls outside of, so only the hypothetical row's own date matters
	// here.
	const from = '2025-01-10';
	const to = '2025-02-01';

	// Today: the still-unpaid invoice contributes nothing.
	expect(sumLedger(rows, 'cash', from, to).amount).toBe(0);

	// The projection: collect it on 2025-01-20 instead. No new function —
	// `sumLedger` runs again over a row list with one date changed.
	const ifCollectedInJanuary = rows.map((row) =>
		row.invoiceId === 'still-unpaid' ? { ...row, paidOn: '2025-01-20' } : row
	);
	expect(sumLedger(ifCollectedInJanuary, 'cash', from, to).amount).toBe(30_000);
});

test('an invalid period (from not before to) is rejected rather than silently summing nothing', () => {
	expect(() => sumLedger(rows, 'cash', '2025-01-01', '2025-01-01')).toThrow(/invalid period/);
});

test('a period spanning a regime change sums each sub-period under its own basis', () => {
	const regimeRows: LedgerRow[] = [
		// Issued and paid inside the cash-basis sub-period: counts under
		// both readings, but only the cash sub-period's basis is applied.
		{
			invoiceId: 'before-switch',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2024-03-01',
			paidOn: '2024-03-10',
			amount: minorUnits(40_000)
		},
		// Issued after the switch to accrual, paid later still: counted
		// the moment it is issued, not when it is paid.
		{
			invoiceId: 'after-switch-unpaid',
			contractId: 'c1',
			clientId: 'client-a',
			issueDate: '2024-08-01',
			paidOn: null,
			amount: minorUnits(60_000)
		}
	];
	const periods: LedgerPeriod[] = [
		{
			basis: 'cash',
			from: '2024-01-01',
			to: '2024-07-01',
			packId: 'flat-rate',
			unresolvedRevenue: 'carries_forward'
		},
		{
			basis: 'accrual',
			from: '2024-07-01',
			to: '2025-01-01',
			packId: 'standard',
			unresolvedRevenue: 'carries_forward'
		}
	];

	const result = sumLedgerAcrossPeriods(regimeRows, periods);

	expect(result.subFigures).toEqual([
		{ basis: 'cash', from: '2024-01-01', to: '2024-07-01', amount: 40_000, packId: 'flat-rate' },
		{ basis: 'accrual', from: '2024-07-01', to: '2025-01-01', amount: 60_000, packId: 'standard' }
	]);
	expect(result.amount).toBe(100_000);
});
