// Needs a migrated database: `pnpm db:up && pnpm db:migrate`.

import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool } from '$lib/server/db';
import { deleteSubscriptionByEndpoint, listSubscriptions, saveSubscription } from './repository';

afterAll(async () => {
	await pool.end();
});

test('saveSubscription upserts on endpoint — resubscribing with new keys refreshes the row, not a duplicate', async () => {
	await inRolledBackTransaction(async (tx) => {
		const endpoint = `https://push.example.com/${crypto.randomUUID()}`;
		await saveSubscription(
			{ endpoint, p256dh: 'p256dh-1', auth: 'auth-1', userEmail: 'lorenzo@example.com' },
			tx
		);
		await saveSubscription(
			{ endpoint, p256dh: 'p256dh-2', auth: 'auth-2', userEmail: 'lorenzo@example.com' },
			tx
		);

		const rows = await listSubscriptions(tx);
		const matching = rows.filter((r) => r.endpoint === endpoint);
		expect(matching).toHaveLength(1);
		expect(matching[0].p256dh).toBe('p256dh-2');
	});
});

test('deleteSubscriptionByEndpoint removes the row, and is a no-op for one not on file', async () => {
	await inRolledBackTransaction(async (tx) => {
		const endpoint = `https://push.example.com/${crypto.randomUUID()}`;
		await saveSubscription({ endpoint, p256dh: 'p', auth: 'a', userEmail: 'x@example.com' }, tx);

		await deleteSubscriptionByEndpoint(endpoint, tx);
		expect((await listSubscriptions(tx)).some((r) => r.endpoint === endpoint)).toBe(false);

		// Second delete: not on file any more, must not throw.
		await deleteSubscriptionByEndpoint(endpoint, tx);
	});
});
