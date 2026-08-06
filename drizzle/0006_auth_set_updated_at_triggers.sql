-- Every table installs set_updated_at() (migration 0000) so an UPDATE
-- cannot forget the timestamp. drizzle-kit cannot generate triggers, hence
-- the hand-written migration.
CREATE TRIGGER user_set_updated_at BEFORE UPDATE ON "user"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER session_set_updated_at BEFORE UPDATE ON "session"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER account_set_updated_at BEFORE UPDATE ON "account"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER verification_set_updated_at BEFORE UPDATE ON "verification"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
