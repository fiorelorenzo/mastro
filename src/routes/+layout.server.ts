import { daysLate } from '$lib/server/domain/invoice';
import { listUnpaidInvoices } from '$lib/server/repositories/invoice';
import { listProposals } from '$lib/server/repositories/proposal';
import type { LayoutServerLoad } from './$types';

/**
 * What the shell needs on every page: who is signed in, and the counts the
 * sidebar/bottom-bar badges show — pending proposals ("Da rivedere") and
 * overdue invoices ("Fatture"), the two queues #233 asks the nav to surface
 * because they are the two a human is actually blocking on. There used to
 * be a third count here, `unreadAlerts` (#146), but #369 found it had no
 * reader anywhere in the app — the nav dropped its badge, and no page ever
 * read it off inherited `PageData` either. A per-request query whose
 * result nothing consumes is pure cost, so it is gone rather than kept
 * "for later": Settings links to `/alerts` directly now (see `items.ts`),
 * which is the surface #369 decided on instead of resurrecting the count.
 *
 * Runs for public routes too (sign-in, offline), where `locals.user` is
 * null and every count is skipped: the guard has not run there, and
 * querying the ledger for a visitor with no session would be both
 * pointless and wrong.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		return { user: null, counts: { proposals: 0, overdueInvoices: 0 } };
	}

	const [pendingProposals, unpaidInvoices] = await Promise.all([
		listProposals('pending'),
		listUnpaidInvoices()
	]);
	const now = new Date();

	return {
		user: { email: locals.user.email },
		counts: {
			proposals: pendingProposals.length,
			overdueInvoices: unpaidInvoices.filter((row) => daysLate(row.invoice.dueDate, now) > 0).length
		}
	};
};
