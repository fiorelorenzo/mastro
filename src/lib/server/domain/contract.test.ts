import { expect, test } from 'vitest';
import { computeDueDate, isRenewalWindowOpen, renewalWindowOpensOn } from './contract';

test('net terms: due date is N calendar days after the invoice date', () => {
	const due = computeDueDate({ kind: 'net', days: 30 }, new Date('2024-03-01T00:00:00Z'));
	expect(due.toISOString().slice(0, 10)).toBe('2024-03-31');
});

test('net terms: crosses a month and year boundary like any date arithmetic', () => {
	const due = computeDueDate({ kind: 'net', days: 45 }, new Date('2023-12-20T00:00:00Z'));
	expect(due.toISOString().slice(0, 10)).toBe('2024-02-03');
});

test('day_of_month terms: due on the given day of the following month', () => {
	const due = computeDueDate(
		{ kind: 'day_of_month', day: 15, monthOffset: 1 },
		new Date('2024-03-05T00:00:00Z')
	);
	expect(due.toISOString().slice(0, 10)).toBe('2024-04-15');
});

test('day_of_month terms: day 31 in a short month clamps to that month\u2019s last day', () => {
	// Invoiced in January, due "the 31st" of February -> February has 28 or
	// 29 days depending on the year; 2023 is not a leap year.
	const due = computeDueDate(
		{ kind: 'day_of_month', day: 31, monthOffset: 1 },
		new Date('2023-01-10T00:00:00Z')
	);
	expect(due.toISOString().slice(0, 10)).toBe('2023-02-28');
});

test('day_of_month terms: day 31 in a leap February clamps to the 29th', () => {
	const due = computeDueDate(
		{ kind: 'day_of_month', day: 31, monthOffset: 1 },
		new Date('2024-01-10T00:00:00Z')
	);
	expect(due.toISOString().slice(0, 10)).toBe('2024-02-29');
});

test('day_of_month terms: month_offset carries December into January of the next year', () => {
	const due = computeDueDate(
		{ kind: 'day_of_month', day: 5, monthOffset: 1 },
		new Date('2024-12-18T00:00:00Z')
	);
	expect(due.toISOString().slice(0, 10)).toBe('2025-01-05');
});

test('day_of_month terms: day 31 requested in December still clamps correctly across the year boundary', () => {
	const due = computeDueDate(
		{ kind: 'day_of_month', day: 31, monthOffset: 1 },
		new Date('2024-12-01T00:00:00Z')
	);
	expect(due.toISOString().slice(0, 10)).toBe('2025-01-31');
});

test('counterparty_option refusal window opens renewalNoticeDays before endsOn', () => {
	const opensOn = renewalWindowOpensOn({ endsOn: '2024-12-31', renewalNoticeDays: 30 });
	expect(opensOn?.toISOString().slice(0, 10)).toBe('2024-12-01');
});

test('refusal window is undefined for a contract with no renewal (no endsOn/notice pair)', () => {
	expect(renewalWindowOpensOn({ endsOn: null, renewalNoticeDays: null })).toBeNull();
});

test('the renewal window is not open before it opens', () => {
	const contract = { endsOn: '2026-12-31', renewalNoticeDays: 60 };
	expect(isRenewalWindowOpen(contract, new Date('2026-08-13T00:00:00Z'))).toBe(false);
});

test('the renewal window is open from the day it opens through the end date, inclusive', () => {
	const contract = { endsOn: '2026-12-31', renewalNoticeDays: 60 };
	expect(isRenewalWindowOpen(contract, new Date('2026-11-01T00:00:00Z'))).toBe(true);
	expect(isRenewalWindowOpen(contract, new Date('2026-12-15T00:00:00Z'))).toBe(true);
	expect(isRenewalWindowOpen(contract, new Date('2026-12-31T00:00:00Z'))).toBe(true);
});

test('the renewal window closes the day after the contract ends', () => {
	const contract = { endsOn: '2026-12-31', renewalNoticeDays: 60 };
	expect(isRenewalWindowOpen(contract, new Date('2027-01-01T00:00:00Z'))).toBe(false);
});

test('a contract with no renewal window (no endsOn/notice pair) is never open', () => {
	expect(isRenewalWindowOpen({ endsOn: null, renewalNoticeDays: null })).toBe(false);
});
