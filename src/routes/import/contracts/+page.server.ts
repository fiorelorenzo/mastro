/**
 * The human trigger for #86's first-intake lane: upload a contract PDF
 * for a counterparty that may not even be a `client` yet, archive it
 * unclaimed — no `contract_id`, no owner, `db/schema/document.ts`'s own
 * "unclaimed" state — and queue the extraction the runner (#82) picks up
 * on its next pass. Never a synchronous model call inside this request,
 * the same "archive now, extract later" boundary `agent/enqueue.ts` and
 * `/invoices/propose` already draw.
 *
 * Unlike `/invoices/propose`, there is no `?contractId=` to scope this
 * page by: a contract's own founding PDF is exactly the case where one
 * does not exist yet. The resulting proposal shows up on `/proposals`
 * with no contract to link back to until a human accepts it — that
 * accept is what creates the contract (`repositories/proposal.ts`'s
 * `applyProposal`, the 'contract' case).
 */
import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import * as m from '$lib/paraglide/messages';
import { contractExtractionInstructions } from '$lib/server/agent/contract-extraction';
import { extractPdfText } from '$lib/server/agent/invoice-producer';
import { storeDocument } from '$lib/server/repositories/document';
import { enqueueJob } from '$lib/server/runner/queue';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request }) => {
		const formData = await request.formData();
		const file = formData.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: m.client_new_from_pdf_error_file_required() });
		}
		if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
			return fail(400, { error: m.client_new_from_pdf_error_file_not_pdf() });
		}

		const bytes = new Uint8Array(await file.arrayBuffer());
		// Unclaimed: no contract exists yet to scope or own this document —
		// that is exactly what accepting the proposal this becomes will
		// create (`db/schema/document.ts`'s doc comment on why
		// `contractId`/`ownerType`/`ownerId` are nullable together).
		const stored = await storeDocument({
			bytes,
			mime: 'application/pdf',
			originalName: file.name,
			provenance: 'upload',
			contractId: null,
			confidential: true,
			ownerType: null,
			ownerId: null
		});

		const content = await extractPdfText(bytes);
		const queueDir = env.RUNNER_QUEUE_DIR ?? './data/runner-queue';
		await enqueueJob(queueDir, {
			documentId: stored.id,
			contractId: null,
			targetType: 'contract',
			content,
			instructions: contractExtractionInstructions()
		});

		redirect(303, '/proposals');
	}
};
