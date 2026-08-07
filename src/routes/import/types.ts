// Client-side mirror of the JSON `/import/analyze` and `/import/confirm`
// responses. Deliberately not imported from `$lib/server/import/review.ts`
// or `client-match.ts`: those live under `$lib/server`, which SvelteKit
// refuses to bundle into client code, and a JSON round trip already erases
// the distinction between the two shapes — same reasoning as
// `clients/notice-channel.ts` duplicating the `notice_channel` enum instead
// of importing it from the schema.

export interface InvoiceSummary {
	readonly number: string;
	readonly issueDate: string;
	readonly customerLegalName: string;
	readonly customerTaxId: string;
	readonly total: number;
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
	readonly proposedAmount: number;
	readonly lineAmount: number;
	readonly amountMatches: boolean;
}

export interface InvoiceLineView {
	readonly description: string;
	readonly quantity: number;
	readonly unitPrice: number;
	readonly amount: number;
	readonly taxRate: number;
	readonly dayMapping: DayMappingProposal | null;
}

export interface RecognisedFile {
	readonly filename: string;
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
	readonly invoice: InvoiceSummary;
	readonly source: AlreadyPresentSource;
	readonly duplicateOfFilename: string | null;
	readonly existingInvoiceNumber: string | null;
	readonly attachments: readonly string[];
}

export interface ConflictFile {
	readonly filename: string;
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
	readonly files: readonly { readonly filename: string; readonly invoice: InvoiceSummary }[];
	client: ClientProposal;
	contract: ContractProposal;
	readonly observedRecurringAmount: number;
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
	readonly invoicesFailed: readonly { readonly filename: string; readonly message: string }[];
}
