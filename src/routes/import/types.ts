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
	  };

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

export interface AlreadyPresentFile {
	readonly filename: string;
	readonly invoice: InvoiceSummary;
	readonly duplicateOfFilename: string;
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
}
