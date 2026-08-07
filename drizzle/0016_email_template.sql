CREATE TABLE "email_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"attachment_kinds" text[] NOT NULL,
	"trigger" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sent_email" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"email_template_id" uuid NOT NULL,
	"recipients" jsonb NOT NULL,
	"subject" text NOT NULL,
	"message_id" text NOT NULL,
	"auto_sent" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract" ADD COLUMN "auto_send_mail" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_template" ADD CONSTRAINT "email_template_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_email" ADD CONSTRAINT "sent_email_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_email" ADD CONSTRAINT "sent_email_email_template_id_email_template_id_fk" FOREIGN KEY ("email_template_id") REFERENCES "public"."email_template"("id") ON DELETE restrict ON UPDATE no action;