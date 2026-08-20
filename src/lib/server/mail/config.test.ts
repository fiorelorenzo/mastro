import { expect, test } from 'vitest';
import {
	DEFAULT_IMAP_MAX_MESSAGE_BYTES,
	isImapConfigured,
	isSmtpConfigured,
	readImapConfig,
	readMailConfig
} from './config';

// A complete mailbox, as a self-hoster who has finished the setup has it.
const FULL: Record<string, string> = {
	SMTP_HOST: 'smtp.example.com',
	SMTP_PORT: '587',
	SMTP_SECURE: 'false',
	SMTP_USER: 'ledger@example.com',
	SMTP_APP_PASSWORD: 'app-password',
	MAIL_FROM_ADDRESS: 'ledger@example.com',
	IMAP_HOST: 'imap.example.com',
	IMAP_PORT: '993',
	IMAP_SECURE: 'true',
	IMAP_USER: 'ledger@example.com',
	IMAP_APP_PASSWORD: 'app-password'
};

test('a fully configured mailbox reads back, with the documented defaults', () => {
	const config = readMailConfig(FULL);
	expect(config.smtp.port).toBe(587);
	expect(config.smtp.secure).toBe(false);
	expect(config.smtp.fromName).toBeNull();
	// Nobody has to name the sent mailbox to get the usual one.
	expect(config.imap.sentMailbox).toBe('Sent');
	// Nor the inbound message ceiling (#306).
	expect(config.imap.maxMessageBytes).toBe(DEFAULT_IMAP_MAX_MESSAGE_BYTES);
});

test('IMAP_MAX_MESSAGE_BYTES overrides the default, and rejects a non-positive value', () => {
	expect(readMailConfig({ ...FULL, IMAP_MAX_MESSAGE_BYTES: '1000' }).imap.maxMessageBytes).toBe(
		1000
	);
	expect(() => readMailConfig({ ...FULL, IMAP_MAX_MESSAGE_BYTES: '0' })).toThrow(
		/IMAP_MAX_MESSAGE_BYTES/
	);
	expect(() => readMailConfig({ ...FULL, IMAP_MAX_MESSAGE_BYTES: 'not-a-number' })).toThrow(
		/IMAP_MAX_MESSAGE_BYTES/
	);
});

test('reading a half-configured mailbox throws, naming the variable that is missing', () => {
	const withoutUser = { ...FULL };
	delete withoutUser.SMTP_USER;
	expect(() => readMailConfig(withoutUser)).toThrow(/SMTP_USER/);
});

// The probes exist precisely so a caller on a timer never takes that
// throw. Both halves are probed separately because a mailbox can be
// configured for receiving and not for sending, and the two callers are
// different: mailbox-poll detection (#84) and the weekly digest (#75).
test('the probes answer for an instance that configured neither half', () => {
	expect(isSmtpConfigured({})).toBe(false);
	expect(isImapConfigured({})).toBe(false);
});

test('the probes answer per half, so one configured half does not vouch for the other', () => {
	const sendOnly = { ...FULL };
	for (const key of ['IMAP_HOST', 'IMAP_PORT', 'IMAP_USER', 'IMAP_APP_PASSWORD'])
		delete sendOnly[key];
	expect(isSmtpConfigured(sendOnly)).toBe(true);
	expect(isImapConfigured(sendOnly)).toBe(false);
});

test('a blank value is not configuration, and neither is whitespace', () => {
	expect(isSmtpConfigured({ ...FULL, SMTP_HOST: '' })).toBe(false);
	expect(isSmtpConfigured({ ...FULL, SMTP_APP_PASSWORD: '   ' })).toBe(false);
});

// The digest builds its From header out of MAIL_FROM_ADDRESS, so an
// instance missing only that one is not ready to send, however complete
// the rest of the SMTP block looks.
test('SMTP without a from address does not count as configured', () => {
	const withoutFrom = { ...FULL };
	delete withoutFrom.MAIL_FROM_ADDRESS;
	expect(isSmtpConfigured(withoutFrom)).toBe(false);
});

/*
 * #343: polling needs IMAP and nothing else. This used to go through
 * `readMailConfig`, so an ingestion-only instance — IMAP set, SMTP not,
 * which `isImapConfigured` reports as configured — failed its own poll with
 * `SMTP_HOST is not set`. Found by pressing the poll-now button against a
 * real mailbox, not by reading the code.
 */
test('readImapConfig reads the IMAP half with no SMTP key set at all', () => {
	const imapOnly = {
		IMAP_HOST: 'imap.gmail.com',
		IMAP_PORT: '993',
		IMAP_SECURE: 'true',
		IMAP_USER: 'someone@example.com',
		IMAP_APP_PASSWORD: 'app-password'
	};

	expect(readImapConfig(imapOnly)).toEqual({
		host: 'imap.gmail.com',
		port: 993,
		secure: true,
		user: 'someone@example.com',
		password: 'app-password',
		sentMailbox: 'Sent',
		inboxMailbox: 'INBOX',
		maxMessageBytes: DEFAULT_IMAP_MAX_MESSAGE_BYTES
	});
	expect(() => readMailConfig(imapOnly)).toThrow(/SMTP_HOST/);
});
