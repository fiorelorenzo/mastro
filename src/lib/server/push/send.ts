// Sends one Web Push message (#63). `web-push` is the standard Node
// implementation of RFC 8030/8291/8292 (encryption, VAPID signing,
// transport) — reused rather than hand-rolled, the same choice this
// project already makes for SMTP (`nodemailer`) and IMAP (`imapflow`).
import webpush from 'web-push';
import type { VapidConfig } from './config';

export interface PushSubscriptionRecord {
	readonly endpoint: string;
	readonly p256dh: string;
	readonly auth: string;
}

/** What `service-worker.ts`'s `push` handler expects — kept intentionally
 * small: a title, a body, and the URL to open on click. */
export interface PushPayload {
	readonly title: string;
	readonly body: string;
	readonly url: string;
}

/** Thrown when the push service reports the subscription gone (404/410):
 * the caller's cue to delete it — #63's "unsubscribe respected server-side"
 * applied to a subscription that stopped existing on its own (the user
 * cleared site data, uninstalled the app, ...) rather than through the
 * explicit unsubscribe endpoint. Any other failure (a transient 5xx, a
 * network error) propagates instead: it says nothing about whether the
 * subscription is still good. */
export class WebPushGoneError extends Error {}

export async function sendWebPush(
	subscription: PushSubscriptionRecord,
	payload: PushPayload,
	config: VapidConfig
): Promise<void> {
	webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
	try {
		await webpush.sendNotification(
			{
				endpoint: subscription.endpoint,
				keys: { p256dh: subscription.p256dh, auth: subscription.auth }
			},
			JSON.stringify(payload)
		);
	} catch (error) {
		if (
			error instanceof webpush.WebPushError &&
			(error.statusCode === 404 || error.statusCode === 410)
		) {
			throw new WebPushGoneError(
				`push subscription ${subscription.endpoint} is gone (${error.statusCode})`
			);
		}
		throw error;
	}
}
