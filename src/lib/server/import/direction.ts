// Direction detection (#45): whether a parsed invoice represents money
// coming in (an outgoing invoice, revenue) or an invoice from a supplier
// (incoming, never revenue). The only signal is the supplier's tax id
// against the account holder's own, from configuration — see
// `config.ts` for where that comes from, and the note on
// `InvoiceTransmission` in `invoice.ts` for the trap this issue exists to
// avoid: when an invoicing service transmits on the account holder's
// behalf, the *transmitter* is the service, and the account holder appears
// only as the invoice's `supplier`.

import type { Invoice } from './invoice';

export interface IncomingInvoiceReason {
	readonly kind: 'supplier_is_not_account_holder';
	readonly supplierTaxId: string;
	readonly accountHolderTaxId: string;
}

export type InvoiceDirection =
	| { readonly kind: 'outgoing' }
	| { readonly kind: 'incoming'; readonly reason: IncomingInvoiceReason };

/** Tax ids are conventionally uppercase but a document is free to transmit
 * them however its issuer typed them; exported so client matching (#46)
 * compares the same way direction detection does. */
export function normalizedTaxId(taxId: string): string {
	return taxId.trim().toUpperCase();
}

/**
 * Compares `supplierTaxId` against `accountHolderTaxId`. Equal (ignoring
 * case and surrounding whitespace, since tax ids are conventionally
 * uppercase but a document is free to transmit them however its issuer
 * typed them) means the account holder issued this invoice: outgoing,
 * revenue. Anything else means somebody else issued it: incoming, and the
 * caller must not treat it as revenue.
 */
export function classifyDirection(
	supplierTaxId: string,
	accountHolderTaxId: string
): InvoiceDirection {
	if (normalizedTaxId(supplierTaxId) === normalizedTaxId(accountHolderTaxId)) {
		return { kind: 'outgoing' };
	}
	return {
		kind: 'incoming',
		reason: { kind: 'supplier_is_not_account_holder', supplierTaxId, accountHolderTaxId }
	};
}

export type ImportedInvoiceOutcome =
	| { readonly kind: 'outgoing'; readonly invoice: Invoice }
	| {
			readonly kind: 'incoming_skipped';
			readonly invoice: Invoice;
			readonly reason: IncomingInvoiceReason;
	  };

/**
 * Classifies a fully parsed invoice by direction, reading `invoice.supplier
 * .taxId` — never `invoice.transmission` (see the module comment above).
 */
export function classifyImportedInvoice(
	invoice: Invoice,
	accountHolderTaxId: string
): ImportedInvoiceOutcome {
	const direction = classifyDirection(invoice.supplier.taxId, accountHolderTaxId);
	return direction.kind === 'outgoing'
		? { kind: 'outgoing', invoice }
		: { kind: 'incoming_skipped', invoice, reason: direction.reason };
}

/**
 * The invoices that may contribute to a revenue total: outgoing only. This
 * is the one function anything computing a revenue figure over imported
 * invoices should call. Re-deriving the same `kind === 'outgoing'` filter
 * at each call site is exactly how the bug #45 exists to prevent comes
 * back — one call site that forgets it is enough to inflate the ceiling
 * figure the whole product exists to protect.
 */
export function revenueEligibleInvoices(
	outcomes: readonly ImportedInvoiceOutcome[]
): readonly Invoice[] {
	return outcomes
		.filter(
			(outcome): outcome is Extract<ImportedInvoiceOutcome, { kind: 'outgoing' }> =>
				outcome.kind === 'outgoing'
		)
		.map((outcome) => outcome.invoice);
}
