CREATE TABLE "assistant_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"tool" text NOT NULL,
	"input" jsonb NOT NULL,
	"preview" jsonb NOT NULL,
	"branch" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"result" jsonb,
	"undo" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "via" text;--> statement-breakpoint
ALTER TABLE "assistant_ops" ADD CONSTRAINT "assistant_ops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_ops_user_idx" ON "assistant_ops" USING btree ("user_id","created_at");