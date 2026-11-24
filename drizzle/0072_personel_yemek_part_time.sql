ALTER TABLE "staff" ADD COLUMN "meal_card" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "kind" text DEFAULT 'full_time' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "daily_wage" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "person_ref" text;--> statement-breakpoint
ALTER TABLE "staff_versions" ADD COLUMN "meal_card" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_versions" ADD COLUMN "daily_wage" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_user_idx" ON "staff" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_kind_ck" CHECK ("staff"."kind" in ('full_time','part_time'));--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_link_ck" CHECK ("staff"."user_id" is null or "staff"."person_ref" is null);