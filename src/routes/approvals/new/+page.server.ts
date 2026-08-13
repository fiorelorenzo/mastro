/**
 * The human path for recording an approval (#210): channel, sender, when
 * it arrived, the verbatim excerpt, and the proof — a file or pasted text
 * archived as a document owned by the approval. Until this route existed,
 * `createApproval` had no production caller: a client who confirmed by
 * phone, WhatsApp, a signed scan or in a meeting could not be recorded at
 * all, so on a contract that requires prior approval every such day could
 * only ever land in (and stay in) `worked_without_approval`.
 *
 * Scoped by `?contractId=` rather than nested under
 * `/clients/[id]/contracts/[contractId]`, the same way `/day/new` takes
 * its contract as a form field rather than a path segment — this page is
 * linked from three different places (a day, the contract, an alert), and
 * a flat query-string contract avoids each caller having to also look up
 * a client id it may not have to hand.
 *
 * `?workUnitId=` is optional and is what makes this #23's recovery path
 * too: when it names a day on the same contract that has no approval yet,
 * submitting the form archives the proof and links (and, if the day was
 * `worked_without_approval`, recovers) it in one transaction —
 * `recordApproval` in `repositories/approval.ts`.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { contractCrumbs } from '$lib/nav/crumbs';
import { noticeChannel } from '$lib/server/db/schema';
import { getContractWithClient } from '$lib/server/repositories/contract';
import { getWorkUnit } from '$lib/server/repositories/work-unit';
import { recordApproval } from '$lib/server/repositories/approval';
import { parseApprovalForm } from '$lib/server/repositories/approval-form';
import type { Actions, PageServerLoad } from './$types';

async function loadLinkableWorkUnit(contractId: string, workUnitId: string | null) {
	if (!workUnitId) return null;
	const workUnit = await getWorkUnit(workUnitId);
	if (!workUnit || workUnit.contractId !== contractId || workUnit.approvalId) {
		error(400, m.approval_form_work_unit_invalid());
	}
	return workUnit;
}

export const load: PageServerLoad = async ({ url }) => {
	const contractId = url.searchParams.get('contractId') ?? '';
	const contract = await getContractWithClient(contractId);
	if (!contract) error(404, m.contract_not_found());

	const workUnit = await loadLinkableWorkUnit(contract.id, url.searchParams.get('workUnitId'));

	return {
		contract: { id: contract.id, title: contract.title, clientId: contract.clientId },
		workUnit: workUnit ? { id: workUnit.id, date: workUnit.date, state: workUnit.state } : null,
		channels: noticeChannel.enumValues,
		crumbs: contractCrumbs(contract)
	};
};

export const actions: Actions = {
	default: async ({ request, url, locals }) => {
		const contractId = url.searchParams.get('contractId') ?? '';
		const contract = await getContractWithClient(contractId);
		if (!contract) error(404, m.contract_not_found());

		const workUnit = await loadLinkableWorkUnit(contract.id, url.searchParams.get('workUnitId'));

		const formData = await request.formData();
		const result = parseApprovalForm(formData, noticeChannel.enumValues);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		const documentInput =
			result.input.proof === 'file'
				? await (async () => {
						const file = formData.get('proofFile') as File;
						return {
							bytes: new Uint8Array(await file.arrayBuffer()),
							mime: file.type || 'application/octet-stream',
							originalName: file.name,
							provenance: 'upload' as const,
							confidential: result.values.confidential
						};
					})()
				: {
						bytes: new TextEncoder().encode(result.values.proofText),
						mime: 'text/plain',
						originalName: 'approval-proof.txt',
						provenance: 'upload' as const,
						confidential: result.values.confidential
					};

		await recordApproval(
			{
				contractId: contract.id,
				channel: result.input.channel,
				sender: result.input.sender,
				receivedAt: result.input.receivedAt,
				excerpt: result.input.excerpt,
				origin: result.input.origin,
				messageId: null,
				document: documentInput
			},
			workUnit
				? {
						workUnitId: workUnit.id,
						actor: { kind: 'human', email: locals.user!.email },
						reason: 'approval recorded from the manual approval form'
					}
				: null
		);

		redirect(
			303,
			workUnit ? `/day/${workUnit.id}` : `/clients/${contract.clientId}/contracts/${contract.id}`
		);
	}
};
