// The proposal review screen (#243): the evidence — the archived message
// in full, the matched sentence marked — is the heavier half, the
// proposed fields the lighter one, exactly the shape #243's brief asks
// for. Pending proposals from the same document are siblings a reviewer
// steps through in order; accepted/rejected ones render the same layout
// read-only, with the day it created linked once it exists.
import { error, fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { proposalsCrumbs } from '$lib/nav/crumbs';
import { decodeMessageBody, parseMessage } from '$lib/server/mail/headers';
import { priceWorkUnitOnDate } from '$lib/server/domain/work-unit-pricing';
import { getContractWithClient } from '$lib/server/repositories/contract';
import {
	getDocument,
	readDocumentBytes,
	toSourceDocumentValue
} from '$lib/server/repositories/document';
import { getInboundThreadForDocument } from '$lib/server/repositories/inbound-thread';
import {
	acceptProposal,
	diffProposalFields,
	getProposal,
	listProposalsForDocument,
	rejectProposal
} from '$lib/server/repositories/proposal';
import { listRateCards } from '$lib/server/repositories/rate-card';
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

/** `workUnitFields`'s counterpart in `../+page.server.ts` — kept file-local
 *  rather than shared, since the two loaders read it into differently
 *  shaped view models (this one keeps `notes`, the queue never shows it). */
function workUnitFields(
	fields: Record<string, unknown>
): { date: string; quantity: number; scope: string; notes: string | null } | null {
	const { date, quantity, scope, notes } = fields;
	if (typeof date !== 'string' || typeof quantity !== 'number' || typeof scope !== 'string') {
		return null;
	}
	return { date, quantity, scope, notes: typeof notes === 'string' ? notes : null };
}

export const load: PageServerLoad = async ({ params }) => {
	const row = await getProposal(params.id);
	if (!row) error(404, m.proposal_detail_not_found());

	const [contract, document, thread, siblingRows] = await Promise.all([
		getContractWithClient(row.contractId),
		getDocument(row.documentId),
		getInboundThreadForDocument(row.documentId),
		listProposalsForDocument(row.documentId)
	]);

	const bytes = document ? await readDocumentBytes(document) : null;
	const parsedMessage = bytes ? parseMessage(bytes) : null;
	const messageBody = parsedMessage ? decodeMessageBody(parsedMessage) : '';

	const effectiveFields = workUnitFields(row.acceptedFields ?? row.proposedFields);
	const amount = effectiveFields
		? priceWorkUnitOnDate(effectiveFields, await listRateCards(row.contractId))
		: null;

	// Siblings from the same document, in the order a reviewer would step
	// through them — the day each proposes, not creation order, since a
	// producer's own fan-out order ("Thursday and Friday" -> two rows) has
	// no particular reason to already be chronological.
	const siblings = [...siblingRows].sort((a, b) => {
		const dateA = workUnitFields(a.proposedFields)?.date ?? '';
		const dateB = workUnitFields(b.proposedFields)?.date ?? '';
		return dateA.localeCompare(dateB);
	});
	const siblingIndex = siblings.findIndex((sibling) => sibling.id === row.id);
	const previousSibling = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
	const nextSibling =
		siblingIndex >= 0 && siblingIndex < siblings.length - 1 ? siblings[siblingIndex + 1] : null;

	const crumbs = proposalsCrumbs();

	return {
		proposal: {
			id: row.id,
			targetType: row.targetType,
			excerpt: row.excerpt,
			confidence: row.confidence,
			confidenceReason: row.confidenceReason,
			validationError: row.validationError,
			status: row.status,
			proposedFields: row.proposedFields,
			acceptedFields: row.acceptedFields,
			resultId: row.resultId,
			decidedBy: row.decidedBy,
			decidedAt: row.decidedAt?.toISOString() ?? null,
			createdAt: row.createdAt.toISOString(),
			changes: diffProposalFields(row)
		},
		contract: contract
			? { id: contract.id, title: contract.title, clientLegalName: contract.client.legalName }
			: null,
		currency: contract?.currency ?? 'EUR',
		amount,
		sourceDocument: document ? toSourceDocumentValue(document) : null,
		message: {
			from: parsedMessage?.headers.get('from') ?? null,
			to: parsedMessage?.headers.get('to') ?? null,
			subject: thread?.subject ?? null,
			receivedAt: thread?.receivedAt.toISOString() ?? null,
			body: messageBody
		},
		siblings: {
			position: siblingIndex >= 0 ? siblingIndex + 1 : 1,
			count: siblings.length,
			previous: previousSibling
				? {
						id: previousSibling.id,
						date: workUnitFields(previousSibling.proposedFields)?.date ?? null
					}
				: null,
			next: nextSibling
				? { id: nextSibling.id, date: workUnitFields(nextSibling.proposedFields)?.date ?? null }
				: null
		},
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
