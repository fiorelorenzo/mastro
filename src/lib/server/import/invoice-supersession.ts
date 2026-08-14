// #87's other half: what happens when a structured document lands for an
// invoice the PDF fallback lane already produced a lower-confidence guess
// for. "Never preferred over it when both exist" cuts both ways — a
// structured document that arrives after the PDF proposal wins on every
// field they disagree about, and the PDF it was extracted from steps
// down from "the invoice's only evidence" to an attachment, never
// discarded (invariant 4: both documents are kept).
//
// Runs inside `persistImportedInvoice`'s own transaction
// (`import/persist.ts`), right after the structured document creates its
// invoice row — there is nothing to supersede before that row exists.
//
// Deliberately scoped to a still-pending PDF proposal only. A PDF
// proposal a human already accepted (creating its own invoice row before
// the structured document ever arrived) is a different case entirely:
// `persist.ts`'s own natural-key dedup surfaces that as a `conflict` for
// a human to resolve — two ledger rows genuinely disagreeing about one
// invoice is not something this module silently reconciles.

import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '$lib/server/db';
import { document, proposal } from '$lib/server/db/schema';
import type { InvoiceProposedFields } from '$lib/server/agent/invoice-extraction';
import { naturalInvoiceKey } from './dedup';
import type { Invoice } from './invoice';

/** Who decided a superseded proposal — never a human's email, so a
 * reviewer reading `proposal.decidedBy` on the review screen can tell
 * this apart from an actual Accept click at a glance. */
export const SUPERSEDED_BY_STRUCTURED_IMPORT = 'system:structured-invoice-import';

export interface SupersessionOutcome {
	readonly supersededProposalIds: readonly string[];
}

/**
 * Finds every still-pending `'invoice'` proposal on `contractId` whose
 * own natural key (supplier tax id + number + year — the same comparator
 * `dedup.ts` already uses for every other invoice dedup in this
 * pipeline) matches `structuredInvoice`'s, and for each:
 *
 * - Re-owns its source PDF onto `invoiceId` (`document.ownerType`/
 *   `ownerId`) — the same "an accepted proposal's evidence becomes the
 *   invoice's own" move `repositories/proposal.ts`'s `applyProposal`
 *   makes for an ordinary Accept, just triggered by a structured document
 *   arriving instead of a human clicking the button.
 * - Marks the proposal `accepted`, with the structured document's own
 *   values as `acceptedFields` — visibly different from what the PDF
 *   proposed whenever they disagree, so `diffProposalFields` on the
 *   review screen shows exactly what the structured document corrected,
 *   the same diff #83's acceptance asks a human's own edit to produce.
 *   `resultId` points at the real invoice, never a second row.
 *
 * A pending proposal marked `accepted` this way can never afterwards be
 * accepted a second time by a human on the review screen —
 * `acceptProposal` already refuses a proposal that is not `'pending'` —
 * which is what actually prevents the duplicate invoice this function
 * exists to avoid; nothing here itself blocks a second write.
 */
export async function supersedePendingInvoiceProposals(
	contractId: string,
	structuredInvoice: Invoice,
	invoiceId: string,
	dueDate: string | null,
	accountHolderTaxId: string,
	executor: DbExecutor
): Promise<SupersessionOutcome> {
	const key = naturalInvoiceKey({
		supplier: { taxId: accountHolderTaxId },
		number: structuredInvoice.number,
		issueDate: structuredInvoice.issueDate
	});

	const pending = await executor
		.select()
		.from(proposal)
		.where(
			and(
				eq(proposal.status, 'pending'),
				eq(proposal.contractId, contractId),
				eq(proposal.targetType, 'invoice')
			)
		);

	const acceptedFields: InvoiceProposedFields = {
		number: structuredInvoice.number,
		issueDate: structuredInvoice.issueDate,
		dueDate,
		clientName: structuredInvoice.customer.legalName,
		currency: structuredInvoice.currency,
		lines: structuredInvoice.lines.map((line) => ({
			description: line.description,
			quantity: line.quantity,
			unitPrice: line.unitPrice,
			amount: line.amount,
			taxRate: line.taxRate
		})),
		taxableAmount: structuredInvoice.taxableAmount,
		taxAmount: structuredInvoice.taxAmount,
		total: structuredInvoice.total
	};

	const supersededProposalIds: string[] = [];
	for (const row of pending) {
		const fields = row.proposedFields;
		if (typeof fields.number !== 'string' || typeof fields.issueDate !== 'string') continue;
		const rowKey = naturalInvoiceKey({
			supplier: { taxId: accountHolderTaxId },
			number: fields.number,
			issueDate: fields.issueDate
		});
		if (rowKey !== key) continue;

		await executor
			.update(document)
			.set({ ownerType: 'invoice', ownerId: invoiceId })
			.where(eq(document.id, row.documentId));

		await executor
			.update(proposal)
			.set({
				status: 'accepted',
				acceptedFields: acceptedFields as unknown as Record<string, unknown>,
				resultId: invoiceId,
				decidedBy: SUPERSEDED_BY_STRUCTURED_IMPORT,
				decidedAt: new Date()
			})
			.where(eq(proposal.id, row.id));

		supersededProposalIds.push(row.id);
	}

	return { supersededProposalIds };
}
