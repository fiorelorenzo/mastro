// The review computation behind the `/import` screen (#47, extended by
// #44 and #48): given the files a scan produced, works out which are
// recognised (and against which contract, and which existing days they
// probably billed), which are already present — in this same batch or
// already imported in the past — which are a genuine conflict with a past
// import, which need a client/contract clarification, and why every other
// file was skipped — without writing anything. `buildReview` is pure (no
// database access — `existingClients`, `existingInvoices` and
// `dayMappingByContractId` are all passed in) so it is tested the same way
// `importer.ts` is, and the route handler (`+server.ts`) is a thin wrapper
// doing only the I/O: reading uploaded files, fetching clients, contracts,
// rate cards, eligible days and invoice history, and resolving the active
// pack.

import type { FiscalPack } from '$lib/server/fiscal/pack';
import { hashContent } from '$lib/server/documents/blob-store';
import type { PriceableRateCard } from '$lib/server/domain/work-unit-pricing';
import type { ImportableFile } from './adapter';
import {
	buildClientContractProposal,
	matchClientByTaxId,
	type ClientContractProposal,
	type ClientMatchCandidate
} from './client-match';
import {
	proposeDayMapping,
	type DayMappingCandidateDay,
	type DayMappingProposal
} from './day-mapping';
import { naturalInvoiceKey, type ExistingInvoiceRecord } from './dedup';
import { classifyImportedInvoice, normalizedTaxId, type IncomingInvoiceReason } from './direction';
import { importFile, type ImportFileResult } from './importer';
import type { Invoice, InvoiceLine, MinorUnits } from './invoice';
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
	| { readonly kind: 'incoming_invoice'; readonly reason: IncomingInvoiceReason }
	| { readonly kind: 'ambiguous_contract'; readonly clientLegalName: string };

export interface SkippedFile {
	readonly filename: string;
	/** See `RecognisedFile`. `malformed_document` and `unrecognised_format`
	 * are decided before a file's invoices are even parsed, so this is
	 * always 0 for those two reasons; `incoming_invoice` and
	 * `ambiguous_contract` are decided per invoice and carry the real
	 * index. */
	readonly invoiceIndex: number;
	readonly reason: SkipReason;
}

/** One billed line, with the day-mapping proposal for it (#48) when the
 * line's contract is day-rate and enough already-recorded, unbilled days
 * exist to account for it exactly — `null` otherwise, meaning nothing is
 * proposed and the reviewer links days by hand if any apply. */
export interface InvoiceLineView {
	readonly description: string;
	readonly quantity: number;
	readonly unitPrice: MinorUnits;
	readonly amount: MinorUnits;
	readonly taxRate: number;
	readonly dayMapping: DayMappingProposal | null;
}

export interface RecognisedFile {
	readonly filename: string;
	/** 0-based position of this invoice within the file's own parsed
	 * array. Almost always 0 — FatturaPA's batch (`lotto`) shape is the
	 * one case in this codebase where a single file's `filename` can
	 * repeat across more than one `RecognisedFile` row, one per
	 * `FatturaElettronicaBody` the file carries (#101); this is what
	 * distinguishes them. */
	readonly invoiceIndex: number;
	readonly invoice: InvoiceSummary;
	readonly lines: readonly InvoiceLineView[];
	readonly clientId: string;
	readonly clientLegalName: string;
	readonly contractId: string;
	/** Companion files in this same batch that share this file's path and
	 * base name, minus extension, and that no adapter claims — the PDF half
	 * of a structured-plus-PDF pair (#44's rule 2). Stored as attachments on
	 * the same invoice on confirm; never parsed for their own fields, since
	 * the structured document already supplies every field this invoice
	 * needs. */
	readonly attachments: readonly string[];
}

export type AlreadyPresentSource = 'batch' | 'database';

/** A file whose natural key and content hash both match an invoice that
 * already exists — in this same batch (`source: 'batch'`) or from a past
 * import (`source: 'database'`, #44's central acceptance: re-running an
 * import a second time creates nothing). Never written on confirm. */
export interface AlreadyPresentFile {
	readonly filename: string;
	/** See `RecognisedFile`. */
	readonly invoiceIndex: number;
	readonly invoice: InvoiceSummary;
	readonly source: AlreadyPresentSource;
	readonly duplicateOfFilename: string | null;
	readonly existingInvoiceNumber: string | null;
	/** Companion files paired to this one that are themselves already
	 * stored under identical content — shown for context, never resent on
	 * confirm. */
	readonly attachments: readonly string[];
}

/** A file whose natural key matches an existing invoice but whose content
 * hash does not: a genuine re-issue, or two different documents claiming
 * the same number and year. #44's rule 3 — surfaced to the reviewer, never
 * merged or silently imported; there is no confirm action for this bucket,
 * on purpose. */
export interface ConflictFile {
	readonly filename: string;
	/** See `RecognisedFile`. */
	readonly invoiceIndex: number;
	readonly invoice: InvoiceSummary;
	readonly existingInvoiceNumber: string;
	readonly existingIssueDate: string;
}

/** One unmatched customer, with every file in this batch that belongs to
 * them and the single proposal built from all of them together — grouped
 * so a customer with several invoices in the folder gets one clarification
 * to accept, not one per invoice. A brand new client has no recorded days
 * yet, so no day-mapping proposal ever applies here — only a `recognised`
 * file (an already-known client) can carry one. */
export interface ClarificationGroup extends ClientContractProposal {
	readonly groupKey: string;
	readonly files: readonly {
		readonly filename: string;
		/** See `RecognisedFile`. */
		readonly invoiceIndex: number;
		readonly invoice: InvoiceSummary;
	}[];
}

export interface ReviewResult {
	readonly recognised: readonly RecognisedFile[];
	readonly alreadyPresent: readonly AlreadyPresentFile[];
	readonly conflicts: readonly ConflictFile[];
	readonly clarifications: readonly ClarificationGroup[];
	readonly skipped: readonly SkippedFile[];
}

/** What a day-rate proposal (#48) is built from for one contract: its rate
 * cards (to resolve the one in force on the invoice's issue date and price
 * it) and its days not yet on an invoice line. Populated by the caller only
 * for a client whose `activeContractId` resolved to something — building
 * it for every contract in the database regardless of whether any file
 * matches it would be wasted work the caller has no reason to do. */
export interface DayMappingContext {
	// Not `readonly`: `proposeDayMapping` passes this straight through to
	// `resolveRateCard`/`priceWorkUnitOnDate`, whose own signature takes a
	// mutable array (see the comment on `proposeDayMapping`'s own parameter).
	readonly rateCards: PriceableRateCard[];
	readonly eligibleDays: readonly DayMappingCandidateDay[];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** `filename` minus its extension, path kept intact — pairs
 * `2024/invoice-042.xml` with `2024/invoice-042.pdf` but never with an
 * unrelated `invoice-042.xml` sitting in a different folder of the same
 * batch. Used only to pair a structured document with a same-named PDF
 * (#44's rule 2), never to decide what a file *is* — the same restraint
 * `ImportableFile.filename`'s own doc comment requires of an adapter's
 * `detect`. */
function fileStem(filename: string): string {
	const dot = filename.lastIndexOf('.');
	const slash = filename.lastIndexOf('/');
	return dot > slash ? filename.slice(0, dot) : filename;
}

interface KeyEntry {
	/** Every content hash currently known under this natural key: the full
	 * set for a `database` entry (structured original plus any PDF already
	 * attached to it), a single hash for a `batch` entry seeded by the
	 * first file this run to claim the key. Grows as this run's own
	 * companions are paired in, so a third copy of the same companion later
	 * in the batch is recognised too, not re-added. */
	readonly hashes: Set<string>;
	readonly source: AlreadyPresentSource;
	readonly filename: string | null;
	readonly number: string;
	readonly issueDate: string;
}

/** Where a companion file (#44's rule 2) attaches: the natural-key entry
 * its structured pair resolved to (so a companion's hash extends the same
 * set future runs check against) and the mutable backing array behind
 * that structured file's `attachments` field — the same array object, so
 * pushing here is visible through the `RecognisedFile`/`AlreadyPresentFile`
 * row already pushed to the result. */
interface StructuredTarget {
	readonly entry: KeyEntry;
	readonly attachments: string[];
}

/**
 * Computes the whole review in one pass over `files`, in the order given
 * (and, within a file, over every invoice it parses to — almost always
 * one, but a FatturaPA batch file can carry several, #101, each
 * classified independently against the same file bytes), followed by a
 * second pass pairing any unclaimed file (a PDF, most concretely) against
 * a structured file it shares a base name with.
 *
 * `existingClients` matches a customer to a client already on record;
 * `existingInvoices` seeds cross-run dedup with every invoice already
 * imported, so a repeat within this batch and a repeat of a past import
 * are caught by the identical natural-key-plus-hash comparator (#44).
 * `dayMappingByContractId` supplies what #48's proposal needs, per
 * contract a matched client might resolve to.
 */
export function buildReview(
	files: readonly ImportableFile[],
	pack: Pick<FiscalPack, 'formats'>,
	registry: AdapterRegistry,
	accountHolderTaxId: string,
	existingClients: readonly ClientMatchCandidate[],
	existingInvoices: readonly ExistingInvoiceRecord[] = [],
	dayMappingByContractId: ReadonlyMap<string, DayMappingContext> = new Map()
): ReviewResult {
	const recognised: RecognisedFile[] = [];
	const alreadyPresent: AlreadyPresentFile[] = [];
	const conflicts: ConflictFile[] = [];
	const skipped: SkippedFile[] = [];
	const unclaimed: ImportableFile[] = [];
	const unknownGroups = new Map<
		string,
		{ filename: string; invoiceIndex: number; invoice: Invoice }[]
	>();

	const keyIndex = new Map<string, KeyEntry>();
	for (const existing of existingInvoices) {
		const key = naturalInvoiceKey({
			supplier: { taxId: accountHolderTaxId },
			number: existing.number,
			issueDate: existing.issueDate
		});
		keyIndex.set(key, {
			hashes: new Set(existing.hashes),
			source: 'database',
			filename: null,
			number: existing.number,
			issueDate: existing.issueDate
		});
	}

	const structuredTargets = new Map<string, StructuredTarget>();

	for (const file of files) {
		let result: ImportFileResult;
		try {
			result = importFile(pack, registry, file);
		} catch (error) {
			skipped.push({
				filename: file.filename,
				invoiceIndex: 0,
				reason: { kind: 'malformed_document', message: errorMessage(error) }
			});
			continue;
		}
		if (result.kind === 'unclaimed') {
			unclaimed.push(file);
			continue;
		}

		// The file's own bytes, hashed once — every invoice a batch file
		// carries (#101) shares the same content hash, since they all come
		// from the same file.
		const hash = hashContent(file.content);

		for (const [invoiceIndex, rawInvoice] of result.invoices.entries()) {
			const direction = classifyImportedInvoice(rawInvoice, accountHolderTaxId);
			if (direction.kind === 'incoming_skipped') {
				skipped.push({
					filename: file.filename,
					invoiceIndex,
					reason: { kind: 'incoming_invoice', reason: direction.reason }
				});
				continue;
			}

			const invoice = direction.invoice;
			const key = naturalInvoiceKey(invoice);
			const existingEntry = keyIndex.get(key);

			if (existingEntry) {
				if (existingEntry.hashes.has(hash)) {
					const attachments: string[] = [];
					alreadyPresent.push({
						filename: file.filename,
						invoiceIndex,
						invoice: summarize(invoice),
						source: existingEntry.source,
						duplicateOfFilename: existingEntry.source === 'batch' ? existingEntry.filename : null,
						existingInvoiceNumber:
							existingEntry.source === 'database' ? existingEntry.number : null,
						attachments
					});
					// A companion file only ever pairs with a single-invoice
					// file (#44's rule 2): which of a batch file's several
					// bodies (#101) a same-named PDF belongs to cannot be
					// known from the filename alone, and guessing would be
					// exactly the invented attribution rule 2 forbids, so a
					// batch body never registers a `structuredTargets` entry
					// — any companion sharing its base name falls through to
					// `unrecognised_format` in the second pass below.
					if (result.invoices.length === 1) {
						structuredTargets.set(fileStem(file.filename), { entry: existingEntry, attachments });
					}
				} else {
					conflicts.push({
						filename: file.filename,
						invoiceIndex,
						invoice: summarize(invoice),
						existingInvoiceNumber: existingEntry.number,
						existingIssueDate: existingEntry.issueDate
					});
				}
				continue;
			}

			const newEntry: KeyEntry = {
				hashes: new Set([hash]),
				source: 'batch',
				filename: file.filename,
				number: invoice.number,
				issueDate: invoice.issueDate
			};
			keyIndex.set(key, newEntry);

			const match = matchClientByTaxId(invoice.customer, existingClients);
			if (match) {
				if (!match.activeContractId) {
					skipped.push({
						filename: file.filename,
						invoiceIndex,
						reason: { kind: 'ambiguous_contract', clientLegalName: match.legalName }
					});
					continue;
				}
				const dayMappingContext = dayMappingByContractId.get(match.activeContractId);
				const attachments: string[] = [];
				recognised.push({
					filename: file.filename,
					invoiceIndex,
					invoice: summarize(invoice),
					lines: invoice.lines.map((line: InvoiceLine) => ({
						description: line.description,
						quantity: line.quantity,
						unitPrice: line.unitPrice,
						amount: line.amount,
						taxRate: line.taxRate,
						dayMapping: dayMappingContext
							? proposeDayMapping(
									line,
									invoice.issueDate,
									dayMappingContext.eligibleDays,
									dayMappingContext.rateCards
								)
							: null
					})),
					clientId: match.id,
					clientLegalName: match.legalName,
					contractId: match.activeContractId,
					attachments
				});
				// See the companion-attachment comment above: same restraint
				// applies to a newly recognised batch body.
				if (result.invoices.length === 1) {
					structuredTargets.set(fileStem(file.filename), { entry: newEntry, attachments });
				}
				continue;
			}

			const groupKey = normalizedTaxId(invoice.customer.taxId);
			const group = unknownGroups.get(groupKey) ?? [];
			group.push({ filename: file.filename, invoiceIndex, invoice });
			unknownGroups.set(groupKey, group);
		}
	}

	for (const file of unclaimed) {
		const target = structuredTargets.get(fileStem(file.filename));
		if (!target) {
			skipped.push({
				filename: file.filename,
				invoiceIndex: 0,
				reason: { kind: 'unrecognised_format' }
			});
			continue;
		}
		target.attachments.push(file.filename);
		target.entry.hashes.add(hashContent(file.content));
	}

	const clarifications: ClarificationGroup[] = [...unknownGroups.entries()].map(
		([groupKey, group]) => ({
			groupKey,
			files: group.map(({ filename, invoiceIndex, invoice }) => ({
				filename,
				invoiceIndex,
				invoice: summarize(invoice)
			})),
			...buildClientContractProposal(group.map(({ invoice }) => invoice))
		})
	);

	return { recognised, alreadyPresent, conflicts, clarifications, skipped };
}
