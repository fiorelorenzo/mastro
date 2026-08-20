import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { resolveActiveFiscalPack } from '$lib/server/fiscal/profile';
import { socialChargeLabel } from '$lib/server/fiscal/pack';
import { getLocale } from '$lib/paraglide/runtime';
import { clientCrumbs } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import { getClientWithContacts } from '$lib/server/repositories/client';
import { createContract } from '$lib/server/repositories/contract';
import { parseContractForm } from '$lib/server/repositories/contract-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const client = await getClientWithContacts(params.id);
	if (!client) error(404, m.client_not_found());

	// #379: what the pack in force calls its social charge, so the form can
	// label the election with the regime's own vocabulary and render nothing
	// when the regime declares no such charge.
	const activePack = await resolveActiveFiscalPack(db, new Date().toISOString().slice(0, 10));
	const socialCharge = socialChargeLabel(activePack?.pack ?? null, getLocale());

	const crumbs = clientCrumbs(client);
	return { client, crumbs, socialChargeLabel: socialCharge };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const formData = await request.formData();
		const result = parseContractForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		const contractRow = await createContract({ ...result.input, clientId: params.id });
		redirect(303, `/clients/${params.id}/contracts/${contractRow.id}`);
	}
};
