// The digest half of #75 against a real throwaway mailbox
// (`compose.mail-test.yaml`, GreenMail on 127.0.0.1, MAIL_TEST_SMTP_PORT/
// MAIL_TEST_IMAP_PORT — 34025/34143 by default), the same pattern
// `mail/smtp-imap.test.ts` sets: skipped automatically when the test
// mailbox is not running. `runAlertPush` is not exercised here — it needs
// a real push subscription, verified separately (see the PR description)
// — this file only proves the digest's own delivery-dedup contract: sent
// once, nothing twice.
//
// SMTP/IMAP/allowlist env vars are read from the process environment
// (`mailConfigFromEnv`/`AUTH_ALLOWED_EMAILS`, both `$env/dynamic/private`)
// rather than mutated here — set them before `pnpm test` for this file,
// see the `env` block below for the exact values this test expects.

import { ImapFlow } from 'imapflow';
import { afterAll, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { client as pool, db } from '$lib/server/db';
import {
	alertDelivery,
	client,
	contract,
	type ExpensePolicy,
	type PaymentTerms
} from '$lib/server/db/schema';
import { runAlertDigest } from './dispatch';
import { MAIL_TEST_HOST, MAIL_TEST_IMAP_PORT } from '$lib/server/mail/test-server-env';

// Matches compose.mail-test.yaml's default test account, and the
// AUTH_ALLOWED_EMAILS this file needs set in the environment it runs
// under: SMTP_HOST=127.0.0.1 SMTP_PORT=34025 SMTP_SECURE=false
// SMTP_USER=mastro@mastro.test SMTP_APP_PASSWORD=test-app-password
// MAIL_FROM_ADDRESS=mastro@mastro.test IMAP_HOST=127.0.0.1
// IMAP_PORT=34143 IMAP_SECURE=false IMAP_USER=mastro@mastro.test
// IMAP_APP_PASSWORD=test-app-password AUTH_ALLOWED_EMAILS=mastro@mastro.test
// A checkout running the mail server on non-default MAIL_TEST_SMTP_PORT/
// MAIL_TEST_IMAP_PORT must set matching SMTP_PORT/IMAP_PORT values above.

async function probeMailbox(): Promise<boolean> {
	const probe = new ImapFlow({
		host: MAIL_TEST_HOST,
		port: MAIL_TEST_IMAP_PORT,
		secure: false,
		auth: { user: 'mastro@mastro.test', pass: 'test-app-password' },
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

const mailConfigured =
	process.env.SMTP_HOST === '127.0.0.1' && process.env.AUTH_ALLOWED_EMAILS === 'mastro@mastro.test';
const mailboxAvailable = mailConfigured && (await probeMailbox());
if (!mailboxAvailable) {
	console.warn(
		'dispatch.test.ts: no test mailbox reachable, or SMTP_HOST/AUTH_ALLOWED_EMAILS not set for it — skipping. ' +
			'Run `docker compose -f compose.mail-test.yaml up -d`, export the env block in this file\u2019s header, then rerun.'
	);
}

afterAll(async () => {
	await pool.end();
});

test.skipIf(!mailboxAvailable)(
	'runAlertDigest sends one email containing an undelivered alert, then sends nothing on a second run the same day',
	async () => {
		const [clientRow] = await db
			.insert(client)
			.values({
				legalName: `Digest Test Client ${crypto.randomUUID()}`,
				taxId: `TEST-TAX-${crypto.randomUUID()}`,
				country: 'IT',
				addressLine1: 'Via Roma 1',
				addressCity: 'Milano',
				addressPostalCode: '20100',
				noticeChannel: 'email' as const
			})
			.returning();
		const [contractRow] = await db
			.insert(contract)
			.values({
				clientId: clientRow.id,
				title: 'Digest test contract',
				startsOn: '2024-01-01',
				endsOn: '2026-08-27', // 20 days out from 2026-08-07: serious, non-urgent → digest
				renewalType: 'none',
				terminationNoticeDays: 30,
				paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
				invoicingCadence: 'monthly',
				currency: 'EUR',
				taxTreatment: 'generic',
				expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
				status: 'active'
			})
			.returning();

		try {
			const first = await runAlertDigest('2026-08-07');
			expect(first.sent).toBe(true);
			expect(first.included).toBeGreaterThan(0);

			const imap = new ImapFlow({
				host: MAIL_TEST_HOST,
				port: MAIL_TEST_IMAP_PORT,
				secure: false,
				auth: { user: 'mastro@mastro.test', pass: 'test-app-password' },
				logger: false
			});
			await imap.connect();
			try {
				const lock = await imap.getMailboxLock('INBOX');
				try {
					const messages = [];
					for await (const message of imap.fetch({ all: true }, { envelope: true })) {
						messages.push(message);
					}
					expect(messages.some((m) => m.envelope?.subject?.toLowerCase().includes('alert'))).toBe(
						true
					);
				} finally {
					lock.release();
				}
			} finally {
				await imap.logout();
			}

			// Same day, run again: everything just delivered is now covered.
			const second = await runAlertDigest('2026-08-07');
			expect(second.sent).toBe(false);
			expect(second.included).toBe(0);
		} finally {
			// `runAlertDigest` also picks up `backup_failure:global` in any
			// database with no backup_run rows at all (a real, expected
			// side effect of running this against a real, otherwise-empty
			// dev database) — cleaned up here too, so a repeat run of this
			// test is not silently suppressed by its own previous delivery.
			await db
				.delete(alertDelivery)
				.where(eq(alertDelivery.alertKey, `contract_expiring:${contractRow.id}`));
			await db.delete(alertDelivery).where(eq(alertDelivery.alertKey, 'backup_failure:global'));
			await db.delete(contract).where(eq(contract.id, contractRow.id));
			await db.delete(client).where(eq(client.id, clientRow.id));
		}
	}
);
