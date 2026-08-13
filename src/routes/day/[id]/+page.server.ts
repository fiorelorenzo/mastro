import { error, fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { calendarCrumbs } from '$lib/nav/crumbs';
import { getApproval, listApprovalsForContract } from '$lib/server/repositories/approval';
import { listClauseNotes } from '$lib/server/repositories/clause-note';
import { getContractWithClient } from '$lib/server/repositories/contract';
import { toSourceDocumentValue } from '$lib/server/repositories/document';
import { listRateCards } from '$lib/server/repositories/rate-card';
import {
	getWorkUnit,
	getWorkUnitDocument,
	getWorkUnitInvoiceLine,
	linkApprovalToWorkUnit,
	listWorkUnitTransitions
} from '$lib/server/repositories/work-unit';
import { resolveRateCard } from '$lib/server/domain/rate-card';
import { priceWorkUnitOnDate } from '$lib/server/domain/work-unit-pricing';
import type { Actions, PageServerLoad } from './$types';

/**
 * The one route for reading a day (#237: fold `/day/date/[date]`'s only
 * real job — a date carrying more than one contract's work — into the
 * calendar's own cells, see `day/calendar/+page.svelte`, rather than a
 * second page here). Everything a person needs about a day lives on this
 * one screen: the approval and its verbatim excerpt, the archived
 * original, what the day is worth, the invoice line it landed on, and the
 * transition log with actor and reason. Both exits from the risk state
 * live here too — `link` below (wave 2's `/approvals/new` is the other) —
 * except `worked_without_approval → unbillable`, which is #228, not this
 * ticket: the "Mark unbillable" button renders disabled, a place held for
 * it rather than a feature built for it.
 */
export const load: PageServerLoad = async ({ params }) => {
	const workUnit = await getWorkUnit(params.id);
	if (!workUnit) error(404, m.day_detail_not_found());

	const contract = await getContractWithClient(workUnit.contractId);
	if (!contract) error(404, m.day_detail_not_found());

	const [transitions, rateCards, approval, sourceDocument, invoiceLineRow, clauseNotes] =
		await Promise.all([
			listWorkUnitTransitions(workUnit.id),
			listRateCards(workUnit.contractId),
			workUnit.approvalId ? getApproval(workUnit.approvalId) : null,
			getWorkUnitDocument(workUnit.id),
			workUnit.invoiceLineId ? getWorkUnitInvoiceLine(workUnit.id) : null,
			// The clause a written approval requirement traces back to, only
			// worth a query when the day is actually flagged over it — the
			// risk banner's "why" (#237), never fetched for every other state.
			workUnit.state === 'worked_without_approval' ? listClauseNotes(workUnit.contractId) : []
		]);

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

	// Whether "Quantità" reads as a day fraction ("1 giornata intera") or an
	// hours figure ("3,5 ore") depends on which rate card was in force the
	// day this was recorded, the same resolution `priceWorkUnitOnDate`
	// itself does — never a second, independent guess.
	const rateCard = resolveRateCard(rateCards, workUnit.date);
	const quantityKind: 'day' | 'hour' = rateCard?.kind === 'hourly' ? 'hour' : 'day';

	const crumbs = calendarCrumbs();

	return {
		workUnit: {
			id: workUnit.id,
			date: workUnit.date,
			quantity: Number(workUnit.quantity),
			quantityKind,
			scope: workUnit.scope,
			state: workUnit.state,
			notes: workUnit.notes
		},
		contract: {
			id: contract.id,
			title: contract.title,
			currency: contract.currency,
			clientName: contract.client.legalName
		},
		amount: priceWorkUnitOnDate(
			{ date: workUnit.date, quantity: Number(workUnit.quantity) },
			rateCards
		),
		approval: approval
			? {
					id: approval.id,
					sender: approval.sender,
					receivedAt: approval.receivedAt.toISOString(),
					excerpt: approval.excerpt
				}
			: null,
		sourceDocument: sourceDocument ? toSourceDocumentValue(sourceDocument) : null,
		invoiceLine: invoiceLineRow
			? {
					id: invoiceLineRow.invoiceLine.id,
					invoiceId: invoiceLineRow.invoice.id,
					invoiceNumber: invoiceLineRow.invoice.number,
					amount: invoiceLineRow.invoiceLine.amount,
					currency: invoiceLineRow.invoice.currency
				}
			: null,
		clauseNotes: clauseNotes.map((note) => ({
			id: note.id,
			clauseReference: note.clauseReference,
			verbatimText: note.verbatimText,
			interpretationAdopted: note.interpretationAdopted
		})),
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
