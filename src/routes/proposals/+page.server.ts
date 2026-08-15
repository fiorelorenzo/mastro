// The review queue (#243): pending proposals grouped by the archived
// message that produced them — several days can come from one "ok for
// Thursday and Friday" email, and the point of grouping is that a
// reviewer sees them as siblings rather than as unrelated cards. Decided
// history (`?status=accepted`/`?status=rejected`) is a flatter list —
// nothing to group by message for once the decision is already made.
import { error, fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { parseMessage } from '$lib/server/mail/headers';
import { priceWorkUnitOnDate } from '$lib/server/domain/work-unit-pricing';
import { getContractWithClient } from '$lib/server/repositories/contract';
import { getDocument, readDocumentBytes } from '$lib/server/repositories/document';
import { getInboundThreadForDocument } from '$lib/server/repositories/inbound-thread';
import {
	acceptProposal,
	countPendingProposals,
	getProposal,
	listProposals,
	listProposalsForDocument,
	rejectProposal,
	type ProposalRow
} from '$lib/server/repositories/proposal';
import { listRateCards } from '$lib/server/repositories/rate-card';
import type { ProposalStatusValue } from './proposal-status';
import type { Actions, PageServerLoad } from './$types';

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** The `work_unit` shape every proposal in the seeded pipeline actually
 *  carries, read defensively since `proposedFields`/`acceptedFields` are
 *  untyped JSONB — a row whose fields don't match this shape (a future
 *  target type, or a malformed one) prices as `null` rather than
 *  throwing the whole queue away. */
function workUnitFields(
	fields: Record<string, unknown>
): { date: string; quantity: number; scope: string } | null {
	const { date, quantity, scope } = fields;
	if (typeof date !== 'string' || typeof quantity !== 'number' || typeof scope !== 'string') {
		return null;
	}
	return { date, quantity, scope };
}

/** The archived message's own `From` header, read straight off the raw
 *  bytes rather than trusted from anywhere else — `null` when the
 *  document carries no header block at all (a minimal fixture, or a
 *  future non-mail provenance) rather than throwing: the queue is a read
 *  path, and an unknown sender is shown as absent, never a 500. */
async function readSender(documentId: string): Promise<string | null> {
	const doc = await getDocument(documentId);
	if (!doc) return null;
	const bytes = await readDocumentBytes(doc);
	return parseMessage(bytes).headers.get('from') ?? null;
}

/** Null only for a first-intake `'contract'` proposal (#86) — there is no
 * contract row yet to summarise, so the queue falls back to a generic
 * label rather than crashing on `getContractWithClient(null)`. */
async function contractSummary(contractId: string | null) {
	if (contractId === null) {
		return { title: m.proposal_list_new_contract_title(), clientLegalName: '', currency: 'EUR' };
	}
	const contract = await getContractWithClient(contractId);
	return {
		title: contract?.title ?? contractId,
		clientLegalName: contract?.client.legalName ?? '',
		currency: contract?.currency ?? 'EUR'
	};
}

async function priceProposal(row: Pick<ProposalRow, 'contractId' | 'proposedFields'>) {
	const fields = workUnitFields(row.proposedFields);
	// A 'contract' proposal's proposedFields never match workUnitFields'
	// shape, so contractId is never null past this point in practice —
	// still checked, since its type is now nullable (#86).
	if (!fields || row.contractId === null) return null;
	const rateCards = await listRateCards(row.contractId);
	return priceWorkUnitOnDate(fields, rateCards);
}

export type QueueRow = {
	id: string;
	date: string | null;
	quantity: number | null;
	scope: string | null;
	confidence: number;
	confidenceReason: string | null;
	validationError: string | null;
	amount: number | null;
};

export type QueueGroup = {
	documentId: string;
	subject: string | null;
	sender: string | null;
	receivedAt: string | null;
	contractTitle: string;
	clientLegalName: string;
	currency: string;
	rows: QueueRow[];
};

async function loadQueue(): Promise<QueueGroup[]> {
	const pending = await listProposals('pending');
	const groups = new Map<string, QueueGroup>();

	for (const row of pending) {
		let group = groups.get(row.documentId);
		if (!group) {
			const [thread, sender, contract] = await Promise.all([
				getInboundThreadForDocument(row.documentId),
				readSender(row.documentId),
				contractSummary(row.contractId)
			]);
			group = {
				documentId: row.documentId,
				subject: thread?.subject ?? null,
				sender,
				receivedAt: thread?.receivedAt.toISOString() ?? null,
				contractTitle: contract.title,
				clientLegalName: contract.clientLegalName,
				currency: contract.currency,
				rows: []
			};
			groups.set(row.documentId, group);
		}
		const fields = workUnitFields(row.proposedFields);
		group.rows.push({
			id: row.id,
			date: fields?.date ?? null,
			quantity: fields?.quantity ?? null,
			scope: fields?.scope ?? null,
			confidence: row.confidence,
			confidenceReason: row.confidenceReason,
			validationError: row.validationError,
			amount: await priceProposal(row)
		});
	}

	return [...groups.values()];
}

export type HistoryRow = {
	id: string;
	date: string | null;
	quantity: number | null;
	status: 'accepted' | 'rejected';
	contractTitle: string;
	currency: string;
	sender: string | null;
	receivedAt: string | null;
	amount: number | null;
	resultId: string | null;
};

async function loadHistory(status: 'accepted' | 'rejected'): Promise<HistoryRow[]> {
	const rows = await listProposals(status);
	return Promise.all(
		rows.map(async (row) => {
			const effectiveFields = row.acceptedFields ?? row.proposedFields;
			const fields = workUnitFields(effectiveFields);
			const [thread, sender, contract] = await Promise.all([
				getInboundThreadForDocument(row.documentId),
				readSender(row.documentId),
				contractSummary(row.contractId)
			]);
			return {
				id: row.id,
				date: fields?.date ?? null,
				quantity: fields?.quantity ?? null,
				status: status,
				contractTitle: contract.title,
				currency: contract.currency,
				sender,
				receivedAt: thread?.receivedAt.toISOString() ?? null,
				amount: fields
					? await priceProposal({ contractId: row.contractId, proposedFields: fields })
					: null,
				resultId: row.resultId
			};
		})
	);
}

export const load: PageServerLoad = async ({ url }) => {
	const statusParam = url.searchParams.get('status');
	const status: ProposalStatusValue =
		statusParam === 'accepted' || statusParam === 'rejected' ? statusParam : 'pending';

	// The pending count is loaded whichever tab is open, not only the
	// pending one. It used to be `null` everywhere else, so the badge
	// vanished the moment you looked at Accepted — exactly when you want
	// to know whether anything new has arrived, and it made the tab bar
	// change shape as you moved along it.
	if (status === 'pending') {
		const groups = await loadQueue();
		const pendingCount = groups.reduce((sum, group) => sum + group.rows.length, 0);
		return { status, groups, pendingCount } as const;
	}

	const [rows, pendingCount] = await Promise.all([loadHistory(status), countPendingProposals()]);
	return { status, rows, pendingCount } as const;
};

export const actions: Actions = {
	accept: async ({ request, locals }) => {
		const formData = await request.formData();
		const id = String(formData.get('id') ?? '');
		const row = await getProposal(id);
		if (!row) error(404, m.proposal_detail_not_found());
		if (row.status !== 'pending') {
			return fail(400, { actionError: m.proposal_detail_already_decided() });
		}
		try {
			await acceptProposal(id, { decidedBy: locals.user!.email });
		} catch (err) {
			return fail(400, { actionError: errorMessage(err) });
		}
		return { decided: true };
	},

	reject: async ({ request, locals }) => {
		const formData = await request.formData();
		const id = String(formData.get('id') ?? '');
		const row = await getProposal(id);
		if (!row) error(404, m.proposal_detail_not_found());
		if (row.status !== 'pending') {
			return fail(400, { actionError: m.proposal_detail_already_decided() });
		}
		await rejectProposal(id, locals.user!.email);
		return { decided: true };
	},

	acceptAll: async ({ request, locals }) => {
		const formData = await request.formData();
		const documentId = String(formData.get('documentId') ?? '');
		const siblings = await listProposalsForDocument(documentId);
		const pending = siblings.filter((sibling) => sibling.status === 'pending');
		const failures: string[] = [];
		for (const sibling of pending) {
			try {
				await acceptProposal(sibling.id, { decidedBy: locals.user!.email });
			} catch (err) {
				failures.push(errorMessage(err));
			}
		}
		if (failures.length > 0) {
			return fail(400, { actionError: failures.join(' ') });
		}
		return { decided: true };
	}
};
