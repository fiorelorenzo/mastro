// The review queue (#243): pending proposals grouped by the archived
// message that produced them — several days can come from one "ok for
// Thursday and Friday" email, and the point of grouping is that a
// reviewer sees them as siblings rather than as unrelated cards. Decided
// history (`?status=accepted`/`?status=rejected`) is a flatter list —
// nothing to group by message for once the decision is already made.
import { error, fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { proposedContract, workUnitFields, type ProposedContract } from './queue-fields';
import type { ProposalTargetType } from '$lib/server/db/schema';
import { isPostgresError } from '$lib/server/db/postgres-error';
import { parseMessage } from '$lib/server/mail/headers';
import { priceWorkUnitOnDate } from '$lib/server/domain/work-unit-pricing';
import { getContractsWithClient, type ContractWithClient } from '$lib/server/repositories/contract';
import {
	getDocuments,
	readDocumentBytes,
	type DocumentRow
} from '$lib/server/repositories/document';
import {
	getInboundThreadsForDocuments,
	type InboundThreadRow
} from '$lib/server/repositories/inbound-thread';
import {
	acceptProposal,
	countPendingProposals,
	getProposal,
	listProposals,
	listProposalsForDocument,
	rejectProposal,
	ProposalValidationError,
	type ProposalRow
} from '$lib/server/repositories/proposal';
import { proposalIssueMessage } from '$lib/i18n/proposal-issue';
import type { ProposalValidationIssue } from '$lib/proposals/validation-issue';
import { listRateCardsForContracts, type RateCardRow } from '$lib/server/repositories/rate-card';
import type { ProposalStatusValue } from './proposal-status';
import type { Actions, PageServerLoad } from './$types';

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Same fallback `errorMessage` always was, but recognises the one error
 *  `acceptProposal` throws that must never render its own `.message` — a
 *  `ProposalValidationError` carries the same `ProposalValidationIssue` the
 *  detail screen renders inline, translated the same way, so a failed
 *  accept from the queue reads like the rest of the interface instead of
 *  leaking the English fallback text `.message` carries for logs. */
function decisionErrorMessage(err: unknown): string {
	if (err instanceof ProposalValidationError) {
		return `${m.proposal_detail_decision_error_heading()} ${proposalIssueMessage(err.issue)}`;
	}
	// The claim is made here, by the only code that knows whether it is
	// true. Both screens used to prepend "the database rejected this" to
	// every failed decision and print the raw `.message` after it: accepting
	// a proposal whose source message had no `inbound_thread` row failed in
	// application code, and the screen blamed the database and showed a
	// document UUID. A real refusal keeps that sentence and the database's
	// own words, which are the useful part; anything else says plainly that
	// it cannot explain itself and leaves the detail in the log.
	if (isPostgresError(err)) {
		return `${m.proposal_detail_decision_error_heading()} ${errorMessage(err)}`;
	}
	console.error('proposal decision failed', err);
	return m.proposal_decision_unexpected_error();
}

/**
 * The archived message's own `From` header, read straight off the raw bytes
 * rather than trusted from anywhere else — `null` when there is no header
 * block to read.
 *
 * The comment here always promised "an unknown sender is shown as absent,
 * never a 500", and the code did not keep it: a document whose blob is
 * missing from the store threw `ENOENT` out of the loader and took the
 * whole review queue down, every row of it, over one file. Now it is
 * caught, because a queue that cannot be opened is worse than a row with
 * no sender shown.
 *
 * It also stops reading the bytes at all unless the document came from
 * mail. A contract PDF has no header block, so parsing it for a `From:`
 * was pointless work on every upload, and pointless work is exactly what
 * should not be able to fail.
 */
async function readSender(doc: DocumentRow | undefined): Promise<string | null> {
	if (!doc || doc.provenance !== 'mail') return null;
	try {
		const bytes = await readDocumentBytes(doc);
		return parseMessage(bytes).headers.get('from') ?? null;
	} catch (err) {
		console.error('proposal queue: cannot read the archived message of', doc.id, err);
		return null;
	}
}

/** Null only for a first-intake `'contract'` proposal (#86) — there is no
 * contract row yet to summarise, so the queue falls back to a generic
 * label rather than a lookup miss on a null id. */
function contractSummary(
	contractId: string | null,
	contractById: ReadonlyMap<string, ContractWithClient>
) {
	if (contractId === null) {
		return { title: m.proposal_list_new_contract_title(), clientLegalName: '', currency: 'EUR' };
	}
	const contract = contractById.get(contractId);
	return {
		title: contract?.title ?? contractId,
		clientLegalName: contract?.client.legalName ?? '',
		currency: contract?.currency ?? 'EUR'
	};
}

function priceProposal(
	row: Pick<ProposalRow, 'contractId' | 'proposedFields'>,
	rateCardsByContract: ReadonlyMap<string, RateCardRow[]>
) {
	const fields = workUnitFields(row.proposedFields);
	// A 'contract' proposal's proposedFields never match workUnitFields'
	// shape, so contractId is never null past this point in practice —
	// still checked, since its type is now nullable (#86).
	if (!fields || row.contractId === null) return null;
	const rateCards = rateCardsByContract.get(row.contractId) ?? [];
	return priceWorkUnitOnDate(fields, rateCards);
}

type ProposalContext = {
	threadByDocument: ReadonlyMap<string, InboundThreadRow>;
	documentById: ReadonlyMap<string, DocumentRow>;
	contractById: ReadonlyMap<string, ContractWithClient>;
	rateCardsByContract: ReadonlyMap<string, RateCardRow[]>;
};

/**
 * The distinct-sets-then-join-in-memory half of #307: collects the unique
 * `documentId`s and `contractId`s a page of proposal rows references,
 * fetches each source table once with a batch repository function, and
 * hands back the four maps `loadQueue`/`loadHistory`'s row loops read
 * from. One query per table, whatever the row count — the four-lookups-
 * per-source-document loop this replaced was the thing making both
 * loaders' query count proportional to their row count.
 */
async function fetchProposalContext(
	rows: readonly Pick<ProposalRow, 'documentId' | 'contractId'>[]
): Promise<ProposalContext> {
	const documentIds = [...new Set(rows.map((row) => row.documentId))];
	const contractIds = [
		...new Set(rows.map((row) => row.contractId).filter((id): id is string => id !== null))
	];

	const [threads, documents, contracts, rateCards] = await Promise.all([
		getInboundThreadsForDocuments(documentIds),
		getDocuments(documentIds),
		getContractsWithClient(contractIds),
		listRateCardsForContracts(contractIds)
	]);

	const rateCardsByContract = new Map<string, RateCardRow[]>();
	for (const card of rateCards) {
		const existing = rateCardsByContract.get(card.contractId);
		if (existing) existing.push(card);
		else rateCardsByContract.set(card.contractId, [card]);
	}

	return {
		threadByDocument: new Map(threads.map((thread) => [thread.documentId, thread])),
		documentById: new Map(documents.map((document) => [document.id, document])),
		contractById: new Map(contracts.map((contract) => [contract.id, contract])),
		rateCardsByContract
	};
}

export type QueueRow = {
	id: string;
	/** What kind of thing this proposes. A queue row cannot be described
	 *  without it: a day is a date and a quantity, a first-intake contract
	 *  is a counterparty and a title, and rendering one as the other is how
	 *  a contract proposal came to read "— — —". */
	targetType: ProposalTargetType;
	date: string | null;
	quantity: number | null;
	scope: string | null;
	/** Set only for a `'contract'` proposal this could read: the
	 *  counterparty, the terms and the rates. A day proposal describes
	 *  itself with `date`/`quantity` and leaves this null. */
	proposedContract: ProposedContract | null;
	confidence: number;
	confidenceReason: string | null;
	validationIssue: ProposalValidationIssue | null;
	amount: number | null;
};

export type QueueGroup = {
	documentId: string;
	subject: string | null;
	/** The archived document's own file name, which is all there is to name
	 *  a group by when the source was an upload rather than a message. */
	documentName: string | null;
	/** Whether the source really was a message. Drives what the group's own
	 *  link offers to open: an uploaded contract PDF has no message to open,
	 *  and no subject to be missing either. */
	fromMessage: boolean;
	sender: string | null;
	receivedAt: string | null;
	/** When the source arrived, whichever kind it is: the message's own
	 *  `receivedAt`, or the archived document's `createdAt` for an upload,
	 *  which has no message and therefore no received time. A card's byline
	 *  dates itself off this. */
	sourceAt: string | null;
	contractTitle: string;
	clientLegalName: string;
	currency: string;
	rows: QueueRow[];
};

async function loadQueue(): Promise<QueueGroup[]> {
	const pending = await listProposals('pending');
	const context = await fetchProposalContext(pending);
	const groups = new Map<string, QueueGroup>();

	for (const row of pending) {
		let group = groups.get(row.documentId);
		if (!group) {
			const document = context.documentById.get(row.documentId);
			const thread = context.threadByDocument.get(row.documentId) ?? null;
			const sender = await readSender(document);
			const contract = contractSummary(row.contractId, context.contractById);
			group = {
				documentId: row.documentId,
				subject: thread?.subject ?? null,
				documentName: document?.originalName ?? null,
				fromMessage: thread !== null,
				sender,
				receivedAt: thread?.receivedAt.toISOString() ?? null,
				sourceAt: (thread?.receivedAt ?? document?.createdAt)?.toISOString() ?? null,
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
			targetType: row.targetType,
			date: fields?.date ?? null,
			quantity: fields?.quantity ?? null,
			scope: fields?.scope ?? null,
			proposedContract: row.targetType === 'contract' ? proposedContract(row.proposedFields) : null,
			confidence: row.confidence,
			confidenceReason: row.confidenceReason,
			validationIssue: row.validationIssue,
			amount: priceProposal(row, context.rateCardsByContract)
		});
	}

	return [...groups.values()];
}

export type HistoryRow = {
	id: string;
	/** Same reason `QueueRow` carries it: a decided contract proposal read
	 *  "— — —" on the Accepted and Rejected tabs too, and it is one row
	 *  renderer for all three. */
	targetType: ProposalTargetType;
	date: string | null;
	quantity: number | null;
	proposedContract: ProposedContract | null;
	status: 'accepted' | 'rejected';
	contractTitle: string;
	currency: string;
	sender: string | null;
	receivedAt: string | null;
	/** Whether the source was a message. The history notes used to say
	 *  "created from a message from …" and "the message stays archived" for
	 *  every row, including a contract proposal read off an uploaded PDF that
	 *  never was one. */
	fromMessage: boolean;
	documentName: string | null;
	/** The instant the source arrived: a message's `receivedAt`, or an
	 *  upload's own `createdAt`. `receivedAt` alone was null for an upload,
	 *  which rendered "Rejected on ." with the date slot left empty. */
	sourceAt: string | null;
	amount: number | null;
	resultId: string | null;
};

async function loadHistory(status: 'accepted' | 'rejected'): Promise<HistoryRow[]> {
	const rows = await listProposals(status);
	const context = await fetchProposalContext(rows);

	// Several decided rows can share one source document (one email
	// approving several days), so the blob is read at most once per
	// document here too, the same guarantee `loadQueue`'s grouping gives
	// it for free — a plain per-row `readSender` call would read it once
	// per row instead.
	const senderByDocument = new Map<string, Promise<string | null>>();
	function sender(documentId: string): Promise<string | null> {
		let pending = senderByDocument.get(documentId);
		if (!pending) {
			pending = readSender(context.documentById.get(documentId));
			senderByDocument.set(documentId, pending);
		}
		return pending;
	}

	return Promise.all(
		rows.map(async (row) => {
			const effectiveFields = row.acceptedFields ?? row.proposedFields;
			const fields = workUnitFields(effectiveFields);
			const thread = context.threadByDocument.get(row.documentId) ?? null;
			const document = context.documentById.get(row.documentId);
			const contract = contractSummary(row.contractId, context.contractById);
			return {
				id: row.id,
				targetType: row.targetType,
				date: fields?.date ?? null,
				quantity: fields?.quantity ?? null,
				// Read off what was actually accepted, not what was proposed: a
				// reviewer who corrected the counterparty's name before accepting
				// should see the name they accepted.
				proposedContract: row.targetType === 'contract' ? proposedContract(effectiveFields) : null,
				status: status,
				contractTitle: contract.title,
				currency: contract.currency,
				sender: await sender(row.documentId),
				receivedAt: thread?.receivedAt.toISOString() ?? null,
				fromMessage: thread !== null,
				documentName: document?.originalName ?? null,
				sourceAt: (thread?.receivedAt ?? document?.createdAt)?.toISOString() ?? null,
				amount: fields
					? priceProposal(
							{ contractId: row.contractId, proposedFields: fields },
							context.rateCardsByContract
						)
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
			return fail(400, { actionError: decisionErrorMessage(err) });
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
				failures.push(decisionErrorMessage(err));
			}
		}
		if (failures.length > 0) {
			return fail(400, { actionError: failures.join(' ') });
		}
		return { decided: true };
	}
};
