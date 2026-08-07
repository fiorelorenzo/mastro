import { pgTable, text, unique } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';

/**
 * One Web Push subscription (#63) — one row per device/browser the
 * operator has enabled push on, since a phone and a desktop each mint
 * their own. `endpoint` is the push service URL the browser handed back
 * from `PushManager.subscribe()`; it is the subscription's own natural
 * identity, unique per device. `p256dh`/`auth` are the two keys
 * `web-push` needs to encrypt a payload for it. No per-type column here:
 * this product is single-tenant, so type routing is `alert_preference`'s
 * job (one set of preferences, applied to every subscription), never a
 * per-subscription copy that could drift from it.
 *
 * Deleted, not flagged, on unsubscribe (`$lib/server/push/repository.ts`)
 * and on a push send reporting the endpoint gone (410/404) — "unsubscribe
 * respected server-side" (#63's acceptance) means the row stops existing,
 * not that a boolean gets flipped a dispatcher would have to remember to
 * check.
 */
export const pushSubscription = pgTable(
	'push_subscription',
	{
		id: id(),
		endpoint: text('endpoint').notNull(),
		p256dh: text('p256dh').notNull(),
		auth: text('auth').notNull(),
		userEmail: text('user_email').notNull(),
		...timestamps()
	},
	(table) => [unique('push_subscription_endpoint_key').on(table.endpoint)]
);
