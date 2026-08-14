import type { MinorUnits } from '$lib/money';
import { relations, sql } from 'drizzle-orm';
import {
	check,
	date,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	text,
	unique,
	uuid,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';
import type { LegalText } from '$lib/legal/legal-text';
import type { InvoiceDocumentType } from '$lib/server/import/invoice';
import { id, timestamps } from '../columns';
import { contract } from './contract';

/**
 * Mirrors `InvoiceDocumentType` in `$lib/server/import/invoice.ts` — the
 * neutral document-type vocabulary #45's importer already produces, kept
 * as one list so a future #44 mapping is a straight assignment, never a
 * translation. `satisfies` below fails the build if the two ever drift.
 */
const invoiceDocumentTypeValues = [
	'invoice',
	'advance_on_invoice',
	'advance_on_fee_note',
	'credit_note',
	'debit_note',
	'fee_note'
] as const satisfies readonly InvoiceDocumentType[];
export const invoiceDocumentType = pgEnum('invoice_document_type', invoiceDocumentTypeValues);

/**
 * Whether `due_date` was read verbatim off the document or worked out from
 * the contract's payment terms because the document did not carry one
 * (#26). `resolveDueDate` in `domain/invoice.ts` is the only place that
 * decides this; every write path goes through it.
 */
export const invoiceDueDateSource = pgEnum('invoice_due_date_source', ['document', 'computed']);
export type InvoiceDueDateSource = (typeof invoiceDueDateSource.enumValues)[number];

/**
 * Where an invoice sits in the hand-off to SdI (#261): `generated` (the
 * XML exists, nothing sent) -> `transmitted` (the self-hoster marks it
 * sent by hand, `transmissionId` recorded) -> `accepted` (ricevuta di
 * consegna / impossibilità di recapito) or `rejected` (notifica di
 * scarto). SdI's own rule is that a scarto invoice "non è mai stata
 * emessa" (docs/specs/2026-08-14-electronic-invoicing.md §3) — a
 * `rejected` invoice is excluded from revenue at the one place every
 * ledger figure reads (`fiscal/revenue.ts`'s `fetchLedgerRows`), without
 * deleting the row: invariant 4, the uploaded receipt (a `document` row)
 * is the evidence, this column the derived fact. A corrected
 * resubmission goes back to `transmitted`, never straight to `accepted`
 * — SdI still has to issue a fresh receipt against it. The accompanying
 * custom migration enforces the edges (`generated -> transmitted`,
 * `transmitted -> accepted`, `transmitted -> rejected`, `rejected ->
 * transmitted`) the same way `work_unit_enforce_state_machine` enforces
 * the day lifecycle — never an application-layer check.
 */
export const invoiceTransmissionStatus = pgEnum('invoice_transmission_status', [
	'generated',
	'transmitted',
	'accepted',
	'rejected'
]);
export type InvoiceTransmissionStatus = (typeof invoiceTransmissionStatus.enumValues)[number];

/**
 * The field set epic #3 describes, named after what a structured e-invoice
 * carries rather than after FatturaPA or any other national schema — the
 * same neutral vocabulary `$lib/server/import/invoice.ts` uses, so that
 * #44 (persisting a parsed import) is a mapping onto this table, not a
 * schema change. `contractId`, not a separate `client_id`: the client is
 * already reachable through the contract, the same choice `work_unit` and
 * `approval` make.
 *
 * `taxTreatmentCode`/`statutoryReference` are the invoice-level pair epic
 * #3 names — the common case where one rate covers the whole document.
 * `invoice_line.taxTreatmentCode` (below) carries a line's own treatment
 * for the mixed-rate case; #26 asks for tax treatment on the line
 * specifically, this column is the document-level summary alongside it,
 * not a duplicate of it. A real multi-rate e-invoice's full breakdown
 * (`InvoiceTaxSummary[]` in the import type) has nowhere to land yet; #44
 * decides whether that becomes its own child table when it lands.
 *
 * `taxableAmount`, `taxAmount` and `total` are computed server-side from
 * the lines for a manually created invoice (`repositories/invoice.ts`),
 * never typed twice by a human — but the CHECK/trigger pair in
 * `0015_invoice_constraints.sql` enforces the arithmetic at the database
 * level regardless of the write path, per #26: "make an invoice whose
 * lines do not sum to its total impossible."
 */
export const invoice = pgTable(
	'invoice',
	{
		id: id(),
		contractId: uuid('contract_id')
			.notNull()
			.references(() => contract.id, { onDelete: 'restrict' }),
		number: text('number').notNull(),
		issueDate: date('issue_date').notNull(),
		documentType: invoiceDocumentType('document_type').notNull().default('invoice'),
		// ISO 4217, matching `contract.currency`.
		currency: text('currency').notNull(),
		// All amounts are MinorUnits (integer cents) — see `import/invoice.ts`
		// and `import/decimal.ts` for why a float never carries money here.
		taxableAmount: integer('taxable_amount').$type<MinorUnits>().notNull(),
		taxAmount: integer('tax_amount').$type<MinorUnits>().notNull(),
		total: integer('total').$type<MinorUnits>().notNull(),
		taxTreatmentCode: text('tax_treatment_code'),
		statutoryReference: jsonb('statutory_reference').$type<LegalText>(),
		stampDuty: integer('stamp_duty').$type<MinorUnits>(),
		socialCharge: integer('social_charge').$type<MinorUnits>(),
		dueDate: date('due_date').notNull(),
		dueDateSource: invoiceDueDateSource('due_date_source').notNull(),
		// The document's own code, opaque here (FatturaPA's `ModalitaPagamento`) —
		// same treatment as `InvoicePaymentInstallment.method` in the import type.
		paymentMethod: text('payment_method'),
		iban: text('iban'),
		transmissionId: text('transmission_id'),
		// Defaults `generated`: every invoice starts as just-generated XML,
		// nothing sent yet. See `invoiceTransmissionStatus`'s own doc
		// comment above for the full state machine.
		transmissionStatus: invoiceTransmissionStatus('transmission_status')
			.notNull()
			.default('generated'),
		// The invoice this one corrects (#213) — set only on a `credit_note`
		// or `debit_note`, enforced by the CHECK below; which of those two
		// values `document_type` actually is on the referencing row still
		// decides the *sign* the amount takes in the ledger
		// (`fiscal/revenue.ts`'s `fetchLedgerRows`), not this column. The
		// referenced row must itself be an ordinary invoice, never another
		// correction — a cross-row read a CHECK cannot express, so that half
		// lives in `invoice_check_correction`
		// (`0042_invoice_correction_constraints.sql`) alongside the sibling
		// rule that a credit note may never exceed what it corrects.
		correctsInvoiceId: uuid('corrects_invoice_id').references((): AnyPgColumn => invoice.id, {
			onDelete: 'restrict'
		}),
		...timestamps()
	},
	(table) => [
		// Invoice numbers are unique across the whole ledger. mastro is
		// single-tenant (AGENTS.md: one fiscal profile, one issuer), so
		// "unique per issuer" and "globally unique" name the same set —
		// two invoices on different contracts cannot share a number any
		// more than two on the same one can (Art. 21, comma 2, lett. b),
		// D.P.R. 633/1972: "un numero progressivo che la identifichi in
		// modo univoco", and SdI rejects a collision on sight; #257).
		unique('invoice_number_unique').on(table.number),
		check('invoice_taxable_amount_non_negative', sql`${table.taxableAmount} >= 0`),
		check('invoice_tax_amount_non_negative', sql`${table.taxAmount} >= 0`),
		check('invoice_total_non_negative', sql`${table.total} >= 0`),
		check(
			'invoice_stamp_duty_non_negative',
			sql`${table.stampDuty} is null or ${table.stampDuty} >= 0`
		),
		check(
			'invoice_social_charge_non_negative',
			sql`${table.socialCharge} is null or ${table.socialCharge} >= 0`
		),
		check(
			'invoice_corrects_invoice_id_only_for_corrections',
			sql`${table.correctsInvoiceId} is null or ${table.documentType} in ('credit_note', 'debit_note')`
		),
		// `transmissionId` is recorded by hand the moment the self-hoster
		// marks an invoice transmitted (#261) — required from that point
		// on, never before it, so a `generated` invoice with nothing sent
		// yet is never mistaken for one that has been.
		check(
			'invoice_transmission_id_required_once_transmitted',
			sql`${table.transmissionStatus} = 'generated' or ${table.transmissionId} is not null`
		)
	]
);

/**
 * One billed line: description, quantity, unit price, line total and tax
 * treatment (#26). `amount` is kept as its own column rather than derived
 * from `quantity * unitPrice` — a real document is free to round or apply
 * a discount the two factors alone do not explain, the same reasoning
 * `Invoice.total` in the import type documents for the invoice as a whole.
 * The days it bills are read from the other side, `work_unit.invoiceLineId`,
 * the same "no column here, read from the referencing table" choice
 * `approval`'s days-covered makes.
 */
export const invoiceLine = pgTable(
	'invoice_line',
	{
		id: id(),
		invoiceId: uuid('invoice_id')
			.notNull()
			.references(() => invoice.id, { onDelete: 'cascade' }),
		description: text('description').notNull(),
		quantity: numeric('quantity', { precision: 6, scale: 2, mode: 'number' }).notNull(),
		unitPrice: integer('unit_price').$type<MinorUnits>().notNull(),
		amount: integer('amount').$type<MinorUnits>().notNull(),
		taxRate: numeric('tax_rate', { precision: 5, scale: 2, mode: 'number' }).notNull(),
		taxTreatmentCode: text('tax_treatment_code'),
		...timestamps()
	},
	(table) => [
		check('invoice_line_quantity_positive', sql`${table.quantity} > 0`),
		check('invoice_line_unit_price_non_negative', sql`${table.unitPrice} >= 0`),
		check('invoice_line_amount_non_negative', sql`${table.amount} >= 0`),
		check('invoice_line_tax_rate_range', sql`${table.taxRate} >= 0 and ${table.taxRate} <= 100`)
	]
);

export const invoiceRelations = relations(invoice, ({ one, many }) => ({
	contract: one(contract, { fields: [invoice.contractId], references: [contract.id] }),
	lines: many(invoiceLine)
}));

export const invoiceLineRelations = relations(invoiceLine, ({ one }) => ({
	invoice: one(invoice, { fields: [invoiceLine.invoiceId], references: [invoice.id] })
	// No reverse `workUnits` relation here: the FK lives on `work_unit`
	// (`invoiceLineId`, added in `work-unit.ts`) exactly like `approval`'s
	// days-covered is read from `work_unit.approvalId`, not from a column
	// or relation declared on this side — and declaring one here would
	// require importing `work-unit.ts`, which imports this file for the
	// FK, a cycle neither `approval.ts` nor `document.ts` takes on either.
}));
