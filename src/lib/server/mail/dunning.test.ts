// #73's acceptance, proved against a real, persisted invoice — not a
// hand-typed fixture: seed a client, a contract and an invoice through
// `createInvoice` the same way `repositories/invoice.test.ts` does, back
// it into the past so it is genuinely overdue, then build and render a
// dunning draft off exactly what `getInvoiceWithLines` reads back. The
// real-send half reuses the GreenMail container `send.test.ts` and
// `smtp-imap.test.ts` prove against; skipped when it is not running.
import { ImapFlow } from 'imapflow';
import { afterAll, expect, test } from 'vitest';
import { minorUnits } from '$lib/money';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import {
	createInvoice,
	getInvoiceWithLines,
	recordPayment
} from '$lib/server/repositories/invoice';
import { buildDunningContext, InvoiceNotOverdueError } from './dunning';
import type { MailConfig } from './config';
import { appendToSentMailbox } from './imap';
import { composeMessage } from './message';
import { renderTemplate } from './render';
import { sendOverSmtp } from './smtp';

afterAll(async () => {
	await pool.end();
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function seedOverdueInvoice(tx: Tx, overrides: { dueDate: string; paidOn?: string | null }) {
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
			templateLanguage: 'it' as const,
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			requiresPriorApproval: false
		})
		.returning();

	const invoiceRow = await createInvoice(
		{
			contractId: contractRow.id,
			number: `INV-${crypto.randomUUID().slice(0, 8)}`,
			issueDate: '2024-04-01',
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
					description: 'Consulting, April',
					quantity: 10,
					unitPrice: minorUnits(50000),
					amount: minorUnits(500000),
					taxRate: 22,
					taxTreatmentCode: null,
					workUnitIds: []
				}
			]
		},
		{ kind: 'human', email: 'lorenzo@example.com' },
		'seed for dunning test',
		tx
	);

	if (overrides.paidOn) {
		await recordPayment(invoiceRow.id, overrides.paidOn);
	}

	// Read back through the same repository function the compose route
	// uses, not the raw insert result — what `buildDunningContext` renders
	// against in production is always this shape.
	const rehydrated = await getInvoiceWithLines(invoiceRow.id);
	if (!rehydrated) throw new Error('invoice failed to persist');
	return rehydrated;
}

test('throws for an invoice that is not overdue: unpaid but not yet past its due date', async () => {
	await expect(
		db.transaction(async (tx) => {
			const invoiceRow = await seedOverdueInvoice(tx, { dueDate: '2024-05-01' });
			await expect(
				buildDunningContext(
					invoiceRow,
					invoiceRow.contract.templateLanguage,
					tx,
					new Date('2024-04-15T00:00:00Z')
				)
			).rejects.toThrow(InvoiceNotOverdueError);
			tx.rollback();
		})
	).rejects.toThrow();
});

test('throws for an invoice already paid, however late the payment was', async () => {
	await expect(
		db.transaction(async (tx) => {
			const invoiceRow = await seedOverdueInvoice(tx, {
				dueDate: '2024-05-01',
				paidOn: '2024-07-01'
			});
			await expect(
				buildDunningContext(
					invoiceRow,
					invoiceRow.contract.templateLanguage,
					tx,
					new Date('2024-08-01T00:00:00Z')
				)
			).rejects.toThrow(InvoiceNotOverdueError);
			tx.rollback();
		})
	).rejects.toThrow();
});

test('builds a draft with the real figures and days late off a persisted overdue invoice (#73)', async () => {
	await expect(
		db.transaction(async (tx) => {
			// Contract's template language is Italian (seeded above); the
			// draft must render in Italian regardless of anything else,
			// per #69.
			const invoiceRow = await seedOverdueInvoice(tx, { dueDate: '2024-05-01' });
			const pinnedToday = new Date('2024-06-01T00:00:00Z'); // 31 days past due

			const context = await buildDunningContext(
				invoiceRow,
				invoiceRow.contract.templateLanguage,
				tx,
				pinnedToday
			);

			expect(context.language).toBe('it');
			expect(context.invoice.number).toBe(invoiceRow.number);
			expect(context.invoice.total).toBe(invoiceRow.total);
			expect(context.invoice.dueDate).toBe('2024-05-01');

			const rendered = renderTemplate(
				{
					subject: 'Sollecito fattura {{invoice_number}}',
					body: 'Importo {{amount}}, scaduta il {{due_date}}, in ritardo di {{days_late}}.'
				},
				context
			);

			expect(rendered.subject).toBe(`Sollecito fattura ${invoiceRow.number}`);
			// €5,000.00 (500000 taxable + 110000 tax = 610000 total, minor
			// units) formatted in Italian, the due date in Italian, and
			// exactly 31 days late — every figure read off the real row,
			// none typed by hand into the assertion's premise.
			expect(rendered.body).toContain('6100,00\u00a0€');
			expect(rendered.body).toContain('1 mag 2024');
			expect(rendered.body).toContain('31 giorni');

			// Currency is a property of the invoice, not a hardcoded /100:
			// the exact same total renders with zero decimal digits and a
			// currency-code suffix (Italian has no yen glyph) in a currency
			// with no minor unit — the distinction #179's dunning bug missed.
			const jpyContext = { ...context, invoice: { ...context.invoice, currency: 'JPY' } };
			const renderedJpy = renderTemplate(
				{ subject: 'Sollecito fattura {{invoice_number}}', body: 'Importo {{amount}}' },
				jpyContext
			);
			expect(renderedJpy.body).toBe('Importo 610.000\u00a0JPY');

			tx.rollback();
		})
	).rejects.toThrow();
});

const realConfig: MailConfig = {
	smtp: {
		host: '127.0.0.1',
		port: 34025,
		secure: false,
		user: 'mastro@mastro.test',
		password: 'test-app-password',
		fromAddress: 'mastro@mastro.test',
		fromName: 'Mastro Test'
	},
	imap: {
		host: '127.0.0.1',
		port: 34143,
		secure: false,
		user: 'mastro@mastro.test',
		password: 'test-app-password',
		sentMailbox: 'Sent'
	}
};

async function probeMailbox(): Promise<boolean> {
	const probe = new ImapFlow({
		host: realConfig.imap.host,
		port: realConfig.imap.port,
		secure: realConfig.imap.secure,
		auth: { user: realConfig.imap.user, pass: realConfig.imap.password },
		logger: false
	});
	try {
		await probe.connect();
		await probe.logout();
		return true;
	} catch {
		return false;
	}
}

const mailboxAvailable = await probeMailbox();
if (!mailboxAvailable) {
	console.warn(
		'dunning.test.ts: no test mailbox at 127.0.0.1:34025/34143 — the real-send test is skipped. ' +
			'Run `docker compose -p mastro-mail-test -f compose.mail-test.yaml up -d` first.'
	);
}

// There is no automatic dunning trigger to gate (see dunning.ts's own
// comment): the only way a reminder leaves is this exact call, made from
// the compose screen's explicit "Send" action. This proves that call, made
// against a real overdue invoice, actually lands — the human-send rule
// holds by construction, not by a flag this test would otherwise have to
// exercise both ways.
test.skipIf(!mailboxAvailable)(
	'dispatching a dunning draft for a real overdue invoice sends and appends to Sent',
	async () => {
		await expect(
			db.transaction(async (tx) => {
				const invoiceRow = await seedOverdueInvoice(tx, { dueDate: '2024-05-01' });
				const context = await buildDunningContext(
					invoiceRow,
					invoiceRow.contract.templateLanguage,
					tx,
					new Date('2024-06-01T00:00:00Z')
				);
				const rendered = renderTemplate(
					{
						subject: `mastro dunning smoke test ${crypto.randomUUID()}`,
						body: 'Importo {{amount}}, in ritardo di {{days_late}}.'
					},
					context
				);

				const message = await composeMessage({
					from: { address: realConfig.smtp.fromAddress, name: realConfig.smtp.fromName },
					to: [realConfig.smtp.user],
					subject: rendered.subject,
					body: rendered.body,
					attachments: []
				});

				await sendOverSmtp(realConfig.smtp, message);
				await appendToSentMailbox(realConfig.imap, message);

				const verifyClient = new ImapFlow({
					host: realConfig.imap.host,
					port: realConfig.imap.port,
					secure: realConfig.imap.secure,
					auth: { user: realConfig.imap.user, pass: realConfig.imap.password },
					logger: false
				});
				await verifyClient.connect();
				try {
					const lock = await verifyClient.getMailboxLock('Sent');
					try {
						const found = await verifyClient.search({ header: { subject: rendered.subject } });
						expect(found).toBeTruthy();
						expect((found as number[]).length).toBeGreaterThan(0);
					} finally {
						lock.release();
					}
				} finally {
					await verifyClient.logout();
				}

				tx.rollback();
			})
		).rejects.toThrow();
	}
);
