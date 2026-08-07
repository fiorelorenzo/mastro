import { getLocale } from '$lib/paraglide/runtime';
import { listActiveAlerts } from '$lib/server/alerts/engine';
import { alertMessage } from '$lib/server/alerts/render';
import { acknowledgeAlert } from '$lib/server/alerts/state';
import type { Actions, PageServerLoad } from './$types';

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

export const load: PageServerLoad = async () => {
	const locale = getLocale();
	const alerts = await listActiveAlerts(todayIso());
	return {
		alerts: alerts.map((alert) => ({
			key: alert.key,
			type: alert.detail.type,
			severity: alert.severity,
			acknowledged: alert.acknowledged,
			acknowledgedAt: alert.acknowledgedAt,
			acknowledgedBy: alert.acknowledgedBy,
			...alertMessage(alert, locale)
		}))
	};
};

export const actions: Actions = {
	// Re-detects rather than trusting the posted key alone: acknowledging
	// an alert that has since resolved (or whose severity moved) between
	// page load and submit is a no-op, never a stale write.
	acknowledge: async ({ request, locals }) => {
		const formData = await request.formData();
		const key = String(formData.get('key') ?? '');
		if (!key) return;

		const alerts = await listActiveAlerts(todayIso());
		const alert = alerts.find((candidate) => candidate.key === key);
		if (!alert) return;

		await acknowledgeAlert(alert, locals.user!.email);
	}
};
