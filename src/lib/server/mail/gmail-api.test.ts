// #345. Every request shape here is proven against a fake `fetch`, the same
// way `drive/google-drive-target.test.ts` does it, plus the two properties
// that are the whole point of choosing `gmail.send`: the sender never names
// a scope, and it never asks Gmail for anything but "send this".

import { Buffer } from 'node:buffer';
import { expect, test, vi } from 'vitest';
import { encodeRawMessage, sendOverGmailApi, type GmailApiConfig } from './gmail-api';
import type { ComposedMessage } from './message';

const CONFIG: GmailApiConfig = {
	clientId: 'client-id',
	clientSecret: 'client-secret',
	refreshToken: 'refresh-token'
};

function message(raw = 'From: a@example.com\r\nSubject: Hi\r\n\r\nBody'): ComposedMessage {
	return {
		raw: Buffer.from(raw, 'utf8'),
		messageId: '<generated@mastro>',
		envelope: { from: 'a@example.com', to: ['b@example.com'] }
	};
}

function fakeFetch(sendResponse = new Response('{"id":"gmail-id"}', { status: 200 })) {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		if (url.includes('oauth2.googleapis.com/token')) {
			return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), {
				status: 200
			});
		}
		return sendResponse;
	});
	return { impl: impl as unknown as typeof fetch, calls };
}

test('the message is posted to the send endpoint as base64url raw bytes, with the access token', async () => {
	const { impl, calls } = fakeFetch();

	await sendOverGmailApi(CONFIG, message(), impl);

	const send = calls.find((call) => call.url.includes('gmail.googleapis.com'));
	expect(send?.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
	expect(send?.init?.method).toBe('POST');
	expect(new Headers(send?.init?.headers).get('authorization')).toBe('Bearer access-token');

	const body: unknown = JSON.parse(String(send?.init?.body));
	expect(body).toEqual({ raw: encodeRawMessage(message().raw) });
});

/*
 * base64url, not base64. Gmail rejects `+` and `/`, and a message
 * containing either once encoded is the common case rather than an edge
 * one, so this pins the alphabet rather than trusting it.
 */
test('the raw encoding uses the url-safe alphabet', () => {
	const bytes = Buffer.from([0xfb, 0xef, 0xbe]);
	// Standard base64 of these three bytes is `++++`-shaped: it contains
	// both of the characters Gmail refuses.
	expect(bytes.toString('base64')).toMatch(/[+/]/);

	const encoded = encodeRawMessage(bytes);

	expect(encoded).not.toMatch(/[+/]/);
	expect(Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')).toEqual(bytes);
});

/*
 * The acceptance criterion that outlives this change: `gmail.send` is a
 * sensitive scope and every other Gmail scope this could reach for is
 * restricted, which is a CASA assessment and an annual re-certification.
 * The sender must therefore never name a scope at all — the grant is fixed
 * when a human consents, and nothing at runtime may widen it.
 */
test('no request this sender makes ever names a scope', async () => {
	const { impl, calls } = fakeFetch();

	await sendOverGmailApi(CONFIG, message(), impl);

	for (const call of calls) {
		expect(call.url).not.toMatch(/scope/i);
		expect(String(call.init?.body ?? '')).not.toMatch(/scope/i);
	}
});

test('nothing is read back: the only Gmail request is the send itself', async () => {
	const { impl, calls } = fakeFetch();

	await sendOverGmailApi(CONFIG, message(), impl);

	const gmailCalls = calls.filter((call) => call.url.includes('gmail.googleapis.com'));
	expect(gmailCalls).toHaveLength(1);
	expect(gmailCalls[0].url).not.toMatch(/messages\/(get|list)|\?q=/);
});

test('a refused send fails loudly, carrying the status and body Gmail returned', async () => {
	const { impl } = fakeFetch(
		new Response('{"error":{"message":"Precondition failed"}}', { status: 400 })
	);

	await expect(sendOverGmailApi(CONFIG, message(), impl)).rejects.toThrow(
		/Gmail send failed: 400.*Precondition failed/s
	);
});

test('a refresh token Google rejects fails as a token problem, not as a send problem', async () => {
	const impl = vi.fn(
		async () => new Response('{"error":"invalid_grant"}', { status: 400 })
	) as unknown as typeof fetch;

	await expect(sendOverGmailApi(CONFIG, message(), impl)).rejects.toThrow(
		/Gmail send token refresh failed: 400.*invalid_grant/s
	);
});
