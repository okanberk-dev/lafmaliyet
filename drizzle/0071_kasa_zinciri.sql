ALTER TABLE "cash_outs" ADD COLUMN "lafpos_id" text;--> statement-breakpoint
ALTER TABLE "pos_day_reports" ADD COLUMN "cash_moves" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_outs_lafpos_uq" ON "cash_outs" USING btree ("lafpos_id");