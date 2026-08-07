-- #50: the `updated_at` trigger every table installs (AGENTS.md's column
-- conventions). `document_mirror_run` has no other hand-written
-- constraint — the enum type generated in 0018 already restricts `status`
-- to 'success'/'failure', the same way `backup_run_status` does.

CREATE TRIGGER document_mirror_run_set_updated_at BEFORE UPDATE ON "document_mirror_run"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
