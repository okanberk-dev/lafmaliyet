CREATE TABLE "error_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"source" text NOT NULL,
	"level" text DEFAULT 'error' NOT NULL,
	"name" text,
	"message" text NOT NULL,
	"path" text,
	"detail" text,
	"digest" text,
	"stack" text,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "error_log_source_ck" CHECK ("error_log"."source" in ('server','action','client','csp')),
	CONSTRAINT "error_log_level_ck" CHECK ("error_log"."level" in ('error','warning')),
	CONSTRAINT "error_log_count_ck" CHECK ("error_log"."count" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "error_log_fingerprint_uq" ON "error_log" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "error_log_last_seen_idx" ON "error_log" USING btree ("last_seen");--> statement-breakpoint
CREATE INDEX "error_log_source_first_idx" ON "error_log" USING btree ("source","first_seen");