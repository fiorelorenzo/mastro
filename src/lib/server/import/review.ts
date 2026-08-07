// The review computation behind #47's screen: given the files a scan
// produced, works out which are recognised, which are already present in
// this batch, which need a client/contract clarification, and why every
// other file was skipped — without writing anything. `buildReview` is pure
// (no database access — `existingClients` is passed in) so it is tested the
// same way `importer.ts` is, and the route handler (`+server.ts`) is a thin
// wrapper doing only the I/O: reading uploaded files, fetching clients,
// resolving the active pack.

import type { FiscalPack } from '$lib/server/fiscal/pack';
import type { ImportableFile } from './adapter';
import {
	buildClientContractProposal,
	matchClientByTaxId,
	type ClientContractProposal,
	type ClientMatchCandidate
} from './client-match';
import { naturalInvoiceKey } from './dedup';
import { classifyImportedInvoice, normalizedTaxId, type IncomingInvoiceReason } from './direction';
import { importFile, type ImportFileResult } from './importer';
import type { Invoice, MinorUnits } from './invoice';
import type { AdapterRegistry } from './registry';

/** Enough of a parsed invoice to show on the review screen, without
 * shipping the full document (tax breakdown, payment plan, ...) to the
 * browser for a summary line. */
export interface InvoiceSummary {
	readonly number: string;
	readonly issueDate: string;
	readonly customerLegalName: string;
	readonly customerTaxId: string;
	readonly total: MinorUnits;
	readonly currency: string;
}

function summarize(invoice: Invoice): InvoiceSummary {
	return {
		number: invoice.number,
		issueDate: invoice.issueDate,
		customerLegalName: invoice.customer.legalName,
		customerTaxId: invoice.customer.taxId,
		total: invoice.total,
		currency: invoice.currency
	};
}

export type SkipReason =
	| { readonly kind: 'unrecognised_format' }
	| { readonly kind: 'malformed_document'; readonly message: string }
	| { readonly kind: 'incoming_invoice'; readonly reason: IncomingInvoiceReason };

export interface SkippedFile {
	readonly filename: string;
	readonly reason: SkipReason;
}

export interface RecognisedFile {
	readonly filename: string;
	readonly invoice: InvoiceSummary;
	readonly clientId: string;
	readonly clientLegalName: string;
}

/** `duplicateOfFilename` names the file that first claimed this invoice's
 * natural key (see dedup.ts) in this same batch — the "already present"
 * bucket is a same-batch fact, not (yet) a check against history, so the
 * "other file" it names is always something the user is looking at right
 * now, never a past import. */
export interface AlreadyPresentFile {
	readonly filename: string;
	readonly invoice: InvoiceSummary;
	readonly duplicateOfFilename: string;
}

/** One unmatched customer, with every file in this batch that belongs to
 * them and the single proposal built from all of them together — grouped
 * so a customer with several invoices in the folder gets one clarification
 * to accept, not one per invoice. */
export interface ClarificationGroup extends ClientContractProposal {
	readonly groupKey: string;
	readonly files: readonly { readonly filename: string; readonly invoice: InvoiceSummary }[];
}

export interface ReviewResult {
	readonly recognised: readonly RecognisedFile[];
	readonly alreadyPresent: readonly AlreadyPresentFile[];
	readonly clarifications: readonly ClarificationGroup[];
	readonly skipped: readonly SkippedFile[];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Computes the whole review in one pass over `files`, in the order given.
 * Never touches a database or a filesystem — every input is already in
 * memory, and the result is exactly what #47's screen renders and what its
 * confirm step later acts on (accepted clarifications only; recognised and
 * already-present files write nothing, see the PR description for why).
 */
export function buildReview(
	files: readonly ImportableFile[],
	pack: Pick<FiscalPack, 'formats'>,
	registry: AdapterRegistry,
	accountHolderTaxId: string,
	existingClients: readonly ClientMatchCandidate[]
): ReviewResult {
	const recognised: RecognisedFile[] = [];
	const alreadyPresent: AlreadyPresentFile[] = [];
	const skipped: SkippedFile[] = [];
	const seenKeys = new Map<string, string>();
	const unknownGroups = new Map<string, { filename: string; invoice: Invoice }[]>();

	for (const file of files) {
		let result: ImportFileResult;
		try {
			result = importFile(pack, registry, file);
		} catch (error) {
			skipped.push({
				filename: file.filename,
				reason: { kind: 'malformed_document', message: errorMessage(error) }
			});
			continue;
		}
		if (result.kind === 'unclaimed') {
			skipped.push({ filename: file.filename, reason: { kind: 'unrecognised_format' } });
			continue;
		}

		const direction = classifyImportedInvoice(result.invoice, accountHolderTaxId);
		if (direction.kind === 'incoming_skipped') {
			skipped.push({
				filename: file.filename,
				reason: { kind: 'incoming_invoice', reason: direction.reason }
			});
			continue;
		}

		const invoice = direction.invoice;
		const key = naturalInvoiceKey(invoice);
		const duplicateOfFilename = seenKeys.get(key);
		if (duplicateOfFilename) {
			alreadyPresent.push({
				filename: file.filename,
				invoice: summarize(invoice),
				duplicateOfFilename
			});
			continue;
		}
		seenKeys.set(key, file.filename);

		const match = matchClientByTaxId(invoice.customer, existingClients);
		if (match) {
			recognised.push({
				filename: file.filename,
				invoice: summarize(invoice),
				clientId: match.id,
				clientLegalName: match.legalName
			});
			continue;
		}

		const groupKey = normalizedTaxId(invoice.customer.taxId);
		const group = unknownGroups.get(groupKey) ?? [];
		group.push({ filename: file.filename, invoice });
		unknownGroups.set(groupKey, group);
	}

	const clarifications: ClarificationGroup[] = [...unknownGroups.entries()].map(
		([groupKey, group]) => ({
			groupKey,
			files: group.map(({ filename, invoice }) => ({ filename, invoice: summarize(invoice) })),
			...buildClientContractProposal(group.map(({ invoice }) => invoice))
		})
	);

	return { recognised, alreadyPresent, clarifications, skipped };
}
