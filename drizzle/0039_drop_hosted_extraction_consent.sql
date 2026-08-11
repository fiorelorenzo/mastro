-- Removes the hosted-extraction consent gate. Lorenzo's call, 2026-08-11.
--
-- #81 chose a local model by default with a per-contract, document-backed
-- opt-in for a hosted one. On 2026-08-08 the model became Claude with no
-- local path, which left the gate switching between extraction and manual
-- entry rather than between two models. This removes it entirely: on a
-- single-user instance the only person who can set the flag is also the only
-- person it constrains, which makes it a note to self, not a control.
--
-- What actually protects a client's documents is unchanged and is not in
-- this file: the runner still cannot write to the ledger, every extraction
-- still becomes a proposal a human accepts (invariant 3), and every
-- proposal still keeps its source document (invariant 4).
--
-- Reversible: `0035`/`0036` are still in this directory, so putting the
-- column and its trigger back is one migration if a client ever asks for it
-- in writing.
--
-- The trigger goes first: it fires BEFORE INSERT OR UPDATE and reads the
-- column, so dropping the column out from under it would leave every write
-- to `contract` failing until this file finished.
DROP TRIGGER IF EXISTS contract_validate_hosted_extraction_consent ON "contract";--> statement-breakpoint
DROP FUNCTION IF EXISTS contract_validate_hosted_extraction_consent();--> statement-breakpoint
ALTER TABLE "contract" DROP CONSTRAINT "contract_hosted_extraction_consent_document_id_document_id_fk";--> statement-breakpoint
ALTER TABLE "contract" DROP COLUMN "hosted_extraction_consent_document_id";--> statement-breakpoint
-- The runner's read grant narrows with it: `id` alone is all routing ever
-- needed once there is nothing to route on. `0037`'s comment explains why
-- Postgres requires the column privilege even to filter by it.
REVOKE SELECT ON "contract" FROM mastro_runner;--> statement-breakpoint
GRANT SELECT (id) ON "contract" TO mastro_runner;
