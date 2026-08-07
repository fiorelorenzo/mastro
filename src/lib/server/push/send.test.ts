// Exercises the classification logic against a mocked `web-push` — the
// real push service round trip is verified separately (see the PR
// description) against a real browser subscription, not here: no unit
// test can fabricate a genuine push service response.

import { expect, test, vi } from 'vitest';
import webpush from 'web-push';
import { sendWebPush, WebPushGoneError } from './send';

// `setVapidDetails` validates key *shape* eagerly, before any network
// call — a real, freshly generated pair, not placeholder strings.
const keys = webpush.generateVAPIDKeys();
const config = {
	publicKey: keys.publicKey,
	privateKey: keys.privateKey,
	subject: 'mailto:ops@example.com'
};
const subscription = { endpoint: 'https://push.example.com/abc', p256dh: 'p', auth: 'a' };

test('a 410/404 from the push service is reported as WebPushGoneError', async () => {
	vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(
		new webpush.WebPushError('gone', 410, {}, '', subscription.endpoint)
	);
	await expect(
		sendWebPush(subscription, { title: 't', body: 'b', url: '/alerts' }, config)
	).rejects.toBeInstanceOf(WebPushGoneError);

	vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(
		new webpush.WebPushError('not found', 404, {}, '', subscription.endpoint)
	);
	await expect(
		sendWebPush(subscription, { title: 't', body: 'b', url: '/alerts' }, config)
	).rejects.toBeInstanceOf(WebPushGoneError);

	vi.restoreAllMocks();
});

test('any other failure propagates verbatim rather than being treated as gone', async () => {
	vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(
		new webpush.WebPushError('server error', 500, {}, '', subscription.endpoint)
	);
	await expect(
		sendWebPush(subscription, { title: 't', body: 'b', url: '/alerts' }, config)
	).rejects.not.toBeInstanceOf(WebPushGoneError);
	vi.restoreAllMocks();
});

test('success sends the payload as JSON to the right subscription', async () => {
	const spy = vi
		.spyOn(webpush, 'sendNotification')
		.mockResolvedValueOnce({ statusCode: 201, body: '', headers: {} });
	await sendWebPush(subscription, { title: 'Hi', body: 'There', url: '/alerts' }, config);
	expect(spy).toHaveBeenCalledWith(
		{ endpoint: subscription.endpoint, keys: { p256dh: 'p', auth: 'a' } },
		JSON.stringify({ title: 'Hi', body: 'There', url: '/alerts' })
	);
	vi.restoreAllMocks();
});
