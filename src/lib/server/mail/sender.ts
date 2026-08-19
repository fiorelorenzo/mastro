// Which sender a message goes out through (#345), and the one place that
// decides it.
//
// Selection is by presence of a refresh token, not by an enum: the same
// convention `drive/config.ts` already uses for the mirror, and for the
// same reason. A `MAIL_SENDER=smtp|gmail_api` variable is a second thing to
// keep in step with reality, and the state it would describe is already
// implied by whether a credential exists.
//
// SMTP is the default. The Gmail API is what a host that refuses outbound
// SMTP needs (#339), and nothing else: it costs a Google Cloud project and
// a `gmail.send` grant, so an instance that can reach port 587 has no
// reason to want it.

import { env } from '$env/dynamic/private';
import { resolveGoogleApiClient } from '$lib/server/google/oauth-client';
import { sendOverSmtp } from './smtp';
import { sendOverGmailApi, type GmailApiConfig } from './gmail-api';
import { appendToSentMailbox } from './imap';
import type { ComposedMessage } from './message';
import type { ImapConfig, SmtpConfig } from './config';

export type SenderConfig =
	| { readonly kind: 'smtp'; readonly smtp: SmtpConfig }
	| { readonly kind: 'gmail_api'; readonly gmail: GmailApiConfig };

/**
 * The sender `source` selects. `GMAIL_SEND_REFRESH_TOKEN` picks the API and
 * reuses the OAuth client sign-in already configures, exactly as the Drive
 * mirror does for `drive.file` — one Google Cloud project, one consent
 * screen, a third narrow purpose rather than a second project.
 *
 * Returns `null` when the API is not configured, which is not an error: the
 * caller then reads its SMTP configuration as it always has. A half-set
 * Google client with a refresh token present is an error, because it is
 * always a mistake rather than a choice.
 */
export function readGmailSenderConfig(
	source: Record<string, string | undefined>
): GmailApiConfig | null {
	const refreshToken = source.GMAIL_SEND_REFRESH_TOKEN?.trim();
	if (!refreshToken) return null;

	// #348: the sign-in client, unless the token was issued by another one
	// and `GOOGLE_API_CLIENT_*` names it. A refresh token cannot be spent by
	// a client that did not obtain it.
	const client = resolveGoogleApiClient(source);
	if (!client) {
		throw new Error(
			'GMAIL_SEND_REFRESH_TOKEN is set but no OAuth client is configured — set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, or GOOGLE_API_CLIENT_ID/GOOGLE_API_CLIENT_SECRET if the token belongs to a different client. See docs/self-hosting.md section 4.'
		);
	}
	return { ...client, refreshToken };
}

export function gmailSenderConfigFromEnv(): GmailApiConfig | null {
	return readGmailSenderConfig(env);
}

/**
 * Sends `message` through the configured sender, and files a copy in Sent
 * only where that is actually needed.
 *
 * **The Sent append is a property of the sender, not a step of sending.**
 * Gmail files anything sent through its own API into Sent by itself, so
 * appending over IMAP on that path uploads the whole message a second time
 * for a copy that is already there — measured on the SMTP path too, where
 * Gmail dedupes by `Message-ID` (Mozilla bug 1427619 documents exactly
 * this). Against a provider that does not do that, which is every provider
 * this product supports through SMTP, the append is the only thing putting
 * a sent message where the human can find it, so it stays.
 */
/** The three transports {@link sendComposedMessage} composes, injectable so
 * the branching can be tested for what it calls without a network, a
 * mailbox, or module mocking — the same shape as `fetchImpl` on the Drive
 * target and `executor` on every repository function. */
export interface MailTransports {
	readonly gmail: typeof sendOverGmailApi;
	readonly smtp: typeof sendOverSmtp;
	readonly append: typeof appendToSentMailbox;
}

const REAL_TRANSPORTS: MailTransports = {
	gmail: sendOverGmailApi,
	smtp: sendOverSmtp,
	append: appendToSentMailbox
};

export async function sendComposedMessage(
	sender: SenderConfig,
	imap: ImapConfig,
	message: ComposedMessage,
	transports: MailTransports = REAL_TRANSPORTS
): Promise<void> {
	if (sender.kind === 'gmail_api') {
		await transports.gmail(sender.gmail, message);
		return;
	}
	await transports.smtp(sender.smtp, message);
	await transports.append(imap, message);
}
