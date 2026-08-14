-- #257: `invoice_contract_number_unique` (0014_invoice.sql) enforced
-- uniqueness per *contract*, not per issuer, despite its own comment
-- claiming otherwise. mastro is single-tenant — one fiscal profile, one
-- issuer (AGENTS.md) — so "per issuer" and "globally" name the same set,
-- and neither was actually enforced: two different contracts could both
-- be issued invoice 2026/014 and the database accepted both. Art. 21,
-- comma 2, lett. b), D.P.R. 633/1972 requires "un numero progressivo che
-- la identifichi in modo univoco" — unique to the issuer — and SdI checks
-- exactly this on ingest.
--
-- Drop the old, too-narrow constraint before adding the new one: keeping
-- both around even briefly would mean the column pair stays "unique" while
-- the column alone is not, which is exactly the bug this migration fixes.
-- Safe against existing data — no two rows in this table share a `number`
-- today (verified against the demo seed and every fixture that inserts
-- into this table directly), so widening the constraint has nothing to
-- reject.
ALTER TABLE "invoice" DROP CONSTRAINT "invoice_contract_number_unique";--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_number_unique" UNIQUE("number");
