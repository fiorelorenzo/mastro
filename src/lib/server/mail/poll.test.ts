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
//
// #394 dropped the per-contract mail folder entirely: attribution is by
// sender only (`client_contact.email`), and a pass polls exactly one
// watched mailbox. Most cases below still want an isolated mailbox per
// test rather than sharing the one real `INBOX`, so they call
// `pollMailboxTarget` directly against a throwaway mailbox created for
// the test (`testFolder`) instead of going through `pollMailboxesOnce`,
// which is now hardwired to `imapConfig.inboxMailbox`. Only the cases
// that are actually about the wiring — a connection failure, the
// watched mailbox itself being wrong, a `mailbox_poll_run` row getting
// written — go through `pollMailboxesOnce`, and the couple of cases
// about the lookback window and the "shared inbox, unknown sender" shape
// use the real `INBOX`, same as before #394, because both are
// specifically about what the *watched* mailbox does.

import { ImapFlow } from 'imapflow';
import { desc, eq } from 'drizzle-orm';
import { afterAll, afterEach, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import {
	listInboundThreadsAwaitingExtraction,
	recordInboundThread
} from '$lib/server/repositories/inbound-thread';
import { storeDocument } from '$lib/server/repositories/document';
import {
	client,
	clientContact,
	contract,
	document,
	inboundThread,
	mailboxPollRun,
	type ExpensePolicy,
	type PaymentTerms
} from '$lib/server/db/schema';
import { connectWithRetry, pollMailboxesOnce, pollMailboxTarget } from './poll';
import { DEFAULT_IMAP_MAX_MESSAGE_BYTES, type ImapConfig } from './config';

const imapConfig: ImapConfig = {
	host: '127.0.0.1',
	port: 34143,
	secure: false,
	user: 'mastro@mastro.test',
	password: 'test-app-password',
	sentMailbox: 'Sent',
	inboxMailbox: 'INBOX',
	inboxLookbackDays: 30,
	maxMessageBytes: DEFAULT_IMAP_MAX_MESSAGE_BYTES
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
// Every mailbox this file creates through `testFolder`. Doubles as the DB
// cleanup key too: every `inbound_thread` row this file writes carries one
// of these mailbox names, known-sender or not — unlike the old per-contract
// scoping, which only ever caught rows attributed to a contract this file
// created and silently leaked every unattributed one (#394's own shape:
// an unattributed row has `contract_id = null`, invisible to that filter).
const createdFolders: string[] = [];
const createdRunIds: string[] = [];

afterEach(async () => {
	for (const mailbox of createdFolders) {
		const documentIds = (
			await db
				.select({ documentId: inboundThread.documentId })
				.from(inboundThread)
				.where(eq(inboundThread.mailbox, mailbox))
		)
			.map((row) => row.documentId)
			.filter((id): id is string => id !== null);
		await db.delete(inboundThread).where(eq(inboundThread.mailbox, mailbox));
		for (const documentId of documentIds) {
			await db.delete(document).where(eq(document.id, documentId));
		}
	}
	for (const id of createdContractIds) {
		await db.delete(contract).where(eq(contract.id, id));
	}
	for (const id of createdClientIds) {
		// `client_contact` cascades on `client` deletion (onDelete: 'cascade').
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

/** A contract with a real client behind it, for sender-based attribution
 * (#394): there is no folder to map any more, so what makes a message
 * "known" is a `client_contact` row whose email matches the sender —
 * `addContact` below adds one. */
async function createTestContract(): Promise<{ contractId: string; clientId: string }> {
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
			// `attributeBySender` only considers active contracts (#394's own
			// conservative rule) — the default `status` is `draft`, which
			// would silently make every fixture in this file unattributable.
			status: 'active' as const
		})
		.returning();
	createdContractIds.push(contractRow.id);
	return { contractId: contractRow.id, clientId: clientRow.id };
}

async function addContact(clientId: string, email: string) {
	await db
		.insert(clientContact)
		.values({ clientId, name: 'Test Contact', email, canApprove: true });
}

function testFolder(label: string): string {
	const folder = `poll-test-${label}-${crypto.randomUUID()}`;
	createdFolders.push(folder);
	return folder;
}

async function appendMessage(
	folder: string,
	options: {
		messageId: string;
		subject?: string;
		ensureFolder?: boolean;
		body?: string;
		internalDate?: Date;
		/** The whole `From` header value, e.g. `Ada <ada@acme.example>` or a
		 * bare address. Defaults to a bare address, same as before. */
		from?: string;
	}
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
				`From: ${options.from ?? 'client@example.com'}\r\n` +
				`To: mastro@mastro.test\r\n\r\n` +
				(options.body ?? `body for ${options.messageId}`)
		);
		await appendClient.append(folder, raw, [], options.internalDate);
	} finally {
		await appendClient.logout();
	}
}

/** Polls one throwaway mailbox directly, the same way a real pass would
 * poll the one it watches — but on a mailbox this test made up, not
 * `imapConfig.inboxMailbox`, so tests do not fight over one shared INBOX
 * the way they would have to now that `#394` leaves only one watched
 * target. Opens its own connection and always logs out, mirroring what
 * `pollMailboxesOnce` does around `pollMailboxTarget` for the real path. */
async function pollIsolatedMailbox(
	mailbox: string,
	options: { maxMessageBytes?: number; lookbackDays?: number } = {}
) {
	const pollClient = rawClient();
	await pollClient.connect();
	try {
		return await pollMailboxTarget(
			pollClient,
			{ mailbox },
			db,
			options.maxMessageBytes ?? DEFAULT_IMAP_MAX_MESSAGE_BYTES,
			options.lookbackDays ?? 30
		);
	} finally {
		await pollClient.mailboxClose().catch(() => {});
		await pollClient.logout().catch(() => {});
	}
}

/** Calls `pollMailboxesOnce`, then tracks the `mailbox_poll_run` row it
 * just wrote (there is exactly one per pass) so `afterEach` cleans it
 * up. `config` defaults to the module's own `imapConfig`; the connection
 * -failure test overrides just `port`, the missing-mailbox test just
 * `inboxMailbox`. */
async function pollOnce(
	options: Parameters<typeof pollMailboxesOnce>[1] = {},
	config: ImapConfig = imapConfig
) {
	const result = await pollMailboxesOnce(config, options);
	{
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
		const folder = testFolder('restart');
		const { contractId, clientId } = await createTestContract();
		const senderEmail = `restart-${crypto.randomUUID()}@example.com`;
		await addContact(clientId, senderEmail);
		const messageIdOne = `<one-${crypto.randomUUID()}@example.com>`;

		await appendMessage(folder, {
			messageId: messageIdOne,
			subject: 'first approval',
			from: senderEmail
		});

		const first = await pollIsolatedMailbox(folder);
		expect(first.error).toBeNull();
		expect(first.handedOff).toBe(1);

		const afterFirst = await db
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.mailbox, folder));
		expect(afterFirst).toHaveLength(1);
		expect(afterFirst[0].messageId).toBe(messageIdOne);
		expect(afterFirst[0].contractId).toBe(contractId);

		const archived = await db
			.select()
			.from(document)
			// This message was archived, not skipped (#306) — its
			// `documentId` is never null here.
			.where(eq(document.id, afterFirst[0].documentId!));
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
		// (there is none), only what `pollMailboxTarget` re-reads from
		// Postgres, exactly what a real process restart would also do.
		const second = await pollIsolatedMailbox(folder);
		expect(second.error).toBeNull();
		expect(second.handedOff).toBe(0);

		const afterSecond = await db
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.mailbox, folder));
		expect(afterSecond).toHaveLength(1); // not reprocessed

		// A genuinely new message, after the "restart", is still picked up.
		const messageIdTwo = `<two-${crypto.randomUUID()}@example.com>`;
		await appendMessage(folder, {
			messageId: messageIdTwo,
			subject: 'second approval',
			from: senderEmail
		});
		const third = await pollIsolatedMailbox(folder);
		expect(third.handedOff).toBe(1);

		const afterThird = await db
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.mailbox, folder));
		expect(afterThird).toHaveLength(2);
		expect(afterThird.map((row) => row.messageId).sort()).toEqual(
			[messageIdOne, messageIdTwo].sort()
		);
	}
);

test.skipIf(!mailboxAvailable)(
	'a message over the configured ceiling is never archived, but its arrival is still recorded with a readable reason (#306)',
	async () => {
		const folder = testFolder('oversized');
		const { contractId, clientId } = await createTestContract();
		const senderEmail = `oversized-${crypto.randomUUID()}@example.com`;
		await addContact(clientId, senderEmail);
		const messageIdBig = `<big-${crypto.randomUUID()}@example.com>`;
		const messageIdSmall = `<small-${crypto.randomUUID()}@example.com>`;

		// A tight ceiling so the test proves the comparison against
		// `message.size`, not a specific byte count — the small message's
		// own headers plus a short body stay comfortably under it, and the
		// big one's 2000-byte body pushes it comfortably over.
		await appendMessage(folder, {
			messageId: messageIdBig,
			subject: 'an approval with a large attachment',
			body: 'x'.repeat(2000),
			from: senderEmail
		});
		await appendMessage(folder, {
			messageId: messageIdSmall,
			subject: 'a small approval',
			from: senderEmail
		});

		const result = await pollIsolatedMailbox(folder, { maxMessageBytes: 1000 });
		expect(result.error).toBeNull();
		// "Handed off" counts documents archived, not every row recorded —
		// only the small message was ever buffered whole. "Skipped" (#343)
		// is the oversized-arrival counterpart, read by the mail page's
		// poll-now action to report "N archived, M skipped".
		expect(result.handedOff).toBe(1);
		expect(result.skipped).toBe(1);

		const rows = await db.select().from(inboundThread).where(eq(inboundThread.mailbox, folder));
		expect(rows).toHaveLength(2);

		const skipped = rows.find((row) => row.messageId === messageIdBig);
		expect(skipped?.archived).toBe(false);
		expect(skipped?.documentId).toBeNull();
		expect(skipped?.skipReason).toBe('oversized');
		expect(skipped?.messageSize).toBeGreaterThan(1000);
		// Recorded even though the bytes were refused (#394, invariant 4):
		// a message from a known sender does not disappear without a trace
		// just because its own size cost it the archive.
		expect(skipped?.senderAddress).toBe(senderEmail.toLowerCase());
		expect(skipped?.contractId).toBe(contractId);

		const kept = rows.find((row) => row.messageId === messageIdSmall);
		expect(kept?.archived).toBe(true);
		expect(kept?.documentId).not.toBeNull();

		// Never buffered whole, never written to the blob store: exactly
		// one `document` row exists for this contract, the small message's.
		const documents = await db.select().from(document).where(eq(document.contractId, contractId));
		expect(documents).toHaveLength(1);
		expect(documents[0].id).toBe(kept?.documentId);
	}
);

test.skipIf(!mailboxAvailable)(
	'a UIDVALIDITY bump does not reprocess a message already handed off, but a genuinely new one under the new generation is still picked up',
	async () => {
		const folder = testFolder('uidvalidity-bump');
		const { clientId } = await createTestContract();
		const senderEmail = `bump-${crypto.randomUUID()}@example.com`;
		await addContact(clientId, senderEmail);
		const messageIdOld = `<old-${crypto.randomUUID()}@example.com>`;

		await appendMessage(folder, {
			messageId: messageIdOld,
			subject: 'before the bump',
			from: senderEmail
		});
		const first = await pollIsolatedMailbox(folder);
		expect(first.handedOff).toBe(1);

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
			ensureFolder: false,
			from: senderEmail
		});
		const messageIdNew = `<new-${crypto.randomUUID()}@example.com>`;
		await appendMessage(folder, {
			messageId: messageIdNew,
			subject: 'after the bump',
			ensureFolder: false,
			from: senderEmail
		});

		const second = await pollIsolatedMailbox(folder);
		expect(second.error).toBeNull();

		const rows = await db.select().from(inboundThread).where(eq(inboundThread.mailbox, folder));
		// Exactly two: the original message once, the new message once —
		// not three, which is what happens if the UIDVALIDITY bump alone
		// were trusted to mean "everything is new".
		expect(rows).toHaveLength(2);
		expect(rows.filter((row) => row.messageId === messageIdOld)).toHaveLength(1);
		expect(rows.filter((row) => row.messageId === messageIdNew)).toHaveLength(1);
	}
);

test.skipIf(!mailboxAvailable)(
	'the watched mailbox not existing surfaces as a recorded failure — since #394 there is only ever one target to fail',
	async () => {
		const missingMailbox = `does-not-exist-${crypto.randomUUID()}`;
		const result = await pollOnce({}, { ...imapConfig, inboxMailbox: missingMailbox });

		expect(result.status).toBe('failure');
		expect(result.mailbox.mailbox).toBe(missingMailbox);
		expect(result.mailbox.error).not.toBeNull();
		expect(result.mailbox.handedOff).toBe(0);

		const [run] = await db
			.select()
			.from(mailboxPollRun)
			.orderBy(desc(mailboxPollRun.createdAt))
			.limit(1);
		expect(run.status).toBe('failure');
		expect(run.detail).toContain(missingMailbox);
	}
);

test.skipIf(!mailboxAvailable)(
	'a connection failure is retried with backoff, then surfaced as a recorded failure rather than swallowed',
	async () => {
		const unreachableConfig: ImapConfig = { ...imapConfig, port: 1 }; // nothing listens on port 1
		const attempts: number[] = [];
		const start = Date.now();

		const result = await pollOnce(
			{
				maxAttempts: 3,
				backoffBaseMs: 10,
				delay: async (ms) => {
					attempts.push(ms);
				}
			},
			unreachableConfig
		);

		expect(result.status).toBe('failure');
		expect(result.mailbox.handedOff).toBe(0); // never got to a mailbox — the connection itself failed
		expect(result.mailbox.error).not.toBeNull();
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

// #380 replaced the old "nothing configured, nothing attempted" behaviour on
// purpose: credentials now imply a mailbox to watch, so a pass always runs and
// always records a run. The thing worth pinning down is what it does with a
// mailbox full of mail from senders nobody knows, which is what a real inbox
// is: it archives them and hands none of them to extraction.
// #380's own regression, measured on a real instance before it was bounded:
// a first pass over a mailbox nobody had polled started at UID 1 and archived
// nine years of mail — 21,747 messages, 3.7 GB, not one proposal, because a
// watched mailbox is for catching what arrives. The window is what stops that.
test.skipIf(!mailboxAvailable)(
	'a first pass reaches back only as far as the lookback window, not to the start of the account',
	async () => {
		const oldId = `<ancient-${crypto.randomUUID()}@example.com>`;
		const freshId = `<fresh-${crypto.randomUUID()}@example.com>`;
		const ancient = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

		await appendMessage('INBOX', { messageId: oldId, internalDate: ancient });
		await appendMessage('INBOX', { messageId: freshId });

		// The window only governs a *first* pass: once a cursor exists the UID
		// range is the bound, and an old message appended late legitimately
		// has a high UID. So this has to be a first pass, which means no
		// cursor for INBOX — the state a real instance is in the moment
		// ingestion is switched on.
		await db.delete(inboundThread).where(eq(inboundThread.mailbox, 'INBOX'));

		await pollOnce();

		const archivedIds = (
			await db.select({ messageId: inboundThread.messageId }).from(inboundThread)
		).map((row) => row.messageId);

		// Scoped to the two ids this test appended: the mailbox is shared.
		expect(archivedIds).toContain(freshId);
		expect(archivedIds).not.toContain(oldId);
	}
);

test.skipIf(!mailboxAvailable)(
	'the shared mailbox archives a message from an unknown sender but never queues it for extraction',
	async () => {
		const messageId = `<stranger-${crypto.randomUUID()}@example.com>`;
		await appendMessage('INBOX', { messageId, subject: 'a newsletter' });

		const result = await pollOnce();

		expect(result.status).toBe('success');
		expect(result.mailbox.mailbox).toBe('INBOX');
		// Kept, and deliberately not read.
		expect(result.mailbox.archivedUnknownSender).toBeGreaterThanOrEqual(1);

		const [archived] = await db
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.messageId, messageId));
		expect(archived.archived).toBe(true);
		expect(archived.documentId).not.toBeNull();
		expect(archived.contractId).toBeNull();
		expect(archived.skipReason).toBe('sender_unknown');

		// And the guard holds where it matters: the drain never sees it.
		const queued = await listInboundThreadsAwaitingExtraction(500);
		expect(queued.map((row) => row.id)).not.toContain(archived.id);
	}
);

test.skipIf(!mailboxAvailable)(
	'the sender address is recorded, lower-cased, for a known sender and an unknown one alike (#394)',
	async () => {
		const folder = testFolder('sender-address');
		const { contractId, clientId } = await createTestContract();
		const knownEmail = `known-${crypto.randomUUID()}@example.com`;
		await addContact(clientId, knownEmail);

		const messageIdKnown = `<known-${crypto.randomUUID()}@example.com>`;
		const messageIdUnknown = `<unknown-${crypto.randomUUID()}@example.com>`;
		// Deliberately mixed case and a display name on the known sender,
		// a bare mixed-case address on the unknown one: the leonardo@ vs
		// leo@ near-miss that motivated #394 was a case where nothing
		// recorded the address at all, so both forms need to land
		// lower-cased whether or not the header carries a display name.
		const unknownEmail = `Stranger-${crypto.randomUUID()}@Somewhere.EXAMPLE`;

		await appendMessage(folder, {
			messageId: messageIdKnown,
			subject: 'from a display-name From header',
			from: `Known Sender <${knownEmail.toUpperCase()}>`
		});
		await appendMessage(folder, {
			messageId: messageIdUnknown,
			subject: 'from a bare address',
			from: unknownEmail
		});

		const result = await pollIsolatedMailbox(folder);
		expect(result.error).toBeNull();
		expect(result.handedOff).toBe(1);
		expect(result.archivedUnknownSender).toBe(1);

		const rows = await db.select().from(inboundThread).where(eq(inboundThread.mailbox, folder));
		const knownRow = rows.find((row) => row.messageId === messageIdKnown);
		const unknownRow = rows.find((row) => row.messageId === messageIdUnknown);

		expect(knownRow?.senderAddress).toBe(knownEmail.toLowerCase());
		expect(knownRow?.contractId).toBe(contractId);
		expect(knownRow?.skipReason).toBeNull();

		expect(unknownRow?.senderAddress).toBe(unknownEmail.toLowerCase());
		expect(unknownRow?.contractId).toBeNull();
		expect(unknownRow?.skipReason).toBe('sender_unknown');
	}
);

test.skipIf(!mailboxAvailable)(
	'a poll recovers a contact added since the last pass even with no new mail at all, because reattribution runs before mailboxOpen (#388)',
	async () => {
		const folder = testFolder('recovery');
		// A real, empty mailbox: nothing is ever appended to it. The point
		// of this case is that recovery does not depend on there being
		// anything new to fetch — `pollMailboxTarget` runs
		// `reattributeKnownSenders` before it ever calls `mailboxOpen`.
		const ensureClient = rawClient();
		await ensureClient.connect();
		await ensureClient.mailboxCreate(folder).catch(() => {});
		await ensureClient.logout();

		const { contractId, clientId } = await createTestContract();
		const senderEmail = `recovery-${crypto.randomUUID()}@example.com`;

		// Stands in for a message an earlier pass already archived, before
		// this contact existed — recorded directly rather than through a
		// poll, the same way #388's own regression looked in production: a
		// message sitting on disk, correctly kept, invisible to extraction.
		const documentRow = await storeDocument({
			bytes: new TextEncoder().encode('an approval that arrived before its sender was known'),
			mime: 'message/rfc822',
			originalName: 'thread.eml',
			provenance: 'mail',
			contractId: null,
			confidential: true,
			ownerType: null,
			ownerId: null
		});
		const threadRow = await recordInboundThread({
			contractId: null,
			documentId: documentRow.id,
			mailbox: folder,
			imapUidValidity: 1_700_000_001,
			imapUid: 1,
			messageId: `<older-${crypto.randomUUID()}@example.com>`,
			subject: 'an older approval',
			inReplyTo: null,
			senderAddress: senderEmail,
			receivedAt: new Date('2026-08-01T09:00:00.000Z'),
			skipReason: 'sender_unknown'
		});
		if (!threadRow) throw new Error('setup: onConflictDoNothing swallowed the insert');

		// The contact is added only now — after the message already sits on
		// disk, unattributed.
		await addContact(clientId, senderEmail);

		const result = await pollIsolatedMailbox(folder);
		expect(result.error).toBeNull();
		expect(result.handedOff).toBe(0); // nothing new arrived
		expect(result.skipped).toBe(0);
		expect(result.archivedUnknownSender).toBe(0);
		expect(result.recovered).toBeGreaterThanOrEqual(1);

		const [updatedThread] = await db
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.id, threadRow.id));
		expect(updatedThread.skipReason).toBeNull();
		expect(updatedThread.contractId).toBe(contractId);

		const [updatedDocument] = await db
			.select()
			.from(document)
			.where(eq(document.id, documentRow.id));
		expect(updatedDocument.contractId).toBe(contractId);
		expect(updatedDocument.ownerType).toBe('contract');
		expect(updatedDocument.ownerId).toBe(contractId);

		const queued = await listInboundThreadsAwaitingExtraction(500);
		expect(queued.map((row) => row.id)).toContain(threadRow.id);
	}
);
