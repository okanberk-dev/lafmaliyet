CREATE TABLE "cash_report_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"date" text NOT NULL,
	"revision" integer NOT NULL,
	"data" jsonb NOT NULL,
	"submitted_by" integer,
	"submitted_by_name" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "months" ALTER COLUMN "discounts" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "months" ALTER COLUMN "discounts" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "months" ALTER COLUMN "off_revenue" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "months" ALTER COLUMN "off_revenue" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "discounts" double precision;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "counted_by" integer;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "counted_by_name" text;--> statement-breakpoint
ALTER TABLE "months" ADD COLUMN "card_share" double precision;--> statement-breakpoint
ALTER TABLE "cash_report_revisions" ADD CONSTRAINT "cash_report_revisions_report_id_cash_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."cash_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_report_revisions" ADD CONSTRAINT "cash_report_revisions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_report_revisions_report_idx" ON "cash_report_revisions" USING btree ("report_id");--> statement-breakpoint
ALTER TABLE "cash_reports" ADD CONSTRAINT "cash_reports_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;