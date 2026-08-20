-- #398: an extraction that proposed nothing is finished, not failed.
--
-- `drain.ts` threw when a completed job produced no proposal, so the run
-- landed on `failed` with the reason "produced no proposal". That is wrong
-- about two things at once: the model did not fail, and the message was
-- read successfully. On the live instance three newsletters sat there as
-- failures, and because a failed job is deliberately left in `done/` for a
-- retry (#278), every sweep re-reported them - a permanent entry in
-- `agent_run.detail` and a standing input to `agent_run_failure` for three
-- messages that simply approved no days.
--
-- `applied` cannot express it either: `extraction_run_proposal_id_iff_applied`
-- ties that status to a non-null `proposal_id`, correctly, since an applied
-- run is one that produced something. So this is a sixth status rather than
-- a reinterpretation of an existing one.
--
-- Only `extraction_run_status_known` needs widening. The other two
-- status-shaped CHECKs already say the right thing about it without being
-- touched: `extraction_run_error_iff_failed` keeps `error` null for a run
-- that did not fail, and `extraction_run_failure_kind_only_when_failed`
-- keeps `failure_kind` null the same way.
--
-- Deliberately still a CHECK rather than a Postgres enum, the same
-- reasoning `extraction_run_status_known` was written with: a CHECK is
-- widened by replacing it, reviewable in one diff, where an
-- `ALTER TYPE ... ADD VALUE` cannot be rolled back inside a transaction.

ALTER TABLE "extraction_run" DROP CONSTRAINT "extraction_run_status_known";--> statement-breakpoint

ALTER TABLE "extraction_run" ADD CONSTRAINT "extraction_run_status_known"
	CHECK (status IN ('queued', 'running', 'extracted', 'applied', 'failed', 'nothing_proposed'));
