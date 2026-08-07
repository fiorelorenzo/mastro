import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { listApprovalsForContract } from '$lib/server/repositories/approval';
import { listClients } from '$lib/server/repositories/client';
import { listContracts } from '$lib/server/repositories/contract';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import { createWorkUnit, getMostRecentContractId } from '$lib/server/repositories/work-unit';
import { parseDayEntryForm } from '$lib/server/repositories/work-unit-form';
import type { Actions, PageServerLoad } from './$types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Only contracts still `active` are offered: recording a day against a
 * draft, terminated or expired contract is not a state the database
 * forbids, but it is never what the fast path wants. */
async function loadActiveContracts() {
	const [contracts, clients] = await Promise.all([listContracts(), listClients()]);
	const clientNameById = new Map(clients.map((client) => [client.id, client.legalName]));
	return contracts
		.filter((contract) => contract.status === 'active')
		.map((contract) => ({
			id: contract.id,
			clientName: clientNameById.get(contract.clientId) ?? contract.clientId,
			title: contract.title,
			requiresPriorApproval: contract.requiresPriorApproval
		}));
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
	const [contracts, mostRecentContractId] = await Promise.all([
		loadActiveContracts(),
		getMostRecentContractId()
	]);
	const approvalsByContract = await loadApprovalsByContract(contracts.map((c) => c.id));

	// "The contract used most recently" (#24) — falls back to the first
	// active contract when nothing has ever been recorded yet, or when the
	// most recently used one is no longer active.
	const defaultContractId =
		(mostRecentContractId && contracts.some((c) => c.id === mostRecentContractId)
			? mostRecentContractId
			: contracts[0]?.id) ?? '';

	const requestedDate = url.searchParams.get('date');
	const defaultDate =
		requestedDate && ISO_DATE.test(requestedDate)
			? requestedDate
			: new Date().toISOString().slice(0, 10);

	return { contracts, approvalsByContract, defaultContractId, defaultDate };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const formData = await request.formData();

		const contracts = await loadActiveContracts();
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
