// The real thing, not a mock (#72's acceptance): sends over SMTP to a
// throwaway GreenMail container (`compose.mail-test.yaml`) with an app
// password, then proves the message actually landed in the same account's
// Sent folder by reading it back over IMAP. Skipped automatically when
// the test mailbox is not running, the same way the Postgres-backed
// repository tests need `pnpm db:up` first — see the PR description for
// exactly what this does and does not prove about a real mailbox.
import { ImapFlow } from 'imapflow';
import { expect, test } from 'vitest';
import { appendToSentMailbox } from './imap';
import { composeMessage } from './message';
import { sendOverSmtp } from './smtp';
import { DEFAULT_IMAP_MAX_MESSAGE_BYTES, type MailConfig } from './config';
import { MAIL_TEST_HOST, MAIL_TEST_IMAP_PORT, MAIL_TEST_SMTP_PORT } from './test-server-env';

const config: MailConfig = {
	smtp: {
		host: MAIL_TEST_HOST,
		port: MAIL_TEST_SMTP_PORT,
		secure: false,
		user: 'mastro@mastro.test',
		password: 'test-app-password',
		fromAddress: 'mastro@mastro.test',
		fromName: 'Mastro Test'
	},
	imap: {
		host: MAIL_TEST_HOST,
		port: MAIL_TEST_IMAP_PORT,
		secure: false,
		user: 'mastro@mastro.test',
		password: 'test-app-password',
		sentMailbox: 'Sent',
		inboxMailbox: 'INBOX',
		inboxLookbackDays: 30,
		maxMessageBytes: DEFAULT_IMAP_MAX_MESSAGE_BYTES
	}
};

async function probeMailbox(): Promise<boolean> {
	const probe = new ImapFlow({
		host: config.imap.host,
		port: config.imap.port,
		secure: config.imap.secure,
		auth: { user: config.imap.user, pass: config.imap.password },
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

// Top-level await: the availability check has to happen before
// `test.skipIf` is evaluated at collection time, not inside a `beforeAll`
// (which runs too late to gate which tests are even registered).
const mailboxAvailable = await probeMailbox();
if (!mailboxAvailable) {
	console.warn(
		`smtp-imap.test.ts: no test mailbox at ${config.imap.host}:${config.smtp.port}/${config.imap.port} — skipping. ` +
			'Run `docker compose -f compose.mail-test.yaml up -d` first.'
	);
}

test.skipIf(!mailboxAvailable)(
	'a sent message appears in the Sent folder, byte-identical to what was sent',
	async () => {
		const nonce = crypto.randomUUID();
		const subject = `mastro smoke test ${nonce}`;

		const message = await composeMessage({
			from: { address: config.smtp.fromAddress, name: config.smtp.fromName },
			to: [config.smtp.user],
			subject,
			body: 'This is a smoke test of the SMTP send + IMAP Sent append path.',
			attachments: [
				{
					filename: 'note.txt',
					contentType: 'text/plain',
					content: Buffer.from('attachment content')
				}
			]
		});

		await sendOverSmtp(config.smtp, message);
		await appendToSentMailbox(config.imap, message);

		const client = new ImapFlow({
			host: config.imap.host,
			port: config.imap.port,
			secure: config.imap.secure,
			auth: { user: config.imap.user, pass: config.imap.password },
			logger: false
		});
		await client.connect();
		try {
			const lock = await client.getMailboxLock('Sent');
			try {
				const uids = await client.search({ header: { subject } }, { uid: true });
				if (uids === false) throw new Error('search returned false');
				expect(uids.length).toBe(1);

				const [uid] = uids;
				const fetched = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
				expect(fetched).not.toBe(false);
				if (fetched === false) return;

				expect(fetched.envelope?.subject).toBe(subject);
				// Byte-identical to what `sendOverSmtp` transmitted, not a
				// re-derived summary of it.
				expect(Buffer.isBuffer(fetched.source) ? fetched.source.equals(message.raw) : false).toBe(
					true
				);
			} finally {
				lock.release();
			}
		} finally {
			await client.logout();
		}
	}
);
