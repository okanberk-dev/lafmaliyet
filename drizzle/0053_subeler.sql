CREATE TABLE "branches" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"pos_source" text DEFAULT 'yok' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"opened_on" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_kind_ck" CHECK ("branches"."kind" in ('fiziksel','online')),
	CONSTRAINT "branches_pos_source_ck" CHECK ("branches"."pos_source" in ('modpos','lafpos','yok')),
	CONSTRAINT "branches_source_kind_ck" CHECK (("branches"."kind" = 'online' and "branches"."pos_source" = 'yok') or ("branches"."kind" = 'fiziksel' and "branches"."pos_source" <> 'yok'))
);
--> statement-breakpoint
CREATE INDEX "branches_active_idx" ON "branches" USING btree ("active","sort_order");