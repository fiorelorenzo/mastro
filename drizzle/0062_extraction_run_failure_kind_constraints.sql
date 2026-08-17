-- `extraction_run.failure_kind` (see `$lib/extraction/failure-kind.ts`):
-- what kind of thing went wrong, recorded where the failure happens, so
-- the run page can say it in the reader's own language instead of showing
-- them a model's English diagnostic and hoping.

-- Known values, the same reasoning as `extraction_run_status_known`:
-- widening the list is a metadata-only migration, never an
-- `ALTER TYPE ... ADD VALUE`.
ALTER TABLE "extraction_run" ADD CONSTRAINT "extraction_run_failure_kind_known"
	CHECK (failure_kind IS NULL OR failure_kind IN ('agent_failed', 'write_refused', 'timed_out'));

-- A kind only ever describes a failure. Deliberately one-directional: a
-- run that failed before this column existed has no kind and must stay
-- readable, so this does not require a kind whenever `status = 'failed'`.
-- The run page treats a missing kind as "no summary available" and falls
-- back to the diagnostic alone, which is exactly what it showed before.
ALTER TABLE "extraction_run" ADD CONSTRAINT "extraction_run_failure_kind_only_when_failed"
	CHECK (failure_kind IS NULL OR status = 'failed');
