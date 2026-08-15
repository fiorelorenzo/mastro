-- Extraction runs (docs/specs/2026-08-15-extraction-runs-design.md): the
-- `updated_at` trigger every table installs, the CHECK constraints the
-- generator cannot express, and the UNIQUE(run_id, seq) that makes
-- `appendRunEvents` idempotent (`repositories/extraction-run.ts`).

CREATE TRIGGER extraction_run_set_updated_at BEFORE UPDATE ON "extraction_run"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER extraction_run_event_set_updated_at BEFORE UPDATE ON "extraction_run_event"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The gap the design doc names: `extracted` and `applied` are separate
-- states precisely so a run whose model answered but whose write failed
-- has somewhere to be visible instead of nowhere. These two CHECKs are
-- that gap enforced in the database, not application code.
ALTER TABLE "extraction_run" ADD CONSTRAINT "extraction_run_error_iff_failed"
	CHECK ((status = 'failed') = (error IS NOT NULL));

ALTER TABLE "extraction_run" ADD CONSTRAINT "extraction_run_proposal_id_iff_applied"
	CHECK ((status = 'applied') = (proposal_id IS NOT NULL));

-- Known-value CHECKs, the same reasoning as `document_owner_type_known`
-- and `proposal_target_type_known`: widening either list is a metadata-
-- only migration, never an `ALTER TYPE ... ADD VALUE`.
ALTER TABLE "extraction_run" ADD CONSTRAINT "extraction_run_status_known"
	CHECK (status IN ('queued', 'running', 'extracted', 'applied', 'failed'));

ALTER TABLE "extraction_run" ADD CONSTRAINT "extraction_run_target_type_known"
	CHECK (target_type IN ('work_unit', 'contract', 'invoice'));

ALTER TABLE "extraction_run_event" ADD CONSTRAINT "extraction_run_event_kind_known"
	CHECK (kind IN ('message', 'thought', 'tool_call', 'plan', 'stop', 'error'));

-- One run's transcript never repeats a sequence number. `appendRunEvents`
-- relies on this exact constraint for its `ON CONFLICT DO NOTHING`: a
-- reconnecting SSE reader replays lines of `runs/<jobId>.jsonl` it has
-- already persisted, and re-inserting an already-stored `(run_id, seq)`
-- must be a no-op, never a duplicate row or an error.
ALTER TABLE "extraction_run_event" ADD CONSTRAINT "extraction_run_event_run_id_seq_unique"
	UNIQUE (run_id, seq);
