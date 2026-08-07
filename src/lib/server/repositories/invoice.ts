import { asc, eq, isNull, sql } from 'drizzle-orm';
import type { LegalText } from '$lib/legal/legal-text';
import { resolveDueDate } from '$lib/server/domain/invoice';
import { db, type DbExecutor } from '$lib/server/db';
import {
	client,
	contract,
	document,
	invoice,
	invoiceLine,
	workUnit,
	type InvoiceDueDateSource,
	type TransitionActor
} from '$lib/server/db/schema';
import type { InvoiceDocumentType, MinorUnits } from '$lib/server/import/invoice';
import type { ExistingInvoiceRecord } from '$lib/server/import/dedup';
import { transitionWorkUnit } from './work-unit';

export type InvoiceLineInput = {
	description: string;
	quantity: number;
	unitPrice: MinorUnits;
	amount: MinorUnits;
	taxRate: number;
	taxTreatmentCode: string | null;
	/** Days this line bills. Each moves to `invoiced` through the existing
	 * state machine (#26) — never assigned directly to `state`. */
	workUnitIds: string[];
};

export type InvoiceInput = {
	contractId: string;
	number: string;
	issueDate: string;
	documentType: InvoiceDocumentType;
	currency: string;
	taxTreatmentCode: string | null;
	statutoryReference: LegalText | null;
	stampDuty: MinorUnits | null;
	socialCharge: MinorUnits | null;
	/** Verbatim off the document when supplied; computed from the
	 * contract's payment terms otherwise — `resolveDueDate` decides which,
	 * and the outcome's source is stored alongside it (#26). */
	dueDate: string | null;
	paymentMethod: string | null;
	iban: string | null;
	transmissionId: string | null;
	lines: InvoiceLineInput[];
};

/**
 * Creates an invoice with its lines and links each line's chosen days to
 * it, moving every one of them to `invoiced` (#26). `taxableAmount`,
 * `taxAmount` and `total` are never taken from the caller: they are summed
 * from `lines` here, so a manually entered invoice cannot help but add up
 * — the same property `0015_invoice_constraints.sql`'s deferred trigger
 * enforces at the database level for every other write path.
 *
 * One transaction: the invoice row, every line, and every day transition
 * commit together or not at all. The totals trigger is deferred to commit
 * for exactly this reason — the invoice's stated total exists before any
 * line does.
 */
export async function createInvoice(
	input: InvoiceInput,
	actor: TransitionActor,
	reason: string,
	tx?: DbExecutor
) {
	const run = async (executor: DbExecutor) => {
		const contractRow = await executor.query.contract.findFirst({
			where: eq(contract.id, input.contractId)
		});
		if (!contractRow) throw new Error(`contract ${input.contractId} not found`);

		const taxableAmount = input.lines.reduce((sum, line) => sum + line.amount, 0);
		const taxAmount = input.lines.reduce(
			(sum, line) => sum + Math.round((line.amount * line.taxRate) / 100),
			0
		);
		const total = taxableAmount + taxAmount + (input.stampDuty ?? 0) + (input.socialCharge ?? 0);

		const { dueDate, source: dueDateSource }: { dueDate: string; source: InvoiceDueDateSource } =
			resolveDueDate(contractRow.paymentTerms, input.issueDate, input.dueDate);

		const [invoiceRow] = await executor
			.insert(invoice)
			.values({
				contractId: input.contractId,
				number: input.number,
				issueDate: input.issueDate,
				documentType: input.documentType,
				currency: input.currency,
				taxableAmount,
				taxAmount,
				total,
				taxTreatmentCode: input.taxTreatmentCode,
				statutoryReference: input.statutoryReference,
				stampDuty: input.stampDuty,
				socialCharge: input.socialCharge,
				dueDate,
				dueDateSource,
				paymentMethod: input.paymentMethod,
				iban: input.iban,
				transmissionId: input.transmissionId
			})
			.returning();

		for (const line of input.lines) {
			const [lineRow] = await executor
				.insert(invoiceLine)
				.values({
					invoiceId: invoiceRow.id,
					description: line.description,
					quantity: line.quantity,
					unitPrice: line.unitPrice,
					amount: line.amount,
					taxRate: line.taxRate,
					taxTreatmentCode: line.taxTreatmentCode
				})
				.returning();

			for (const workUnitId of line.workUnitIds) {
				await transitionWorkUnit(
					workUnitId,
					{ invoiceLineId: lineRow.id, state: 'invoiced' },
					actor,
					reason,
					executor
				);
			}
		}

		return invoiceRow;
	};

	return tx ? run(tx) : db.transaction(run);
}

export async function getInvoiceWithLines(id: string) {
	const invoiceRow = await db.query.invoice.findFirst({
		where: eq(invoice.id, id),
		with: { contract: { with: { client: true } } }
	});
	if (!invoiceRow) return null;

	const rows = await db
		.select({ line: invoiceLine, day: workUnit })
		.from(invoiceLine)
		.leftJoin(workUnit, eq(workUnit.invoiceLineId, invoiceLine.id))
		.where(eq(invoiceLine.invoiceId, id))
		.orderBy(asc(invoiceLine.createdAt), asc(workUnit.date));

	const linesById = new Map<
		string,
		typeof invoiceLine.$inferSelect & { days: (typeof workUnit.$inferSelect)[] }
	>();
	for (const { line, day } of rows) {
		const existing = linesById.get(line.id) ?? { ...line, days: [] };
		if (day) existing.days.push(day);
		linesById.set(line.id, existing);
	}

	return { ...invoiceRow, lines: [...linesById.values()] };
}

/**
 * Marks an invoice paid on `paidOn` (#27) — the one column this writes.
 * Days on this invoice's lines are never bulk-transitioned to `paid` here:
 * "paid" for a day is derived from its line's invoice at read time (see
 * `routes/invoices/[id]`), not stored, exactly as #27 asks. No batch job
 * exists to keep a stored flag current because nothing stores one.
 */
export async function recordPayment(invoiceId: string, paidOn: string) {
	const [row] = await db
		.update(invoice)
		.set({ paidOn })
		.where(eq(invoice.id, invoiceId))
		.returning();
	return row;
}

/**
 * The ageing list (#29): every unpaid invoice, with its contract's title
 * and client for display, and the count of days it bills for the "days it
 * bills" link. Ordering by lateness is the caller's job
 * (`routes/invoices/+page.server.ts`), not this query's: `daysLate` is a
 * plain function over `dueDate`, not a column this query could `ORDER BY`
 * without duplicating that arithmetic in SQL.
 */
export async function listUnpaidInvoices() {
	const rows = await db
		.select({
			invoice,
			contractTitle: contract.title,
			clientLegalName: client.legalName,
			dayCount: sql<number>`count(${workUnit.id})`.mapWith(Number)
		})
		.from(invoice)
		.innerJoin(contract, eq(contract.id, invoice.contractId))
		.innerJoin(client, eq(client.id, contract.clientId))
		.leftJoin(invoiceLine, eq(invoiceLine.invoiceId, invoice.id))
		.leftJoin(workUnit, eq(workUnit.invoiceLineId, invoiceLine.id))
		.where(isNull(invoice.paidOn))
		.groupBy(invoice.id, contract.id, client.id);

	return rows;
}

/**
 * Every invoice on record, each with every content hash currently attached
 * to it — the structured document import wrote plus any PDF filed
 * alongside it — for the import pipeline's cross-run dedup (#44).
 * `contractId` is deliberately absent: the natural key an import compares
 * against is (supplier tax id, number, year), and the supplier is always
 * the account holder regardless of which contract an invoice was filed
 * under (only outgoing invoices are ever persisted), so a number reused
 * across two different clients' contracts is exactly the collision #44's
 * conflict bucket exists to catch, never a false negative this query
 * should filter away by scoping to one contract.
 *
 * Two queries rather than one join, the same shape `getInvoiceWithLines`
 * already uses for its own line/day join: an invoice with two attached
 * documents would otherwise duplicate every other column of the row once
 * per hash.
 */
export async function listInvoicesForDedup(
	executor: DbExecutor = db
): Promise<ExistingInvoiceRecord[]> {
	const invoiceRows = await executor
		.select({ id: invoice.id, number: invoice.number, issueDate: invoice.issueDate })
		.from(invoice);
	const documentRows = await executor
		.select({ invoiceId: document.ownerId, hash: document.hash })
		.from(document)
		.where(eq(document.ownerType, 'invoice'));

	const hashesByInvoiceId = new Map<string, string[]>();
	for (const row of documentRows) {
		const hashes = hashesByInvoiceId.get(row.invoiceId) ?? [];
		hashes.push(row.hash);
		hashesByInvoiceId.set(row.invoiceId, hashes);
	}

	return invoiceRows.map((row) => ({ ...row, hashes: hashesByInvoiceId.get(row.id) ?? [] }));
}
