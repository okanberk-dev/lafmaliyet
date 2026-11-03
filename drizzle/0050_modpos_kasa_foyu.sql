CREATE TABLE "modpos_cash_sheets" (
	"day" text PRIMARY KEY NOT NULL,
	"sheet" jsonb NOT NULL,
	"state" text NOT NULL,
	"final" boolean DEFAULT false NOT NULL,
	"fingerprint" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"previous" jsonb,
	"generated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modpos_cash_sheets_revision_pos" CHECK ("modpos_cash_sheets"."revision" >= 1)
);
