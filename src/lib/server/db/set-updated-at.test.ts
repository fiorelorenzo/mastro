import { afterAll, expect, test } from 'vitest';
import { sql } from 'drizzle-orm';
import { client, db } from './index';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
// The pattern for every database test: do the work inside a transaction and
// roll it back, so the suite leaves no rows behind and can run in any order.

afterAll(async () => {
	await client.end();
});

test('the database maintains updated_at, the caller never has to', async () => {
	await expect(
		db.transaction(async (tx) => {
			await tx.execute(
				sql`create table trigger_probe (id int primary key, updated_at timestamptz not null)`
			);
			await tx.execute(
				sql`create trigger trigger_probe_set_updated_at before update on trigger_probe
				    for each row execute function set_updated_at()`
			);
			await tx.execute(
				sql`insert into trigger_probe (id, updated_at) values (1, now() - interval '1 day')`
			);
			await tx.execute(sql`update trigger_probe set id = 1 where id = 1`);

			const rows = await tx.execute<{ fresh: boolean }>(
				sql`select updated_at > now() - interval '1 minute' as fresh from trigger_probe`
			);
			expect(rows[0].fresh).toBe(true);

			tx.rollback();
		})
	).rejects.toThrow();
});
