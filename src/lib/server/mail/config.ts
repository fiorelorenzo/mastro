// SMTP/IMAP configuration (#72), read from environment on demand rather
// than at module load. Unlike `import/config.ts`'s account holder tax id —
// needed by every import, so failing fast at boot is correct — mail
// sending is an occasional, human-triggered action: a self-hoster who has
// not configured a mailbox yet must still be able to run every other
// screen in the product. `readMailConfig` is called once, right before a
// send, by whichever route needs it.
import { env } from '$env/dynamic/private';

export type SmtpConfig = {
	host: string;
	port: number;
	secure: boolean;
	user: string;
	password: string;
	fromAddress: string;
	fromName: string | null;
};

export type ImapConfig = {
	host: string;
	port: number;
	secure: boolean;
	user: string;
	password: string;
	sentMailbox: string;
};

export type MailConfig = { smtp: SmtpConfig; imap: ImapConfig };

function required(source: Record<string, string | undefined>, key: string): string {
	const value = (source[key] ?? '').trim();
	if (!value) {
		throw new Error(
			`${key} is not set. Mail sending needs the full SMTP/IMAP configuration — see .env.example.`
		);
	}
	return value;
}

function requiredPort(source: Record<string, string | undefined>, key: string): number {
	const raw = required(source, key);
	const port = Number(raw);
	if (!Number.isInteger(port) || port <= 0)
		throw new Error(`${key} must be a positive integer, got ${raw}.`);
	return port;
}

/** Parses SMTP/IMAP settings out of a plain env-like object — a pure
 * function so it is exercised directly against fabricated input, the same
 * way `blob-store.ts` takes its storage root explicitly instead of
 * reading configuration itself. */
export function readMailConfig(source: Record<string, string | undefined>): MailConfig {
	return {
		smtp: {
			host: required(source, 'SMTP_HOST'),
			port: requiredPort(source, 'SMTP_PORT'),
			secure: source.SMTP_SECURE === 'true',
			user: required(source, 'SMTP_USER'),
			password: required(source, 'SMTP_APP_PASSWORD'),
			fromAddress: required(source, 'MAIL_FROM_ADDRESS'),
			fromName: source.MAIL_FROM_NAME?.trim() || null
		},
		imap: {
			host: required(source, 'IMAP_HOST'),
			port: requiredPort(source, 'IMAP_PORT'),
			secure: source.IMAP_SECURE === 'true',
			user: required(source, 'IMAP_USER'),
			password: required(source, 'IMAP_APP_PASSWORD'),
			sentMailbox: source.IMAP_SENT_MAILBOX?.trim() || 'Sent'
		}
	};
}

/** The real configuration, read from the process environment. Every
 * caller that needs to actually send calls this at the point of sending,
 * never at import time. */
export function mailConfigFromEnv(): MailConfig {
	return readMailConfig(env);
}

/** Whether IMAP is configured at all, without throwing — `readMailConfig`
 * deliberately throws on a half-set mailbox (this file's own doc
 * comment: sending is a deliberate action, nobody should be surprised by
 * the error). The alert engine's "is polling even configured" gate
 * (`detectMailboxPollFailure`, #84) needs the opposite: a safe probe it
 * can call on every `detectAlerts` run regardless of whether mail is set
 * up, the same role `mirrorConfigFromEnv() !== null` plays for the
 * document mirror. */
export function isImapConfigured(source: Record<string, string | undefined>): boolean {
	return Boolean(
		source.IMAP_HOST?.trim() &&
		source.IMAP_PORT?.trim() &&
		source.IMAP_USER?.trim() &&
		source.IMAP_APP_PASSWORD?.trim()
	);
}

export function imapConfiguredInEnv(): boolean {
	return isImapConfigured(env);
}

/** The sending half of the same idea. `runAlertDigest` (#75) is called by
 * the scheduler (#222) on a timer, not by a human pressing send, so on an
 * instance with no mailbox configured `mailConfigFromEnv()` throwing turns
 * a supported configuration into a weekly 500 and — because a job that
 * stops succeeding raises an alert — a recurring false alarm about the
 * product's own health. The digest already knows how to say "there is
 * content but nowhere to send it" when the allowlist is empty; this lets
 * it say the same thing about an unconfigured mailbox. */
export function isSmtpConfigured(source: Record<string, string | undefined>): boolean {
	return Boolean(
		source.SMTP_HOST?.trim() &&
		source.SMTP_PORT?.trim() &&
		source.SMTP_USER?.trim() &&
		source.SMTP_APP_PASSWORD?.trim() &&
		source.MAIL_FROM_ADDRESS?.trim()
	);
}

export function smtpConfiguredInEnv(): boolean {
	return isSmtpConfigured(env);
}
