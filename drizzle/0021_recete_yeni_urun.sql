ALTER TABLE "recipe_change_requests" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "count_from" text;--> statement-breakpoint
ALTER TABLE "recipe_change_requests" ADD COLUMN "kind" text DEFAULT 'change' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_change_requests" ADD COLUMN "proposed" jsonb;--> statement-breakpoint
ALTER TABLE "recipe_change_requests" ADD CONSTRAINT "recipe_change_requests_kind_ck" CHECK (("recipe_change_requests"."kind" = 'change' and "recipe_change_requests"."product_id" is not null) or ("recipe_change_requests"."kind" = 'new' and "recipe_change_requests"."proposed" is not null));