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
		const mailboxes = await client.list();
		const specialUseSent = mailboxes.find((mailbox) => mailbox.specialUse === '\\Sent');
		const target = specialUseSent?.path ?? config.sentMailbox;

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
