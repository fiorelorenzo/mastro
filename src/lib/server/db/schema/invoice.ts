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
	uuid
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
		taxableAmount: integer('taxable_amount').notNull(),
		taxAmount: integer('tax_amount').notNull(),
		total: integer('total').notNull(),
		taxTreatmentCode: text('tax_treatment_code'),
		statutoryReference: jsonb('statutory_reference').$type<LegalText>(),
		stampDuty: integer('stamp_duty'),
		socialCharge: integer('social_charge'),
		dueDate: date('due_date').notNull(),
		dueDateSource: invoiceDueDateSource('due_date_source').notNull(),
		// The document's own code, opaque here (FatturaPA's `ModalitaPagamento`) —
		// same treatment as `InvoicePaymentInstallment.method` in the import type.
		paymentMethod: text('payment_method'),
		iban: text('iban'),
		transmissionId: text('transmission_id'),
		// Human input, never present on any imported document (epic #3) —
		// the one field the product exists to make effortless to keep current.
		paidOn: date('paid_on'),
		...timestamps()
	},
	(table) => [
		// Invoice numbers are unique per issuer's own series, not globally.
		unique('invoice_contract_number_unique').on(table.contractId, table.number),
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
		unitPrice: integer('unit_price').notNull(),
		amount: integer('amount').notNull(),
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
