import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { LegalText } from '$lib/legal/legal-text';
import {
	computeInvoiceBalance,
	resolveDueDate,
	type InvoiceBalance
} from '$lib/server/domain/invoice';
import { db, type DbExecutor } from '$lib/server/db';
import {
	client,
	contract,
	document,
	expense,
	invoice,
	invoiceLine,
	payment,
	workUnit,
	type InvoiceDueDateSource,
	type InvoiceTransmissionStatus,
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
import { listDocumentsForOwner, storeDocument } from './document';
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
 * Marks `invoiceId` transmitted by hand (#261): the self-hoster sent the
 * generated FatturaPA file themselves (AdE's own portal, PEC, or a paid
 * intermediary — `docs/specs/2026-08-14-electronic-invoicing.md` §5) and
 * records the identifier SdI (or the channel) gave them back. Legal from
 * `generated` (first transmission) and from `rejected` (a corrected
 * resubmission, same number and date per AdE's own guidance) alone —
 * `invoice_enforce_transmission_status`
 * (`0055_invoice_transmission_status_constraints.sql`) rejects any other
 * edge, e.g. an already-`accepted` invoice, at the database level.
 */
export async function markInvoiceTransmitted(
	invoiceId: string,
	transmissionId: string,
	executor: DbExecutor = db
) {
	const [row] = await executor
		.update(invoice)
		.set({ transmissionStatus: 'transmitted', transmissionId })
		.where(eq(invoice.id, invoiceId))
		.returning();
	return row;
}

export interface RecordInvoiceReceiptInput {
	readonly outcome: Extract<InvoiceTransmissionStatus, 'accepted' | 'rejected'>;
	readonly bytes: Uint8Array;
	readonly mime: string;
	readonly originalName: string;
}

/**
 * Records SdI's own receipt against `invoiceId` (#261): the uploaded
 * file — a ricevuta di consegna/impossibilità di recapito (`accepted`)
 * or a notifica di scarto (`rejected`) — is archived as a `document`
 * (`ownerType: 'invoice'`, `provenance: 'upload'`, invariant 4: the
 * receipt is the evidence, `transmissionStatus` the derived fact) in the
 * same transaction that moves `transmissionStatus` to `input.outcome`,
 * so a status change can never land with no evidence behind it, or vice
 * versa. The transition itself — legal only from `transmitted` — is
 * enforced by `invoice_enforce_transmission_status`; an illegal call
 * (e.g. against a still-`generated` invoice) throws from the trigger and
 * the document write rolls back with it, same pattern as
 * {@link createInvoice}'s own `tx ? run(tx) : db.transaction(run)`.
 */
export async function recordInvoiceReceipt(
	invoiceId: string,
	contractId: string,
	input: RecordInvoiceReceiptInput,
	tx?: DbExecutor
) {
	const run = async (executor: DbExecutor) => {
		const documentRow = await storeDocument(
			{
				bytes: input.bytes,
				mime: input.mime,
				originalName: input.originalName,
				provenance: 'upload',
				contractId,
				confidential: true,
				ownerType: 'invoice',
				ownerId: invoiceId
			},
			executor
		);
		const [invoiceRow] = await executor
			.update(invoice)
			.set({ transmissionStatus: input.outcome })
			.where(eq(invoice.id, invoiceId))
			.returning();
		return { document: documentRow, invoice: invoiceRow };
	};
	return tx ? run(tx) : db.transaction(run);
}

/** One `payment` row, oldest first — {@link listPaymentsForInvoice}'s and
 *  {@link listPaymentsByInvoiceId}'s own element type, and the shape the
 *  detail page's payment history table renders directly. */
export type PaymentRow = typeof payment.$inferSelect;

/** Every payment recorded against `invoiceId`, oldest first — the detail
 *  page's own payment history, and the raw material {@link getInvoiceBalance}
 *  sums. */
export async function listPaymentsForInvoice(
	invoiceId: string,
	executor: DbExecutor = db
): Promise<PaymentRow[]> {
	return executor
		.select()
		.from(payment)
		.where(eq(payment.invoiceId, invoiceId))
		.orderBy(asc(payment.date), asc(payment.createdAt));
}

/** Every payment on record, grouped by the invoice it was recorded
 *  against, oldest first — the one bulk read {@link listInvoices} and
 *  {@link listInvoiceTotalsByClient} both group by, so an ageing-list row
 *  and a client-exposure row can never compute a different balance for
 *  the same invoice. */
export async function listPaymentsByInvoiceId(
	executor: DbExecutor = db
): Promise<Map<string, PaymentRow[]>> {
	const rows = await executor
		.select()
		.from(payment)
		.orderBy(asc(payment.date), asc(payment.createdAt));
	const byInvoiceId = new Map<string, PaymentRow[]>();
	for (const row of rows) {
		const existing = byInvoiceId.get(row.invoiceId) ?? [];
		existing.push(row);
		byInvoiceId.set(row.invoiceId, existing);
	}
	return byInvoiceId;
}

/** `total` plus every payment on record against `invoiceId`, reduced to
 *  {@link InvoiceBalance} through `domain/invoice.ts`'s
 *  `computeInvoiceBalance` — the one place a total and a set of payments
 *  become "paid / remaining / settled". `null` for an invoice id that
 *  does not exist. */
export async function getInvoiceBalance(
	invoiceId: string,
	executor: DbExecutor = db
): Promise<InvoiceBalance | null> {
	const invoiceRow = await executor.query.invoice.findFirst({
		where: eq(invoice.id, invoiceId),
		columns: { total: true }
	});
	if (!invoiceRow) return null;
	const payments = await listPaymentsForInvoice(invoiceId, executor);
	return computeInvoiceBalance(invoiceRow.total, payments);
}

export interface RecordPaymentInput {
	readonly amount: MinorUnits;
	readonly date: string;
	readonly method?: string | null;
	readonly reference?: string | null;
}

/**
 * Records one payment against an invoice as a row (#212) — never a flag
 * or a single stored date: a client who pays half is a second row away
 * from a client who pays the rest. The invoice's own paid state is never
 * written here; it is derived on every read through
 * {@link getInvoiceBalance}/`computeInvoiceBalance`, so there is nothing
 * for this function to keep in sync when a second, third, or overpaying
 * payment is recorded later.
 */
export async function recordPayment(
	invoiceId: string,
	input: RecordPaymentInput,
	executor: DbExecutor = db
): Promise<PaymentRow> {
	const [row] = await executor
		.insert(payment)
		.values({
			invoiceId,
			amount: input.amount,
			date: input.date,
			method: input.method ?? null,
			reference: input.reference ?? null
		})
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
	/** #212: derived from `invoice.total` and every payment on record —
	 *  never a stored flag. */
	balance: InvoiceBalance;
	/** Every payment behind `balance`, oldest first — a caller asking
	 *  "how much actually arrived within year Y" (the dashboard, the
	 *  ageing list's own "collected this year" stat) needs each payment's
	 *  own date, not just the aggregate. */
	payments: readonly { readonly date: string; readonly amount: MinorUnits }[];
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
	const [rows, paymentsByInvoiceId] = await Promise.all([
		executor
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
			.groupBy(invoice.id, contract.id, client.id),
		listPaymentsByInvoiceId(executor)
	]);
	return rows.map((row) => {
		const payments = paymentsByInvoiceId.get(row.invoice.id) ?? [];
		return {
			...row,
			balance: computeInvoiceBalance(row.invoice.total, payments),
			payments: payments.map((p) => ({ date: p.date, amount: p.amount }))
		};
	});
}

/**
 * The ageing list's original query (#29), now `listInvoices` with the one
 * filter reapplied in JS rather than a second, near-identical `SELECT`:
 * the two cannot drift apart on the join or the grouping, only on which
 * rows they keep. "Unpaid" (#212) means not fully settled — a partly
 * paid invoice stays here, for whatever it still owes.
 */
export async function listUnpaidInvoices(executor: DbExecutor = db) {
	const rows = await listInvoices(executor);
	return rows.filter((row) => !row.balance.settled);
}

/** One row of {@link listInvoiceTotalsByClient} — an invoice's own gross
 *  total, its balance against it (read the same way
 *  {@link InvoiceListRow.balance} is), and the raw payments behind that
 *  balance — `client-exposure.ts`'s own "collected this calendar year"
 *  needs each payment's own date, since a payment landing in one year
 *  and another in the next must not be lumped into a single figure by
 *  either. */
export interface InvoiceTotalRow {
	readonly clientId: string;
	readonly invoiceId: string;
	readonly total: MinorUnits;
	readonly currency: string;
	readonly balance: InvoiceBalance;
	readonly payments: readonly { readonly date: string; readonly amount: MinorUnits }[];
}

/**
 * Every invoice's own client and gross total (#242): the client list's
 * "outstanding" and "collected this year" both read off `total` — the
 * same gross, VAT-and-stamp-inclusive figure `listUnpaidInvoices` already
 * sums for the ageing list, the amount a client actually owes or paid,
 * not the fiscal ledger's own net revenue figure (`fiscal/ledger.ts`'s
 * `LedgerRow.amount`, which excludes VAT on purpose — see its header
 * comment). One query; the caller classifies each row as outstanding
 * (`balance.remaining`) or collected-in-a-year (summing `payments` whose
 * own date falls in it) in application code, the same "no stored flag"
 * convention `routes/invoices/+page.server.ts` already sets for
 * `daysLate`.
 */
export async function listInvoiceTotalsByClient(
	executor: DbExecutor = db
): Promise<InvoiceTotalRow[]> {
	const [rows, paymentsByInvoiceId] = await Promise.all([
		executor
			.select({
				clientId: contract.clientId,
				invoiceId: invoice.id,
				total: invoice.total,
				currency: invoice.currency
			})
			.from(invoice)
			.innerJoin(contract, eq(contract.id, invoice.contractId)),
		listPaymentsByInvoiceId(executor)
	]);
	return rows.map((row) => {
		const payments = paymentsByInvoiceId.get(row.invoiceId) ?? [];
		return {
			...row,
			balance: computeInvoiceBalance(row.total, payments),
			payments: payments.map((p) => ({ date: p.date, amount: p.amount }))
		};
	});
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
		// `document.owner_id` is nullable in the schema now (an
		// unclaimed, first-intake document, #86/#87), but every row this
		// query reads is `owner_type = 'invoice'`, and
		// `document_unclaimed_together` (0052) guarantees `owner_id` is
		// set whenever `owner_type` is — this filter already excludes
		// every row where it could be null.
		if (row.invoiceId === null) continue;
		const hashes = hashesByInvoiceId.get(row.invoiceId) ?? [];
		hashes.push(row.hash);
		hashesByInvoiceId.set(row.invoiceId, hashes);
	}

	return invoiceRows.map((row) => ({ ...row, hashes: hashesByInvoiceId.get(row.id) ?? [] }));
}

/** Every invoice raised against a contract, most recent first, each with
 *  its own {@link InvoiceBalance} (#212) — the contract detail page's own
 *  "what has this contract produced" feed (#240), the sibling of
 *  `listInvoiceLinesForContract` (expenses' rebill picker) at the
 *  invoice-row grain instead of the line grain. */
export async function listInvoicesForContract(contractId: string, executor: DbExecutor = db) {
	const rows = await executor
		.select()
		.from(invoice)
		.where(eq(invoice.contractId, contractId))
		.orderBy(desc(invoice.issueDate), desc(invoice.createdAt));
	if (rows.length === 0) return [];
	const payments = await executor
		.select()
		.from(payment)
		.where(
			inArray(
				payment.invoiceId,
				rows.map((row) => row.id)
			)
		)
		.orderBy(asc(payment.date), asc(payment.createdAt));
	const paymentsByInvoiceId = new Map<string, PaymentRow[]>();
	for (const row of payments) {
		const existing = paymentsByInvoiceId.get(row.invoiceId) ?? [];
		existing.push(row);
		paymentsByInvoiceId.set(row.invoiceId, existing);
	}
	return rows.map((row) => ({
		...row,
		balance: computeInvoiceBalance(row.total, paymentsByInvoiceId.get(row.id) ?? [])
	}));
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
