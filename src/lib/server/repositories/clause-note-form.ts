import * as m from '$lib/paraglide/messages';
import type { ClauseNoteInput } from './clause-note';

export type ClauseNoteFormValues = {
	clauseReference: string;
	verbatimText: string;
	interpretationAdopted: string;
	notes: string;
};

export type ClauseNoteFormResult =
	| { ok: true; input: Omit<ClauseNoteInput, 'contractId'>; values: ClauseNoteFormValues }
	| { ok: false; errors: Record<string, string>; values: ClauseNoteFormValues };

/**
 * Parses and validates a clause note create/edit submission (#20).
 * `contractId` is deliberately not read here, the same reason
 * `parseContractForm` skips it: it comes from the route, not the body.
 */
export function parseClauseNoteForm(formData: FormData): ClauseNoteFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();

	const clauseReference = string('clauseReference');
	if (!clauseReference) errors.clauseReference = m.clause_note_validation_reference_required();

	const verbatimText = string('verbatimText');
	if (!verbatimText) errors.verbatimText = m.clause_note_validation_verbatim_text_required();

	const interpretationAdopted = string('interpretationAdopted');
	if (!interpretationAdopted) {
		errors.interpretationAdopted = m.clause_note_validation_interpretation_required();
	}

	const notes = string('notes');

	const values: ClauseNoteFormValues = {
		clauseReference,
		verbatimText,
		interpretationAdopted,
		notes
	};

	if (Object.keys(errors).length > 0) return { ok: false, errors, values };

	return {
		ok: true,
		values,
		input: { clauseReference, verbatimText, interpretationAdopted, notes: notes || null }
	};
}
