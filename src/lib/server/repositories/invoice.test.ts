import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { rejection } from '$lib/server/db/pg-error';
import { minorUnits } from '$lib/money';
import { eq, sql } from 'drizzle-orm';
import { client as pool, db } from '$lib/server/db';
import { client, contract, document, invoice, invoiceLine } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { computeInvoiceBalance } from '$lib/server/domain/invoice';
import {
	countInvoicesByTab,
	createInvoice,
	getInvoiceBalance,
	getInvoiceDocuments,
	getInvoiceListTotals,
	getInvoiceWithLines,
	listInvoices,
	listInvoicesForContract,
	listPaymentsForInvoice,
	listUnpaidInvoices,
	markInvoiceTransmitted,
	recordInvoiceReceipt,
	recordPayment,
	type InvoiceInput
} from './invoice';
import { createExpense } from './expense';
import { createWorkUnit, getWorkUnit } from './work-unit';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres work
// happens inside a transaction that is always rolled back, same pattern as
// `repositories/work-unit.test.ts`. `createInvoice`'s totals trigger is
// deferred to commit (0015_invoice_constraints.sql), so a test that wants
// to observe it reject something forces early evaluation with `SET
// CONSTRAINTS ... IMMEDIATE` instead of actually committing.

afterAll(async () => {
	await pool.end();
});

async function insertContract(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	paymentTerms: PaymentTerms = { kind: 'net', days: 30 }
) {
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: `Test Client ${crypto.randomUUID()}`,
			taxId: `TEST-TAX-${crypto.randomUUID()}`,
			country: 'IT',
			addressLine1: 'Via Roma 1',
			addressCity: 'Milano',
			addressPostalCode: '20100',
			noticeChannel: 'email' as const
		})
		.returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Test contract',
			startsOn: '2024-01-01',
			renewalType: 'none' as const,
			terminationNoticeDays: 30,
			paymentTerms,
			invoicingCadence: 'monthly' as const,
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			requiresPriorApproval: false
		})
		.returning();
	return contractRow;
}

test('an invoice created manually with lines whose amounts add up succeeds, and each linked day moves to invoiced', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const day1 = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2024-06-10',
				quantity: 1,
				scope: 'Day one.',
				state: 'worked'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'worked as agreed',
			tx
		);
		const day2 = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2024-06-11',
				quantity: 1,
				scope: 'Day two.',
				state: 'worked'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'worked as agreed',
			tx
		);

		const invoiceRow = await createInvoice(
			{
				contractId: contractRow.id,
				number: 'INV-0001',
				issueDate: '2024-06-30',
				documentType: 'invoice',
				currency: 'EUR',
				taxTreatmentCode: null,
				statutoryReference: null,
				stampDuty: null,
				socialCharge: null,
				dueDate: null,
				paymentMethod: null,
				iban: null,
				transmissionId: null,
				lines: [
					{
						description: 'Two days of consulting',
						quantity: 2,
						unitPrice: minorUnits(50000),
						amount: minorUnits(100000),
						taxRate: 22,
						taxTreatmentCode: null,
						workUnitIds: [day1.id, day2.id]
					}
				]
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'invoiced end of month',
			tx
		);

		expect(invoiceRow.taxableAmount).toBe(100000);
		expect(invoiceRow.taxAmount).toBe(22000);
		expect(invoiceRow.total).toBe(122000);
		// No due date supplied: computed from the contract's net-30 terms,
		// with the source visible on the row, not just inferred by absence.
		expect(invoiceRow.dueDate).toBe('2024-07-30');
		expect(invoiceRow.dueDateSource).toBe('computed');

		const refreshedDay1 = await getWorkUnit(day1.id, tx);
		const refreshedDay2 = await getWorkUnit(day2.id, tx);
		expect(refreshedDay1.state).toBe('invoiced');
		expect(refreshedDay2.state).toBe('invoiced');

		const withLines = await getInvoiceWithLines(invoiceRow.id, tx);
		expect(withLines?.lines).toHaveLength(1);
		expect(withLines?.lines[0].days.map((d) => d.id).sort()).toEqual([day1.id, day2.id].sort());
	});
});

test('a line with expenseIds rebills each expense onto it (#217), the same way workUnitIds links days', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const expenseRow = await createExpense(
			{
				contractId: contractRow.id,
				date: '2024-06-05',
				description: 'Train ticket',
				amount: minorUnits(4200),
				preAuthorised: false,
				authorisationReference: null
			},
			null,
			tx
		);

		const invoiceRow = await createInvoice(
			{
				contractId: contractRow.id,
				number: 'INV-EXP-0001',
				issueDate: '2024-06-30',
				documentType: 'invoice',
				currency: 'EUR',
				taxTreatmentCode: null,
				statutoryReference: null,
				stampDuty: null,
				socialCharge: null,
				dueDate: null,
				paymentMethod: null,
				iban: null,
				transmissionId: null,
				lines: [
					{
						description: 'Expense rebill: Train ticket',
						quantity: 1,
						unitPrice: minorUnits(4200),
						amount: minorUnits(4200),
						taxRate: 0,
						taxTreatmentCode: null,
						workUnitIds: [],
						expenseIds: [expenseRow.id]
					}
				]
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'invoiced',
			tx
		);

		const withLines = await getInvoiceWithLines(invoiceRow.id, tx);
		expect(withLines?.lines).toHaveLength(1);
		expect(withLines?.lines[0].expenses.map((e) => e.id)).toEqual([expenseRow.id]);

		const refreshed = await tx.query.expense.findFirst({
			where: (e, { eq }) => eq(e.id, expenseRow.id)
		});
		expect(refreshed?.invoiceLineId).toBe(withLines?.lines[0].id);
	});
});

test('a line with no workUnitIds and no expenseIds is a manual line — the structural marker, no schema column needed', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const invoiceRow = await createInvoice(
			{
				contractId: contractRow.id,
				number: 'INV-MANUAL-0001',
				issueDate: '2024-06-30',
				documentType: 'invoice',
				currency: 'EUR',
				taxTreatmentCode: null,
				statutoryReference: null,
				stampDuty: null,
				socialCharge: null,
				dueDate: null,
				paymentMethod: null,
				iban: null,
				transmissionId: null,
				lines: [
					{
						description: 'Genuine exception',
						quantity: 1,
						unitPrice: minorUnits(10000),
						amount: minorUnits(10000),
						taxRate: 0,
						taxTreatmentCode: null,
						workUnitIds: []
					}
				]
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'invoiced',
			tx
		);

		const withLines = await getInvoiceWithLines(invoiceRow.id, tx);
		expect(withLines?.lines[0].days).toEqual([]);
		expect(withLines?.lines[0].expenses).toEqual([]);
	});
});

test('a supplied due date is stored verbatim, sourced as "document"', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const invoiceRow = await createInvoice(
			{
				contractId: contractRow.id,
				number: 'INV-0002',
				issueDate: '2024-06-30',
				documentType: 'invoice',
				currency: 'EUR',
				taxTreatmentCode: null,
				statutoryReference: null,
				stampDuty: null,
				socialCharge: null,
				dueDate: '2024-08-15',
				paymentMethod: null,
				iban: null,
				transmissionId: null,
				lines: [
					{
						description: 'Flat fee',
						quantity: 1,
						unitPrice: minorUnits(100000),
						amount: minorUnits(100000),
						taxRate: 0,
						taxTreatmentCode: 'N2.2',
						workUnitIds: []
					}
				]
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'invoiced',
			tx
		);

		expect(invoiceRow.dueDate).toBe('2024-08-15');
		expect(invoiceRow.dueDateSource).toBe('document');
	});
});

test('#257: two invoices on different contracts cannot share a number — numbering is unique across the whole ledger, not just within one contract', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractA = await insertContract(tx);
		const contractB = await insertContract(tx);
		// Random, not a literal like '2026/014': a fixed number here would
		// collide with the demo seed's own invoices once this runs against a
		// seeded database (AGENTS.md — "a test runs against a database that
		// has data in it"), and that collision would fail the *first* insert
		// below, outside `rejection`, not the one this test means to observe.
		const sharedNumber = `INV-257-${crypto.randomUUID().slice(0, 8)}`;

		const fieldsFor = (contractId: string): InvoiceInput => ({
			contractId,
			number: sharedNumber,
			issueDate: '2024-06-30',
			documentType: 'invoice',
			currency: 'EUR',
			taxTreatmentCode: null,
			statutoryReference: null,
			stampDuty: null,
			socialCharge: null,
			dueDate: '2024-07-30',
			paymentMethod: null,
			iban: null,
			transmissionId: null,
			lines: [
				{
					description: 'Flat fee',
					quantity: 1,
					unitPrice: minorUnits(100000),
					amount: minorUnits(100000),
					taxRate: 0,
					taxTreatmentCode: 'N2.2',
					workUnitIds: []
				}
			]
		});

		await createInvoice(
			fieldsFor(contractA.id),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);

		// invoice_number_unique (0048_invoice_number_unique.sql) is a plain,
		// non-deferred UNIQUE constraint on `number` alone — it fires on this
		// statement itself, no `set constraints all immediate` needed, unlike
		// the deferred totals/correction triggers above.
		const error = await rejection(
			() =>
				createInvoice(
					fieldsFor(contractB.id),
					{ kind: 'human', email: 'lorenzo@example.com' },
					'test fixture',
					tx
				),
			tx
		);

		expect(error).toMatchObject({
			code: '23505',
			constraint_name: 'invoice_number_unique'
		});
	});
});

test('the database rejects an invoice whose lines do not sum to its stated taxable amount', async () => {
	const failure = await db
		.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const [invoiceRow] = await tx
				.insert(invoice)
				.values({
					contractId: contractRow.id,
					number: 'INV-BAD',
					issueDate: '2024-06-30',
					currency: 'EUR',
					taxableAmount: minorUnits(100000),
					taxAmount: minorUnits(22000),
					total: minorUnits(122000),
					dueDate: '2024-07-30',
					dueDateSource: 'computed'
				})
				.returning();

			// Only 40000 of lines against a stated taxable_amount of 100000.
			await tx.insert(invoiceLine).values({
				invoiceId: invoiceRow.id,
				description: 'Understated line',
				quantity: 1,
				unitPrice: minorUnits(40000),
				amount: minorUnits(40000),
				taxRate: 22
			});

			// The check is a deferred constraint trigger: force it to run now
			// instead of waiting for a commit this test never performs. The
			// raised message lands on the driver error's `.cause`, same as
			// every Postgres error `postgres-error.ts` unwraps.
			await tx.execute(sql`set constraints all immediate`);
		})
		.catch((error: { cause?: { message?: string } }) => error);

	expect(failure).toBeInstanceOf(Error);
	expect((failure as Error & { cause?: { message?: string } }).cause?.message).toMatch(
		/does not match the sum of its lines/
	);
});

test('the database rejects an invoice whose total does not equal taxable + tax + stamp duty + social charge', async () => {
	const failure = await db
		.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const [invoiceRow] = await tx
				.insert(invoice)
				.values({
					contractId: contractRow.id,
					number: 'INV-BAD-TOTAL',
					issueDate: '2024-06-30',
					currency: 'EUR',
					taxableAmount: minorUnits(100000),
					taxAmount: minorUnits(22000),
					total: minorUnits(999999),
					dueDate: '2024-07-30',
					dueDateSource: 'computed'
				})
				.returning();

			await tx.insert(invoiceLine).values({
				invoiceId: invoiceRow.id,
				description: 'Line',
				quantity: 1,
				unitPrice: minorUnits(100000),
				amount: minorUnits(100000),
				taxRate: 22
			});

			await tx.execute(sql`set constraints all immediate`);
		})
		.catch((error: { cause?: { message?: string } }) => error);

	expect(failure).toBeInstanceOf(Error);
	expect((failure as Error & { cause?: { message?: string } }).cause?.message).toMatch(
		/does not equal taxable_amount/
	);
});

test('recording a payment sets paid_on, and the invoice no longer appears in the unpaid list', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const invoiceRow = await createInvoice(
			{
				contractId: contractRow.id,
				number: 'INV-0003',
				issueDate: '2024-01-01',
				documentType: 'invoice',
				currency: 'EUR',
				taxTreatmentCode: null,
				statutoryReference: null,
				stampDuty: null,
				socialCharge: null,
				dueDate: '2024-01-15',
				paymentMethod: null,
				iban: null,
				transmissionId: null,
				lines: [
					{
						description: 'Flat fee',
						quantity: 1,
						unitPrice: minorUnits(50000),
						amount: minorUnits(50000),
						taxRate: 0,
						taxTreatmentCode: null,
						workUnitIds: []
					}
				]
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'invoiced',
			tx
		);

		const unpaidBefore = await listUnpaidInvoices(tx);
		expect(unpaidBefore.some((row) => row.invoice.id === invoiceRow.id)).toBe(true);

		const paid = await recordPayment(
			invoiceRow.id,
			{ amount: invoiceRow.total, date: '2024-02-01' },
			tx
		);
		expect(paid.amount).toBe(invoiceRow.total);
		expect(paid.date).toBe('2024-02-01');

		const unpaidAfter = await listUnpaidInvoices(tx);
		expect(unpaidAfter.some((row) => row.invoice.id === invoiceRow.id)).toBe(false);
	});
});

test('a day linked to an unpaid invoice line is not itself transitioned to "paid": paid is derived from the invoice, not stored on the day', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const day = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2024-01-05',
				quantity: 1,
				scope: 'Work.',
				state: 'worked'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'worked',
			tx
		);
		const invoiceRow = await createInvoice(
			{
				contractId: contractRow.id,
				number: 'INV-0004',
				issueDate: '2024-01-01',
				documentType: 'invoice',
				currency: 'EUR',
				taxTreatmentCode: null,
				statutoryReference: null,
				stampDuty: null,
				socialCharge: null,
				dueDate: '2024-01-15',
				paymentMethod: null,
				iban: null,
				transmissionId: null,
				lines: [
					{
						description: 'A day of work',
						quantity: 1,
						unitPrice: minorUnits(50000),
						amount: minorUnits(50000),
						taxRate: 0,
						taxTreatmentCode: null,
						workUnitIds: [day.id]
					}
				]
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'invoiced',
			tx
		);

		await recordPayment(invoiceRow.id, { amount: invoiceRow.total, date: '2024-02-01' }, tx);

		const refreshedDay = await getWorkUnit(day.id, tx);
		// The row itself is unchanged by paying the invoice — no cascade
		// wrote 'paid' onto it. `routes/invoices/[id]` derives the display
		// status from the invoice's own paidOn instead.
		expect(refreshedDay.state).toBe('invoiced');
	});
});

test('linking a line to a day still on "proposed" is rejected by the existing state machine, not pre-validated here', async () => {
	const failure = await db
		.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const day = await createWorkUnit(
				{ contractId: contractRow.id, date: '2024-01-05', quantity: 1, scope: 'Not yet worked.' },
				{ kind: 'human', email: 'lorenzo@example.com' },
				'proposed',
				tx
			);

			await createInvoice(
				{
					contractId: contractRow.id,
					number: 'INV-0005',
					issueDate: '2024-01-01',
					documentType: 'invoice',
					currency: 'EUR',
					taxTreatmentCode: null,
					statutoryReference: null,
					stampDuty: null,
					socialCharge: null,
					dueDate: '2024-01-15',
					paymentMethod: null,
					iban: null,
					transmissionId: null,
					lines: [
						{
							description: 'A day not yet worked',
							quantity: 1,
							unitPrice: minorUnits(50000),
							amount: minorUnits(50000),
							taxRate: 0,
							taxTreatmentCode: null,
							workUnitIds: [day.id]
						}
					]
				},
				{ kind: 'human', email: 'lorenzo@example.com' },
				'invoiced',
				tx
			);
		})
		.catch((error: { cause?: { message?: string } }) => error);

	expect(failure).toBeInstanceOf(Error);
	expect((failure as Error & { cause?: { message?: string } }).cause?.message).toMatch(
		/illegal work_unit transition/
	);
});

test("#215: an imported invoice's archived original is reachable, a hand-entered one has none", async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const day = await createWorkUnit(
			{
				contractId: contractRow.id,
				date: '2024-06-10',
				quantity: 1,
				scope: 'Day one.',
				state: 'worked'
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'worked as agreed',
			tx
		);
		const invoiceRow = await createInvoice(
			{
				contractId: contractRow.id,
				number: 'INV-0001',
				issueDate: '2024-06-30',
				documentType: 'invoice',
				currency: 'EUR',
				taxTreatmentCode: null,
				statutoryReference: null,
				stampDuty: null,
				socialCharge: null,
				dueDate: null,
				paymentMethod: null,
				iban: null,
				transmissionId: null,
				lines: [
					{
						description: 'One day of consulting',
						quantity: 1,
						unitPrice: minorUnits(50000),
						amount: minorUnits(50000),
						taxRate: 22,
						taxTreatmentCode: null,
						workUnitIds: [day.id],
						expenseIds: []
					}
				]
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'invoiced end of month',
			tx
		);

		// Entered by hand, the way this whole file's other invoices are —
		// nothing archived against it (`persist.ts` is the only writer of
		// `ownerType: 'invoice'` documents, and it never ran here).
		expect(await getInvoiceDocuments(invoiceRow.id, tx)).toEqual([]);

		// The shape an import leaves behind (`persist.ts`'s own
		// `storeDocument` call, reproduced directly since none of this
		// exercises the blob store).
		const [documentRow] = await tx
			.insert(document)
			.values({
				hash: 'a'.repeat(64),
				mime: 'application/xml',
				size: 10,
				originalName: 'invoice-0001.xml',
				provenance: 'folder_import',
				contractId: contractRow.id,
				confidential: true,
				ownerType: 'invoice',
				ownerId: invoiceRow.id
			})
			.returning();

		const documents = await getInvoiceDocuments(invoiceRow.id, tx);
		expect(documents.map((d) => d.id)).toEqual([documentRow.id]);
		expect(documents[0].originalName).toBe('invoice-0001.xml');
	});
});

// #213: a credit note references the invoice it corrects via
// `corrects_invoice_id` (0042_invoice_correction.sql), enforced two ways —
// a plain CHECK for "only for credit_note/debit_note"
// (`invoice_corrects_invoice_id_only_for_corrections`) and a deferred
// constraint trigger for the cross-row half
// (`invoice_check_correction`, 0043_invoice_correction_constraints.sql).
// The deferred half only ever fires at commit or when forced — never on
// `inRolledBackTransaction`'s own rollback — so every rejection test below
// forces it with `set constraints all immediate` inside the same
// `rejection` call that is meant to observe it, the same reasoning
// `invoice_check_totals`'s own tests give above for the identical need.
function correctionFields(contractId: string, overrides: Partial<InvoiceInput> = {}): InvoiceInput {
	return {
		contractId,
		number: `INV-${crypto.randomUUID()}`,
		issueDate: '2024-06-30',
		documentType: 'invoice',
		currency: 'EUR',
		taxTreatmentCode: null,
		statutoryReference: null,
		stampDuty: null,
		socialCharge: null,
		dueDate: null,
		paymentMethod: null,
		iban: null,
		transmissionId: null,
		lines: [
			{
				description: 'Consulting',
				quantity: 1,
				unitPrice: minorUnits(100000),
				amount: minorUnits(100000),
				taxRate: 0,
				taxTreatmentCode: null,
				workUnitIds: []
			}
		],
		...overrides
	};
}

test('a credit note stores which invoice it corrects, and crediting exactly the original\u2019s own total succeeds', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const original = await createInvoice(
			correctionFields(contractRow.id),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);

		const creditNote = await createInvoice(
			correctionFields(contractRow.id, {
				documentType: 'credit_note',
				correctsInvoiceId: original.id
				// Lines default to the same 100000 as `original` — matching it
				// exactly is allowed; "more than" is the line the database
				// actually draws (see the rejection test below).
			}),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);

		expect(creditNote.correctsInvoiceId).toBe(original.id);
		expect(creditNote.total).toBe(original.total);
	});
});

test('the database rejects a credit note that would credit more than the original invoice\u2019s own total, by constraint name', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const original = await createInvoice(
			correctionFields(contractRow.id),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);

		const error = await rejection(async () => {
			await createInvoice(
				correctionFields(contractRow.id, {
					documentType: 'credit_note',
					correctsInvoiceId: original.id,
					lines: [
						{
							description: 'Over-credit',
							quantity: 1,
							unitPrice: minorUnits(150000),
							amount: minorUnits(150000),
							taxRate: 0,
							taxTreatmentCode: null,
							workUnitIds: []
						}
					]
				}),
				{ kind: 'human', email: 'lorenzo@example.com' },
				'test fixture',
				tx
			);
			await tx.execute(sql`set constraints all immediate`);
		}, tx);

		expect(error).toMatchObject({
			code: '23514',
			constraint_name: 'invoice_credit_note_not_exceeding_original'
		});
	});
});

test('the database rejects a credit note whose corrects_invoice_id targets another correction, not an ordinary invoice', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const original = await createInvoice(
			correctionFields(contractRow.id),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);
		const firstCreditNote = await createInvoice(
			correctionFields(contractRow.id, {
				documentType: 'credit_note',
				correctsInvoiceId: original.id,
				lines: [
					{
						description: 'First credit',
						quantity: 1,
						unitPrice: minorUnits(10000),
						amount: minorUnits(10000),
						taxRate: 0,
						taxTreatmentCode: null,
						workUnitIds: []
					}
				]
			}),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);

		const error = await rejection(async () => {
			await createInvoice(
				correctionFields(contractRow.id, {
					documentType: 'credit_note',
					correctsInvoiceId: firstCreditNote.id,
					lines: [
						{
							description: 'Correcting a correction',
							quantity: 1,
							unitPrice: minorUnits(1000),
							amount: minorUnits(1000),
							taxRate: 0,
							taxTreatmentCode: null,
							workUnitIds: []
						}
					]
				}),
				{ kind: 'human', email: 'lorenzo@example.com' },
				'test fixture',
				tx
			);
			await tx.execute(sql`set constraints all immediate`);
		}, tx);

		expect(error).toMatchObject({
			code: '23514',
			constraint_name: 'invoice_corrects_invoice_id_targets_ordinary_invoice'
		});
	});
});

test('the CHECK rejects corrects_invoice_id set on an invoice that is neither a credit nor a debit note', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const original = await createInvoice(
			correctionFields(contractRow.id),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);

		const error = await rejection(
			() =>
				createInvoice(
					correctionFields(contractRow.id, {
						documentType: 'invoice',
						correctsInvoiceId: original.id
					}),
					{ kind: 'human', email: 'lorenzo@example.com' },
					'test fixture',
					tx
				),
			tx
		);

		expect(error).toMatchObject({
			code: '23514',
			constraint_name: 'invoice_corrects_invoice_id_only_for_corrections'
		});
	});
});

test('a partial payment leaves the invoice unpaid with the correct remaining balance', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const invoiceRow = await createInvoice(
			{
				contractId: contractRow.id,
				number: 'INV-0007',
				issueDate: '2024-01-01',
				documentType: 'invoice',
				currency: 'EUR',
				taxTreatmentCode: null,
				statutoryReference: null,
				stampDuty: null,
				socialCharge: null,
				dueDate: '2024-01-15',
				paymentMethod: null,
				iban: null,
				transmissionId: null,
				lines: [
					{
						description: 'Flat fee',
						quantity: 1,
						unitPrice: minorUnits(50000),
						amount: minorUnits(50000),
						taxRate: 0,
						taxTreatmentCode: null,
						workUnitIds: []
					}
				]
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'invoiced',
			tx
		);

		const partial = minorUnits(Math.floor(invoiceRow.total / 2));
		await recordPayment(invoiceRow.id, { amount: partial, date: '2024-02-01' }, tx);

		const balance = await getInvoiceBalance(invoiceRow.id, tx);
		expect(balance?.settled).toBe(false);
		expect(balance?.paid).toBe(partial);
		expect(balance?.remaining).toBe(invoiceRow.total - partial);

		const unpaid = await listUnpaidInvoices(tx);
		expect(unpaid.some((row) => row.invoice.id === invoiceRow.id)).toBe(true);
	});
});

test('listInvoicesForContract batches payments in one query, with amounts and ordering identical to a per-invoice fetch (#309)', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);

		async function makeInvoice(number: string, issueDate: string) {
			return createInvoice(
				{
					contractId: contractRow.id,
					number,
					issueDate,
					documentType: 'invoice',
					currency: 'EUR',
					taxTreatmentCode: null,
					statutoryReference: null,
					stampDuty: null,
					socialCharge: null,
					dueDate: '2024-12-31',
					paymentMethod: null,
					iban: null,
					transmissionId: null,
					lines: [
						{
							description: 'Flat fee',
							quantity: 1,
							unitPrice: minorUnits(100000),
							amount: minorUnits(100000),
							taxRate: 0,
							taxTreatmentCode: null,
							workUnitIds: []
						}
					]
				},
				{ kind: 'human', email: 'lorenzo@example.com' },
				'invoiced',
				tx
			);
		}

		const invoiceA = await makeInvoice(`INV-${crypto.randomUUID()}`, '2024-01-01');
		const invoiceB = await makeInvoice(`INV-${crypto.randomUUID()}`, '2024-02-01');
		const invoiceC = await makeInvoice(`INV-${crypto.randomUUID()}`, '2024-03-01');

		// Payments recorded out of date order, so a wrong grouping (or a
		// query that dropped the per-invoice ordering) would show up as a
		// different paid total or settlement date below.
		await recordPayment(invoiceA.id, { amount: minorUnits(60000), date: '2024-01-20' }, tx);
		await recordPayment(invoiceA.id, { amount: minorUnits(40000), date: '2024-01-10' }, tx);

		await recordPayment(invoiceB.id, { amount: minorUnits(30000), date: '2024-02-15' }, tx);
		await recordPayment(invoiceB.id, { amount: minorUnits(30000), date: '2024-02-05' }, tx);
		await recordPayment(invoiceB.id, { amount: minorUnits(30000), date: '2024-02-10' }, tx);

		await recordPayment(invoiceC.id, { amount: minorUnits(50000), date: '2024-03-05' }, tx);

		// This contract was just created in this transaction, so every row
		// returned belongs to one of the three invoices above.
		const rows = await listInvoicesForContract(contractRow.id, tx);
		expect(rows.map((row) => row.id)).toEqual([invoiceC.id, invoiceB.id, invoiceA.id]);

		for (const invoiceRow of [invoiceA, invoiceB, invoiceC]) {
			const batchedRow = rows.find((row) => row.id === invoiceRow.id);
			const paymentsFetchedIndividually = await listPaymentsForInvoice(invoiceRow.id, tx);
			const expectedBalance = computeInvoiceBalance(invoiceRow.total, paymentsFetchedIndividually);
			expect(batchedRow?.balance).toEqual(expectedBalance);
		}

		// Sanity: invoice B's three payments really do sum the way the
		// balance above claims, proving the batched grouping did not
		// cross-attach a payment from a different invoice.
		const balanceB = rows.find((row) => row.id === invoiceB.id)?.balance;
		expect(balanceB?.paid).toBe(minorUnits(90000));
	});
});

test('two payments that together exceed the total settle the invoice, with remaining floored at zero', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const invoiceRow = await createInvoice(
			{
				contractId: contractRow.id,
				number: 'INV-0008',
				issueDate: '2024-01-01',
				documentType: 'invoice',
				currency: 'EUR',
				taxTreatmentCode: null,
				statutoryReference: null,
				stampDuty: null,
				socialCharge: null,
				dueDate: '2024-01-15',
				paymentMethod: null,
				iban: null,
				transmissionId: null,
				lines: [
					{
						description: 'Flat fee',
						quantity: 1,
						unitPrice: minorUnits(50000),
						amount: minorUnits(50000),
						taxRate: 0,
						taxTreatmentCode: null,
						workUnitIds: []
					}
				]
			},
			{ kind: 'human', email: 'lorenzo@example.com' },
			'invoiced',
			tx
		);

		// Neither payment alone reaches the total; together they exceed it
		// by 10,000 — `settledOn` is the later date, the one at which the
		// running sum first reaches or passes `total`.
		const firstAmount = minorUnits(Math.floor(invoiceRow.total * 0.6));
		const secondAmount = minorUnits(Math.floor(invoiceRow.total * 0.6));
		await recordPayment(invoiceRow.id, { amount: firstAmount, date: '2024-02-01' }, tx);
		await recordPayment(invoiceRow.id, { amount: secondAmount, date: '2024-03-01' }, tx);

		const balance = await getInvoiceBalance(invoiceRow.id, tx);
		expect(balance?.settled).toBe(true);
		expect(balance?.remaining).toBe(0);
		expect(balance?.paid).toBe(firstAmount + secondAmount);
		expect(balance?.settledOn).toBe('2024-03-01');

		const unpaid = await listUnpaidInvoices(tx);
		expect(unpaid.some((row) => row.invoice.id === invoiceRow.id)).toBe(false);
	});
});

// #261: the transmission-status state machine, enforced by
// `invoice_enforce_transmission_status`
// (0055_invoice_transmission_status_constraints.sql) the same way
// `work_unit_enforce_state_machine` enforces the day lifecycle. Receipt
// uploads exercise the real blob store against a throwaway temp
// directory, same pattern as `fiscal/generate-invoice-document.test.ts`.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

let receiptStorageRoot: string;

beforeEach(async () => {
	receiptStorageRoot = await mkdtemp(join(tmpdir(), 'mastro-receipt-documents-'));
	process.env.DOCUMENT_STORAGE_ROOT = receiptStorageRoot;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(receiptStorageRoot, { recursive: true, force: true });
});

async function insertGeneratedInvoice(tx: Tx) {
	const contractRow = await insertContract(tx);
	return createInvoice(
		{
			contractId: contractRow.id,
			number: `INV-${crypto.randomUUID()}`,
			issueDate: '2024-06-01',
			documentType: 'invoice',
			currency: 'EUR',
			taxTreatmentCode: null,
			statutoryReference: null,
			stampDuty: null,
			socialCharge: null,
			dueDate: null,
			paymentMethod: null,
			iban: null,
			transmissionId: null,
			lines: [
				{
					description: 'Consulting',
					quantity: 1,
					unitPrice: minorUnits(100_000),
					amount: minorUnits(100_000),
					taxRate: 0,
					taxTreatmentCode: null,
					workUnitIds: []
				}
			]
		} satisfies InvoiceInput,
		{ kind: 'human', email: 'lorenzo@example.com' },
		'test fixture',
		tx
	);
}

test('an invoice is created transmission_status generated, with transmission_id null', async () => {
	await inRolledBackTransaction(async (tx) => {
		const invoiceRow = await insertGeneratedInvoice(tx);
		expect(invoiceRow.transmissionStatus).toBe('generated');
		expect(invoiceRow.transmissionId).toBeNull();
	});
});

test('markInvoiceTransmitted moves generated -> transmitted and records the id', async () => {
	await inRolledBackTransaction(async (tx) => {
		const invoiceRow = await insertGeneratedInvoice(tx);
		const updated = await markInvoiceTransmitted(invoiceRow.id, 'SDI-0001', tx);
		expect(updated.transmissionStatus).toBe('transmitted');
		expect(updated.transmissionId).toBe('SDI-0001');
	});
});

test('invoice_enforce_transmission_status rejects generated -> accepted, skipping transmitted', async () => {
	await inRolledBackTransaction(async (tx) => {
		const invoiceRow = await insertGeneratedInvoice(tx);
		const error = await rejection(
			() =>
				tx
					.update(invoice)
					.set({ transmissionStatus: 'accepted' })
					.where(eq(invoice.id, invoiceRow.id)),
			tx
		);
		expect(error.message).toMatch(/illegal invoice transmission_status transition/);
	});
});

test('invoice_transmission_id_required_once_transmitted rejects transmitted with no transmission_id', async () => {
	await inRolledBackTransaction(async (tx) => {
		const invoiceRow = await insertGeneratedInvoice(tx);
		const error = await rejection(
			() =>
				tx
					.update(invoice)
					.set({ transmissionStatus: 'transmitted' })
					.where(eq(invoice.id, invoiceRow.id)),
			tx
		);
		expect(error.constraint_name).toBe('invoice_transmission_id_required_once_transmitted');
	});
});

test('recordInvoiceReceipt archives the uploaded receipt as a document and moves transmitted -> accepted', async () => {
	await inRolledBackTransaction(async (tx) => {
		const invoiceRow = await insertGeneratedInvoice(tx);
		await markInvoiceTransmitted(invoiceRow.id, 'SDI-0002', tx);

		expect(await getInvoiceDocuments(invoiceRow.id, tx)).toEqual([]);

		const { document: documentRow, invoice: updated } = await recordInvoiceReceipt(
			invoiceRow.id,
			invoiceRow.contractId,
			{
				outcome: 'accepted',
				bytes: new TextEncoder().encode('<ricevuta/>'),
				mime: 'application/xml',
				originalName: 'RC_0001.xml'
			},
			tx
		);
		expect(updated.transmissionStatus).toBe('accepted');

		const documents = await getInvoiceDocuments(invoiceRow.id, tx);
		expect(documents.map((d) => d.id)).toEqual([documentRow.id]);
		expect(documents[0].provenance).toBe('upload');
		expect(documents[0].ownerType).toBe('invoice');
		expect(documents[0].ownerId).toBe(invoiceRow.id);
	});
});

test('recordInvoiceReceipt moves transmitted -> rejected, and a corrected resubmission goes back to transmitted', async () => {
	await inRolledBackTransaction(async (tx) => {
		const invoiceRow = await insertGeneratedInvoice(tx);
		await markInvoiceTransmitted(invoiceRow.id, 'SDI-0003', tx);

		const { invoice: rejected } = await recordInvoiceReceipt(
			invoiceRow.id,
			invoiceRow.contractId,
			{
				outcome: 'rejected',
				bytes: new TextEncoder().encode('<notificaScarto/>'),
				mime: 'application/xml',
				originalName: 'NS_0001.xml'
			},
			tx
		);
		expect(rejected.transmissionStatus).toBe('rejected');

		// A scarto invoice was never legally issued (AdE's own rule); the
		// resubmission goes back to `transmitted`, never straight to
		// `accepted` — SdI still has to issue a fresh receipt.
		const rejectedToAccepted = await rejection(
			() =>
				tx
					.update(invoice)
					.set({ transmissionStatus: 'accepted' })
					.where(eq(invoice.id, invoiceRow.id)),
			tx
		);
		expect(rejectedToAccepted.message).toMatch(/illegal invoice transmission_status transition/);

		const resubmitted = await markInvoiceTransmitted(invoiceRow.id, 'SDI-0003-BIS', tx);
		expect(resubmitted.transmissionStatus).toBe('transmitted');
		expect(resubmitted.transmissionId).toBe('SDI-0003-BIS');
	});
});

// #311: the ageing list's own query pushes its tab filter, its bound and
// its counts into SQL rather than fetching the whole ledger — every
// assertion below is scoped to ids this test itself created (`.some`/
// delta against a captured "before" snapshot), since the shared database
// also holds demo-seed invoices these queries see too.

async function createTestInvoice(
	tx: Tx,
	contractId: string,
	overrides: { dueDate: string; issueDate?: string; amount?: number }
) {
	const amount = minorUnits(overrides.amount ?? 100_000);
	return createInvoice(
		{
			contractId,
			number: `INV-${crypto.randomUUID()}`,
			issueDate: overrides.issueDate ?? '2024-01-01',
			documentType: 'invoice',
			currency: 'EUR',
			taxTreatmentCode: null,
			statutoryReference: null,
			stampDuty: null,
			socialCharge: null,
			dueDate: overrides.dueDate,
			paymentMethod: null,
			iban: null,
			transmissionId: null,
			lines: [
				{
					description: 'Consulting',
					quantity: 1,
					unitPrice: amount,
					amount,
					taxRate: 0,
					taxTreatmentCode: null,
					workUnitIds: []
				}
			]
		} satisfies InvoiceInput,
		{ kind: 'human', email: 'lorenzo@example.com' },
		'test fixture',
		tx
	);
}

test('#311: listInvoices pushes the due/overdue/paid filter into the query instead of filtering a full fetch', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const today = new Date('2024-06-15T00:00:00Z');

		const dueSoon = await createTestInvoice(tx, contractRow.id, { dueDate: '2024-07-01' });
		const overdue = await createTestInvoice(tx, contractRow.id, { dueDate: '2024-01-01' });
		const paid = await createTestInvoice(tx, contractRow.id, { dueDate: '2024-01-01' });
		await recordPayment(paid.id, { amount: paid.total, date: '2024-02-01' }, tx);

		const [dueRows, overdueRows, paidRows, allRows] = await Promise.all([
			listInvoices({ tab: 'due', limit: 1000, today }, tx),
			listInvoices({ tab: 'overdue', limit: 1000, today }, tx),
			listInvoices({ tab: 'paid', limit: 1000, today }, tx),
			listInvoices({ tab: 'all', limit: 1000, today }, tx)
		]);
		const idsOf = (rows: { invoice: { id: string } }[]) => rows.map((row) => row.invoice.id);

		expect(idsOf(dueRows)).toEqual(expect.arrayContaining([dueSoon.id, overdue.id]));
		expect(idsOf(dueRows)).not.toContain(paid.id);

		expect(idsOf(overdueRows)).toContain(overdue.id);
		expect(idsOf(overdueRows)).not.toContain(dueSoon.id);
		expect(idsOf(overdueRows)).not.toContain(paid.id);

		expect(idsOf(paidRows)).toContain(paid.id);
		expect(idsOf(paidRows)).not.toContain(dueSoon.id);
		expect(idsOf(paidRows)).not.toContain(overdue.id);

		expect(idsOf(allRows)).toEqual(expect.arrayContaining([dueSoon.id, overdue.id, paid.id]));
	});
});

test('#311: listInvoices bounds the result with limit/offset, most overdue first', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const today = new Date('2024-06-15T00:00:00Z');

		// Deep-past due dates so these three sort first regardless of any
		// overdue invoice the demo seed happens to carry.
		const oldest = await createTestInvoice(tx, contractRow.id, {
			issueDate: '1901-01-01',
			dueDate: '1901-01-15'
		});
		const middle = await createTestInvoice(tx, contractRow.id, {
			issueDate: '1901-02-01',
			dueDate: '1901-02-15'
		});
		const newest = await createTestInvoice(tx, contractRow.id, {
			issueDate: '1901-03-01',
			dueDate: '1901-03-15'
		});

		const firstPage = await listInvoices({ tab: 'overdue', limit: 2, offset: 0, today }, tx);
		expect(firstPage.map((row) => row.invoice.id)).toEqual([oldest.id, middle.id]);

		const secondPage = await listInvoices({ tab: 'overdue', limit: 2, offset: 2, today }, tx);
		expect(secondPage.map((row) => row.invoice.id)).toEqual([newest.id]);
	});
});

test('#311: countInvoicesByTab counts each tab from a single query, not from fetching every invoice', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const today = new Date('2024-06-15T00:00:00Z');

		const before = await countInvoicesByTab(today, tx);

		await createTestInvoice(tx, contractRow.id, { dueDate: '2024-07-01' });
		await createTestInvoice(tx, contractRow.id, { dueDate: '2024-01-01' });
		const paid = await createTestInvoice(tx, contractRow.id, { dueDate: '2024-01-01' });
		await recordPayment(paid.id, { amount: paid.total, date: '2024-02-01' }, tx);

		const after = await countInvoicesByTab(today, tx);

		expect(after.all - before.all).toBe(3);
		expect(after.due - before.due).toBe(2);
		expect(after.overdue - before.overdue).toBe(1);
		expect(after.paid - before.paid).toBe(1);
	});
});

test('#311: getInvoiceListTotals sums outstanding/overdue/collected across every matching invoice, not one page of them', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const today = new Date('2024-06-15T00:00:00Z');

		const before = await getInvoiceListTotals(today, tx);

		await createTestInvoice(tx, contractRow.id, {
			dueDate: '2024-01-01',
			amount: 100_000
		});
		const dueSoonPartial = await createTestInvoice(tx, contractRow.id, {
			dueDate: '2024-07-01',
			amount: 50_000
		});
		await recordPayment(dueSoonPartial.id, { amount: minorUnits(20_000), date: '2024-05-01' }, tx);
		const paidThisYear = await createTestInvoice(tx, contractRow.id, {
			dueDate: '2024-02-01',
			amount: 80_000
		});
		await recordPayment(paidThisYear.id, { amount: minorUnits(80_000), date: '2024-03-01' }, tx);

		const after = await getInvoiceListTotals(today, tx);

		const outstandingBefore = before.totalOutstandingByCurrency.EUR ?? 0;
		const overdueBefore = before.totalOverdueByCurrency.EUR ?? 0;
		const collectedBefore = before.totalCollectedThisYearByCurrency.EUR ?? 0;

		expect(after.totalOutstandingByCurrency.EUR - outstandingBefore).toBe(100_000 + 30_000);
		expect(after.totalOverdueByCurrency.EUR - overdueBefore).toBe(100_000);
		expect(after.totalCollectedThisYearByCurrency.EUR - collectedBefore).toBe(20_000 + 80_000);
		expect(after.paidThisYearCount - before.paidThisYearCount).toBe(2);
	});
});

test('#311: getInvoiceListTotals reports the oldest overdue due date across the whole ledger', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const today = new Date('2024-06-15T00:00:00Z');
		await createTestInvoice(tx, contractRow.id, { issueDate: '1901-01-01', dueDate: '1901-01-15' });
		await createTestInvoice(tx, contractRow.id, { issueDate: '1902-01-01', dueDate: '1902-01-15' });

		const totals = await getInvoiceListTotals(today, tx);
		expect(totals.oldestOverdueDueDate).toBe('1901-01-15');
	});
});
