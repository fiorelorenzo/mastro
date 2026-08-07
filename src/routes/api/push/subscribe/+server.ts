import { json } from '@sveltejs/kit';
import { saveSubscription } from '$lib/server/push/repository';
import type { RequestHandler } from './$types';

/** Saves a browser's push subscription (#63). Protected the ordinary way
 * (deny-by-default, `locals.user` set by `hooks.server.ts`) — no separate
 * auth here, unlike `/api/alerts/run/[job]`, because this is called from
 * an authenticated tab, not a cron job with no session to present. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	if (
		!body ||
		typeof body.endpoint !== 'string' ||
		!body.endpoint ||
		typeof body.keys?.p256dh !== 'string' ||
		typeof body.keys?.auth !== 'string'
	) {
		return json({ error: 'invalid subscription' }, { status: 400 });
	}

	await saveSubscription({
		endpoint: body.endpoint,
		p256dh: body.keys.p256dh,
		auth: body.keys.auth,
		userEmail: locals.user!.email
	});

	return json({ ok: true });
};
