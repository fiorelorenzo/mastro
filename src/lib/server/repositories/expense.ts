import { asc, eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { expense, invoice, invoiceLine, type DocumentProvenance } from '$lib/server/db/schema';
import type { MinorUnits } from '$lib/server/import/invoice';
import { listDocumentsForOwner, storeDocument } from './document';

export type ExpenseInput = {
	contractId: string;
	date: string;
	description: string;
	amount: MinorUnits;
	preAuthorised: boolean;
	authorisationReference: string | null;
};

export type ExpenseReceiptInput = {
	bytes: Uint8Array;
	mime: string;
	originalName: string;
	provenance: DocumentProvenance;
	confidential: boolean;
};

export async function listExpensesForContract(contractId: string) {
	return db.query.expense.findMany({
		where: eq(expense.contractId, contractId),
		orderBy: asc(expense.date)
	});
}

export async function getExpense(id: string) {
	return db.query.expense.findFirst({ where: eq(expense.id, id) });
}

/** Every expense a given invoice line has rebilled — the forward half of
 * #28's "a rebilled expense appears on the invoice", read from the
 * invoice's own detail screen alongside the days `getInvoiceWithLines`
 * already joins in. */
export async function listExpensesForInvoiceLine(invoiceLineId: string) {
	return db.query.expense.findMany({
		where: eq(expense.invoiceLineId, invoiceLineId),
		orderBy: asc(expense.date)
	});
}

/**
 * Creates the expense and, when `receipt` is given, archives it the same
 * way `createApproval` archives an approval's proof: the document is
 * inserted first, owned by the contract (the expense it will evidence
 * does not exist yet), then re-pointed at the expense once its id exists.
 * `reimbursable` is never part of the input — the database trigger
 * computes it from `preAuthorised` against the contract, unconditionally,
 * on every insert.
 */
export async function createExpense(
	input: ExpenseInput,
	receipt: ExpenseReceiptInput | null,
	tx?: DbExecutor
) {
	const run = async (executor: DbExecutor) => {
		const [row] = await executor
			.insert(expense)
			.values({
				contractId: input.contractId,
				date: input.date,
				description: input.description,
				amount: input.amount,
				preAuthorised: input.preAuthorised,
				authorisationReference: input.authorisationReference
			})
			.returning();

		if (receipt) {
			await storeDocument(
				{
					...receipt,
					contractId: input.contractId,
					ownerType: 'expense',
					ownerId: row.id
				},
				executor
			);
		}

		return row;
	};

	return tx ? run(tx) : db.transaction(run);
}

export async function updateExpense(id: string, input: Omit<ExpenseInput, 'contractId'>) {
	const [row] = await db
		.update(expense)
		.set({
			date: input.date,
			description: input.description,
			amount: input.amount,
			preAuthorised: input.preAuthorised,
			authorisationReference: input.authorisationReference
		})
		.where(eq(expense.id, id))
		.returning();
	return row;
}

/** Attaches a receipt to an expense that does not have one yet — the edit
 * screen's own upload, for the case a receipt only turns up after the
 * expense was first recorded. Owned by the expense directly, no
 * re-pointing dance needed: unlike `createExpense`, the expense already
 * exists by the time this runs. */
export async function attachExpenseReceipt(
	expenseId: string,
	contractId: string,
	receipt: ExpenseReceiptInput
) {
	return storeDocument({
		...receipt,
		contractId,
		ownerType: 'expense',
		ownerId: expenseId
	});
}

export async function getExpenseReceipts(expenseId: string) {
	return listDocumentsForOwner('expense', expenseId);
}

/**
 * Rebills an expense onto an existing invoice line, reusing `invoice_line`
 * exactly as `work_unit.invoiceLineId` does rather than a parallel
 * mechanism. `expense_forbid_rebill_twice` (the accompanying custom
 * migration) rejects this outright once `invoiceLineId` is already set —
 * a constraint, not a convention this function could forget to check.
 */
export async function rebillExpense(expenseId: string, invoiceLineId: string) {
	const [row] = await db
		.update(expense)
		.set({ invoiceLineId })
		.where(eq(expense.id, expenseId))
		.returning();
	return row;
}

/** Every invoice line raised for a contract, across every one of its
 * invoices — the picker `rebillExpense`'s own form offers, scoped to the
 * contract an expense actually belongs to. */
export async function listInvoiceLinesForContract(contractId: string) {
	const rows = await db
		.select({ line: invoiceLine, invoiceNumber: invoice.number })
		.from(invoiceLine)
		.innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.id))
		.where(eq(invoice.contractId, contractId))
		.orderBy(asc(invoice.issueDate), asc(invoiceLine.createdAt));
	return rows.map(({ line, invoiceNumber }) => ({ ...line, invoiceNumber }));
}
