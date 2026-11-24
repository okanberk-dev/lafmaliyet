CREATE TABLE "pos_day_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"branch_id" text DEFAULT 'tuzla' NOT NULL,
	"revision" integer,
	"z_no" integer NOT NULL,
	"correction" jsonb,
	"body" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos_daily_sales" ADD COLUMN "gross" double precision;--> statement-breakpoint
ALTER TABLE "pos_daily_sales" ADD COLUMN "is_addon" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_day_reports" ADD COLUMN "off_device" jsonb;--> statement-breakpoint
ALTER TABLE "pos_day_reports" ADD COLUMN "refunds" jsonb;--> statement-breakpoint
ALTER TABLE "pos_day_reports" ADD COLUMN "iptal" jsonb;--> statement-breakpoint
ALTER TABLE "pos_day_reports" ADD COLUMN "correction" jsonb;--> statement-breakpoint
ALTER TABLE "pos_day_reports" ADD COLUMN "revision" integer;--> statement-breakpoint
ALTER TABLE "pos_day_revisions" ADD CONSTRAINT "pos_day_revisions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_day_revisions_day_idx" ON "pos_day_revisions" USING btree ("date","branch_id");