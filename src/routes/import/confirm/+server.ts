// The only endpoint in the import pipeline that writes anything (#46,
// #47's "nothing is written until the user confirms", extended by #44 and
// #48). Multipart, not plain JSON, since writing an invoice needs the
// structured document's own bytes again (and any companion attachment's):
// `decisions` carries the reviewer's choices as JSON, `file` fields carry
// exactly the bytes those choices reference, resent by the browser from
// what it already scanned.
//
// Each accepted clarification and each invoice is confirmed independently
// — one proposal or one file failing does not undo everyone else's, the
// same reasoning #46's version of this file already applied to
// clarifications alone.
import { json, text } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { db } from '$lib/server/db';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import type { FiscalPack } from '$lib/server/fiscal/pack';
import { resolveActiveFiscalPack } from '$lib/server/fiscal/profile';
import type { ImportableFile } from '$lib/server/import/adapter';
import type { ClientProposal, ContractProposal } from '$lib/server/import/client-match';
import { confirmClientContractProposal } from '$lib/server/import/confirm';
import { getAccountHolderTaxId } from '$lib/server/import/config';
import { importFile } from '$lib/server/import/importer';
import {
	persistImportedInvoice,
	type PersistInvoiceLineDecision,
	type PersistInvoiceOutcome
} from '$lib/server/import/persist';
import { defaultAdapterRegistry, type AdapterRegistry } from '$lib/server/import/registry';
import { listInvoicesForDedup } from '$lib/server/repositories/invoice';
import type { RequestHandler } from './$types';

interface ConfirmRequestProposal {
	readonly groupKey: string;
	readonly client: ClientProposal;
	readonly contract: ContractProposal;
	/** File refs for this group's own invoices, imported once the client and
	 * contract this proposal describes exist — the day #44 lands, a brand
	 * new client's own invoices no longer wait for a second import run.
	 * `invoiceIndex` picks which invoice within the file when a FatturaPA
	 * batch file (#101) parses to more than one. */
	readonly files: readonly { readonly filename: string; readonly invoiceIndex: number }[];
}

interface ConfirmRequestInvoice {
	readonly filename: string;
	/** Which invoice within `filename`'s own parsed array this refers to —
	 * 0 except for a FatturaPA batch file (#101), which can produce more
	 * than one. */
	readonly invoiceIndex: number;
	readonly contractId: string;
	/** Companion filenames `review.ts` paired to this one (#44's rule 2). */
	readonly attachments: readonly string[];
	/** One entry per line, in document order — the day ids the reviewer
	 * accepted for that line's day-mapping proposal (#48), or an empty
	 * array when the line has none or the reviewer rejected it. */
	readonly lineWorkUnitIds: readonly (readonly string[])[];
}

interface ConfirmRequestBody {
	readonly proposals: readonly ConfirmRequestProposal[];
	readonly invoices: readonly ConfirmRequestInvoice[];
}

function isConfirmRequestBody(value: unknown): value is ConfirmRequestBody {
	return (
		typeof value === 'object' &&
		value !== null &&
		Array.isArray((value as ConfirmRequestBody).proposals) &&
		Array.isArray((value as ConfirmRequestBody).invoices)
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function todayIsoDate(): string {
	return new Date().toISOString().slice(0, 10);
}

/** Every line an invoice document turns out to have, each with no day
 * linked — the shape a brand new contract's first invoice always gets,
 * since a contract just created by this same request has no rate card and
 * no recorded days yet for #48 to propose anything from. */
function emptyLineDecisions(
	file: ImportableFile,
	invoiceIndex: number,
	pack: Pick<FiscalPack, 'formats'>,
	registry: AdapterRegistry
): PersistInvoiceLineDecision[] {
	const parsed = importFile(pack, registry, file);
	const lineCount =
		parsed.kind === 'parsed' ? (parsed.invoices[invoiceIndex]?.lines.length ?? 0) : 0;
	return Array.from({ length: lineCount }, () => ({ workUnitIds: [] }));
}

export const POST: RequestHandler = async ({ request, locals }) => {
	// Read per request, not at module load: see config.ts and #133.
	const accountHolderTaxId = getAccountHolderTaxId();
	const formData = await request.formData();

	const decisionsRaw = formData.get('decisions');
	if (typeof decisionsRaw !== 'string') {
		return text('Expected a "decisions" field', { status: 400 });
	}
	let body: unknown;
	try {
		body = JSON.parse(decisionsRaw);
	} catch {
		return text('Malformed JSON in "decisions"', { status: 400 });
	}
	if (!isConfirmRequestBody(body)) {
		return text('Expected { proposals: [...], invoices: [...] }', { status: 400 });
	}

	const filesByName = new Map<string, ImportableFile>();
	for (const entry of formData.getAll('file')) {
		if (!(entry instanceof File)) continue;
		filesByName.set(entry.name, {
			filename: entry.name,
			content: new Uint8Array(await entry.arrayBuffer())
		});
	}

	const activePeriod = await resolveActiveFiscalPack(db, todayIsoDate());
	if (!activePeriod) {
		return text(m.import_no_active_pack(), { status: 422 });
	}
	const pack = activePeriod.pack;
	const registry = defaultAdapterRegistry;
	const actor = { kind: 'human' as const, email: locals.user!.email };
	const existingInvoices = await listInvoicesForDedup();

	const created: { groupKey: string; clientId: string; contractId: string }[] = [];
	const failed: { groupKey: string; message: string }[] = [];
	const invoicesCreated: { filename: string; invoiceId: string }[] = [];
	const invoicesAlreadyPresent: { filename: string }[] = [];
	const invoicesConflicted: { filename: string; existingInvoiceNumber: string }[] = [];
	// `invoiceIndex` is only threaded onto `invoicesFailed`: it is the one
	// array the review page renders in a keyed `{#each}` where the same
	// `filename` can appear twice, for a FatturaPA batch file's several
	// invoices (#101) — `invoicesCreated`/`invoicesAlreadyPresent`/
	// `invoicesConflicted` are shown only by count on that page today.
	const invoicesFailed: { filename: string; invoiceIndex: number; message: string }[] = [];

	function recordOutcome(filename: string, outcome: PersistInvoiceOutcome): void {
		if (outcome.kind === 'created')
			invoicesCreated.push({ filename, invoiceId: outcome.invoiceId });
		else if (outcome.kind === 'already_present') invoicesAlreadyPresent.push({ filename });
		else
			invoicesConflicted.push({ filename, existingInvoiceNumber: outcome.existingInvoiceNumber });
	}

	for (const proposal of body.proposals) {
		let contractId: string;
		try {
			const result = await confirmClientContractProposal(proposal.client, proposal.contract);
			created.push({ groupKey: proposal.groupKey, ...result });
			contractId = result.contractId;
		} catch (error) {
			const message = isPostgresConstraintViolation(error, '23505', 'client_tax_id_unique')
				? m.client_validation_tax_id_duplicate()
				: errorMessage(error);
			failed.push({ groupKey: proposal.groupKey, message });
			continue;
		}

		for (const fileRef of proposal.files) {
			const file = filesByName.get(fileRef.filename);
			if (!file) {
				invoicesFailed.push({
					filename: fileRef.filename,
					invoiceIndex: fileRef.invoiceIndex,
					message: 'file bytes were not resent with the confirm request'
				});
				continue;
			}
			try {
				const outcome = await persistImportedInvoice(
					{
						file,
						invoiceIndex: fileRef.invoiceIndex,
						attachments: [],
						contractId,
						lineDecisions: emptyLineDecisions(file, fileRef.invoiceIndex, pack, registry)
					},
					pack,
					registry,
					accountHolderTaxId,
					existingInvoices,
					actor,
					`imported after creating ${proposal.client.legalName} from the same folder`
				);
				recordOutcome(fileRef.filename, outcome);
			} catch (error) {
				invoicesFailed.push({
					filename: fileRef.filename,
					invoiceIndex: fileRef.invoiceIndex,
					message: errorMessage(error)
				});
			}
		}
	}

	for (const item of body.invoices) {
		const file = filesByName.get(item.filename);
		if (!file) {
			invoicesFailed.push({
				filename: item.filename,
				invoiceIndex: item.invoiceIndex,
				message: 'file bytes were not resent with the confirm request'
			});
			continue;
		}
		const attachments = item.attachments
			.map((name) => filesByName.get(name))
			.filter((f): f is ImportableFile => f !== undefined);
		try {
			const outcome = await persistImportedInvoice(
				{
					file,
					invoiceIndex: item.invoiceIndex,
					attachments,
					contractId: item.contractId,
					lineDecisions: item.lineWorkUnitIds.map((workUnitIds) => ({ workUnitIds }))
				},
				pack,
				registry,
				accountHolderTaxId,
				existingInvoices,
				actor,
				'imported from a folder'
			);
			recordOutcome(item.filename, outcome);
		} catch (error) {
			invoicesFailed.push({
				filename: item.filename,
				invoiceIndex: item.invoiceIndex,
				message: errorMessage(error)
			});
		}
	}

	return json({
		created,
		failed,
		invoicesCreated,
		invoicesAlreadyPresent,
		invoicesConflicted,
		invoicesFailed
	});
};
