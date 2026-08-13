import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { minorUnits } from '$lib/money';
import { sql } from 'drizzle-orm';
import { client as pool, db } from '$lib/server/db';
import { client, contract, document, invoice, invoiceLine } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import {
	createInvoice,
	getInvoiceDocuments,
	getInvoiceWithLines,
	listUnpaidInvoices,
	recordPayment
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

		const paid = await recordPayment(invoiceRow.id, '2024-02-01', tx);
		expect(paid.paidOn).toBe('2024-02-01');

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

		await recordPayment(invoiceRow.id, '2024-02-01', tx);

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
