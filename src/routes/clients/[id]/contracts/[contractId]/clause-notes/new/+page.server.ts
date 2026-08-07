import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { createClauseNote } from '$lib/server/repositories/clause-note';
import { parseClauseNoteForm } from '$lib/server/repositories/clause-note-form';
import { getContractWithClient } from '$lib/server/repositories/contract';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const contract = await getContractWithClient(params.contractId);
	if (!contract || contract.clientId !== params.id) error(404, m.contract_not_found());
	return { contract };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const formData = await request.formData();
		const result = parseClauseNoteForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		await createClauseNote({ ...result.input, contractId: params.contractId });
		redirect(303, `/clients/${params.id}/contracts/${params.contractId}`);
	}
};
