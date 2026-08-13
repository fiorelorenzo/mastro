// #230's acceptance: `sent_email.invoice_id` actually answers "what has
// gone out about this invoice" and "has this exact reminder gone out
// this period already" — proved against real rows, not mocks, the same
// `inRolledBackTransaction` pattern every other repository test uses.
import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { minorUnits } from '$lib/money';
import { client as pool, db } from '$lib/server/db';
import { client, contract, emailTemplate, invoice, sentEmail } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { chasePeriodStart, findChaseThisPeriod, listSentEmailsForInvoice } from './sent-email';

afterAll(async () => {
	await pool.end();
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

test('chasePeriodStart is the first instant of the UTC calendar month containing the date', () => {
	expect(chasePeriodStart(new Date('2024-03-17T22:45:00Z'))).toEqual(
		new Date('2024-03-01T00:00:00.000Z')
	);
	// The month boundary itself belongs to the new month, not the old one.
	expect(chasePeriodStart(new Date('2024-03-01T00:00:00Z'))).toEqual(
		new Date('2024-03-01T00:00:00.000Z')
	);
});

async function seedInvoiceWithTwoTemplates(tx: Tx) {
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
			paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
			invoicingCadence: 'monthly' as const,
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			requiresPriorApproval: false
		})
		.returning();
	const [invoiceRow] = await tx
		.insert(invoice)
		.values({
			contractId: contractRow.id,
			number: `INV-${crypto.randomUUID().slice(0, 8)}`,
			issueDate: '2024-03-01',
			currency: 'EUR',
			taxableAmount: minorUnits(100_000),
			taxAmount: minorUnits(22_000),
			total: minorUnits(122_000),
			dueDate: '2024-03-31',
			dueDateSource: 'computed'
		})
		.returning();
	const [firstReminder] = await tx
		.insert(emailTemplate)
		.values({
			contractId: contractRow.id,
			name: 'First reminder',
			subject: 'Reminder {{invoice_number}}',
			body: 'Please pay {{amount}}.',
			attachmentKinds: [],
			trigger: { kind: 'days_after_due', days: 7 }
		})
		.returning();
	const [finalNotice] = await tx
		.insert(emailTemplate)
		.values({
			contractId: contractRow.id,
			name: 'Final notice',
			subject: 'Final notice {{invoice_number}}',
			body: 'Please pay {{amount}} immediately.',
			attachmentKinds: [],
			trigger: { kind: 'days_after_due', days: 30 }
		})
		.returning();

	return { contractRow, invoiceRow, firstReminder, finalNotice };
}

async function logSend(
	tx: Tx,
	invoiceId: string,
	contractId: string,
	templateId: string,
	sentAt: Date
) {
	// `created_at` is supplied explicitly, not left to its `now()` default
	// and then updated afterward: `sent_email` is append-only
	// (`sent_email_immutable`, 0017_email_template_constraints.sql) —
	// every write happens once, at insert, including this test's own
	// back-dating for the duplicate-window tests below.
	const [row] = await tx
		.insert(sentEmail)
		.values({
			contractId,
			invoiceId,
			emailTemplateId: templateId,
			recipients: ['client@example.com'],
			subject: 'Reminder',
			messageId: `<${crypto.randomUUID()}@mastro.test>`,
			autoSent: false,
			createdAt: sentAt
		})
		.returning();
	return row;
}

test('listSentEmailsForInvoice returns every send about the invoice, most recent first, with its template name', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, invoiceRow, firstReminder, finalNotice } =
			await seedInvoiceWithTwoTemplates(tx);
		await logSend(
			tx,
			invoiceRow.id,
			contractRow.id,
			firstReminder.id,
			new Date('2024-04-08T09:00:00Z')
		);
		await logSend(
			tx,
			invoiceRow.id,
			contractRow.id,
			finalNotice.id,
			new Date('2024-05-01T09:00:00Z')
		);

		const history = await listSentEmailsForInvoice(invoiceRow.id, tx);

		expect(history).toHaveLength(2);
		expect(history[0].templateName).toBe('Final notice');
		expect(history[0].sentAt).toEqual(new Date('2024-05-01T09:00:00Z'));
		expect(history[1].templateName).toBe('First reminder');
	});
});

test('listSentEmailsForInvoice never mixes in a send about a different invoice on the same contract', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, invoiceRow, firstReminder } = await seedInvoiceWithTwoTemplates(tx);
		const [otherInvoiceRow] = await tx
			.insert(invoice)
			.values({
				contractId: contractRow.id,
				number: `INV-${crypto.randomUUID().slice(0, 8)}`,
				issueDate: '2024-04-01',
				currency: 'EUR',
				taxableAmount: minorUnits(50_000),
				taxAmount: minorUnits(11_000),
				total: minorUnits(61_000),
				dueDate: '2024-04-30',
				dueDateSource: 'computed'
			})
			.returning();
		await logSend(
			tx,
			otherInvoiceRow.id,
			contractRow.id,
			firstReminder.id,
			new Date('2024-05-08T09:00:00Z')
		);

		expect(await listSentEmailsForInvoice(invoiceRow.id, tx)).toEqual([]);
	});
});

test('findChaseThisPeriod finds the same template sent for the same invoice within the period', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, invoiceRow, firstReminder } = await seedInvoiceWithTwoTemplates(tx);
		await logSend(
			tx,
			invoiceRow.id,
			contractRow.id,
			firstReminder.id,
			new Date('2024-04-08T09:00:00Z')
		);

		const duplicate = await findChaseThisPeriod(
			invoiceRow.id,
			firstReminder.id,
			chasePeriodStart(new Date('2024-04-20T00:00:00Z')),
			tx
		);
		expect(duplicate).toEqual({ sentAt: new Date('2024-04-08T09:00:00Z') });
	});
});

test('findChaseThisPeriod finds nothing once the send falls in an earlier period', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, invoiceRow, firstReminder } = await seedInvoiceWithTwoTemplates(tx);
		await logSend(
			tx,
			invoiceRow.id,
			contractRow.id,
			firstReminder.id,
			new Date('2024-03-08T09:00:00Z')
		);

		const duplicate = await findChaseThisPeriod(
			invoiceRow.id,
			firstReminder.id,
			chasePeriodStart(new Date('2024-04-20T00:00:00Z')),
			tx
		);
		expect(duplicate).toBeNull();
	});
});

test('findChaseThisPeriod ignores a different template sent for the same invoice: not the same reminder', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow, invoiceRow, firstReminder, finalNotice } =
			await seedInvoiceWithTwoTemplates(tx);
		await logSend(
			tx,
			invoiceRow.id,
			contractRow.id,
			firstReminder.id,
			new Date('2024-04-08T09:00:00Z')
		);

		const duplicate = await findChaseThisPeriod(
			invoiceRow.id,
			finalNotice.id,
			chasePeriodStart(new Date('2024-04-20T00:00:00Z')),
			tx
		);
		expect(duplicate).toBeNull();
	});
});
