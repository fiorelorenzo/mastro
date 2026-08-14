/**
 * The human trigger for #87's fallback lane: upload an invoice PDF when
 * no structured document exists for it yet, archive it under the
 * contract it belongs to, and queue the extraction the runner (#82)
 * picks up on its next pass — never a synchronous model call inside this
 * request, the same "archive now, extract later" boundary
 * `agent/enqueue.ts` already draws for a mail-approval thread.
 *
 * Scoped by `?contractId=`, the same flat-query-string choice
 * `/approvals/new` already made for the same reason: this page is one
 * destination reachable from more than one place (a client's contract,
 * an alert about a missing invoice), and a flat contract id avoids every
 * caller having to resolve a client id it may not have to hand.
 *
 * The PDF's own text is extracted here (`extractPdfText`, #87) rather
 * than left for the runner: the runner has no PDF library and no blob
 * store access (`runner/types.ts`'s own doc comment — "PDF text already
 * extracted by the caller"), so the conversion has to happen on this
 * side of the boundary, once, before the job is ever queued.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import * as m from '$lib/paraglide/messages';
import { contractCrumbs } from '$lib/nav/crumbs';
import { invoiceExtractionInstructions } from '$lib/server/agent/invoice-extraction';
import { extractPdfText } from '$lib/server/agent/invoice-producer';
import { getContractWithClient } from '$lib/server/repositories/contract';
import { storeDocument } from '$lib/server/repositories/document';
import { enqueueJob } from '$lib/server/runner/queue';
import type { Actions, PageServerLoad } from './$types';

async function requireContract(contractId: string) {
	const contract = await getContractWithClient(contractId);
	if (!contract) error(404, m.contract_not_found());
	return contract;
}

export const load: PageServerLoad = async ({ url }) => {
	const contract = await requireContract(url.searchParams.get('contractId') ?? '');
	return { contract, crumbs: contractCrumbs(contract) };
};

export const actions: Actions = {
	default: async ({ request, url }) => {
		const contract = await requireContract(url.searchParams.get('contractId') ?? '');

		const formData = await request.formData();
		const file = formData.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: m.invoice_propose_error_file_required() });
		}
		if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
			return fail(400, { error: m.invoice_propose_error_file_not_pdf() });
		}

		const bytes = new Uint8Array(await file.arrayBuffer());
		const stored = await storeDocument({
			bytes,
			mime: 'application/pdf',
			originalName: file.name,
			provenance: 'upload',
			contractId: contract.id,
			confidential: true,
			ownerType: 'contract',
			ownerId: contract.id
		});

		const content = await extractPdfText(bytes);
		const queueDir = env.RUNNER_QUEUE_DIR ?? './data/runner-queue';
		await enqueueJob(queueDir, {
			documentId: stored.id,
			contractId: contract.id,
			targetType: 'invoice',
			content,
			instructions: invoiceExtractionInstructions()
		});

		redirect(303, `/clients/${contract.clientId}/contracts/${contract.id}`);
	}
};
