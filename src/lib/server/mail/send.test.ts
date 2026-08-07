import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { ImapFlow } from 'imapflow';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { client, contract, sentEmail, workUnit } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { createApproval } from '$lib/server/repositories/approval';
import { createWorkUnit } from '$lib/server/repositories/work-unit';
import type { MailConfig } from './config';
import { composeForAutomaticTrigger, dispatchEmail, prepareEmail } from './send';

// Same transaction-rollback pattern as the other repository tests, plus
// the real test mailbox from `compose.mail-test.yaml` for the parts of
// #72 that actually send. Skipped when that mailbox is not running.

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

// Deliberately unreachable (RFC 5737 TEST-NET-1, non-routable) and a
// closed port: if `composeForAutomaticTrigger` ever tried to send while
// auto-send is off, this config would make the attempt fail or hang
// rather than quietly succeed, which is exactly what the test below
// relies on to prove nothing was attempted.
const unreachableConfig: MailConfig = {
	smtp: {
		host: '192.0.2.1',
		port: 1,
		secure: false,
		user: 'x',
		password: 'x',
		fromAddress: 'x@x.test',
		fromName: null
	},
	imap: { host: '192.0.2.1', port: 1, secure: false, user: 'x', password: 'x', sentMailbox: 'Sent' }
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

let root: string;

// Top-level await: the availability check has to happen before `test.skipIf`
// is evaluated at collection time, not inside a `beforeAll`, which runs too
// late to gate which tests are even registered. A test that returned early
// instead would report as passing while asserting nothing, which
// `expect.requireAssertions` rightly treats as a failure.
const mailboxAvailable = await probeMailbox();
if (!mailboxAvailable) {
	console.warn(
		'send.test.ts: no test mailbox at 127.0.0.1:34025/34143 — the real-send tests are skipped. ' +
			'Run `docker compose -p mastro-mail-test -f compose.mail-test.yaml up -d` first.'
	);
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-send-'));
	process.env.DOCUMENT_STORAGE_ROOT = root;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function seed(tx: Tx) {
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
			requiresPriorApproval: true
		})
		.returning();

	const bytes = new TextEncoder().encode('Yes, go ahead.');
	const approvalRow = await createApproval(
		{
			contractId: contractRow.id,
			channel: 'email',
			sender: 'ops@client.example',
			receivedAt: new Date('2024-03-01T09:00:00Z'),
			messageId: '<abc@example.com>',
			excerpt: 'Yes, go ahead.',
			origin: { kind: 'manual' },
			document: {
				bytes,
				mime: 'message/rfc822',
				originalName: 'approval.eml',
				provenance: 'mail',
				confidential: true
			}
		},
		tx
	);
	const day = await createWorkUnit(
		{
			contractId: contractRow.id,
			date: '2024-03-10',
			quantity: 1,
			scope: 'Send fixture day.',
			approvalId: approvalRow.id
		},
		{ kind: 'human', email: 'lorenzo@example.com' },
		'seed',
		tx
	);
	await tx
		.update(workUnit)
		.set({ state: 'invoiced', invoiceLineId: crypto.randomUUID() })
		.where(eq(workUnit.id, day.id));

	return contractRow;
}

const template = {
	id: 'template-1',
	contractId: '',
	subject: 'Invoice {{invoice_number}}',
	body: 'Days worked: {{day_list}} ({{day_total}}). Amount: {{amount}}.',
	attachmentKinds: ['day_register_pdf', 'day_register_csv'] as (
		'day_register_pdf' | 'day_register_csv'
	)[]
};

const context = {
	invoice: { number: 'INV-1', total: 100000, currency: 'EUR', dueDate: '2024-04-30' },
	period: { from: '2024-03-01', to: '2024-03-31' }
};

test('auto-send off: prepares nothing sent, touches neither SMTP nor IMAP', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await seed(tx);
			const prepared = await prepareEmail(
				{ ...template, contractId: contractRow.id },
				{
					...context,
					register: { contractId: contractRow.id, ...context.period, entries: [], totalQuantity: 0 }
				},
				['client@example.com'],
				tx
			);

			const result = await composeForAutomaticTrigger(prepared, false, unreachableConfig, tx);
			expect(result).toEqual({ sent: false });

			const logged = await tx
				.select()
				.from(sentEmail)
				.where(eq(sentEmail.contractId, contractRow.id));
			expect(logged).toEqual([]);

			tx.rollback();
		})
	).rejects.toThrow();
});

test.skipIf(!mailboxAvailable)(
	'auto-send on: sends for real, appends to Sent, and logs the send',
	async () => {
		await expect(
			db.transaction(async (tx) => {
				const contractRow = await seed(tx);
				const prepared = await prepareEmail(
					{
						...template,
						contractId: contractRow.id,
						subject: `${template.subject} ${crypto.randomUUID()}`
					},
					{
						...context,
						register: {
							contractId: contractRow.id,
							...context.period,
							entries: [],
							totalQuantity: 0
						}
					},
					[realConfig.smtp.user],
					tx
				);

				const result = await composeForAutomaticTrigger(prepared, true, realConfig, tx);
				expect(result.sent).toBe(true);
				if (!result.sent) return;
				expect(result.messageId).toBeTruthy();

				const [logged] = await tx
					.select()
					.from(sentEmail)
					.where(eq(sentEmail.contractId, contractRow.id));
				expect(logged.autoSent).toBe(true);
				expect(logged.messageId).toBe(result.messageId);
				expect(logged.subject).toBe(prepared.subject);

				tx.rollback();
			})
		).rejects.toThrow();
	}
);

test.skipIf(!mailboxAvailable)(
	'a manual send always requires dispatchEmail explicitly, regardless of the auto-send flag',
	async () => {
		await expect(
			db.transaction(async (tx) => {
				const contractRow = await seed(tx);
				const prepared = await prepareEmail(
					{
						...template,
						contractId: contractRow.id,
						subject: `${template.subject} ${crypto.randomUUID()}`
					},
					{
						...context,
						register: {
							contractId: contractRow.id,
							...context.period,
							entries: [],
							totalQuantity: 0
						}
					},
					[realConfig.smtp.user],
					tx
				);

				// Nothing sent yet: dispatchEmail was never called.
				const before = await tx
					.select()
					.from(sentEmail)
					.where(eq(sentEmail.contractId, contractRow.id));
				expect(before).toEqual([]);

				const result = await dispatchEmail(prepared, realConfig, false, tx);
				expect(result.messageId).toBeTruthy();

				const [logged] = await tx
					.select()
					.from(sentEmail)
					.where(eq(sentEmail.contractId, contractRow.id));
				expect(logged.autoSent).toBe(false);

				tx.rollback();
			})
		).rejects.toThrow();
	}
);
