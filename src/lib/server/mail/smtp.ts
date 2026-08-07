// Sends over SMTP with the configured app password (#72) — never the
// Gmail API; see AGENTS.md for why (a Google project in Testing status
// breaks weekly under a restricted-scope API, and IMAP/SMTP works with
// any provider).
import nodemailer from 'nodemailer';
import type { SmtpConfig } from './config';
import type { ComposedMessage } from './message';

/** Sends `message`'s exact bytes. `raw` bypasses nodemailer's own MIME
 * composition entirely, so the bytes that leave over SMTP are the same
 * ones `imap.ts` appends to Sent — see `message.ts`. */
export async function sendOverSmtp(config: SmtpConfig, message: ComposedMessage): Promise<void> {
	const transporter = nodemailer.createTransport({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: { user: config.user, pass: config.password }
	});
	try {
		await transporter.sendMail({ raw: message.raw, envelope: message.envelope });
	} finally {
		transporter.close();
	}
}
