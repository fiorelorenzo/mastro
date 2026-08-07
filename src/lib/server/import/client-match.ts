// Client matching and contract proposal (#46). Matching is exact-tax-id
// lookup against the clients already on record; when nothing matches, this
// builds a proposal — never a write, per invariant 3 ("agents propose,
// humans confirm") — from whatever the invoice(s) for that customer reveal.
// `review.ts` is the only caller: it decides which invoices are unmatched
// and groups them by customer before calling `buildClientContractProposal`
// once per customer, not once per file, so three invoices from one new
// customer produce one proposal to accept, not three.

import type { ExpensePolicy, InvoicingCadence, PaymentTerms } from '$lib/server/db/schema/contract';
import type { NoticeChannel } from '$lib/server/db/schema/client';
import { normalizedTaxId } from './direction';
import type { Invoice, InvoiceParty, MinorUnits } from './invoice';

export interface ClientMatchCandidate {
	readonly id: string;
	readonly taxId: string;
	readonly legalName: string;
	/** The one contract an imported invoice for this client can be filed
	 * against without asking, computed by the caller (#44): the client's
	 * sole `active` contract, or `null` when there is none or more than
	 * one. A client with several active contracts is a genuine ambiguity —
	 * nothing on an invoice document says which engagement it belongs to —
	 * so `review.ts` leaves a file with no resolvable contract unimported
	 * rather than guessing one, the same restraint direction detection
	 * already applies to an incoming invoice. */
	readonly activeContractId: string | null;
}

/** Exact match on tax id, the only signal #46 asks for — case and
 * surrounding whitespace insensitive, same as direction detection. */
export function matchClientByTaxId(
	customer: Pick<InvoiceParty, 'taxId'>,
	clients: readonly ClientMatchCandidate[]
): ClientMatchCandidate | null {
	const target = normalizedTaxId(customer.taxId);
	return clients.find((candidate) => normalizedTaxId(candidate.taxId) === target) ?? null;
}

export interface ClientProposal {
	readonly legalName: string;
	readonly taxId: string;
	readonly vatId: string | null;
	readonly country: string;
	readonly addressLine1: string;
	readonly addressLine2: string | null;
	readonly addressCity: string;
	readonly addressPostalCode: string;
	readonly addressRegion: string | null;
	/** An invoice reveals nothing about how this client prefers to receive
	 * a legal notice (renewal refusal, termination) — `'email'` is the
	 * least-friction default among the options `noticeChannel` allows and
	 * requires no address/detail beyond one already on the invoice; the
	 * user corrects it on the client's own edit screen if it is wrong. */
	readonly noticeChannel: NoticeChannel;
}

export interface ContractProposal {
	readonly title: string;
	readonly signedDocumentReference: null;
	/** ISO date. */
	readonly startsOn: string;
	/** No recurrence contract can be inferred from an invoice alone —
	 * `'none'` is the only default that does not silently invent a renewal
	 * clause nobody agreed to; the user sets a real one on the contract's
	 * own edit screen once the proposal is accepted. */
	readonly endsOn: null;
	readonly renewalType: 'none';
	readonly renewalNoticeDays: null;
	readonly paymentTerms: PaymentTerms;
	readonly invoicingCadence: InvoicingCadence;
	/** ISO 4217. */
	readonly currency: string;
	/**
	 * Opaque, exactly as it is on the `contract` row itself (see
	 * `db/schema/contract.ts`) — copied verbatim from the invoice's own
	 * `taxSummary[].taxTreatmentCode` when the document carries one, never
	 * interpreted or guessed at here (that would be exactly the
	 * country-specific branching invariant 1 forbids). Most standard-rate
	 * invoices carry no such code (see `InvoiceTaxSummary` in `invoice.ts`:
	 * FatturaPA only requires it for a zero rate), so this is routinely
	 * empty and left for the user to complete before the contract is used
	 * by the ceiling engine — the review screen flags an empty value.
	 */
	readonly taxTreatment: string;
	readonly terminationNoticeDays: number;
	readonly requiresPriorApproval: boolean;
	readonly expensePolicy: ExpensePolicy;
	/** The invoices being imported already happened, so the proposed
	 * contract is proposed `active`, not `draft` — a professional importing
	 * three years of real invoicing history is not drafting anything. */
	readonly status: 'active';
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(from: string, to: string): number {
	return Math.round(
		(new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
			MILLISECONDS_PER_DAY
	);
}

/** `net <n>` from the invoice's own first payment instalment when it has
 * one; a document with no payment-terms block at all (legal, per
 * `InvoicePaymentTerms` on `Invoice`) falls back to net 30 rather than
 * leaving the required field unset. */
function inferPaymentTerms(invoice: Invoice): PaymentTerms {
	const firstInstallment = invoice.paymentTerms[0]?.installments[0];
	if (!firstInstallment) return { kind: 'net', days: 30 };
	const days = daysBetween(invoice.issueDate, firstInstallment.dueDate);
	return { kind: 'net', days: days > 0 ? days : 30 };
}

/**
 * A cadence guess from how far apart this customer's invoices in the
 * current batch actually fall — the only recurrence evidence available
 * without a persisted invoice history (see the module comment on
 * `dedup.ts` for the same limitation applied to dedup). A single invoice
 * carries no recurrence evidence at all, so it proposes `on_completion`
 * rather than guessing monthly; the user is expected to correct this on
 * the review screen for a customer they know is actually recurring.
 */
export function inferInvoicingCadence(issueDates: readonly string[]): InvoicingCadence {
	if (issueDates.length < 2) return 'on_completion';
	const sorted = [...issueDates].toSorted();
	const gaps = sorted.slice(1).map((date, i) => daysBetween(sorted[i], date));
	const averageGapDays = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
	if (averageGapDays <= 45) return 'monthly';
	if (averageGapDays <= 135) return 'quarterly';
	return 'annual';
}

export interface ClientContractProposal {
	readonly client: ClientProposal;
	readonly contract: ContractProposal;
	/** The average invoice total observed for this customer in the batch —
	 * shown to the user as the "recurring amount" the proposal is based on
	 * (per #46's acceptance). Not itself persisted: pricing lives on a
	 * `rate_card`, which is out of scope for this wave (see the PR
	 * description) — only `client` and `contract` are written on confirm. */
	readonly observedRecurringAmount: MinorUnits;
	readonly observedCadence: InvoicingCadence;
}

/** Builds one client-and-contract proposal from every invoice found for one
 * unmatched customer in the batch. `invoices` must be non-empty and must
 * all share the same `customer.taxId` — `review.ts` guarantees both by
 * construction (it groups by that key before calling this). */
export function buildClientContractProposal(invoices: readonly Invoice[]): ClientContractProposal {
	const customer = invoices[0].customer;
	const earliest = invoices.toSorted((a, b) => (a.issueDate < b.issueDate ? -1 : 1))[0];
	const cadence = inferInvoicingCadence(invoices.map((invoice) => invoice.issueDate));
	const observedRecurringAmount = Math.round(
		invoices.reduce((sum, invoice) => sum + invoice.total, 0) / invoices.length
	);

	return {
		client: {
			legalName: customer.legalName,
			taxId: customer.taxId,
			vatId: null,
			country: customer.country,
			addressLine1: customer.addressLine1,
			addressLine2: customer.addressLine2 ?? null,
			addressCity: customer.addressCity,
			addressPostalCode: customer.addressPostalCode,
			addressRegion: customer.addressRegion ?? null,
			noticeChannel: 'email'
		},
		contract: {
			title: customer.legalName,
			signedDocumentReference: null,
			startsOn: earliest.issueDate,
			endsOn: null,
			renewalType: 'none',
			renewalNoticeDays: null,
			paymentTerms: inferPaymentTerms(earliest),
			invoicingCadence: cadence,
			currency: earliest.currency,
			taxTreatment: earliest.taxSummary[0]?.taxTreatmentCode ?? '',
			terminationNoticeDays: 0,
			requiresPriorApproval: false,
			expensePolicy: { kind: 'not_reimbursed' },
			status: 'active'
		},
		observedRecurringAmount,
		observedCadence: cadence
	};
}
