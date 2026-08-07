import { json } from '@sveltejs/kit';
import { deleteSubscriptionByEndpoint } from '$lib/server/push/repository';
import type { RequestHandler } from './$types';

/** Deletes a subscription by endpoint (#63's "unsubscribe respected
 * server-side"). A missing or already-deleted endpoint is not an error —
 * `deleteSubscriptionByEndpoint` is a no-op for one that is not on file. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body.endpoint !== 'string' || !body.endpoint) {
		return json({ error: 'invalid endpoint' }, { status: 400 });
	}

	await deleteSubscriptionByEndpoint(body.endpoint);

	return json({ ok: true });
};
