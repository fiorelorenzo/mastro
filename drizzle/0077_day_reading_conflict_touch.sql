-- `day_reading_conflict` (0076) carries an `updated_at` from `columns.ts`'s
-- `timestamps()` like every other table, and `columns.ts` itself says every
-- table installs the `set_updated_at` trigger in its own migration — the
-- generator has no notation for triggers, so this is that migration.
--
-- `recordDayReadingConflict` (`src/lib/server/repositories/day-reading-conflict.ts`)
-- upserts on `(contract_id, date)`: the second and later disagreement for a
-- day is an UPDATE, not an INSERT, and without this trigger that UPDATE
-- would leave `updated_at` frozen at the row's original insert time — the
-- one thing an alert reviewer needs to know ("is this still current, or a
-- disagreement from three weeks ago that never got acknowledged") would be
-- silently wrong.
CREATE TRIGGER day_reading_conflict_set_updated_at BEFORE UPDATE ON "day_reading_conflict"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
