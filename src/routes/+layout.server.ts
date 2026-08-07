import { listActiveAlerts } from '$lib/server/alerts/engine';
import type { LayoutServerLoad } from './$types';

/**
 * What the shell needs on every page: who is signed in, and how many alerts
 * are waiting. Runs for public routes too (sign-in, offline), where
 * `locals.user` is null and the count is skipped: the guard has not run
 * there, and querying the ledger for a visitor with no session would be
 * both pointless and wrong.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) return { user: null, unreadAlerts: 0 };

	const alerts = await listActiveAlerts(new Date().toISOString().slice(0, 10));
	return {
		user: { email: locals.user.email },
		unreadAlerts: alerts.filter((alert) => alert.acknowledgedAt === null).length
	};
};
