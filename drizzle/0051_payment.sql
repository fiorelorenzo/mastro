-- #212: payments as rows against an invoice, amount/date/method/reference,
-- with the invoice's paid state derived from their sum instead of stored
-- as a single date. Order matters: the table is created, then every
-- existing `paid_on` becomes one payment for the invoice's own full total
-- on that date (no data lost), and only then is the column dropped — so a
-- hand-run of this file against real data never has a window where the
-- old and new representations disagree.
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"date" date NOT NULL,
	"method" text,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_amount_positive" CHECK ("payment"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER payment_set_updated_at BEFORE UPDATE ON "payment"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
INSERT INTO "payment" ("invoice_id", "amount", "date", "method")
SELECT "id", "total", "paid_on", "payment_method"
FROM "invoice"
WHERE "paid_on" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" DROP COLUMN "paid_on";
