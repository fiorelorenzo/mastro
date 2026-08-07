import { error, fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { calendarCrumbs } from '$lib/nav/crumbs';
import { getApproval, listApprovalsForContract } from '$lib/server/repositories/approval';
import { getContract } from '$lib/server/repositories/contract';
import { listRateCards } from '$lib/server/repositories/rate-card';
import {
	getWorkUnit,
	linkApprovalToWorkUnit,
	listWorkUnitTransitions
} from '$lib/server/repositories/work-unit';
import { priceWorkUnitOnDate } from '$lib/server/domain/work-unit-pricing';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const workUnit = await getWorkUnit(params.id);
	if (!workUnit) error(404, m.day_detail_not_found());

	const [contract, transitions, rateCards, approval] = await Promise.all([
		getContract(workUnit.contractId),
		listWorkUnitTransitions(workUnit.id),
		listRateCards(workUnit.contractId),
		workUnit.approvalId ? getApproval(workUnit.approvalId) : null
	]);
	if (!contract) error(404, m.day_detail_not_found());

	// Only the risk state can ever gain an approval after the fact — every
	// other state either never needed one or already has one, enforced by
	// the state machine trigger — so the inline linking list is loaded
	// only when it could actually be used.
	const linkableApprovals =
		workUnit.state === 'worked_without_approval'
			? (await listApprovalsForContract(workUnit.contractId)).map((row) => ({
					id: row.id,
					sender: row.sender,
					receivedAt: row.receivedAt.toISOString()
				}))
			: [];

	const crumbs = calendarCrumbs();

	return {
		workUnit: {
			id: workUnit.id,
			date: workUnit.date,
			quantity: Number(workUnit.quantity),
			scope: workUnit.scope,
			state: workUnit.state,
			notes: workUnit.notes
		},
		contract: { id: contract.id, title: contract.title, currency: contract.currency },
		amount: priceWorkUnitOnDate(
			{ date: workUnit.date, quantity: Number(workUnit.quantity) },
			rateCards
		),
		approval: approval
			? { id: approval.id, sender: approval.sender, receivedAt: approval.receivedAt.toISOString() }
			: null,
		linkableApprovals,
		transitions: transitions.map((t) => ({
			fromState: t.fromState,
			toState: t.toState,
			reason: t.reason,
			actor: t.actor,
			createdAt: t.createdAt.toISOString()
		})),
		crumbs
	};
};

export const actions: Actions = {
	link: async ({ request, params, locals }) => {
		const formData = await request.formData();
		const approvalId = String(formData.get('approvalId') ?? '').trim();

		const workUnit = await getWorkUnit(params.id);
		if (!workUnit) error(404, m.day_detail_not_found());

		const allowed = await listApprovalsForContract(workUnit.contractId);
		if (!approvalId || !allowed.some((row) => row.id === approvalId)) {
			return fail(400, { linkError: m.day_validation_approval_invalid() });
		}

		await linkApprovalToWorkUnit(
			params.id,
			approvalId,
			{ kind: 'human', email: locals.user!.email },
			'approval linked from the day detail page'
		);

		return { linked: true };
	}
};
