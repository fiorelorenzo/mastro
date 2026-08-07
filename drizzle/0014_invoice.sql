CREATE TYPE "public"."invoice_document_type" AS ENUM('invoice', 'advance_on_invoice', 'advance_on_fee_note', 'credit_note', 'debit_note', 'fee_note');--> statement-breakpoint
CREATE TYPE "public"."invoice_due_date_source" AS ENUM('document', 'computed');--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"number" text NOT NULL,
	"issue_date" date NOT NULL,
	"document_type" "invoice_document_type" DEFAULT 'invoice' NOT NULL,
	"currency" text NOT NULL,
	"taxable_amount" integer NOT NULL,
	"tax_amount" integer NOT NULL,
	"total" integer NOT NULL,
	"tax_treatment_code" text,
	"statutory_reference" jsonb,
	"stamp_duty" integer,
	"social_charge" integer,
	"due_date" date NOT NULL,
	"due_date_source" "invoice_due_date_source" NOT NULL,
	"payment_method" text,
	"iban" text,
	"transmission_id" text,
	"paid_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_contract_number_unique" UNIQUE("contract_id","number"),
	CONSTRAINT "invoice_taxable_amount_non_negative" CHECK ("invoice"."taxable_amount" >= 0),
	CONSTRAINT "invoice_tax_amount_non_negative" CHECK ("invoice"."tax_amount" >= 0),
	CONSTRAINT "invoice_total_non_negative" CHECK ("invoice"."total" >= 0),
	CONSTRAINT "invoice_stamp_duty_non_negative" CHECK ("invoice"."stamp_duty" is null or "invoice"."stamp_duty" >= 0),
	CONSTRAINT "invoice_social_charge_non_negative" CHECK ("invoice"."social_charge" is null or "invoice"."social_charge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(6, 2) NOT NULL,
	"unit_price" integer NOT NULL,
	"amount" integer NOT NULL,
	"tax_rate" numeric(5, 2) NOT NULL,
	"tax_treatment_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_line_quantity_positive" CHECK ("invoice_line"."quantity" > 0),
	CONSTRAINT "invoice_line_unit_price_non_negative" CHECK ("invoice_line"."unit_price" >= 0),
	CONSTRAINT "invoice_line_amount_non_negative" CHECK ("invoice_line"."amount" >= 0),
	CONSTRAINT "invoice_line_tax_rate_range" CHECK ("invoice_line"."tax_rate" >= 0 and "invoice_line"."tax_rate" <= 100)
);
--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_unit" ADD CONSTRAINT "work_unit_invoice_line_id_invoice_line_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_line"("id") ON DELETE restrict ON UPDATE no action;