/**
 * The Postgres error behind a Drizzle one.
 *
 * Drizzle wraps every failed statement in an `Error` whose message is
 * `Failed query: insert into …` and hangs the real `PostgresError` — the
 * one carrying `code`, `constraint_name` and the trigger's own message —
 * off `cause`. A test asserting on a constraint has to reach through, and
 * dozens did not: `rejects.toThrow(/immutable once written/)` and
 * `rejects.toMatchObject({ code: '23514' })` both matched against the
 * wrapper and could never have passed. Nobody noticed because the
 * rolled-back-transaction pattern swallowed the failure (#191).
 *
 * Kept next to `rollback.ts` for the same reason: both exist so a database
 * test asserts against what the database actually said.
 */
export interface PostgresErrorFields {
	readonly message: string;
	readonly code?: string;
	readonly constraint_name?: string;
	readonly detail?: string;
}

/**
 * Unwraps `error` to the Postgres error underneath, or returns the error
 * itself when there is nothing to unwrap. Never throws: a test asserting
 * on the result gets a mismatch it can read, not a second failure on top
 * of the first.
 */
export function postgresErrorFrom(error: unknown): PostgresErrorFields {
	const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
	const actual = cause ?? error;
	if (actual instanceof Error) {
		const fields = actual as Error & { code?: string; constraint_name?: string; detail?: string };
		return {
			message: fields.message,
			code: fields.code,
			constraint_name: fields.constraint_name,
			detail: fields.detail
		};
	}
	return { message: String(actual) };
}

/**
 * Runs `body` and returns the Postgres error it raised. Fails loudly when
 * it raised nothing at all, which is the one outcome a constraint test
 * must never treat as a pass.
 *
 * Pass `tx` when the surrounding test is inside a transaction and has more
 * to do afterwards: a failed statement aborts its transaction, and every
 * later statement then answers `current transaction is aborted` rather
 * than doing anything. A savepoint contains the failure, which is the only
 * way one test can watch two constraints fire.
 */
export async function rejection(
	body: () => Promise<unknown>,
	// Structural on purpose: any drizzle executor that can open a savepoint
	// satisfies this, and the nested executor is passed straight back to
	// `body`, which closes over what it needs and ignores the argument.
	tx?: { transaction: <T>(fn: (nested: unknown) => Promise<T>) => Promise<T> }
): Promise<PostgresErrorFields> {
	if (!tx) {
		try {
			await body();
		} catch (error) {
			return postgresErrorFrom(error);
		}
		throw new Error('expected the database to reject this, and it did not');
	}

	const marker = Symbol('rejected');
	let captured: PostgresErrorFields | null = null;
	try {
		await tx.transaction(async () => {
			try {
				await body();
			} catch (error) {
				captured = postgresErrorFrom(error);
				// Leaving by throwing is what releases the savepoint and undoes
				// the failed statement; returning would keep the aborted state.
				throw marker;
			}
			return undefined as unknown as never;
		});
	} catch (error) {
		if (error !== marker) throw error;
	}
	if (captured === null) throw new Error('expected the database to reject this, and it did not');
	return captured;
}
