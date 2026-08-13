import { and, asc, desc, eq, notInArray, sql } from 'drizzle-orm';
import type { LegalText } from '$lib/legal/legal-text';
import { resolveDueDate } from '$lib/server/domain/invoice';
import { db, type DbExecutor } from '$lib/server/db';
import {
	client,
	contract,
	document,
	expense,
	invoice,
	invoiceLine,
	workUnit,
	type InvoiceDueDateSource,
	type TransitionActor
} from '$lib/server/db/schema';
import {
	addMinorUnits,
	NO_MINOR_UNITS,
	scaleMinorUnits,
	sumMinorUnits,
	type MinorUnits
} from '$lib/money';
import type { InvoiceDocumentType } from '$lib/server/import/invoice';
import type { ExistingInvoiceRecord } from '$lib/server/import/dedup';
import { listDocumentsForOwner } from './document';
import { rebillExpense } from './expense';
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
	/** Expenses this line rebills (#217) — each moves to rebilled through
	 * `rebillExpense`, the same "assign through the existing mechanism,
	 * never a second one" choice `workUnitIds` already makes. Optional,
	 * defaulting to none: every pre-existing caller that never rebills an
	 * expense through a line (the importer, every alert/ceiling/revenue
	 * fixture that only needs an invoice to exist) is unaffected.
	 * `routes/invoices/new` is the one caller that always supplies it. */
	expenseIds?: string[];
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
	/** The invoice this one corrects (#213) — set only for `credit_note`/
	 * `debit_note`, enforced by `invoice_corrects_invoice_id_only_for_corrections`
	 * and (for the cross-row half) `invoice_check_correction`
	 * (`0042`/`0043_invoice_correction_constraints.sql`). Optional,
	 * defaulting to `null`: every pre-existing caller that never issues a
	 * correction (the importer, every ledger/ceiling/revenue fixture that
	 * only needs an ordinary invoice) is unaffected — the same choice
	 * `InvoiceLineInput.expenseIds` already makes. */
	correctsInvoiceId?: string | null;
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

		const taxableAmount = sumMinorUnits(input.lines.map((line) => line.amount));
		const taxAmount = sumMinorUnits(
			input.lines.map((line) => scaleMinorUnits(line.amount, line.taxRate / 100))
		);
		const total = addMinorUnits(
			taxableAmount,
			taxAmount,
			input.stampDuty ?? NO_MINOR_UNITS,
			input.socialCharge ?? NO_MINOR_UNITS
		);

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
				transmissionId: input.transmissionId,
				correctsInvoiceId: input.correctsInvoiceId ?? null
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

			for (const expenseId of line.expenseIds ?? []) {
				await rebillExpense(expenseId, lineRow.id, executor);
			}
		}

		return invoiceRow;
	};

	return tx ? run(tx) : db.transaction(run);
}

export async function getInvoiceWithLines(id: string, executor: DbExecutor = db) {
	const invoiceRow = await executor.query.invoice.findFirst({
		where: eq(invoice.id, id),
		with: { contract: { with: { client: true } } }
	});
	if (!invoiceRow) return null;

	// Days and rebilled expenses are fetched as two separate left joins,
	// not one combined query: a line can carry several of each, and
	// joining both against `invoice_line` in a single query would produce
	// their cartesian product per line instead of two independent lists.
	const dayRows = await executor
		.select({ line: invoiceLine, day: workUnit })
		.from(invoiceLine)
		.leftJoin(workUnit, eq(workUnit.invoiceLineId, invoiceLine.id))
		.where(eq(invoiceLine.invoiceId, id))
		.orderBy(asc(invoiceLine.createdAt), asc(workUnit.date));

	const expenseRows = await executor
		.select({ line: invoiceLine, expense })
		.from(invoiceLine)
		.leftJoin(expense, eq(expense.invoiceLineId, invoiceLine.id))
		.where(eq(invoiceLine.invoiceId, id))
		.orderBy(asc(invoiceLine.createdAt), asc(expense.date));

	const linesById = new Map<
		string,
		typeof invoiceLine.$inferSelect & {
			days: (typeof workUnit.$inferSelect)[];
			expenses: (typeof expense.$inferSelect)[];
		}
	>();
	for (const { line, day } of dayRows) {
		const existing = linesById.get(line.id) ?? { ...line, days: [], expenses: [] };
		if (day) existing.days.push(day);
		linesById.set(line.id, existing);
	}
	for (const { line, expense: expenseRow } of expenseRows) {
		const existing = linesById.get(line.id) ?? { ...line, days: [], expenses: [] };
		if (expenseRow) existing.expenses.push(expenseRow);
		linesById.set(line.id, existing);
	}

	return { ...invoiceRow, lines: [...linesById.values()] };
}

/** Every document archived against this invoice — for an import, the
 *  structured original plus any attachments alongside it (`persist.ts`
 *  stores each as its own row, same `ownerType: 'invoice'`); for a
 *  hand-entered invoice, none (#215's "the archived original of an
 *  imported invoice"). */
export async function getInvoiceDocuments(id: string, executor: DbExecutor = db) {
	return listDocumentsForOwner('invoice', id, executor);
}

/**
 * Marks an invoice paid on `paidOn` (#27) — the one column this writes.
 * Days on this invoice's lines are never bulk-transitioned to `paid` here:
 * "paid" for a day is derived from its line's invoice at read time (see
 * `routes/invoices/[id]`), not stored, exactly as #27 asks. No batch job
 * exists to keep a stored flag current because nothing stores one.
 */
export async function recordPayment(invoiceId: string, paidOn: string, executor: DbExecutor = db) {
	const [row] = await executor
		.update(invoice)
		.set({ paidOn })
		.where(eq(invoice.id, invoiceId))
		.returning();
	return row;
}

/** One row of {@link listInvoices}/{@link listUnpaidInvoices} — named here,
 *  the module that owns the query, rather than left for callers to derive
 *  with `ReturnType`, so the ageing list's loader (`routes/invoices/
 *  +page.server.ts`) has a real type to extend with its own `daysLate`/
 *  `overdue`. */
export interface InvoiceListRow {
	invoice: typeof invoice.$inferSelect;
	contractTitle: string;
	clientLegalName: string;
	dayCount: number;
}

/**
 * Every invoice on record, paid or not, with its contract's title and
 * client for display, and the count of days it bills for the "days it
 * bills" link (#238's "every invoice in the instance is reachable from the
 * interface" — `listUnpaidInvoices` used to be the only query this page
 * ran, so a paid invoice was reachable only by typing its URL). Ordering
 * is the caller's job (`routes/invoices/+page.server.ts`), not this
 * query's: `daysLate` is a plain function over `dueDate`, not a column
 * this query could `ORDER BY` without duplicating that arithmetic in SQL.
 */
export async function listInvoices(executor: DbExecutor = db): Promise<InvoiceListRow[]> {
	return executor
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
		.groupBy(invoice.id, contract.id, client.id);
}

/**
 * The ageing list's original query (#29), now `listInvoices` with the one
 * filter reapplied in JS rather than a second, near-identical `SELECT`:
 * the two cannot drift apart on the join or the grouping, only on which
 * rows they keep.
 */
export async function listUnpaidInvoices(executor: DbExecutor = db) {
	const rows = await listInvoices(executor);
	return rows.filter((row) => row.invoice.paidOn === null);
}

/**
 * Every invoice's own client and gross total (#242): the client list's
 * "outstanding" and "collected this year" both read off `total` — the
 * same gross, VAT-and-stamp-inclusive figure `listUnpaidInvoices` already
 * sums for the ageing list, the amount a client actually owes or paid,
 * not the fiscal ledger's own net revenue figure (`fiscal/ledger.ts`'s
 * `LedgerRow.amount`, which excludes VAT on purpose — see its header
 * comment). One query; the caller classifies each row as outstanding
 * (`paidOn` null) or collected-this-year (`paidOn` within the year) in
 * application code, the same "no stored flag" convention
 * `routes/invoices/+page.server.ts` already sets for `daysLate`.
 */
export async function listInvoiceTotalsByClient(executor: DbExecutor = db) {
	return executor
		.select({
			clientId: contract.clientId,
			total: invoice.total,
			currency: invoice.currency,
			paidOn: invoice.paidOn
		})
		.from(invoice)
		.innerJoin(contract, eq(contract.id, invoice.contractId));
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

/** Every invoice raised against a contract, most recent first — the
 * contract detail page's own "what has this contract produced" feed
 * (#240), the sibling of `listInvoiceLinesForContract` (expenses'
 * rebill picker) at the invoice-row grain instead of the line grain. */
export async function listInvoicesForContract(contractId: string, executor: DbExecutor = db) {
	return executor
		.select()
		.from(invoice)
		.where(eq(invoice.contractId, contractId))
		.orderBy(desc(invoice.issueDate), desc(invoice.createdAt));
}

/** Every ordinary invoice on this contract — never itself a `credit_note`
 *  or `debit_note` — for the "which invoice does this correct" picker
 *  `/invoices/new` shows once `documentType` is `credit_note` (#213). The
 *  same exclusion `invoice_corrects_invoice_id_only_for_corrections` (the
 *  CHECK, `0042_invoice_correction.sql`) and `invoice_check_correction`
 *  (the cross-row trigger, `0043_invoice_correction_constraints.sql`)
 *  enforce at the database level — this query exists so the picker never
 *  offers a choice the write would reject anyway. */
export async function listCorrectableInvoicesForContract(
	contractId: string,
	executor: DbExecutor = db
) {
	return executor
		.select({
			id: invoice.id,
			number: invoice.number,
			issueDate: invoice.issueDate,
			taxableAmount: invoice.taxableAmount,
			total: invoice.total,
			currency: invoice.currency
		})
		.from(invoice)
		.where(
			and(
				eq(invoice.contractId, contractId),
				notInArray(invoice.documentType, ['credit_note', 'debit_note'])
			)
		)
		.orderBy(desc(invoice.issueDate), desc(invoice.createdAt));
}
