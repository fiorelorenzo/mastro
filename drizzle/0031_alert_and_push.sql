CREATE TYPE "public"."alert_delivery_channel" AS ENUM('push', 'digest');--> statement-breakpoint
CREATE TABLE "alert_acknowledgement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_key" text NOT NULL,
	"alert_type" text NOT NULL,
	"severity_rank" integer NOT NULL,
	"acknowledged_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_acknowledgement_alert_key_key" UNIQUE("alert_key")
);
--> statement-breakpoint
CREATE TABLE "alert_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_key" text NOT NULL,
	"alert_type" text NOT NULL,
	"severity_rank" integer NOT NULL,
	"channel" "alert_delivery_channel" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_delivery_alert_key_key" UNIQUE("alert_key")
);
--> statement-breakpoint
CREATE TABLE "alert_preference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_type" text NOT NULL,
	"digest_enabled" boolean DEFAULT true NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_preference_alert_type_key" UNIQUE("alert_type")
);
--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscription_endpoint_key" UNIQUE("endpoint")
);
