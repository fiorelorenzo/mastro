import { timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Column conventions shared by every table. See AGENTS.md: each table carries
 * `id` (uuid), `created_at` and `updated_at`.
 *
 * `updated_at` is maintained by the `set_updated_at` trigger, which every table
 * installs in its own migration:
 *
 * ```sql
 * CREATE TRIGGER <table>_set_updated_at BEFORE UPDATE ON "<table>"
 *   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
 * ```
 */
export const id = () => uuid('id').primaryKey().defaultRandom();

export const timestamps = () => ({
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
