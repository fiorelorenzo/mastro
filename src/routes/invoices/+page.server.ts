import { daysLate } from '$lib/server/domain/invoice';
import { listUnpaidInvoices } from '$lib/server/repositories/invoice';
import type { PageServerLoad } from './$types';

// The ageing table (#29): every unpaid invoice, most overdue first.
// `daysLate` is recomputed against `new Date()` on every load — nothing
// here reads a stored flag, so the ordering and every chip are correct
// even if the process has been up for months with no job running (#27).
export const load: PageServerLoad = async () => {
	const now = new Date();
	const rows = (await listUnpaidInvoices())
		.map((row) => ({ ...row, daysLate: daysLate(row.invoice.dueDate, now) }))
		.sort((a, b) => b.daysLate - a.daysLate);

	const totalOutstandingByCurrency = rows.reduce<Record<string, number>>((totals, row) => {
		totals[row.invoice.currency] = (totals[row.invoice.currency] ?? 0) + row.invoice.total;
		return totals;
	}, {});

	return {
		rows,
		totalOutstandingByCurrency,
		awaitingPaymentCount: rows.length
	};
};
