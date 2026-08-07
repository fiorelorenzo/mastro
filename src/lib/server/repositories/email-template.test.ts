import { afterAll, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { client, contract, emailTemplate } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import {
	createEmailTemplate,
	getEmailTemplate,
	listEmailTemplatesForContract,
	updateEmailTemplate
} from './email-template';

// Same transaction-rollback pattern as the other repository tests.

afterAll(async () => {
	await pool.end();
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function insertContract(tx: Tx) {
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
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy
		})
		.returning();
	return contractRow;
}

test('creates, lists and updates a template for a contract', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);

			const created = await createEmailTemplate({
				contractId: contractRow.id,
				name: 'Invoice cover note',
				subject: 'Invoice {{invoice_number}}',
				body: 'Total: {{amount}}.',
				attachmentKinds: ['day_register_pdf'],
				trigger: { kind: 'manual' }
			});
			expect(created.attachmentKinds).toEqual(['day_register_pdf']);

			const forContract = await listEmailTemplatesForContract(contractRow.id);
			expect(forContract.map((t) => t.id)).toEqual([created.id]);

			const updated = await updateEmailTemplate(created.id, {
				contractId: contractRow.id,
				name: 'Invoice cover note',
				subject: 'Invoice {{invoice_number}} — updated',
				body: 'Total: {{amount}}. Due {{due_date}}.',
				attachmentKinds: ['day_register_pdf', 'day_register_csv'],
				trigger: { kind: 'days_before_due', days: 7 }
			});
			expect(updated.subject).toContain('updated');
			expect(updated.attachmentKinds).toEqual(['day_register_pdf', 'day_register_csv']);

			const fetched = await getEmailTemplate(created.id);
			expect(fetched?.trigger).toEqual({ kind: 'days_before_due', days: 7 });

			tx.rollback();
		})
	).rejects.toThrow();
});

test('the database rejects an attachment kind outside the known set, defense in depth', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			// Deliberately outside the CHECK-constrained set: the cast below
			// widens past the narrower `EmailAttachmentKind[]` type so the
			// database's own rejection, not TypeScript's, is what this proves.
			const insert = tx.insert(emailTemplate).values({
				contractId: contractRow.id,
				name: 'Bad',
				subject: 'Subject',
				body: 'Body',
				attachmentKinds: ['invoice_pdf'],
				trigger: { kind: 'manual' }
			} as unknown as typeof emailTemplate.$inferInsert);
			await expect(insert).rejects.toSatisfy((error) =>
				isPostgresConstraintViolation(error, '23514', 'email_template_attachment_kinds_known')
			);
			tx.rollback();
		})
	).rejects.toThrow();
});

test('the database rejects a malformed trigger shape, defense in depth', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			// Deliberately malformed (negative days): same reasoning as above.
			const insert = tx.insert(emailTemplate).values({
				contractId: contractRow.id,
				name: 'Bad',
				subject: 'Subject',
				body: 'Body',
				attachmentKinds: [],
				trigger: { kind: 'days_before_due', days: -1 }
			} satisfies typeof emailTemplate.$inferInsert);
			await expect(insert).rejects.toSatisfy((error) =>
				isPostgresConstraintViolation(error, '23514', 'email_template_trigger_shape')
			);
			tx.rollback();
		})
	).rejects.toThrow();
});
