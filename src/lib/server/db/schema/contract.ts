import { relations } from 'drizzle-orm';
import {
	boolean,
	date,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	uuid,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { client } from './client';
// Circular at the type level with document.ts (document.contractId points
// back here): safe because drizzle's `.references(() => document.id)`
// below is a closure, only invoked after both modules finish evaluating,
// never at import time.
import { document } from './document';

export const contractRenewalType = pgEnum('contract_renewal_type', [
	'none',
	'explicit',
	'counterparty_option',
	'tacit'
]);
export type ContractRenewalType = (typeof contractRenewalType.enumValues)[number];

/**
 * The language templates for this contract render in (#69), independent of
 * whoever is signed in and what they have their interface set to: the
 * interface language is a preference of the person using mastro, the
 * language a client is written to is a property of the contract. Values
 * mirror `project.inlang/settings.json`'s `locales` exactly —
 * `contract.test.ts` asserts the two never drift apart, the same way
 * `messages.test.ts` guards the message catalogues. Defaults to the
 * interface's own base locale (`'en'`) only because nothing here can ask a
 * human at insert time (an import confirmation, a test fixture); every real
 * contract should have this set deliberately, on the mail hub screen where
 * it lives today (`setContractTemplateLanguage`).
 */
export const contractTemplateLanguage = pgEnum('contract_template_language', ['en', 'it']);
export type ContractTemplateLanguage = (typeof contractTemplateLanguage.enumValues)[number];

/** How often the contract is invoiced, independent of how a rate card's own
 * `disbursementPeriod` splits a recurring fee. */
export const invoicingCadence = pgEnum('invoicing_cadence', [
	'monthly',
	'quarterly',
	'annual',
	'on_completion'
]);
export type InvoicingCadence = (typeof invoicingCadence.enumValues)[number];

export const contractStatus = pgEnum('contract_status', [
	'draft',
	'active',
	'terminated',
	'expired'
]);
export type ContractStatus = (typeof contractStatus.enumValues)[number];

/**
 * Discriminated union, spelled out in issue #18. `monthOffset` is fixed at
 * `1` (payable the following month) because that is the only shape either
 * founding archetype needs; extending it to other offsets is a schema
 * change for whoever needs it, not a speculative field today.
 */
export type PaymentTerms =
	{ kind: 'net'; days: number } | { kind: 'day_of_month'; day: number; monthOffset: 1 };

/**
 * Not specified further by the issue; decided here. A closed set mirroring
 * `PaymentTerms`'s shape: whether expenses are reimbursed at all, and if so
 * whether there is a cap. Receipts and the expense ledger itself are
 * `expense`, out of scope for this issue.
 */
export type ExpensePolicy =
	| { kind: 'not_reimbursed' }
	| { kind: 'reimbursed_at_cost' }
	| { kind: 'reimbursed_with_cap'; capAmount: number };

/**
 * The contract is the shape most of the domain's difficulty lives in. Two
 * fields are deliberately opaque here and interpreted only elsewhere:
 * `taxTreatment` is a code resolved against the active jurisdiction pack
 * (invariant 1 — no country-specific logic here, not even a lookup table),
 * and `signedDocumentReference` is a placeholder reference until the
 * `document` table (out of scope for this issue) exists to point at.
 */
export const contract = pgTable('contract', {
	id: id(),
	clientId: uuid('client_id')
		.notNull()
		.references(() => client.id, { onDelete: 'restrict' }),
	title: text('title').notNull(),
	signedDocumentReference: text('signed_document_reference'),
	startsOn: date('starts_on').notNull(),
	endsOn: date('ends_on'),
	renewalType: contractRenewalType('renewal_type').notNull(),
	// Applicable, and required, for every renewal type except 'none'. See
	// the custom migration for the CHECK constraint that enforces this.
	renewalNoticeDays: integer('renewal_notice_days'),
	// Notice required to terminate early, regardless of renewal type. Feeds
	// the forecast's irrevocability window later.
	terminationNoticeDays: integer('termination_notice_days').notNull(),
	paymentTerms: jsonb('payment_terms').$type<PaymentTerms>().notNull(),
	invoicingCadence: invoicingCadence('invoicing_cadence').notNull(),
	// ISO 4217, e.g. 'EUR'.
	currency: text('currency').notNull(),
	// Opaque: resolved against the active jurisdiction pack, never
	// interpreted here.
	taxTreatment: text('tax_treatment').notNull(),
	requiresPriorApproval: boolean('requires_prior_approval').notNull().default(false),
	// Whether a draft produced by a non-manual email_template trigger (#71)
	// goes out unattended. Per-contract, not per-template, because it
	// follows the counterparty relationship (invariant 2): off by default,
	// so a new contract never emails a client without a human looking at
	// the message first (#72). The manual trigger always requires the
	// explicit send action regardless of this flag.
	autoSendMail: boolean('auto_send_mail').notNull().default(false),
	// The language every email_template renders in for this contract
	// (#69) — never the signed-in operator's interface locale. See
	// `contractTemplateLanguage`'s own doc comment above.
	templateLanguage: contractTemplateLanguage('template_language').notNull().default('en'),
	// The IMAP folder or label (#84) new approval mail for this contract
	// is filed under, in the same account `IMAP_HOST`/`IMAP_USER` already
	// authenticate to (`mail/config.ts`) — a mailbox concern, not a
	// commercial one, grouped here next to `templateLanguage` for the
	// same reason `autoSendMail` is. Null means "not polled", the default
	// for every contract until an operator sets one from the mail hub
	// (`setContractMailFolder`, `/mail/contracts/[id]`); at most one
	// contract may claim a given folder (`contract_mail_folder_key` in
	// the accompanying custom migration) so a message never has two
	// candidate contracts to be handed off under.
	mailFolder: text('mail_folder'),
	expensePolicy: jsonb('expense_policy').$type<ExpensePolicy>().notNull(),
	// Whether an expense on this contract needs written pre-authorisation
	// to be reimbursable, independent of `requiresPriorApproval` (days) —
	// a contract can require one, the other, both or neither. Read by the
	// `expense` table's own trigger (#28's custom migration), which flags
	// an expense non-reimbursable rather than rejecting it, the same way
	// an unapproved day becomes `worked_without_approval` rather than
	// being rejected outright.
	requiresExpensePreAuthorisation: boolean('requires_expense_pre_authorisation')
		.notNull()
		.default(false),
	status: contractStatus('status').notNull().default('draft'),
	/**
	 * A human's evidence (#81, #82) that this contract's client consented
	 * in writing to route documents to a named hosted extraction provider
	 * — never a bare boolean: the accompanying custom migration's trigger
	 * rejects any value that does not point at a `document` archived with
	 * `ownerType: 'contract', ownerId: <this contract>`, the same
	 * evidentiary shape every other piece of proof in this system carries
	 * (invariant 4). Null, the default and every contract's starting
	 * state, means local-only: the ACP runner (#82) reads this column to
	 * decide, and refuses a hosted call outright when it is null rather
	 * than falling back to it. Set only by a human, through
	 * `setHostedExtractionConsentDocument` in `repositories/contract.ts`
	 * — the runner's own database role has no write grant on this table
	 * at all, let alone this column.
	 */
	hostedExtractionConsentDocumentId: uuid('hosted_extraction_consent_document_id').references(
		(): AnyPgColumn => document.id,
		{ onDelete: 'restrict' }
	),
	...timestamps()
});

export const contractRelations = relations(contract, ({ one }) => ({
	client: one(client, { fields: [contract.clientId], references: [client.id] }),
	hostedExtractionConsentDocument: one(document, {
		fields: [contract.hostedExtractionConsentDocumentId],
		references: [document.id]
	})
}));
