-- `updated_at` maintenance for `contract_renewal_assumption`
-- (0027_contract_renewal_assumption.sql), per AGENTS.md: every table
-- installs this trigger. The CHECK constraints for #39 (probability
-- range, non-negative volume) were already expressible through Drizzle's
-- own `check()` builder and landed in 0027 alongside the table; nothing
-- here duplicates them.
CREATE TRIGGER contract_renewal_assumption_set_updated_at BEFORE UPDATE ON "contract_renewal_assumption"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
