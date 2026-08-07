-- `updated_at` maintenance for `ceiling` (0018_ceiling.sql), per AGENTS.md:
-- every table installs this trigger. The CHECK constraints for #36
-- (measure/value pairing, non-negative amount, ratio range) were already
-- expressible through Drizzle's own `check()` builder and landed in
-- 0018_ceiling.sql alongside the table; nothing here duplicates them.
CREATE TRIGGER ceiling_set_updated_at BEFORE UPDATE ON "ceiling"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
