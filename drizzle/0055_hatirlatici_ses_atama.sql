ALTER TABLE "user_reminders" ADD COLUMN "sound" text DEFAULT 'tek' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_reminders" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "user_reminders" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "user_reminders" ADD CONSTRAINT "user_reminders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;