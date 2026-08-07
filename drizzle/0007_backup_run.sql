CREATE TYPE "public"."backup_run_status" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TABLE "backup_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "backup_run_status" NOT NULL,
	"detail" text,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
