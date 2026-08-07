import { relations } from 'drizzle-orm';
import { boolean, date, integer, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { client } from './client';

export const contractRenewalType = pgEnum('contract_renewal_type', [
	'none',
	'explicit',
	'counterparty_option',
	'tacit'
]);
export type ContractRenewalType = (typeof contractRenewalType.enumValues)[number];

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
	expensePolicy: jsonb('expense_policy').$type<ExpensePolicy>().notNull(),
	status: contractStatus('status').notNull().default('draft'),
	...timestamps()
});

export const contractRelations = relations(contract, ({ one }) => ({
	client: one(client, { fields: [contract.clientId], references: [client.id] })
}));
