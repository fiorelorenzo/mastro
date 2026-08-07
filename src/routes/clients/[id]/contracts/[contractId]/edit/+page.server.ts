import { error, fail, redirect } from '@sveltejs/kit';
import type { Crumb } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import {
	getContractWithClient,
	revokeHostedExtractionConsent,
	setHostedExtractionConsentDocument,
	updateContract
} from '$lib/server/repositories/contract';
import { parseContractForm } from '$lib/server/repositories/contract-form';
import { getDocument } from '$lib/server/repositories/document';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const contract = await getContractWithClient(params.contractId);
	if (!contract || contract.clientId !== params.id) error(404, m.contract_not_found());

	// #82: the runner reads this column to decide whether it may call a
	// hosted provider for this contract's documents; a human sets it here
	// by archiving the actual consent, the same way every other piece of
	// evidence in this system is attached (see `ExpenseForm`'s receipt
	// upload for the pattern this mirrors).
	const hostedExtractionConsentDocument = contract.hostedExtractionConsentDocumentId
		? await getDocument(contract.hostedExtractionConsentDocumentId)
		: null;

	const crumbs: Crumb[] = [
		{ href: '/clients', label: m.clients_heading() },
		{ href: `/clients/${contract.clientId}`, label: contract.client.legalName },
		{ href: `/clients/${contract.clientId}/contracts/${contract.id}`, label: contract.title }
	];

	return { contract, hostedExtractionConsentDocument, crumbs };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const formData = await request.formData();
		const result = parseContractForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		await updateContract(params.contractId, { ...result.input, clientId: params.id });
		redirect(303, `/clients/${params.id}/contracts/${params.contractId}`);
	},

	consent: async ({ request, params }) => {
		const formData = await request.formData();
		const file = formData.get('hostedExtractionConsentDocument');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { consentError: m.contract_hosted_extraction_consent_file_required() });
		}
		await setHostedExtractionConsentDocument(params.contractId, {
			bytes: new Uint8Array(await file.arrayBuffer()),
			mime: file.type || 'application/octet-stream',
			originalName: file.name,
			provenance: 'upload',
			confidential: true
		});
		redirect(303, `/clients/${params.id}/contracts/${params.contractId}/edit`);
	},

	revokeConsent: async ({ params }) => {
		await revokeHostedExtractionConsent(params.contractId);
		redirect(303, `/clients/${params.id}/contracts/${params.contractId}/edit`);
	}
};
