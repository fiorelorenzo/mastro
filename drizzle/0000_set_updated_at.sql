-- The trigger every table hangs its `updated_at` on. Keeping it in the database
-- rather than in the application means a hand-written UPDATE cannot forget it.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
