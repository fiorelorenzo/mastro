import { error, fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { proposalsCrumbs } from '$lib/nav/crumbs';
import { getContract } from '$lib/server/repositories/contract';
import { getDocument, toSourceDocumentValue } from '$lib/server/repositories/document';
import {
	acceptProposal,
	diffProposalFields,
	getProposal,
	rejectProposal
} from '$lib/server/repositories/proposal';
import type { Actions, PageServerLoad } from './$types';

/** Every proposed field, re-typed from the reviewer's own edit to the JSON
 * blob's original type — a number stays a number, a boolean stays a
 * boolean — so an untouched field round-trips unchanged and a genuinely
 * edited one reaches `acceptProposal` as the same shape the target
 * repository's own writer expects, not a string it then has to reject.
 * A field the reviewer left blank or unparsable is passed through as the
 * raw string instead of guessing: `acceptProposal`'s own dispatcher then
 * rejects it with a clear type error rather than writing a silently wrong
 * value (a blank quantity becoming `0`, or worse, `NaN` slipping past a
 * `> 0` database check that treats `NaN` as greater than everything). */
function editedFieldsFromForm(
	proposedFields: Record<string, unknown>,
	formData: FormData
): Record<string, unknown> {
	const edited: Record<string, unknown> = {};
	for (const [field, originalValue] of Object.entries(proposedFields)) {
		if (!formData.has(field)) continue;
		const raw = String(formData.get(field) ?? '').trim();
		if (typeof originalValue === 'number') {
			const parsed = Number(raw);
			edited[field] = raw.length > 0 && Number.isFinite(parsed) ? parsed : raw;
		} else if (typeof originalValue === 'boolean') {
			edited[field] = raw === 'true' || raw === 'on';
		} else {
			edited[field] = raw.length > 0 ? raw : null;
		}
	}
	return edited;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export const load: PageServerLoad = async ({ params }) => {
	const row = await getProposal(params.id);
	if (!row) error(404, m.proposal_detail_not_found());

	const [contract, document] = await Promise.all([
		getContract(row.contractId),
		getDocument(row.documentId)
	]);
	const crumbs = proposalsCrumbs();

	return {
		proposal: {
			id: row.id,
			targetType: row.targetType,
			excerpt: row.excerpt,
			confidence: row.confidence,
			status: row.status,
			proposedFields: row.proposedFields,
			acceptedFields: row.acceptedFields,
			resultId: row.resultId,
			decidedBy: row.decidedBy,
			decidedAt: row.decidedAt?.toISOString() ?? null,
			createdAt: row.createdAt.toISOString(),
			changes: diffProposalFields(row)
		},
		contract: contract ? { id: contract.id, title: contract.title } : null,
		sourceDocument: document ? toSourceDocumentValue(document) : null,
		crumbs
	};
};

export const actions: Actions = {
	accept: async ({ request, params, locals }) => {
		const row = await getProposal(params.id);
		if (!row) error(404, m.proposal_detail_not_found());
		if (row.status !== 'pending') {
			return fail(400, { decisionError: m.proposal_detail_already_decided() });
		}

		const formData = await request.formData();
		const edits = editedFieldsFromForm(row.proposedFields, formData);

		try {
			await acceptProposal(params.id, { edits, decidedBy: locals.user!.email });
		} catch (err) {
			return fail(400, { decisionError: errorMessage(err) });
		}
		return { decided: true };
	},

	reject: async ({ params, locals }) => {
		const row = await getProposal(params.id);
		if (!row) error(404, m.proposal_detail_not_found());
		if (row.status !== 'pending') {
			return fail(400, { decisionError: m.proposal_detail_already_decided() });
		}

		await rejectProposal(params.id, locals.user!.email);
		return { decided: true };
	}
};
