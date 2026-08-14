import { expect, test } from 'vitest';
import { daysLate, isOverdue, resolveDueDate, resolveInvoiceRouting } from './invoice';

test('resolveDueDate keeps a supplied date verbatim, sourced as "document"', () => {
	const result = resolveDueDate({ kind: 'net', days: 30 }, '2024-03-01', '2024-03-20');
	expect(result).toEqual({ dueDate: '2024-03-20', source: 'document' });
});

test('resolveDueDate computes from the contract payment terms when none is supplied, sourced as "computed"', () => {
	const result = resolveDueDate({ kind: 'net', days: 30 }, '2024-03-01', null);
	expect(result).toEqual({ dueDate: '2024-03-31', source: 'computed' });
});

test('resolveDueDate computes from day_of_month terms the same way computeDueDate does', () => {
	const result = resolveDueDate(
		{ kind: 'day_of_month', day: 15, monthOffset: 1 },
		'2024-03-05',
		null
	);
	expect(result).toEqual({ dueDate: '2024-04-15', source: 'computed' });
});

test('daysLate is positive once the due date has passed', () => {
	expect(daysLate('2024-03-01', new Date('2024-03-11T00:00:00Z'))).toBe(10);
});

test('daysLate is zero on the due date itself', () => {
	expect(daysLate('2024-03-01', new Date('2024-03-01T00:00:00Z'))).toBe(0);
});

test('daysLate is negative before the due date', () => {
	expect(daysLate('2024-03-10', new Date('2024-03-01T00:00:00Z'))).toBe(-9);
});

test('daysLate does not depend on the server timezone: reads the reference instant at UTC midnight', () => {
	// 23:59 UTC on the 1st is still "the 1st" for a calendar-day due date, not the 2nd.
	expect(daysLate('2024-03-01', new Date('2024-03-01T23:59:00Z'))).toBe(0);
});

test('an unpaid invoice past its due date is overdue', () => {
	expect(isOverdue('2024-03-01', null, new Date('2024-03-02T00:00:00Z'))).toBe(true);
});

test('an unpaid invoice not yet at its due date is not overdue', () => {
	expect(isOverdue('2024-03-10', null, new Date('2024-03-01T00:00:00Z'))).toBe(false);
});

test('an invoice due today, with no payment yet, is not overdue: overdue means the date has passed', () => {
	expect(isOverdue('2024-03-01', null, new Date('2024-03-01T00:00:00Z'))).toBe(false);
});

test('a paid invoice is never overdue, however late the payment was', () => {
	expect(isOverdue('2024-03-01', '2024-04-15', new Date('2024-06-01T00:00:00Z'))).toBe(false);
});

test('resolveInvoiceRouting picks the client sdiCode when one is on file', () => {
	expect(
		resolveInvoiceRouting({ sdiCode: 'ABC1234', pecAddress: 'client@pec.example.it' })
	).toEqual({ case: 'sdi_code', sdiCode: 'ABC1234' });
});

test('resolveInvoiceRouting falls back to the PEC address when there is no sdiCode', () => {
	expect(resolveInvoiceRouting({ sdiCode: null, pecAddress: 'client@pec.example.it' })).toEqual({
		case: 'pec',
		pecAddress: 'client@pec.example.it'
	});
});

test('resolveInvoiceRouting falls back to the reserved area when neither is on file', () => {
	expect(resolveInvoiceRouting({ sdiCode: null, pecAddress: null })).toEqual({
		case: 'reserved_area'
	});
});

test('resolveInvoiceRouting treats an empty sdiCode string the same as absent', () => {
	expect(resolveInvoiceRouting({ sdiCode: '', pecAddress: null })).toEqual({
		case: 'reserved_area'
	});
});
