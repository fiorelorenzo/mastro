// Builds the exact RFC 822 bytes a send transmits (#72). One composition,
// used both for the SMTP send and the IMAP append, so what lands in the
// user's Sent folder is byte-identical to what actually left — never two
// independent renderings that could quietly drift apart.
import nodemailer from 'nodemailer';
import type { EmailAttachment } from './attachments';

export type OutgoingEmail = {
	from: { address: string; name: string | null };
	to: readonly string[];
	subject: string;
	body: string;
	attachments: readonly EmailAttachment[];
};

export type ComposedMessage = {
	raw: Buffer;
	messageId: string;
	envelope: { from: string; to: string[] };
};

/**
 * Nodemailer's "stream transport" with `buffer: true` is used purely as a
 * MIME compiler here: `createTransport({ streamTransport: true })` never
 * opens a socket, so this call has no network effect, it only returns the
 * message nodemailer would otherwise have sent — see `smtp.ts`, which
 * sends these exact bytes via `raw` rather than recomposing them.
 */
export async function composeMessage(email: OutgoingEmail): Promise<ComposedMessage> {
	const compiler = nodemailer.createTransport({ streamTransport: true, buffer: true });
	const info = await compiler.sendMail({
		from: email.from.name
			? { name: email.from.name, address: email.from.address }
			: email.from.address,
		to: [...email.to],
		subject: email.subject,
		text: email.body,
		attachments: email.attachments.map((attachment) => ({
			filename: attachment.filename,
			contentType: attachment.contentType,
			content: attachment.content
		}))
	});
	if (!Buffer.isBuffer(info.message))
		throw new Error('expected a buffered message from the stream transport');
	return {
		raw: info.message,
		messageId: info.messageId,
		envelope: { from: email.from.address, to: [...email.to] }
	};
}
