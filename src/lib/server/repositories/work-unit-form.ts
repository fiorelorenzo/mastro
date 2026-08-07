import * as m from '$lib/paraglide/messages';
import type { WorkUnitInput } from './work-unit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DayEntryFormValues = {
	workUnitId: string;
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
 *
 * `workUnitId` (#62) is a hidden field the page generates for every
 * attempt, live or queued offline: it becomes the new day's id and is how
 * a replayed offline mutation is told apart from a genuinely new one (see
 * createWorkUnit). It is plumbing, not user input, so a missing or
 * malformed value is never a validation error shown to the user — it just
 * falls back to letting the database assign one, same as any submission
 * from before #62.
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

	const workUnitIdRaw = string('workUnitId');
	const workUnitId = UUID.test(workUnitIdRaw) ? workUnitIdRaw : undefined;

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
		workUnitId: workUnitIdRaw,
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
			id: workUnitId,
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
