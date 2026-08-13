import * as m from '$lib/paraglide/messages';
import { decimalStringToMinorUnits } from '$lib/server/import/decimal';
import { getLocale } from '$lib/paraglide/runtime';
import { NO_MINOR_UNITS, type MinorUnits } from '$lib/money';
import type { ExpenseInput } from './expense';

export type ExpenseFormValues = {
	date: string;
	description: string;
	amount: string;
	preAuthorised: boolean;
	authorisationReference: string;
};

export type ExpenseFormResult =
	| { ok: true; input: Omit<ExpenseInput, 'contractId'>; values: ExpenseFormValues }
	| { ok: false; errors: Record<string, string>; values: ExpenseFormValues };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses and validates an expense create/edit submission (#28).
 * `authorisationReference` is required exactly when `preAuthorised` is
 * checked, mirroring the database's own
 * `expense_authorisation_reference_matches_pre_authorised` CHECK — caught
 * here first so a plain mismatch never round-trips to the database only
 * to bounce back as a 500. `contractId` is not read here, the same reason
 * `parseContractForm` skips it: it comes from the route.
 */
export function parseExpenseForm(formData: FormData, currency: string): ExpenseFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();

	const date = string('date');
	if (!ISO_DATE.test(date)) errors.date = m.expense_validation_date_required();

	const description = string('description');
	if (!description) errors.description = m.expense_validation_description_required();

	const amountRaw = string('amount');
	let amount: MinorUnits = NO_MINOR_UNITS;
	try {
		amount = decimalStringToMinorUnits(amountRaw, currency, getLocale());
		if (amount <= 0) throw new Error('non-positive');
	} catch {
		errors.amount = m.expense_validation_amount_invalid();
	}

	const preAuthorised = formData.get('preAuthorised') === 'on';

	const authorisationReference = string('authorisationReference');
	if (preAuthorised && !authorisationReference) {
		errors.authorisationReference = m.expense_validation_authorisation_reference_required();
	}

	const values: ExpenseFormValues = {
		date,
		description,
		amount: amountRaw,
		preAuthorised,
		authorisationReference
	};

	if (Object.keys(errors).length > 0) return { ok: false, errors, values };

	return {
		ok: true,
		values,
		input: {
			date,
			description,
			amount,
			preAuthorised,
			authorisationReference: preAuthorised ? authorisationReference : null
		}
	};
}
