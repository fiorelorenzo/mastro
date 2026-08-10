import { db, type DbExecutor } from './index';

/**
 * Runs `body` inside a transaction, rolls it back, and returns whatever
 * `body` returned — so assertions happen **after** the transaction, on the
 * value, rather than inside it.
 *
 * The pattern this replaces looks like this, and it can silently pass:
 *
 * ```ts
 * await expect(
 *   db.transaction(async (tx) => {
 *     expect(1).toBe(2); // fails, throws
 *     tx.rollback();     // never reached
 *   })
 * ).rejects.toThrow();   // sees the assertion's own error and is satisfied
 * ```
 *
 * `tx.rollback()` works by throwing, so `rejects.toThrow()` is how the
 * caller lets it through — and a failing assertion throws too, which the
 * same matcher then swallows. Verified rather than reasoned about:
 * `expect(1).toBe(2)` inside that shape passes.
 *
 * Here the rollback is this function's business, not the test's. Anything
 * else `body` throws propagates, so a failing assertion fails its test.
 */
export async function inRolledBackTransaction<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> {
	const marker = Symbol('rollback');
	let result!: T;
	try {
		await db.transaction(async (tx) => {
			result = await body(tx);
			// Not `tx.rollback()`: its error is indistinguishable from a real
			// one at the catch below, which is the whole problem being fixed.
			throw marker;
		});
	} catch (error) {
		if (error !== marker) throw error;
	}
	return result;
}
