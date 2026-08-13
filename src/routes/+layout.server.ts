import { listActiveAlerts } from '$lib/server/alerts/engine';
import { daysLate } from '$lib/server/domain/invoice';
import { listUnpaidInvoices } from '$lib/server/repositories/invoice';
import { listProposals } from '$lib/server/repositories/proposal';
import type { LayoutServerLoad } from './$types';

/**
 * What the shell needs on every page: who is signed in, and the counts the
 * sidebar/bottom-bar badges show — pending proposals ("Da rivedere") and
 * overdue invoices ("Fatture"), the two queues #233 asks the nav to surface
 * because they are the two a human is actually blocking on. `unreadAlerts`
 * stays alongside them (unchanged from #146): the nav no longer renders it
 * as a badge of its own now that Alerts is reachable from Settings rather
 * than a primary destination, but any page under this layout — the alerts
 * list first among them — can still read it off inherited `PageData`
 * instead of re-querying.
 *
 * Runs for public routes too (sign-in, offline), where `locals.user` is
 * null and every count is skipped: the guard has not run there, and
 * querying the ledger for a visitor with no session would be both
 * pointless and wrong.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		return { user: null, unreadAlerts: 0, counts: { proposals: 0, overdueInvoices: 0 } };
	}

	const [alerts, pendingProposals, unpaidInvoices] = await Promise.all([
		listActiveAlerts(new Date().toISOString().slice(0, 10)),
		listProposals('pending'),
		listUnpaidInvoices()
	]);
	const now = new Date();

	return {
		user: { email: locals.user.email },
		unreadAlerts: alerts.filter((alert) => alert.acknowledgedAt === null).length,
		counts: {
			proposals: pendingProposals.length,
			overdueInvoices: unpaidInvoices.filter((row) => daysLate(row.invoice.dueDate, now) > 0).length
		}
	};
};
