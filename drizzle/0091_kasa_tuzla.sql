CREATE TABLE "cash_counts" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" text DEFAULT 'tuzla' NOT NULL,
	"date" text NOT NULL,
	"amount" double precision NOT NULL,
	"reason" text,
	"user_id" integer,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "handed_to" text;--> statement-breakpoint
ALTER TABLE "cash_reports" ADD COLUMN "handed_to_user_id" integer;--> statement-breakpoint
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_counts_day_idx" ON "cash_counts" USING btree ("date","branch_id");--> statement-breakpoint
ALTER TABLE "cash_reports" ADD CONSTRAINT "cash_reports_handed_to_user_id_users_id_fk" FOREIGN KEY ("handed_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;