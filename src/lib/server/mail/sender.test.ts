// #345: which sender runs, and — the part that is easy to get wrong — who
// appends to Sent. Both decisions are configuration, so both are tested
// against fabricated configuration rather than against an environment, and
// the transports are injected rather than mocked.

import { Buffer } from 'node:buffer';
import { expect, test } from 'vitest';
import { readGmailSenderConfig, sendComposedMessage, type MailTransports } from './sender';
import type { ComposedMessage } from './message';
import type { ImapConfig, SmtpConfig } from './config';
import type { GmailApiConfig } from './gmail-api';

const GOOGLE_CLIENT = {
	GOOGLE_CLIENT_ID: 'client-id',
	GOOGLE_CLIENT_SECRET: 'client-secret'
};

const MESSAGE: ComposedMessage = {
	raw: Buffer.from('From: a@example.com\r\n\r\nBody', 'utf8'),
	messageId: '<id@mastro>',
	envelope: { from: 'a@example.com', to: ['b@example.com'] }
};

const IMAP: ImapConfig = {
	host: 'imap.example.com',
	port: 993,
	secure: true,
	user: 'user',
	password: 'password',
	sentMailbox: 'Sent',
	maxMessageBytes: 1024
};

const SMTP: SmtpConfig = {
	host: 'smtp.example.com',
	port: 587,
	secure: false,
	user: 'user',
	password: 'password',
	fromAddress: 'a@example.com',
	fromName: null
};

const GMAIL: GmailApiConfig = {
	clientId: 'client-id',
	clientSecret: 'client-secret',
	refreshToken: 'refresh-token'
};

function recordingTransports(): { calls: string[]; transports: MailTransports } {
	const calls: string[] = [];
	return {
		calls,
		transports: {
			gmail: async () => {
				calls.push('gmail');
			},
			smtp: async () => {
				calls.push('smtp');
			},
			append: async () => {
				calls.push('append');
			}
		}
	};
}

test('no GMAIL_SEND_REFRESH_TOKEN means no Gmail sender, which is the default configuration', () => {
	expect(readGmailSenderConfig({})).toBeNull();
	expect(readGmailSenderConfig(GOOGLE_CLIENT)).toBeNull();
});

test('a refresh token plus the sign-in OAuth client selects the Gmail sender', () => {
	expect(
		readGmailSenderConfig({ ...GOOGLE_CLIENT, GMAIL_SEND_REFRESH_TOKEN: 'refresh-token' })
	).toEqual(GMAIL);
});

/*
 * A refresh token with no OAuth client behind it is always a mistake rather
 * than a choice — the token cannot be spent without the client it was
 * issued to — so this refuses loudly instead of silently falling back to
 * SMTP, which would look like a send that worked and went nowhere.
 */
test('a refresh token with no OAuth client configured is refused, naming what is missing', () => {
	expect(() => readGmailSenderConfig({ GMAIL_SEND_REFRESH_TOKEN: 'refresh-token' })).toThrow(
		/GOOGLE_CLIENT_ID\/GOOGLE_CLIENT_SECRET/
	);
});

test('whitespace is not configuration', () => {
	expect(readGmailSenderConfig({ ...GOOGLE_CLIENT, GMAIL_SEND_REFRESH_TOKEN: '   ' })).toBeNull();
});

/*
 * The Sent append is a property of the sender, not a step of sending, and
 * this is the assertion that pins it. Gmail files a message sent through its
 * own API into Sent by itself and dedupes by `Message-ID`; appending over
 * IMAP as well uploads the whole message a second time for a copy that is
 * already there. Against every other provider — which is what the SMTP path
 * is for — that append is the only thing putting a sent message where a
 * human can find it.
 */
test('the Gmail path does not append to Sent', async () => {
	const { calls, transports } = recordingTransports();

	await sendComposedMessage({ kind: 'gmail_api', gmail: GMAIL }, IMAP, MESSAGE, transports);

	expect(calls).toEqual(['gmail']);
});

test('the SMTP path sends and then appends, in that order', async () => {
	const { calls, transports } = recordingTransports();

	await sendComposedMessage({ kind: 'smtp', smtp: SMTP }, IMAP, MESSAGE, transports);

	expect(calls).toEqual(['smtp', 'append']);
});

test('a failing send never reaches the append: nothing lands in Sent that did not go out', async () => {
	const { calls, transports } = recordingTransports();
	const failing: MailTransports = {
		...transports,
		smtp: async () => {
			calls.push('smtp');
			throw new Error('connect ECONNREFUSED');
		}
	};

	await expect(
		sendComposedMessage({ kind: 'smtp', smtp: SMTP }, IMAP, MESSAGE, failing)
	).rejects.toThrow(/ECONNREFUSED/);
	expect(calls).toEqual(['smtp']);
});
