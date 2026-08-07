import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { getClauseNote, updateClauseNote } from '$lib/server/repositories/clause-note';
import { parseClauseNoteForm } from '$lib/server/repositories/clause-note-form';
import { getContractWithClient } from '$lib/server/repositories/contract';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const contract = await getContractWithClient(params.contractId);
	if (!contract || contract.clientId !== params.id) error(404, m.contract_not_found());

	const clauseNote = await getClauseNote(params.clauseNoteId);
	if (!clauseNote || clauseNote.contractId !== params.contractId) {
		error(404, m.clause_note_not_found());
	}

	return { contract, clauseNote };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const formData = await request.formData();
		const result = parseClauseNoteForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		await updateClauseNote(params.clauseNoteId, { ...result.input, contractId: params.contractId });
		redirect(303, `/clients/${params.id}/contracts/${params.contractId}`);
	}
};
