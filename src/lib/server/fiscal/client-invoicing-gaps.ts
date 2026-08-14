/**
 * What a client is still missing before an invoice for it can become the
 * document its jurisdiction requires.
 *
 * A client needs a legal name and a country to exist (migration 0056): the
 * rest is optional at creation because demanding it up front only ever
 * produced invented values, and an invented address travels onto an
 * invoice. The requirement did not disappear, it moved here — to the point
 * where it is actually true, so the screen that cannot proceed says which
 * field it needs instead of a form refusing to record a name.
 *
 * Three readers, one answer: the invoice's own "generate" action (disabled
 * with the reason), the client screen (a completion state, the shape
 * `practice_profile` already uses), and the generator itself, which throws
 * naming the field as the last net rather than the first. A generator that
 * trusted its caller would emit an invalid document.
 *
 * Invariant 1: this asks the pack whether it declares an invoice format at
 * all and reads nothing country-specific. An instance on the `generic`
 * pack reports no gaps, because it has no national format to satisfy.
 */
import type { FiscalPack } from './pack';

/** The client fields a national invoice format needs filled in. Names, not
 * sentences: the caller turns each into copy through the same message keys
 * the client form already labels these fields with, so the two can never
 * drift into saying different things about the same field. */
export const CLIENT_INVOICING_FIELDS = [
	'taxId',
	'addressLine1',
	'addressCity',
	'addressPostalCode'
] as const;

export type ClientInvoicingField = (typeof CLIENT_INVOICING_FIELDS)[number];

/** Only what this function reads, so a caller can pass a full row or a
 * projection and neither has to know which columns matter. */
export type InvoiceableClient = {
	readonly taxId: string | null;
	readonly addressLine1: string | null;
	readonly addressCity: string | null;
	readonly addressPostalCode: string | null;
};

/**
 * The fields `client` is missing, in the order the client form shows them.
 * Empty when the pack declares no invoice format — there is nothing to be
 * incomplete against — and empty when every field is filled.
 *
 * A blank string counts as missing. A column can hold `''` (nothing stops
 * it) and a document built from one would carry an empty `Denominazione`
 * or `CAP`, which is a worse failure than a missing one because it looks
 * deliberate.
 */
export function clientInvoicingGaps(
	client: InvoiceableClient,
	pack: Pick<FiscalPack, 'formats'>
): readonly ClientInvoicingField[] {
	if (pack.formats.length === 0) return [];
	return CLIENT_INVOICING_FIELDS.filter((field) => (client[field] ?? '').trim() === '');
}

/** Whether an invoice for this client can be generated as its jurisdiction
 * requires. The negation reads badly at call sites (`!gaps.length`), and
 * this is the question every one of them is actually asking. */
export function isClientInvoiceable(
	client: InvoiceableClient,
	pack: Pick<FiscalPack, 'formats'>
): boolean {
	return clientInvoicingGaps(client, pack).length === 0;
}
