import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { db } from './index';
import { inRolledBackTransaction } from './rollback';
import { client } from './schema';

test('the work is rolled back, and the value comes back out', async () => {
	const legalName = `Rollback probe ${Date.now()}`;
	const id = await inRolledBackTransaction(async (tx) => {
		const [row] = await tx
			.insert(client)
			.values({
				legalName,
				taxId: `IT${Date.now()}`,
				country: 'IT',
				addressLine1: 'Via Prova 1',
				addressCity: 'Milano',
				addressPostalCode: '20121',
				noticeChannel: 'email'
			})
			.returning();
		return row.id;
	});

	expect(await db.select().from(client).where(eq(client.id, id))).toEqual([]);
});

test('a failing assertion inside the body fails the test instead of being swallowed', async () => {
	// The point of this helper. Under the older
	// `expect(db.transaction(...)).rejects.toThrow()` shape this same body
	// passes, because the matcher cannot tell an assertion's error from
	// `tx.rollback()`'s.
	await expect(
		inRolledBackTransaction(async () => {
			expect(1).toBe(2);
		})
	).rejects.toThrow(/expected 1 to be 2/);
});
