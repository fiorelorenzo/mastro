// The real thing, not a mock (#84's own instruction, and #72's before
// it): exercises the poller against the same throwaway GreenMail
// container `smtp-imap.test.ts` uses (`compose.mail-test.yaml`), real
// IMAP APPEND, real UID/UIDVALIDITY semantics. Skipped automatically
// when the test mailbox is not running.
//
// Real, committed database writes rather than the usual rolled-back
// transaction (`db/set-updated-at.test.ts`'s pattern is the norm
// elsewhere): `pollMailboxesOnce` defaults to the pool, and the actual
// "restart" proof this file exists to give needs two independent calls
// sharing nothing but Postgres — a rolled-back transaction would prove
// the opposite of what #84 asks for. Every row created here is deleted
// again in `afterEach`.

import { ImapFlow } from 'imapflow';
import { desc, eq } from 'drizzle-orm';
import { afterAll, afterEach, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import {
	client,
	contract,
	document,
	inboundThread,
	mailboxPollRun,
	type ExpensePolicy,
	type PaymentTerms
} from '$lib/server/db/schema';
import { connectWithRetry, pollMailboxesOnce } from './poll';
import type { ImapConfig } from './config';

const imapConfig: ImapConfig = {
	host: '127.0.0.1',
	port: 34143,
	secure: false,
	user: 'mastro@mastro.test',
	password: 'test-app-password',
	sentMailbox: 'Sent'
};

function rawClient() {
	return new ImapFlow({
		host: imapConfig.host,
		port: imapConfig.port,
		secure: imapConfig.secure,
		auth: { user: imapConfig.user, pass: imapConfig.password },
		logger: false
	});
}

async function probeMailbox(): Promise<boolean> {
	const probe = rawClient();
	try {
		await probe.connect();
		await probe.logout();
		return true;
	} catch {
		return false;
	}
}

// Top-level await, same reason `smtp-imap.test.ts` gives: the
// availability check has to happen before `test.skipIf` is evaluated at
// collection time.
const mailboxAvailable = await probeMailbox();
if (!mailboxAvailable) {
	console.warn(
		'mail/poll.test.ts: no test mailbox at 127.0.0.1:34025/34143 — skipping. ' +
			'Run `docker compose -f compose.mail-test.yaml up -d` first.'
	);
}

afterAll(async () => {
	await pool.end();
});

const createdContractIds: string[] = [];
const createdClientIds: string[] = [];
const createdFolders: string[] = [];
const createdRunIds: string[] = [];

afterEach(async () => {
	for (const id of createdContractIds) {
		await db.delete(inboundThread).where(eq(inboundThread.contractId, id));
		await db.delete(document).where(eq(document.contractId, id));
	}
	for (const id of createdContractIds) {
		await db.delete(contract).where(eq(contract.id, id));
	}
	for (const id of createdClientIds) {
		await db.delete(client).where(eq(client.id, id));
	}
	for (const id of createdRunIds) {
		await db.delete(mailboxPollRun).where(eq(mailboxPollRun.id, id));
	}
	createdContractIds.length = 0;
	createdClientIds.length = 0;
	createdRunIds.length = 0;

	// `finally`, not a plain sequence: the array resets below must run
	// even if the real IMAP server rejects a delete or drops the
	// connection, or one test's leftover folder list would bleed into
	// every later test's own cleanup.
	if (mailboxAvailable && createdFolders.length > 0) {
		try {
			const cleanup = rawClient();
			await cleanup.connect();
			for (const folder of createdFolders) {
				await cleanup.mailboxDelete(folder).catch(() => {});
			}
			await cleanup.logout().catch(() => {});
		} finally {
			createdFolders.length = 0;
		}
	} else {
		createdFolders.length = 0;
	}
});

let counter = 0;

async function createTestContract(mailFolder: string | null): Promise<string> {
	counter += 1;
	const [clientRow] = await db
		.insert(client)
		.values({
			legalName: `Test Client ${counter}`,
			taxId: `TEST-TAX-${crypto.randomUUID()}`,
			country: 'IT',
			addressLine1: 'Via Roma 1',
			addressCity: 'Milano',
			addressPostalCode: '20100',
			noticeChannel: 'email' as const
		})
		.returning();
	createdClientIds.push(clientRow.id);
	const [contractRow] = await db
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
			mailFolder
		})
		.returning();
	createdContractIds.push(contractRow.id);
	return contractRow.id;
}

function testFolder(label: string): string {
	const folder = `poll-test-${label}-${crypto.randomUUID()}`;
	createdFolders.push(folder);
	return folder;
}

async function appendMessage(
	folder: string,
	options: { messageId: string; subject?: string; ensureFolder?: boolean }
) {
	const appendClient = rawClient();
	await appendClient.connect();
	try {
		if (options.ensureFolder !== false) {
			await appendClient.mailboxCreate(folder).catch(() => {});
		}
		const raw = Buffer.from(
			`Message-ID: ${options.messageId}\r\n` +
				`Subject: ${options.subject ?? 'test message'}\r\n` +
				`From: client@example.com\r\n` +
				`To: mastro@mastro.test\r\n\r\n` +
				`body for ${options.messageId}`
		);
		await appendClient.append(folder, raw, []);
	} finally {
		await appendClient.logout();
	}
}

/** Calls `pollMailboxesOnce`, then tracks the `mailbox_poll_run` row it
 * just wrote (there is exactly one, or none for a `'skipped'` result) so
 * `afterEach` cleans it up. */
async function pollOnce(options: Parameters<typeof pollMailboxesOnce>[1] = {}) {
	const result = await pollMailboxesOnce(imapConfig, options);
	if (result.status !== 'skipped') {
		const [latest] = await db
			.select({ id: mailboxPollRun.id })
			.from(mailboxPollRun)
			.orderBy(desc(mailboxPollRun.createdAt))
			.limit(1);
		if (latest && !createdRunIds.includes(latest.id)) createdRunIds.push(latest.id);
	}
	return result;
}

test.skipIf(!mailboxAvailable)(
	'a new message is handed off once, is not reprocessed across a restart, and a genuinely new message is picked up afterward',
	async () => {
		const contractId = await createTestContract(testFolder('restart'));
		const folder = (await db.query.contract.findFirst({ where: eq(contract.id, contractId) }))!
			.mailFolder!;
		const messageIdOne = `<one-${crypto.randomUUID()}@example.com>`;

		await appendMessage(folder, { messageId: messageIdOne, subject: 'first approval' });

		const first = await pollOnce();
		expect(first.status).toBe('success');
		expect(first.status === 'success' && first.folders[0].handedOff).toBe(1);

		const afterFirst = await db
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.contractId, contractId));
		expect(afterFirst).toHaveLength(1);
		expect(afterFirst[0].messageId).toBe(messageIdOne);

		const archived = await db
			.select()
			.from(document)
			.where(eq(document.id, afterFirst[0].documentId));
		expect(archived[0].ownerType).toBe('contract');
		expect(archived[0].ownerId).toBe(contractId);
		expect(archived[0].provenance).toBe('mail');
		expect(archived[0].confidential).toBe(true);
		// #300: the archived `originalName` is a display/file name, not the
		// evidence — the sender-chosen `Message-ID` must not end up there.
		// The verbatim header lives in `inbound_thread.messageId` (asserted
		// above) instead.
		expect(archived[0].originalName).not.toBe(messageIdOne);
		expect(archived[0].originalName).not.toContain(messageIdOne);

		// "Restart" — a second, fully independent call with nothing new in
		// the mailbox. Nothing carried in memory between the two calls
		// (there is none), only what `pollMailboxesOnce` re-reads from
		// Postgres, exactly what a real process restart would also do.
		const second = await pollOnce();
		expect(second.status).toBe('success');
		expect(second.status === 'success' && second.folders[0].handedOff).toBe(0);

		const afterSecond = await db
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.contractId, contractId));
		expect(afterSecond).toHaveLength(1); // not reprocessed

		// A genuinely new message, after the "restart", is still picked up.
		const messageIdTwo = `<two-${crypto.randomUUID()}@example.com>`;
		await appendMessage(folder, { messageId: messageIdTwo, subject: 'second approval' });
		const third = await pollOnce();
		expect(third.status === 'success' && third.folders[0].handedOff).toBe(1);

		const afterThird = await db
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.contractId, contractId));
		expect(afterThird).toHaveLength(2);
		expect(afterThird.map((row) => row.messageId).sort()).toEqual(
			[messageIdOne, messageIdTwo].sort()
		);
	}
);

test.skipIf(!mailboxAvailable)(
	'a UIDVALIDITY bump does not reprocess a message already handed off, but a genuinely new one under the new generation is still picked up',
	async () => {
		const folder = testFolder('uidvalidity-bump');
		const contractId = await createTestContract(folder);
		const messageIdOld = `<old-${crypto.randomUUID()}@example.com>`;

		await appendMessage(folder, { messageId: messageIdOld, subject: 'before the bump' });
		const first = await pollOnce();
		expect(first.status === 'success' && first.folders[0].handedOff).toBe(1);

		// Force a genuine UIDVALIDITY bump: delete and recreate the same
		// mailbox. This is the documented exception to "no real timers in
		// tests" — GreenMail derives UIDVALIDITY from its own server-side
		// clock at mailbox-creation time (verified empirically: two
		// deletes/recreates back to back keep the same value), so nothing
		// this process's fake-timer control reaches can force the value to
		// actually change; only a real gap on the wall clock the external
		// server itself reads can. This is exactly the "IMAP UIDs reset
		// when UIDVALIDITY changes" case #84 calls out, reproduced for
		// real against the real server rather than assumed.
		const admin = rawClient();
		await admin.connect();
		const before = await admin.mailboxOpen(folder);
		await admin.mailboxClose();
		await admin.mailboxDelete(folder);
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 1100);
		await promise;
		await admin.mailboxCreate(folder);
		const after = await admin.mailboxOpen(folder);
		await admin.logout();
		expect(after.uidValidity).not.toBe(before.uidValidity); // the premise of this test held

		// The same message, re-numbered under the new generation (a
		// provider re-syncing after the equivalent of a mailbox rebuild
		// would present it this way), plus one genuinely new message.
		await appendMessage(folder, {
			messageId: messageIdOld,
			subject: 'before the bump',
			ensureFolder: false
		});
		const messageIdNew = `<new-${crypto.randomUUID()}@example.com>`;
		await appendMessage(folder, {
			messageId: messageIdNew,
			subject: 'after the bump',
			ensureFolder: false
		});

		const second = await pollOnce();
		expect(second.status).toBe('success');

		const rows = await db
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.contractId, contractId));
		// Exactly two: the original message once, the new message once —
		// not three, which is what happens if the UIDVALIDITY bump alone
		// were trusted to mean "everything is new".
		expect(rows).toHaveLength(2);
		expect(rows.filter((row) => row.messageId === messageIdOld)).toHaveLength(1);
		expect(rows.filter((row) => row.messageId === messageIdNew)).toHaveLength(1);
	}
);

test.skipIf(!mailboxAvailable)(
	'a folder that does not exist fails that one contract without blocking another contract in the same pass',
	async () => {
		const goodFolder = testFolder('good');
		const goodContractId = await createTestContract(goodFolder);
		const badContractId = await createTestContract(`does-not-exist-${crypto.randomUUID()}`);

		await appendMessage(goodFolder, { messageId: `<ok-${crypto.randomUUID()}@example.com>` });

		const result = await pollOnce();
		expect(result.status).toBe('failure'); // one folder failed
		if (result.status === 'skipped') throw new Error('unreachable');

		const good = result.folders.find((folder) => folder.contractId === goodContractId);
		const bad = result.folders.find((folder) => folder.contractId === badContractId);
		expect(good?.error).toBeNull();
		expect(good?.handedOff).toBe(1); // the other contract's folder was not blocked
		expect(bad?.error).not.toBeNull();

		const [run] = await db
			.select()
			.from(mailboxPollRun)
			.orderBy(desc(mailboxPollRun.createdAt))
			.limit(1);
		expect(run.status).toBe('failure');
		expect(run.detail).toContain(badContractId);
	}
);

test.skipIf(!mailboxAvailable)(
	'a connection failure is retried with backoff, then surfaced as a recorded failure rather than swallowed',
	async () => {
		const contractId = await createTestContract(testFolder('unreachable'));
		void contractId;

		const unreachableConfig: ImapConfig = { ...imapConfig, port: 1 }; // nothing listens on port 1
		const attempts: number[] = [];
		const start = Date.now();

		const result = await (async () => {
			const [{ status, folders }] = await Promise.all([
				pollMailboxesOnce(unreachableConfig, {
					maxAttempts: 3,
					backoffBaseMs: 10,
					delay: async (ms) => {
						attempts.push(ms);
					}
				})
			]);
			return { status, folders };
		})();

		expect(result.status).toBe('failure');
		expect(result.folders).toEqual([]); // never got to a folder — the connection itself failed
		// Two backoff waits for three attempts (500ms/1s pattern, scaled
		// down here), each longer than the last.
		expect(attempts).toEqual([10, 20]);
		expect(Date.now() - start).toBeLessThan(2000); // the injected delay was actually used, not the real one

		const [run] = await db
			.select()
			.from(mailboxPollRun)
			.orderBy(desc(mailboxPollRun.createdAt))
			.limit(1);
		expect(run.status).toBe('failure');
		expect(run.detail).not.toBeNull();
		createdRunIds.push(run.id);
	}
);

test.skipIf(!mailboxAvailable)(
	'connectWithRetry gives up after the configured number of attempts and throws the last error',
	async () => {
		const unreachableConfig: ImapConfig = { ...imapConfig, port: 1 };
		let calls = 0;
		await expect(
			connectWithRetry(unreachableConfig, {
				maxAttempts: 4,
				backoffBaseMs: 5,
				delay: async () => {
					calls += 1;
				}
			})
		).rejects.toThrow();
		expect(calls).toBe(3); // one fewer wait than attempts
	}
);

test.skipIf(!mailboxAvailable)(
	'nothing is attempted, and no run is recorded, when no contract has a folder configured',
	async () => {
		const before = await db.select({ id: mailboxPollRun.id }).from(mailboxPollRun);
		const result = await pollMailboxesOnce(imapConfig);
		expect(result).toEqual({ status: 'skipped', reason: 'no folders configured', folders: [] });
		const after = await db.select({ id: mailboxPollRun.id }).from(mailboxPollRun);
		expect(after).toHaveLength(before.length);
	}
);
