import { expect, test } from 'vitest';
import { isImapConfigured, isSmtpConfigured, readMailConfig } from './config';

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
