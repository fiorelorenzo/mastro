import { error, fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { calendarCrumbs } from '$lib/nav/crumbs';
import { utcToday } from '$lib/server/days/settle';
import { getApproval, listApprovalsForContract } from '$lib/server/repositories/approval';
import { listClauseNotes } from '$lib/server/repositories/clause-note';
import { getContractWithClient } from '$lib/server/repositories/contract';
import { toSourceDocumentValue } from '$lib/server/repositories/document';
import { listRateCards } from '$lib/server/repositories/rate-card';
import {
	disputeWorkUnit,
	getWorkUnit,
	getWorkUnitDocument,
	getWorkUnitInvoiceLine,
	linkApprovalToWorkUnit,
	listWorkUnitTransitions,
	markWorkUnitUnbillable,
	markWorkUnitWorked,
	rejectWorkUnit,
	resolveWorkUnitDispute,
	revokeWorkUnit
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

	// Shared with the sweep (`settleApprovedDays`) so the manual button and
	// the automatic half never disagree about what "today" means — see
	// `utcToday`'s own note on why UTC, not local time.
	const today = utcToday();
	const crumbs = calendarCrumbs();

	return {
		workUnit: {
			id: workUnit.id,
			date: workUnit.date,
			quantity: Number(workUnit.quantity),
			quantityKind,
			scope: workUnit.scope,
			state: workUnit.state,
			notes: workUnit.notes,
			today
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
	},

	// #228's other exit from the risk state: a day nobody will ever approve,
	// closed out instead of left as a permanent, escalating alert. Legal
	// only from `worked_without_approval` — the database trigger
	// (`work_unit_enforce_state_machine`) is what actually enforces that,
	// this action does not re-check the day's current state first.
	unbillable: async ({ request, params, locals }) => {
		const formData = await request.formData();
		const reason = String(formData.get('reason') ?? '').trim();

		const workUnit = await getWorkUnit(params.id);
		if (!workUnit) error(404, m.day_detail_not_found());

		if (!reason) {
			return fail(400, { unbillableError: m.day_detail_unbillable_reason_required(), reason });
		}

		await markWorkUnitUnbillable(params.id, { kind: 'human', email: locals.user!.email }, reason);

		return { markedUnbillable: true };
	},

	// The manual half of the settle sweep (Task 2's automatic half fires
	// once the date has passed): a day approved for today that the
	// consultant has already finished should not have to wait for the
	// night. The trigger admits `approved -> worked` and also
	// `worked_without_approval -> worked`, but neither the trigger nor the
	// state machine has any notion of *when* a day happened — that is an
	// application rule, not a state-machine one, and the trigger cannot
	// enforce it. So this action carries the one precondition the template
	// button also renders on: the day's date must not be in the future.
	// `date <= today`, not `date === today` — a day dated yesterday that
	// the hourly sweep has not reached yet is legitimately markable by
	// hand (the sweep would do it within the hour anyway); a day dated
	// tomorrow must never be, because the only edge out of `worked` is
	// `worked -> invoiced`, and a mis-tap here cannot be undone.
	worked: async ({ params, locals }) => {
		const workUnit = await getWorkUnit(params.id);
		if (!workUnit) error(404, m.day_detail_not_found());

		if (workUnit.date > utcToday()) {
			return fail(400, { workedError: m.day_detail_worked_future_error() });
		}

		await markWorkUnitWorked(
			params.id,
			{ kind: 'human', email: locals.user!.email },
			'recorded worked by hand'
		);

		return { recorded: true };
	},

	// #214's path in: legal only from `invoiced` — the trigger enforces
	// that, this action does not re-check the day's current state first.
	dispute: async ({ request, params, locals }) => {
		const formData = await request.formData();
		const reason = String(formData.get('reason') ?? '').trim();

		const workUnit = await getWorkUnit(params.id);
		if (!workUnit) error(404, m.day_detail_not_found());

		if (!reason) {
			return fail(400, { disputeError: m.day_detail_dispute_reason_required(), reason });
		}

		await disputeWorkUnit(params.id, { kind: 'human', email: locals.user!.email }, reason);

		return { disputed: true };
	},

	// #214's way out: legal only from `disputed` — same reasoning as
	// `dispute` above.
	resolveDispute: async ({ request, params, locals }) => {
		const formData = await request.formData();
		const reason = String(formData.get('reason') ?? '').trim();

		const workUnit = await getWorkUnit(params.id);
		if (!workUnit) error(404, m.day_detail_not_found());

		if (!reason) {
			return fail(400, {
				resolveDisputeError: m.day_detail_resolve_dispute_reason_required(),
				reason
			});
		}

		await resolveWorkUnitDispute(params.id, { kind: 'human', email: locals.user!.email }, reason);

		return { disputeResolved: true };
	},

	// #370: rejected is a proposed day that never took place. Legal only
	// from `proposed` — the trigger enforces that, this action does not
	// re-check the day's current state first, the same as every other
	// exit on this page. No reason field: the evidence for why is the
	// source document the proposal rested on, already archived, not a
	// fresh explanation typed here — and a day that can still be rejected
	// has never reached `invoiced` (`proposed` is the state before
	// approval, let alone billing), so there is no invoice line for this
	// to touch either.
	reject: async ({ params, locals }) => {
		const workUnit = await getWorkUnit(params.id);
		if (!workUnit) error(404, m.day_detail_not_found());

		await rejectWorkUnit(
			params.id,
			{ kind: 'human', email: locals.user!.email },
			'recorded as not having happened, from the day detail page'
		);

		return { rejected: true };
	},

	// #370: revoked is an approval withdrawn before the day was worked.
	// Legal only from `approved` — same reasoning as `reject` above, both
	// for skipping a reason field (the approval itself is the evidence,
	// and it stays archived and linked) and for never touching an
	// invoice (only a `worked` day ever gets billed, and this is legal
	// only one step before that).
	revoke: async ({ params, locals }) => {
		const workUnit = await getWorkUnit(params.id);
		if (!workUnit) error(404, m.day_detail_not_found());

		await revokeWorkUnit(
			params.id,
			{ kind: 'human', email: locals.user!.email },
			'recorded as revoked, from the day detail page'
		);

		return { revoked: true };
	}
};
