// The second sender (#345): the Gmail API over HTTPS, for a host where
// SMTP cannot leave the box.
//
// This exists because of a measurement, not a preference. Every SMTP
// submission port — 587, 465, 2525, to Gmail and to two unrelated
// providers — is refused outbound from the production host, while 443
// answers (#339). That is standard anti-spam policy for a VPS provider and
// no amount of configuration changes it, so on that host `sendOverSmtp`
// cannot deliver anything at all.
//
// **SMTP stays the default, and reading stays IMAP.** The asymmetry is
// Google's own: `gmail.send` is a sensitive scope, needing brand
// verification and no security assessment, while `gmail.readonly`,
// `gmail.modify` and — the one that matters here — `https://mail.google.com/`,
// which Google's restricted-scope list defines as "includes any usage of
// IMAP, SMTP, and POP3 protocols", are restricted: a third-party CASA
// assessment, about $500 a year, re-certified every 12 months or production
// access is revoked. So reading over OAuth would put that on every
// self-hoster, and doing IMAP over OAuth would need the most restricted
// scope of all. An app password over IMAP needs no Google Cloud project
// whatsoever. Sending is the one half where the API is cheaper than the
// protocol.
//
// One endpoint and a token refresh, so no client library, the same
// reasoning `drive/google-drive-target.ts` states for Drive.

import { Buffer } from 'node:buffer';
import type { ComposedMessage } from './message';
import {
	createGoogleAccessTokenCache,
	type FetchLike,
	type GoogleOAuthCredentials
} from '$lib/server/google/access-token';

const SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/** The same three fields the Drive mirror needs, and nothing else — in
 * particular no scope and no mailbox: `users/me` is whoever authorised the
 * refresh token, which is the only account this can ever send as. */
export type GmailApiConfig = GoogleOAuthCredentials;

/**
 * `message`'s exact bytes, handed to Gmail as one `raw` field.
 *
 * base64url, not base64: the API rejects `+` and `/`, and a message
 * containing either in its encoded form is not an edge case, it is most
 * messages. Padding is left on, which Gmail accepts.
 */
export function encodeRawMessage(raw: Buffer | string): string {
	return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Sends `message` through the Gmail API and resolves once Gmail has
 * accepted it.
 *
 * Nothing is read back beyond the id Gmail returns, which is also all
 * there is to read: this posts a message and gets an identifier. The
 * caller records its own `Message-ID` (composed before sending) in
 * `sent_email`, exactly as the SMTP path does, so the two senders leave
 * the same ledger behind.
 */
export async function sendOverGmailApi(
	config: GmailApiConfig,
	message: ComposedMessage,
	fetchImpl: FetchLike = fetch
): Promise<void> {
	const accessToken = await createGoogleAccessTokenCache(config, 'Gmail send', fetchImpl)();
	const response = await fetchImpl(SEND_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ raw: encodeRawMessage(message.raw) })
	});
	if (!response.ok) {
		throw new Error(`Gmail send failed: ${response.status} ${await response.text()}`);
	}
}
