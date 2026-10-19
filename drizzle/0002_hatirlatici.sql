CREATE TABLE "notification_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"subject" text,
	"recipients" text,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_recipients_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'odeme' NOT NULL,
	"amount" double precision,
	"due_date" text NOT NULL,
	"anchor_date" text NOT NULL,
	"repeat" text DEFAULT 'none' NOT NULL,
	"remind_days_before" integer DEFAULT 3 NOT NULL,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "due_date" text;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_log_key_uq" ON "notification_log" USING btree ("key");--> statement-breakpoint
CREATE INDEX "notification_log_sent_idx" ON "notification_log" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" USING btree ("due_date");