// Appends the sent message to the user's own Sent folder over IMAP (#72),
// so the thread lives where the user expects it rather than only in
// whatever the SMTP server's own idea of "sent" is — plenty of providers
// (including the one this app is built to run against) do not copy a
// message to Sent on relay by themselves.
import { ImapFlow } from 'imapflow';
import type { ImapConfig } from './config';
import type { ComposedMessage } from './message';

/**
 * Appends `message`'s exact bytes — the same ones `sendOverSmtp` sent —
 * to the user's Sent mailbox, flagged `\Seen` since the user did, in
 * effect, just read it by sending it.
 *
 * The target mailbox is resolved via the IMAP SPECIAL-USE extension
 * (RFC 6154) when the server reports one — the only provider-independent
 * way to find "Sent" given providers name it differently (Gmail's is
 * `[Gmail]/Sent Mail`) — and falls back to `config.sentMailbox`
 * (`IMAP_SENT_MAILBOX`, default `'Sent'`) otherwise. If that mailbox does
 * not exist yet, the server answers APPEND with `TRYCREATE`: RFC 3501's
 * own signal that the client should create it and retry, which is
 * exactly what a brand new mailbox with no Sent folder yet needs and
 * what this does, once, before giving up for real.
 */
export async function appendToSentMailbox(
	config: ImapConfig,
	message: ComposedMessage
): Promise<void> {
	const client = new ImapFlow({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: { user: config.user, pass: config.password },
		logger: false
	});
	await client.connect();
	try {
		const target = (await resolveSentMailbox(client, config.sentMailbox)) ?? config.sentMailbox;

		try {
			await client.append(target, message.raw, ['\\Seen']);
		} catch (error) {
			if (
				typeof error === 'object' &&
				error !== null &&
				'serverResponseCode' in error &&
				error.serverResponseCode === 'TRYCREATE'
			) {
				await client.mailboxCreate(target);
				await client.append(target, message.raw, ['\\Seen']);
			} else {
				throw error;
			}
		}
	} finally {
		await client.logout();
	}
}

/**
 * Which mailbox holds sent mail on this server, or null when nothing does.
 *
 * The SPECIAL-USE extension (RFC 6154) is the only provider-independent way
 * to ask - providers name it differently, and Gmail's is
 * `[Gmail]/Sent Mail` - with the configured name as the fallback for a
 * server that does not report one. Extracted from `appendToSentMailbox`
 * when the sent pass (#409) needed the same answer: two copies of this
 * resolution would be two chances to append to one mailbox and read from
 * another, and nothing would look wrong.
 *
 * Null means "no such mailbox", which is a supported configuration and not
 * a failure: the poller then has nothing to read, and the appender falls
 * back to creating the configured name on TRYCREATE as it always did.
 */
export async function resolveSentMailbox(
	client: ImapFlow,
	configured: string
): Promise<string | null> {
	const mailboxes = await client.list();
	const specialUseSent = mailboxes.find((mailbox) => mailbox.specialUse === '\\Sent');
	if (specialUseSent) return specialUseSent.path;
	return mailboxes.some((mailbox) => mailbox.path === configured) ? configured : null;
}
