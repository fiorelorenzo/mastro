// Turns detected alerts into actual delivery (#75, #63): immediate push
// for urgent alerts, a weekly digest email for everything else — and, as
// a deliberate safety net, anything urgent that push could not reach.
// Neither `runAlertPush` nor `runAlertDigest` is scheduled by anything in
// this repository; see the PR description for what has to call them in
// production, and `src/routes/api/alerts/run/[job]/+server.ts` for the
// one entry point this PR adds for a cron job to do that with.
//
// Delivery reuses the existing mail primitives (`compose Message` +
// `sendOverSmtp`) rather than a second SMTP client — the per-contract
// template/attachment/Sent-append machinery in `mail/send.ts` is for
// client-facing correspondence, which this is not: an alert digest is
// addressed to the operator, not a counterparty, so it is composed and
// sent directly, and never appended to the Sent mailbox (there is no
// thread with anyone for it to belong to).

import { env } from '$env/dynamic/private';
import * as m from '$lib/paraglide/messages';
import { parseAllowlist } from '$lib/server/auth/allowlist';
import { log } from '$lib/server/log/logger';
import { mailConfigFromEnv, smtpConfiguredInEnv } from '$lib/server/mail/config';
import { composeMessage } from '$lib/server/mail/message';
import { sendOverSmtp } from '$lib/server/mail/smtp';
import { sendOverGmailApi } from '$lib/server/mail/gmail-api';
import { gmailSenderConfigFromEnv } from '$lib/server/mail/sender';
import { vapidConfigFromEnv } from '$lib/server/push/config';
import { deleteSubscriptionByEndpoint, listSubscriptions } from '$lib/server/push/repository';
import { sendWebPush, WebPushGoneError } from '$lib/server/push/send';
import { detectAlerts } from './engine';
import { alertMessage, DELIVERY_LOCALE } from './render';
import {
	covers,
	DEFAULT_PREFERENCE,
	listAcknowledgements,
	listAlertPreferences,
	listDeliveries,
	recordDelivery
} from './state';
import { isUrgent, SEVERITY_RANK, type Alert } from './types';

/** The operator's own address(es) — `AUTH_ALLOWED_EMAILS` (#53), reused
 * rather than a second "who gets notified" setting: this product is
 * single-tenant, and the allowlist already names exactly the person who
 * is meant to be able to see the ledger at all. */
function alertRecipients(): string[] {
	return [...parseAllowlist(env.AUTH_ALLOWED_EMAILS)];
}

/** Every alert eligible for `channel` right now: not suppressed by an
 * acknowledgement or a prior delivery at this severity or higher
 * (`state.ts`'s `covers`), and not turned off for its type on this
 * channel (`alert_preference`, defaulting on — #75's "turning a type off
 * stops delivery without stopping detection": detection
 * (`detectAlerts`) runs unconditionally above this filter, never the
 * other way round). `channel === 'push'` additionally requires the alert
 * to be urgent (`critical`) — the weekly digest carries everything else,
 * deliberately without that restriction, so an urgent alert push could
 * not reach (no subscription yet, every send failed) still reaches the
 * operator eventually instead of being lost. */
async function deliverableAlerts(asOfDate: string, channel: 'push' | 'digest'): Promise<Alert[]> {
	const [alerts, acknowledgements, deliveries, preferences] = await Promise.all([
		detectAlerts(asOfDate),
		listAcknowledgements(),
		listDeliveries(),
		listAlertPreferences()
	]);

	return alerts.filter((alert) => {
		if (channel === 'push' && !isUrgent(alert.severity)) return false;
		const preference = preferences.get(alert.detail.type) ?? DEFAULT_PREFERENCE;
		if (channel === 'push' && !preference.pushEnabled) return false;
		if (channel === 'digest' && !preference.digestEnabled) return false;
		if (covers(acknowledgements.get(alert.key), alert.severity)) return false;
		if (covers(deliveries.get(alert.key), alert.severity)) return false;
		return true;
	});
}

export interface PushRunResult {
	readonly attempted: number;
	readonly delivered: number;
	readonly prunedSubscriptions: number;
}

/**
 * Immediate delivery for urgent alerts (#75's "an urgent alert arrives the
 * same day", #63's push subscription). Sends to every subscription on
 * file; one that the push service reports gone (404/410) is deleted, not
 * retried (`WebPushGoneError`, `push/send.ts`).
 *
 * An alert is only recorded as delivered (dedup, `recordDelivery`, channel
 * `'push'`) once it actually reached at least one subscription — zero
 * subscriptions on file, or every send failing, leaves it undelivered, so
 * it is still eligible for the next `runAlertDigest` run instead of being
 * silently dropped.
 */
export async function runAlertPush(asOfDate: string): Promise<PushRunResult> {
	const [alerts, subscriptions] = await Promise.all([
		deliverableAlerts(asOfDate, 'push'),
		listSubscriptions()
	]);
	if (alerts.length === 0 || subscriptions.length === 0) {
		return { attempted: alerts.length, delivered: 0, prunedSubscriptions: 0 };
	}

	const config = vapidConfigFromEnv();
	let delivered = 0;
	let prunedSubscriptions = 0;

	for (const alert of alerts) {
		const { title, body } = alertMessage(alert, DELIVERY_LOCALE);
		let sentToAny = false;
		for (const subscription of subscriptions) {
			try {
				await sendWebPush(subscription, { title, body, url: '/alerts' }, config);
				sentToAny = true;
			} catch (error) {
				if (error instanceof WebPushGoneError) {
					await deleteSubscriptionByEndpoint(subscription.endpoint);
					prunedSubscriptions += 1;
				} else {
					log.error('alerts: push send failed', { alertKey: alert.key, error });
				}
			}
		}
		if (sentToAny) {
			await recordDelivery(alert, 'push');
			delivered += 1;
		}
	}

	return { attempted: alerts.length, delivered, prunedSubscriptions };
}

export interface DigestRunResult {
	readonly included: number;
	readonly sent: boolean;
}

/** One alert the digest could not turn into text, named so the log can say
 *  which and why. */
export interface UnrenderableAlert {
	readonly alertKey: string;
	readonly alertType: string;
	readonly detail: string;
}

/**
 * The digest's body, one block per alert, severest first, and separately
 * the alerts that could not be rendered at all.
 *
 * Split out and exported for one reason: one alert that cannot be rendered
 * must not cost the other twelve their only delivery. The digest is the
 * safety net for anything push could not reach, so a throw in here used to
 * mean the whole weekly email never went out while the route answered 500
 * to a timer nobody watches — which is exactly how #436 sat unnoticed on
 * production for a release. Same "one bad row does not stop the batch"
 * shape `runQueueOnce` and the document mirror already use.
 *
 * Pure, and exported, because the failure path is otherwise unreachable
 * from a test: `runAlertDigest` reads its alerts out of the database, and
 * the columns they come from cannot hold a value that fails to render. A
 * test can hand this function one, and that is the only way to prove the
 * containment actually contains.
 *
 * `rendered` is returned alongside the lines, and it is not decoration:
 * only what actually reached the email may be marked delivered, or an
 * alert that failed to render would be recorded as sent and never appear
 * in a later digest either. Dropping it from one email is a degradation;
 * marking it delivered would be data loss.
 */
export function digestLines(alerts: readonly Alert[]): {
	readonly lines: readonly string[];
	readonly rendered: readonly Alert[];
	readonly unrenderable: readonly UnrenderableAlert[];
} {
	const sorted = [...alerts].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
	const lines: string[] = [];
	const rendered: Alert[] = [];
	const unrenderable: UnrenderableAlert[] = [];
	for (const alert of sorted) {
		try {
			const { title, body } = alertMessage(alert, DELIVERY_LOCALE);
			lines.push(`${title}\n${body}`);
			rendered.push(alert);
		} catch (error) {
			unrenderable.push({
				alertKey: alert.key,
				alertType: alert.detail.type,
				detail: error instanceof Error ? error.message : String(error)
			});
		}
	}
	return { lines, rendered, unrenderable };
}

/**
 * The weekly digest (#75): one email containing every alert not already
 * delivered through either channel — urgent ones included, as the safety
 * net `deliverableAlerts` describes. Nothing is sent, and nothing is
 * marked delivered, when there is nothing new: "the digest arrives once
 * and contains only what has not already been delivered" holds whether
 * this runs on schedule or is accidentally triggered twice in the same
 * week — a second run that finds everything already marked delivered
 * sends no second email.
 */
export async function runAlertDigest(asOfDate: string): Promise<DigestRunResult> {
	const alerts = await deliverableAlerts(asOfDate, 'digest');
	if (alerts.length === 0) return { included: 0, sent: false };

	const recipients = alertRecipients();
	if (recipients.length === 0) {
		log.warn('alerts: digest has content but AUTH_ALLOWED_EMAILS is empty; nothing to send to');
		return { included: alerts.length, sent: false };
	}

	// Same shape as the empty allowlist above, and for the same reason: the
	// scheduler calls this on a timer, so an instance that has simply not
	// configured a mailbox must get a skip it can log, not a 500 it will
	// alert about every week.
	if (!smtpConfiguredInEnv()) {
		log.warn('alerts: digest has content but SMTP is not configured; nothing sent');
		return { included: alerts.length, sent: false };
	}

	const { lines, rendered, unrenderable } = digestLines(alerts);
	for (const failure of unrenderable) {
		log.error('alerts: digest could not render an alert, sending the rest without it', {
			...failure
		});
	}
	if (lines.length === 0) {
		log.error('alerts: digest had content but nothing could be rendered; nothing sent', {
			included: alerts.length
		});
		return { included: alerts.length, sent: false };
	}
	const body = [
		m.alerts_digest_intro({ count: lines.length }, { locale: DELIVERY_LOCALE }),
		'',
		lines.join('\n\n')
	].join('\n');

	const mailConfig = mailConfigFromEnv();
	const message = await composeMessage({
		from: { address: mailConfig.smtp.fromAddress, name: mailConfig.smtp.fromName },
		to: recipients,
		subject: m.alerts_digest_subject(undefined, { locale: DELIVERY_LOCALE }),
		body,
		attachments: []
	});
	// The digest never went to Sent even before #345 (it is machinery
	// writing to its own operator, not correspondence with a client), so
	// this calls the sender directly rather than through
	// `sendComposedMessage`, and only the choice of sender is shared.
	const gmail = gmailSenderConfigFromEnv();
	if (gmail) await sendOverGmailApi(gmail, message);
	else await sendOverSmtp(mailConfig.smtp, message);

	// Only what the email actually contained. An alert that failed to render
	// stays undelivered on purpose, so the next digest offers it again
	// instead of it being recorded as sent and never seen.
	await Promise.all(rendered.map((alert) => recordDelivery(alert, 'digest')));

	return { included: rendered.length, sent: true };
}
