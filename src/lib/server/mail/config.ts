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
	/** #380: the mailbox inbound polling watches, `INBOX` unless overridden. */
	inboxMailbox: string;
	/**
	 * How far back a *first* pass over a mailbox reaches, in days (#380).
	 *
	 * Only ever consulted when there is no cursor yet for that mailbox and
	 * UIDVALIDITY generation. Without it the first pass starts at UID 1 and
	 * archives the entire history of the account: measured on a real
	 * instance, 21,747 messages going back to 2017, none of which produced a
	 * proposal because none of their senders were known contacts. A watched
	 * mailbox is for catching what arrives, so the default is a short window
	 * and not "everything".
	 */
	inboxLookbackDays: number;
	// #306: the ceiling on one inbound message's RFC822 size, checked
	// against `message.size` in the IMAP listing before `source` is ever
	// fetched — an oversized message is never buffered whole. Optional in
	// the environment (`IMAP_MAX_MESSAGE_BYTES`, see `readMailConfig`),
	// never optional here: every caller gets a concrete number, the
	// documented default when unset.
	maxMessageBytes: number;
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

/** `requiredPort`'s optional sibling: unset falls back to `fallback`
 * rather than throwing — `IMAP_MAX_MESSAGE_BYTES` is a sane-default
 * ceiling, not a credential a self-hoster must supply. Still validated
 * once set, the same way a bad port is: a typo becomes a boot-time error,
 * never a silently-ignored one. */
function optionalPositiveInt(
	source: Record<string, string | undefined>,
	key: string,
	fallback: number
): number {
	const raw = source[key]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${key} must be a positive integer, got ${raw}.`);
	}
	return value;
}

// 25 MiB (#306): Gmail's own inbound attachment ceiling, a reasonable
// default for any provider and generous enough that a real approval
// email with a scanned PDF attached is never the thing that trips it.
export const DEFAULT_IMAP_MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

/** #380: a first pass reaches back a month, never to the beginning of the
 * account. Long enough to pick up an approval sent a few weeks ago, short
 * enough that turning ingestion on does not archive years of unrelated mail. */
export const DEFAULT_IMAP_INBOX_LOOKBACK_DAYS = 30;

/**
 * The IMAP half alone, for the two callers that only ever poll: the cron
 * route and `/mail`'s poll-now action (#343).
 *
 * Polling used to go through `readMailConfig`, which builds both halves and
 * whose `required` throws on any missing key, so a poll demanded the whole
 * sending configuration too. That is not hypothetical tidiness: an instance
 * configured for ingestion only, IMAP set and SMTP not, is a supported
 * shape — `isImapConfigured` reports it configured, so `/mail` said "mail
 * is configured, never polled" and its own button then failed with
 * `SMTP_HOST is not set`. Found by pressing that button against a real
 * mailbox with only the IMAP keys in `.env`, which is the state credentials
 * arrive in before anything is known about sending.
 */
export function readImapConfig(source: Record<string, string | undefined>): ImapConfig {
	return {
		host: required(source, 'IMAP_HOST'),
		port: requiredPort(source, 'IMAP_PORT'),
		secure: source.IMAP_SECURE === 'true',
		user: required(source, 'IMAP_USER'),
		password: required(source, 'IMAP_APP_PASSWORD'),
		sentMailbox: source.IMAP_SENT_MAILBOX?.trim() || 'Sent',
		// #380: the mailbox polled for inbound mail, whether or not any
		// contract has a folder of its own. `INBOX` by default, which is the
		// whole point: monitoring should need no setup beyond credentials.
		// Overridable for an account that filters client mail elsewhere.
		inboxMailbox: source.IMAP_INBOX_MAILBOX?.trim() || 'INBOX',
		inboxLookbackDays: optionalPositiveInt(
			source,
			'IMAP_INBOX_LOOKBACK_DAYS',
			DEFAULT_IMAP_INBOX_LOOKBACK_DAYS
		),
		maxMessageBytes: optionalPositiveInt(
			source,
			'IMAP_MAX_MESSAGE_BYTES',
			DEFAULT_IMAP_MAX_MESSAGE_BYTES
		)
	};
}

/** Parses SMTP/IMAP settings out of a plain env-like object — a pure
 * function over `source`, so a test hands it a literal instead of
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
		imap: readImapConfig(source)
	};
}

/** The real configuration, read from the process environment. Every
 * caller that needs to actually send calls this at the point of sending,
 * never at import time. */
export function mailConfigFromEnv(): MailConfig {
	return readMailConfig(env);
}

/** The polling half of the same idea, for the callers that never send. */
export function imapConfigFromEnv(): ImapConfig {
	return readImapConfig(env);
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
