import { fail } from '@sveltejs/kit';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';
import { alertResolution } from '$lib/server/alerts/actions';
import { listActiveAlerts } from '$lib/server/alerts/engine';
import { alertMessage } from '$lib/server/alerts/render';
import { acknowledgeAlert } from '$lib/server/alerts/state';
import { markWorkUnitUnbillable } from '$lib/server/repositories/work-unit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const locale = getLocale();
	const alerts = await listActiveAlerts(new Date().toISOString().slice(0, 10));
	return {
		alerts: alerts.map((alert) => ({
			key: alert.key,
			type: alert.detail.type,
			severity: alert.severity,
			acknowledged: alert.acknowledged,
			acknowledgedAt: alert.acknowledgedAt,
			acknowledgedBy: alert.acknowledgedBy,
			...alertMessage(alert, locale),
			...alertResolution(alert.detail, locale)
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

		const alerts = await listActiveAlerts(new Date().toISOString().slice(0, 10));
		const alert = alerts.find((candidate) => candidate.key === key);
		if (!alert) return;

		await acknowledgeAlert(alert, locals.user!.email);
	},

	// #228's other exit from the risk state, offered right from the alert
	// list rather than only from the day itself. Same re-detection as
	// `acknowledge` above: a day that recovered (a late approval landed)
	// or was already closed out between page load and submit is a no-op,
	// never a stale write against a day no longer in the risk state — the
	// database trigger would reject it anyway, but this keeps a harmless
	// double-submit from surfacing as an error.
	unbillable: async ({ request, locals }) => {
		const formData = await request.formData();
		const workUnitId = String(formData.get('workUnitId') ?? '').trim();
		const reason = String(formData.get('reason') ?? '').trim();
		if (!workUnitId) return;

		const alerts = await listActiveAlerts(new Date().toISOString().slice(0, 10));
		const alert = alerts.find(
			(candidate) =>
				candidate.detail.type === 'worked_without_approval' &&
				candidate.detail.workUnitId === workUnitId
		);
		if (!alert) return { markedUnbillable: true, workUnitId };

		if (!reason) {
			return fail(400, {
				unbillableError: m.alerts_unbillable_reason_required(),
				workUnitId,
				reason
			});
		}

		await markWorkUnitUnbillable(workUnitId, { kind: 'human', email: locals.user!.email }, reason);

		return { markedUnbillable: true, workUnitId };
	}
};
