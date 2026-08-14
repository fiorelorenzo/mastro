-- A client needs a legal name and a country. Everything else is optional
-- at creation and required at the point of use instead: an invoice that
-- needs an address says so, rather than a form refusing to record a name.
--
-- `tax_id` keeps its UNIQUE constraint. Postgres does not treat two NULLs
-- as equal, so clients without one coexist while two sharing a real one
-- are still refused here rather than by an application check.
ALTER TABLE "client" ALTER COLUMN "tax_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "client" ALTER COLUMN "address_line1" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "client" ALTER COLUMN "address_city" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "client" ALTER COLUMN "address_postal_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "client" ALTER COLUMN "notice_channel" DROP NOT NULL;