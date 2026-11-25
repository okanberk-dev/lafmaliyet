CREATE TABLE "pos_stale" (
	"branch_id" text NOT NULL,
	"product_id" integer NOT NULL,
	"stale_price" double precision NOT NULL,
	"stale_since" timestamp with time zone NOT NULL,
	CONSTRAINT "pos_stale_branch_id_product_id_pk" PRIMARY KEY("branch_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "pos_marks" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_stale" ADD CONSTRAINT "pos_stale_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_stale" ADD CONSTRAINT "pos_stale_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_stale_product_idx" ON "pos_stale" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "pos_marks" ADD CONSTRAINT "pos_marks_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_marks_branch_product_idx" ON "pos_marks" USING btree ("branch_id","product_id");