ALTER TABLE "client" ADD COLUMN "sdi_code" text;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "pec_address" text;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_sdi_code_length" CHECK ("client"."sdi_code" is null or char_length("client"."sdi_code") = 7);--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_pec_address_is_email" CHECK ("client"."pec_address" is null or "client"."pec_address" ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$');