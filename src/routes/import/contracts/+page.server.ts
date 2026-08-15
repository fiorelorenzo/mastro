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
 * does not exist yet.
 *
 * #278 (`docs/specs/2026-08-15-extraction-runs-design.md`, "Making it
 * immediate"): this also creates the `extraction_run` row the redirect
 * target needs to exist, and lands on that run's own page instead of
 * blindly on `/proposals` — the resulting proposal is only reachable
 * from there once a human accepts the run's outcome.
 */
import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import * as m from '$lib/paraglide/messages';
import { contractExtractionInstructions } from '$lib/server/agent/contract-extraction';
import { extractPdfText } from '$lib/server/agent/invoice-producer';
import { db } from '$lib/server/db';
import { createExtractionRun } from '$lib/server/repositories/extraction-run';
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
		// `extractPdfText` **detaches** what it is given — pdfjs transfers the
		// ArrayBuffer to its worker, and the caller's view comes back with
		// `byteLength` 0. Measured, not feared: 3095 bytes in, 0 out,
		// `buffer.detached === true`. So the text is read from a copy and
		// `bytes` stays intact for `storeDocument` below. Archiving the
		// document is the whole point (invariant 4: never keep only the
		// extracted fields), and handing the original here would archive
		// nothing at all — in fact it would throw, since
		// `document_size_positive` refuses a zero-byte row, so every contract
		// upload would fail outright.
		const content = await extractPdfText(bytes.slice());
		const queueDir = env.RUNNER_QUEUE_DIR ?? './data/runner-queue';
		const enqueuedAt = new Date();

		// The document row and the run row are written in one transaction —
		// either both exist or neither does. `enqueueJob` has to sit between
		// them: it needs the document's id, already known from
		// `storeDocument`'s own `.returning()` even though this transaction
		// has not committed yet, and `createExtractionRun` needs the job id
		// `enqueueJob` returns — there is no ordering that keeps all three
		// atomic together. What stays outside this transaction's guarantee
		// is the queue file itself: `enqueueJob` writes
		// `pending/<jobId>.json` with a plain `rename(2)` on disk (invariant
		// 3 is exactly why the runner has no database access to make this
		// one write instead of two). If this transaction rolled back after
		// `enqueueJob` already wrote that file, the runner would pick up a
		// job naming a document that was never actually saved — but
		// `job.ts`'s own defence-in-depth check re-reads `documentId` from
		// its own scoped connection before ever calling the model, so that
		// turns into a clean `markJobFailed`, not a job silently attributed
		// to nothing. That is judged the acceptable edge, over the
		// alternative of writing the run row outside this transaction
		// entirely, which would let an upload appear queued with no run to
		// show for it if only the run insert failed.
		const run = await db.transaction(async (tx) => {
			// Unclaimed: no contract exists yet to scope or own this
			// document — that is exactly what accepting the proposal this
			// becomes will create (`db/schema/document.ts`'s doc comment on
			// why `contractId`/`ownerType`/`ownerId` are nullable together).
			const stored = await storeDocument(
				{
					bytes,
					mime: 'application/pdf',
					originalName: file.name,
					provenance: 'upload',
					contractId: null,
					confidential: true,
					ownerType: null,
					ownerId: null
				},
				tx
			);

			const jobId = await enqueueJob(queueDir, {
				documentId: stored.id,
				contractId: null,
				targetType: 'contract',
				content,
				instructions: contractExtractionInstructions()
			});

			return createExtractionRun(
				{ jobId, documentId: stored.id, targetType: 'contract', enqueuedAt },
				tx
			);
		});

		redirect(303, `/import/runs/${run.id}`);
	}
};
