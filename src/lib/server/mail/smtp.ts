// Sends over SMTP with the configured app password (#72), and is still the
// default sender: it works with any provider and needs no Google Cloud
// project. `gmail-api.ts` is the alternative added in #345, for a host that
// cannot reach an SMTP port at all; `sender.ts` picks between them. Reading
// is IMAP either way, for the restricted-scope reasons AGENTS.md and
// docs/self-hosting.md section 4 both spell out.
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
