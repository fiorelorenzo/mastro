import * as m from '$lib/paraglide/messages';
import type { WorkUnitInput } from './work-unit';

export type DayEntryFormValues = {
	date: string;
	quantity: string;
	scope: string;
	contractId: string;
	approvalId: string;
};

export type DayEntryFormResult =
	| { ok: true; input: WorkUnitInput; values: DayEntryFormValues }
	| { ok: false; errors: Record<string, string>; values: DayEntryFormValues };

/**
 * Parses and validates a day-entry submission (#24). Always builds a
 * `'worked'` day: the form records a day that was worked, not a proposal
 * for one, and it is the state machine trigger's job — not this
 * function's — to redirect a contract that required an approval nobody
 * linked into `worked_without_approval` (#23). `validContractIds` and
 * `approvalIdsByContract` come from the same data the form itself was
 * rendered with, so a submission naming a contract or approval the form
 * never offered is rejected the same way a stale or tampered request
 * would be, not trusted at face value.
 */
export function parseDayEntryForm(
	formData: FormData,
	validContractIds: ReadonlySet<string>,
	approvalIdsByContract: ReadonlyMap<string, ReadonlySet<string>>
): DayEntryFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();

	const date = string('date');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = m.day_validation_date_required();

	const quantityRaw = string('quantity');
	const quantity = Number(quantityRaw);
	if (!quantityRaw || !Number.isFinite(quantity) || quantity <= 0) {
		errors.quantity = m.day_validation_quantity_positive();
	}

	const scope = string('scope');
	if (!scope) errors.scope = m.day_validation_scope_required();

	const contractId = string('contractId');
	if (!contractId) {
		errors.contractId = m.day_validation_contract_required();
	} else if (!validContractIds.has(contractId)) {
		errors.contractId = m.day_validation_contract_invalid();
	}

	const approvalId = string('approvalId');
	if (approvalId) {
		const allowedForContract = approvalIdsByContract.get(contractId);
		if (!allowedForContract || !allowedForContract.has(approvalId)) {
			errors.approvalId = m.day_validation_approval_invalid();
		}
	}

	const values: DayEntryFormValues = {
		date,
		quantity: quantityRaw,
		scope,
		contractId,
		approvalId
	};

	if (Object.keys(errors).length > 0) return { ok: false, errors, values };

	return {
		ok: true,
		input: {
			contractId,
			date,
			quantity,
			scope,
			state: 'worked',
			approvalId: approvalId || null
		},
		values
	};
}
