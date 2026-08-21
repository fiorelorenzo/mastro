import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { calendarCrumbs } from '$lib/nav/crumbs';
import { listApprovalsForContract } from '$lib/server/repositories/approval';
import { listClients } from '$lib/server/repositories/client';
import { listContracts } from '$lib/server/repositories/contract';
import { listRateCards } from '$lib/server/repositories/rate-card';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import { createWorkUnit, getMostRecentContractId } from '$lib/server/repositories/work-unit';
import { parseDayEntryForm } from '$lib/server/repositories/work-unit-form';
import type { RateCardPreview } from './day-value';
import type { Actions, PageServerLoad } from './$types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Only contracts still `active` are offered: recording a day against a
 * draft, terminated or expired contract is not a state the database
 * forbids, but it is never what the fast path wants.
 *
 * When nothing is offered, this also reports *why* (#365). It used to
 * report only whether a client existed, so a ledger holding one draft
 * contract - which is what accepting a contract proposal produced until
 * today - got "No contract yet" and a button offering to add one, when the
 * contract already existed and only needed activating. The remedy on
 * offer created a second contract and left the first one still unusable.
 */
async function loadActiveContracts() {
	const [contracts, clients] = await Promise.all([listContracts(), listClients()]);
	const clientNameById = new Map(clients.map((client) => [client.id, client.legalName]));
	const active = contracts.filter((contract) => contract.status === 'active');

	// Every active contract's rate cards, fetched once here rather than a
	// server round trip per keystroke: the form prices the selected
	// contract/date/quantity itself, client-side, through `day-value.ts`'s
	// duplicate of `priceRateCard`/`resolveRateCard` — see that file's own
	// header comment for why it is a duplicate and not an import.
	const rateCardsByContract = new Map(
		await Promise.all(
			active.map(async (contract) => [contract.id, await listRateCards(contract.id)] as const)
		)
	);

	return {
		contracts: active.map((contract) => ({
			id: contract.id,
			clientName: clientNameById.get(contract.clientId) ?? contract.clientId,
			title: contract.title,
			currency: contract.currency,
			requiresPriorApproval: contract.requiresPriorApproval,
			rateCards: (rateCardsByContract.get(contract.id) ?? []).map((card): RateCardPreview => ({
				id: card.id,
				kind: card.kind,
				amount: card.amount,
				unit: card.unit,
				allowedFractions: card.allowedFractions,
				disbursementPeriod: card.disbursementPeriod,
				validFrom: card.validFrom,
				validTo: card.validTo
			}))
		})),
		// Only consulted when `contracts` comes back empty, and it names the
		// actual cause so the empty state can offer the remedy that matches
		// it rather than always offering "add a contract":
		//   'no_client'   — nothing exists yet; start with a client.
		//   'no_contract' — a client exists with no contract at all.
		//   'none_active' — contracts exist and every one is draft,
		//                   terminated or expired. `/contracts` shows each
		//                   one's status, which is where this is resolved.
		emptyReason:
			clients.length === 0
				? ('no_client' as const)
				: contracts.length === 0
					? ('no_contract' as const)
					: ('none_active' as const),
		firstClientId: clients[0]?.id ?? null
	};
}

async function loadApprovalsByContract(contractIds: string[]) {
	const entries = await Promise.all(
		contractIds.map(async (contractId) => {
			const approvals = await listApprovalsForContract(contractId);
			return [
				contractId,
				approvals.map((approval) => ({
					id: approval.id,
					sender: approval.sender,
					receivedAt: approval.receivedAt.toISOString()
				}))
			] as const;
		})
	);
	return Object.fromEntries(entries);
}

export const load: PageServerLoad = async ({ url }) => {
	const [{ contracts, firstClientId, emptyReason }, mostRecentContractId] = await Promise.all([
		loadActiveContracts(),
		getMostRecentContractId()
	]);
	const approvalsByContract = await loadApprovalsByContract(contracts.map((c) => c.id));

	// "The contract used most recently" (#24) — falls back to the first
	// active contract when nothing has ever been recorded yet, or when the
	// most recently used one is no longer active. `?contractId=` (the
	// `approval_unactioned` alert's primary action, `alerts/actions.ts`)
	// overrides both when it names a real, still-active contract.
	const requestedContractId = url.searchParams.get('contractId');
	const defaultContractId =
		(requestedContractId && contracts.some((c) => c.id === requestedContractId)
			? requestedContractId
			: mostRecentContractId && contracts.some((c) => c.id === mostRecentContractId)
				? mostRecentContractId
				: contracts[0]?.id) ?? '';

	// `?approvalId=` only takes effect once it actually belongs to the
	// resolved contract — a stale or mismatched id from an old alert link
	// is silently dropped rather than crashing the form.
	const requestedApprovalId = url.searchParams.get('approvalId');
	const defaultApprovalId =
		requestedApprovalId &&
		(approvalsByContract[defaultContractId] ?? []).some(
			(approval) => approval.id === requestedApprovalId
		)
			? requestedApprovalId
			: '';

	const requestedDate = url.searchParams.get('date');
	const defaultDate =
		requestedDate && ISO_DATE.test(requestedDate)
			? requestedDate
			: new Date().toISOString().slice(0, 10);

	const crumbs = calendarCrumbs();

	return {
		contracts,
		defaultContractId,
		defaultApprovalId,
		defaultDate,
		crumbs,
		firstClientId,
		emptyReason,
		// How many written approvals each contract holds (#417). The warning
		// on this form used to claim "no written approval for {date} on this
		// contract" from a condition that only knew whether *this entry* had
		// one attached - a statement about the ledger that nothing had
		// checked, and false on the live instance the day it was read. A count
		// is enough to tell the two states apart and costs no query: the
		// approvals were already loaded here to validate the submitted id.
		approvalCountByContract: Object.fromEntries(
			Object.entries(approvalsByContract).map(([contractId, approvals]) => [
				contractId,
				approvals.length
			])
		)
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const formData = await request.formData();

		const { contracts } = await loadActiveContracts();
		const validContractIds = new Set(contracts.map((contract) => contract.id));
		const approvalsByContract = await loadApprovalsByContract(contracts.map((c) => c.id));
		const approvalIdsByContract = new Map(
			Object.entries(approvalsByContract).map(([contractId, approvals]) => [
				contractId,
				new Set(approvals.map((approval) => approval.id))
			])
		);

		const result = parseDayEntryForm(formData, validContractIds, approvalIdsByContract);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		let row;
		try {
			row = await createWorkUnit(
				result.input,
				{ kind: 'human', email: locals.user!.email },
				'recorded from the day entry form'
			);
		} catch (err) {
			// "At most one day per contract per date is ever 'live' at a
			// time" (0012_work_unit_state_machine.sql) — a day already
			// recorded for this contract on this date is a form error the
			// user can fix (pick another date, or open the existing day),
			// not a 500.
			if (isPostgresConstraintViolation(err, '23505', 'work_unit_one_active_per_contract_date')) {
				const errors: Record<string, string> = { date: m.day_validation_date_already_recorded() };
				return fail(400, { errors, values: result.values });
			}
			throw err;
		}

		redirect(303, `/day/${row.id}`);
	}
};
