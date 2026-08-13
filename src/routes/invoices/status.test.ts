import { expect, test } from 'vitest';
import { ageingBandKey, ageingStatus, invoiceStatus } from './status';

test('a negative daysLate reads as good, due in the future', () => {
	expect(ageingStatus(-3).level).toBe('good');
});

test('due today is warning, not yet overdue', () => {
	expect(ageingStatus(0).level).toBe('warning');
});

test('overdue up to a week stays warning', () => {
	expect(ageingStatus(7).level).toBe('warning');
});

test('overdue past a week but within a month is serious', () => {
	expect(ageingStatus(8).level).toBe('serious');
	expect(ageingStatus(30).level).toBe('serious');
});

test('overdue past a month is critical', () => {
	expect(ageingStatus(31).level).toBe('critical');
});

test('a band key partitions the same daysLate axis into four non-overlapping ranges', () => {
	expect(ageingBandKey(31)).toBe('overdue_critical');
	expect(ageingBandKey(30)).toBe('overdue');
	expect(ageingBandKey(1)).toBe('overdue');
	expect(ageingBandKey(0)).toBe('due_soon');
	expect(ageingBandKey(-7)).toBe('due_soon');
	expect(ageingBandKey(-8)).toBe('not_due_soon');
});

test('an overdue-by-15-days invoice lands in the overdue band, not due-soon — the mockup never exercises this case since its seed data has none', () => {
	expect(ageingBandKey(15)).toBe('overdue');
});

test('a paid invoice is always good, regardless of how late it once was', () => {
	expect(invoiceStatus(90, '2026-01-01').level).toBe('good');
});

test('an unpaid invoice falls back to its ageing status', () => {
	expect(invoiceStatus(34, null)).toEqual(ageingStatus(34));
});
