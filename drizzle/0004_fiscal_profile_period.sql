-- `updated_at` maintenance, and the non-overlap guarantee for
-- `fiscal_profile.valid_from`/`valid_to` that Drizzle cannot express:
-- neither a generated range column nor an EXCLUDE constraint has a
-- TypeScript builder.
CREATE TRIGGER fiscal_profile_set_updated_at BEFORE UPDATE ON "fiscal_profile"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- `valid_to` null means "still current", i.e. unbounded above; `daterange`
-- treats a NULL bound as infinity, so this is exactly that without a
-- sentinel date. `[)`: `valid_from` in, `valid_to` out, matching how
-- resolution reads the period (`src/lib/server/fiscal/resolve.ts`).
ALTER TABLE "fiscal_profile"
  ADD COLUMN "valid_period" daterange
  GENERATED ALWAYS AS (daterange("valid_from", "valid_to", '[)')) STORED;

-- Two profiles must never cover the same instant, so at most one is ever
-- current at a time and a date inside a regime change resolves to exactly
-- one pack. Range types carry a built-in GiST opclass, so this needs no
-- extension.
ALTER TABLE "fiscal_profile"
  ADD CONSTRAINT "fiscal_profile_no_overlap" EXCLUDE USING gist ("valid_period" WITH &&);