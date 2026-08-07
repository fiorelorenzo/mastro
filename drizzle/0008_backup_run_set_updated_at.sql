CREATE TRIGGER backup_run_set_updated_at BEFORE UPDATE ON "backup_run"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
