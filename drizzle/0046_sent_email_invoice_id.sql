ALTER TABLE "sent_email" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "sent_email" ADD CONSTRAINT "sent_email_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sent_email_invoice_id_idx" ON "sent_email" USING btree ("invoice_id");