import { eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { pushSubscription } from '$lib/server/db/schema';

export type SubscriptionInput = {
	endpoint: string;
	p256dh: string;
	auth: string;
	userEmail: string;
};

/** Saves a new subscription or refreshes the keys of one already on file
 * for the same `endpoint` — a browser can resubscribe with new keys
 * without ever unsubscribing first, and `endpoint` is the row's own
 * natural identity (`db/schema/push.ts`). */
export async function saveSubscription(input: SubscriptionInput, executor: DbExecutor = db) {
	const [row] = await executor
		.insert(pushSubscription)
		.values(input)
		.onConflictDoUpdate({
			target: pushSubscription.endpoint,
			set: { p256dh: input.p256dh, auth: input.auth, userEmail: input.userEmail }
		})
		.returning();
	return row;
}

/** Deletes a subscription by its endpoint — #63's "unsubscribe respected
 * server-side", called both from the explicit unsubscribe endpoint and
 * from `$lib/server/alerts/dispatch.ts` when a push send reports the
 * endpoint gone. A no-op, not an error, when the endpoint is not on file:
 * unsubscribing twice (a retried request, a second device that never
 * subscribed) is not a failure. */
export async function deleteSubscriptionByEndpoint(endpoint: string, executor: DbExecutor = db) {
	await executor.delete(pushSubscription).where(eq(pushSubscription.endpoint, endpoint));
}

export async function listSubscriptions(executor: DbExecutor = db) {
	return executor.select().from(pushSubscription);
}
