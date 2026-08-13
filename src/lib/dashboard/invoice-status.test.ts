import { expect, test } from 'vitest';
import { dashboardInvoiceStatus } from './invoice-status';

test('overdue bands mirror the ageing table: warning within a week, serious within a month, critical beyond', () => {
	expect(dashboardInvoiceStatus(1).level).toBe('warning');
	expect(dashboardInvoiceStatus(7).level).toBe('warning');
	expect(dashboardInvoiceStatus(8).level).toBe('serious');
	expect(dashboardInvoiceStatus(30).level).toBe('serious');
	expect(dashboardInvoiceStatus(34).level).toBe('critical');
});

test('due today is warning, not good', () => {
	expect(dashboardInvoiceStatus(0).level).toBe('warning');
});

test("#234: not yet due but within the dashboard's due-soon window still reads warning, unlike the ageing table", () => {
	expect(dashboardInvoiceStatus(-3).level).toBe('warning');
	expect(dashboardInvoiceStatus(-7).level).toBe('warning');
});

test('comfortably not due reads good', () => {
	expect(dashboardInvoiceStatus(-8).level).toBe('good');
	expect(dashboardInvoiceStatus(-30).level).toBe('good');
});
