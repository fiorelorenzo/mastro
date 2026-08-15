import type { MinorUnits } from '$lib/money';

// Client-side mirror of the JSON `/import/invoices/analyze` and
// `/import/invoices/confirm`
// responses. Deliberately not imported from `$lib/server/import/review.ts`
// or `client-match.ts`: those live under `$lib/server`, which SvelteKit
// refuses to bundle into client code, and a JSON round trip already erases
// the distinction between the two shapes — same reasoning as
// `clients/notice-channel.ts` duplicating the `notice_channel` enum instead
// of importing it from the schema. `MinorUnits` is the exception it can
// import, and the reason `$lib/money` sits outside `$lib/server`: the
// mirror has to agree with the server about which of these numbers are
// money, or the brand stops at the network boundary and the formatter
// guard stops with it.

export interface InvoiceSummary {
	readonly number: string;
	readonly issueDate: string;
	readonly customerLegalName: string;
	readonly customerTaxId: string;
	readonly total: MinorUnits;
	readonly currency: string;
}

export type SkipReason =
	| { readonly kind: 'unrecognised_format' }
	| { readonly kind: 'malformed_document'; readonly message: string }
	| {
			readonly kind: 'incoming_invoice';
			readonly reason: {
				readonly supplierTaxId: string;
				readonly accountHolderTaxId: string;
			};
	  }
	| { readonly kind: 'ambiguous_contract'; readonly clientLegalName: string };

export interface SkippedFile {
	readonly filename: string;
	/** See `RecognisedFile` in the server-side `review.ts`: distinguishes
	 * more than one invoice a FatturaPA batch (lotto) file can produce
	 * from one file (#101). */
	readonly invoiceIndex: number;
	readonly reason: SkipReason;
}

/** #48: a proposed set of already-recorded days a line billed, with the
 * reasoning (period, count, amount) the acceptance criteria asks to be
 * visible — never applied until the reviewer confirms it. */
export interface DayMappingProposal {
	readonly workUnitIds: readonly string[];
	readonly periodStart: string;
	readonly periodEnd: string;
	readonly dayCount: number;
	readonly proposedAmount: MinorUnits;
	readonly lineAmount: MinorUnits;
	readonly amountMatches: boolean;
}

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
	/** See `RecognisedFile` in the server-side `review.ts`: distinguishes
	 * more than one invoice a FatturaPA batch (lotto) file can produce
	 * from one file (#101). */
	readonly invoiceIndex: number;
	readonly invoice: InvoiceSummary;
	readonly lines: readonly InvoiceLineView[];
	readonly clientId: string;
	readonly clientLegalName: string;
	readonly contractId: string;
	readonly attachments: readonly string[];
}

export type AlreadyPresentSource = 'batch' | 'database';

export interface AlreadyPresentFile {
	readonly filename: string;
	/** See `RecognisedFile`. */
	readonly invoiceIndex: number;
	readonly invoice: InvoiceSummary;
	readonly source: AlreadyPresentSource;
	readonly duplicateOfFilename: string | null;
	readonly existingInvoiceNumber: string | null;
	readonly attachments: readonly string[];
}

export interface ConflictFile {
	readonly filename: string;
	/** See `RecognisedFile`. */
	readonly invoiceIndex: number;
	readonly invoice: InvoiceSummary;
	readonly existingInvoiceNumber: string;
	readonly existingIssueDate: string;
}

export type InvoicingCadence = 'monthly' | 'quarterly' | 'annual' | 'on_completion';

export interface ClientProposal {
	legalName: string;
	taxId: string;
	vatId: string | null;
	country: string;
	addressLine1: string;
	addressLine2: string | null;
	addressCity: string;
	addressPostalCode: string;
	addressRegion: string | null;
	noticeChannel: string;
}

export interface ContractProposal {
	title: string;
	signedDocumentReference: null;
	startsOn: string;
	endsOn: null;
	renewalType: 'none';
	renewalNoticeDays: null;
	paymentTerms: { kind: 'net'; days: number };
	invoicingCadence: InvoicingCadence;
	currency: string;
	taxTreatment: string;
	terminationNoticeDays: number;
	requiresPriorApproval: boolean;
	expensePolicy: { kind: 'not_reimbursed' };
	status: 'active';
}

export interface ClarificationGroup {
	readonly groupKey: string;
	readonly files: readonly {
		readonly filename: string;
		/** See `RecognisedFile`. */
		readonly invoiceIndex: number;
		readonly invoice: InvoiceSummary;
	}[];
	client: ClientProposal;
	contract: ContractProposal;
	readonly observedRecurringAmount: MinorUnits;
	readonly observedCadence: InvoicingCadence;
}

export interface ReviewResult {
	readonly recognised: readonly RecognisedFile[];
	readonly alreadyPresent: readonly AlreadyPresentFile[];
	readonly conflicts: readonly ConflictFile[];
	readonly clarifications: readonly ClarificationGroup[];
	readonly skipped: readonly SkippedFile[];
}

export interface ConfirmResponse {
	readonly created: readonly {
		readonly groupKey: string;
		readonly clientId: string;
		readonly contractId: string;
	}[];
	readonly failed: readonly { readonly groupKey: string; readonly message: string }[];
	readonly invoicesCreated: readonly { readonly filename: string; readonly invoiceId: string }[];
	readonly invoicesAlreadyPresent: readonly { readonly filename: string }[];
	readonly invoicesConflicted: readonly {
		readonly filename: string;
		readonly existingInvoiceNumber: string;
	}[];
	/** `invoiceIndex` distinguishes two failures against the same
	 * `filename` — a FatturaPA batch file (#101) whose bodies each failed
	 * independently. */
	readonly invoicesFailed: readonly {
		readonly filename: string;
		readonly invoiceIndex: number;
		readonly message: string;
	}[];
}
