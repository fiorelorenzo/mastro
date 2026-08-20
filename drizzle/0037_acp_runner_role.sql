-- #82: the privilege boundary invariant 3 promises ("the ACP runner has no
-- write access to the database") as a real database role, not an
-- application-level convention a future refactor could quietly bypass.
--
-- `mastro_runner` gets:
--   * CONNECT on this database and USAGE on the `public` schema — without
--     both, nothing below matters.
--   * SELECT on exactly two columns of `contract`: `id` (to filter by it —
--     Postgres requires column privilege even to reference a column in a
--     WHERE clause) and `hosted_extraction_consent_document_id`, the one
--     piece of contract data model routing needs (#81's decision comment
--     on #82). No other contract column — not the title, not payment
--     terms, not the expense policy — is readable by this role.
--   * SELECT on every column of `document`: the row the runner is handed
--     to process is metadata only (hash, mime, size, provenance, its
--     owning contract) — nothing here is the confidential content itself,
--     which lives in the blob store on disk, outside this role's reach.
--
-- No INSERT, UPDATE or DELETE is granted on anything, anywhere, ever. No
-- grant at all exists on any other table — `client`, `work_unit`,
-- `invoice`, `approval`, `proposal`, every other row in this ledger is
-- unreachable from this role, not merely unreachable through some
-- application code path. `db-privilege.test.ts` connects as this role
-- directly and proves both halves: the reads this role is supposed to have
-- succeed, and a write anywhere, or a read anywhere else, is refused by
-- Postgres itself.
--
-- The password is never set here — a committed migration is public. See
-- `scripts/migrate.ts`, which rotates it from `RUNNER_DB_PASSWORD` after
-- every migration run (local and in the deployed image), and
-- `docs/agent-runner.md` for what a self-hoster configures.
-- A role is cluster-wide, not per-database, so an unguarded CREATE ROLE
-- makes a second mastro database in the same Postgres cluster impossible to
-- migrate: the run dies here with `role "mastro_runner" already exists` and
-- leaves that database half-migrated (#362). Guarded, because the fix has
-- to be in *this* file rather than a later one: a fresh database runs 0037
-- before it ever reaches migration 0069 or whatever the next number is, so
-- a later migration correcting the role would never be read in time. Editing a committed migration is
-- safe here and only here - `drizzle/meta/_journal.json` carries no
-- checksum, and the migrator applies entries whose `when` is newer than the
-- last applied one rather than re-verifying old files, so on a database
-- that already ran 0037 this edit is never executed at all. The grants
-- below are per-database (`GRANT CONNECT ON DATABASE`, `USAGE ON SCHEMA`,
-- the two table grants), so they still run on each database and stay
-- correct when the role already exists.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mastro_runner') THEN
		CREATE ROLE mastro_runner LOGIN;
	END IF;
END
$$;
COMMENT ON ROLE mastro_runner IS
	'ACP runner (#82): read-only, scoped to model routing (contract.id, contract.hosted_extraction_consent_document_id) and the document row being processed. No write grant anywhere. Password rotated by scripts/migrate.ts from RUNNER_DB_PASSWORD, never stored in this migration.';

DO $$
BEGIN
	EXECUTE format('GRANT CONNECT ON DATABASE %I TO mastro_runner', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO mastro_runner;

GRANT SELECT (id, hosted_extraction_consent_document_id) ON "contract" TO mastro_runner;
GRANT SELECT ON "document" TO mastro_runner;
