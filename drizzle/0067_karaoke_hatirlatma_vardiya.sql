CREATE TABLE "karaoke_reminders" (
	"external_id" text PRIMARY KEY NOT NULL,
	"email_sealed" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"detail" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" text DEFAULT 'tuzla' NOT NULL,
	"date" text NOT NULL,
	"person_ref" text NOT NULL,
	"user_id" integer,
	"person_name" text NOT NULL,
	"kind" text DEFAULT 'work' NOT NULL,
	"start_min" integer,
	"end_min" integer,
	"note" text,
	"updated_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_time_ck" CHECK (("shifts"."kind" = 'off' and "shifts"."start_min" is null and "shifts"."end_min" is null) or ("shifts"."kind" = 'work' and "shifts"."start_min" >= 0 and "shifts"."start_min" < 1440 and "shifts"."end_min" > "shifts"."start_min" and "shifts"."end_min" <= 1800))
);
--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "karaoke_reminders_status_idx" ON "karaoke_reminders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_branch_date_person_uq" ON "shifts" USING btree ("branch_id","date","person_ref");--> statement-breakpoint
CREATE INDEX "shifts_date_idx" ON "shifts" USING btree ("date");