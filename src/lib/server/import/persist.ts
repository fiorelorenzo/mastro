// The only place in the import pipeline that writes an invoice (#44).
// Everything upstream (`review.ts`) only proposes; nothing reaches the
// ledger until a human confirms, one file at a time, per invariant 3 —
// mirroring `confirm.ts`'s role for a client/contract proposal.
//
// The file is re-parsed from its own bytes here rather than trusting
// whatever `review.ts` computed a moment (or a browser round trip) ago:
// the structured document is the source of every field this invoice gets
// (#44's rule 2 — "the structured document wins"), so parsing it again at
// write time is simpler than serialising the parsed `Invoice` back and
// forth and trusting the client not to have tampered with it, and it
// re-validates direction and the natural key against whatever the database
// looks like right now, not at review time.

import { sumMinorUnits } from '$lib/money';
import { db, type DbExecutor } from '$lib/server/db';
import type { TransitionActor } from '$lib/server/db/schema';
import { hashContent } from '$lib/server/documents/blob-store';
import type { FiscalPack } from '$lib/server/fiscal/pack';
import { createInvoice, type InvoiceInput, type InvoiceLineInput } from '../repositories/invoice';
import { storeDocument } from '../repositories/document';
import type { ImportableFile } from './adapter';
import { naturalInvoiceKey, type ExistingInvoiceRecord } from './dedup';
import { classifyImportedInvoice } from './direction';
import { importFile } from './importer';
import type { Invoice } from './invoice';
import { supersedePendingInvoiceProposals } from './invoice-supersession';
import type { AdapterRegistry } from './registry';

/** What a human decided for one line's proposed day mapping (#48):
 * `workUnitIds` is empty when the line has no day-rate proposal, or when
 * the reviewer rejected the one it had — either way, the line is still
 * created, just linked to no day. */
export interface PersistInvoiceLineDecision {
	readonly workUnitIds: readonly string[];
}

export interface PersistInvoiceRequest {
	/** The structured document — re-parsed here, never trusted pre-parsed. */
	readonly file: ImportableFile;
	/** 0-based position within the file's own parsed array of invoices
	 * (`ImportFileResult.invoices`). 0 for the ordinary case; only nonzero
	 * for a body other than the first in a FatturaPA batch (`lotto`) file
	 * (#101). */
	readonly invoiceIndex: number;
	/** Companion files (#44's rule 2) to attach to the same invoice as-is,
	 * never parsed for their own fields. */
	readonly attachments: readonly ImportableFile[];
	readonly contractId: string;
	/** Must have exactly one entry per line the document turns out to have;
	 * a mismatch is rejected rather than guessed at, the same restraint a
	 * malformed document already gets from `importFile`. */
	readonly lineDecisions: readonly PersistInvoiceLineDecision[];
}

export type PersistInvoiceOutcome =
	| { readonly kind: 'created'; readonly filename: string; readonly invoiceId: string }
	| { readonly kind: 'already_present'; readonly filename: string }
	| {
			readonly kind: 'conflict';
			readonly filename: string;
			readonly existingInvoiceNumber: string;
	  };

function mimeForFilename(filename: string): string {
	const dot = filename.lastIndexOf('.');
	switch (dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '') {
		case 'xml':
			return 'application/xml';
		case 'pdf':
			return 'application/pdf';
		default:
			return 'application/octet-stream';
	}
}

/**
 * Maps the neutral, parsed `Invoice` onto `invoice`'s flat columns.
 * `taxSummary` and `socialSecurityCharges` are arrays on the neutral type
 * because a real document can carry more than one tax-rate block or fund
 * (see the doc comments on `InvoiceTaxSummary`/`InvoiceSocialSecurityCharge`
 * in `invoice.ts`); `invoice`'s own columns are one flat value each, the
 * same simplification the manual invoice form (#26) already leaves a human
 * to resolve by typing a single value. A social charge is summed, since an
 * amount is meaningfully additive; a tax-treatment annotation is not, so
 * the first block's is kept and any second-and-later block's annotation is
 * not carried onto the invoice row — the totals, tax and every line still
 * reconcile regardless, since those are summed from `lines` by
 * `createInvoice` itself, never read off this mapping.
 */
function mapInvoiceToInput(invoice: Invoice, contractId: string): Omit<InvoiceInput, 'lines'> {
	const firstTaxSummary = invoice.taxSummary[0];
	const firstInstallment = invoice.paymentTerms[0]?.installments[0];
	const socialCharge = invoice.socialSecurityCharges.length
		? sumMinorUnits(invoice.socialSecurityCharges.map((charge) => charge.amount))
		: null;
	return {
		contractId,
		number: invoice.number,
		issueDate: invoice.issueDate,
		documentType: invoice.documentType,
		currency: invoice.currency,
		taxTreatmentCode: firstTaxSummary?.taxTreatmentCode ?? null,
		statutoryReference: firstTaxSummary?.statutoryReference ?? null,
		stampDuty: invoice.stampDuty ?? null,
		socialCharge,
		dueDate: firstInstallment?.dueDate ?? null,
		paymentMethod: firstInstallment?.method ?? null,
		iban: firstInstallment?.iban ?? null,
		transmissionId: invoice.transmission.progressiveNumber
	};
}

/**
 * Persists one imported invoice: parses `request.file`, checks it against
 * `existingInvoices` by the same natural-key-plus-hash comparator
 * `review.ts` used to propose this in the first place, and either writes
 * nothing (`already_present`, `conflict`) or writes the invoice, its
 * lines — each linked to the days its decision accepted, moving them to
 * `invoiced` through the existing state machine (#48) — the structured
 * document, and every attachment not already stored under identical
 * content.
 *
 * Throws, rather than returning an outcome, for anything that means the
 * request itself does not make sense any more (the file no longer parses,
 * turned out to be incoming, the line count no longer matches, or
 * `contractId` does not exist): these are not business outcomes a reviewer
 * chose between, they are the confirm request disagreeing with reality,
 * and the caller (the route handler) reports them the same way it already
 * reports a failed clarification.
 */
export async function persistImportedInvoice(
	request: PersistInvoiceRequest,
	pack: Pick<FiscalPack, 'formats'>,
	registry: AdapterRegistry,
	accountHolderTaxId: string,
	existingInvoices: readonly ExistingInvoiceRecord[],
	actor: TransitionActor,
	reason: string,
	tx?: DbExecutor
): Promise<PersistInvoiceOutcome> {
	const filename = request.file.filename;

	const parsed = importFile(pack, registry, request.file);
	if (parsed.kind === 'unclaimed') {
		throw new Error(`${filename}: no adapter recognises this file any more`);
	}
	const rawInvoice = parsed.invoices[request.invoiceIndex];
	if (rawInvoice === undefined) {
		throw new Error(
			`${filename}: the document no longer has an invoice at index ${request.invoiceIndex}`
		);
	}
	const direction = classifyImportedInvoice(rawInvoice, accountHolderTaxId);
	if (direction.kind === 'incoming_skipped') {
		throw new Error(`${filename}: this is an incoming invoice, never imported as revenue`);
	}
	const invoice = direction.invoice;
	if (invoice.lines.length !== request.lineDecisions.length) {
		throw new Error(
			`${filename}: the document has ${invoice.lines.length} line(s) but ${request.lineDecisions.length} decision(s) were supplied`
		);
	}

	const key = naturalInvoiceKey(invoice);
	const hash = hashContent(request.file.content);
	const existing = existingInvoices.find(
		(row) =>
			naturalInvoiceKey({
				supplier: { taxId: accountHolderTaxId },
				number: row.number,
				issueDate: row.issueDate
			}) === key
	);

	const run = async (executor: DbExecutor): Promise<PersistInvoiceOutcome> => {
		let invoiceId: string;
		const knownHashes = new Set(existing?.hashes ?? []);

		if (existing) {
			if (!knownHashes.has(hash)) {
				return { kind: 'conflict', filename, existingInvoiceNumber: existing.number };
			}
			invoiceId = existing.id;
		} else {
			const lines: InvoiceLineInput[] = invoice.lines.map((line, index) => ({
				description: line.description,
				quantity: line.quantity,
				unitPrice: line.unitPrice,
				amount: line.amount,
				taxRate: line.taxRate,
				// The neutral `InvoiceLine` carries no per-line treatment code —
				// only the tax-summary block does (`mapInvoiceToInput` above) —
				// so a line never claims one of its own on creation either.
				taxTreatmentCode: null,
				workUnitIds: [...request.lineDecisions[index].workUnitIds]
			}));
			const invoiceRow = await createInvoice(
				{ ...mapInvoiceToInput(invoice, request.contractId), lines },
				actor,
				reason,
				executor
			);
			await storeDocument(
				{
					bytes: request.file.content,
					mime: mimeForFilename(filename),
					originalName: filename,
					provenance: 'folder_import',
					contractId: request.contractId,
					confidential: true,
					ownerType: 'invoice',
					ownerId: invoiceRow.id
				},
				executor
			);
			invoiceId = invoiceRow.id;
			// #87: a PDF fallback proposal may already exist for this exact
			// invoice (same contract, same natural key), still pending a
			// human's review because nothing more authoritative had arrived
			// yet. Now something has — supersede it: the structured document's
			// own values win, and the PDF it was extracted from becomes this
			// invoice's attachment rather than its only evidence, both kept
			// (invariant 4).
			await supersedePendingInvoiceProposals(
				request.contractId,
				invoice,
				invoiceRow.id,
				invoiceRow.dueDate,
				accountHolderTaxId,
				executor
			);
			knownHashes.add(hash);
		}

		for (const attachment of request.attachments) {
			const attachmentHash = hashContent(attachment.content);
			if (knownHashes.has(attachmentHash)) continue;
			await storeDocument(
				{
					bytes: attachment.content,
					mime: mimeForFilename(attachment.filename),
					originalName: attachment.filename,
					provenance: 'folder_import',
					contractId: request.contractId,
					confidential: true,
					ownerType: 'invoice',
					ownerId: invoiceId
				},
				executor
			);
			knownHashes.add(attachmentHash);
		}

		return existing
			? { kind: 'already_present', filename }
			: { kind: 'created', filename, invoiceId };
	};

	return tx ? run(tx) : db.transaction(run);
}
