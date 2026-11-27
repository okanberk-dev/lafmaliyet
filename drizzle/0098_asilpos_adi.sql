-- AsilPOS ad değişikliği (26 Kasım 2026; plan A1): yalnız genişletme, tek işlem. Production'da migration'lar
-- `npm run build` sırasında, eski sürüm hâlâ hizmet verirken çalışır: her adım eski sürümün okuma ve yazmalarını bozmaz.
-- - İki tablo yeni adına taşınır (sayacı, birincil anahtarı, benzersizliği, dizini ve yabancı anahtarlarıyla); eski adla
--   aynı sütunlu görünüm (view) kalır. Tek tablolu görünüm kendiliğinden güncellenebilir: eski sürümün INSERT (ON
--   CONFLICT ile), UPDATE, DELETE ve RETURNING'i tabloya gider, verilmeyen ya da DEFAULT sütun tablonun varsayılanını
--   alır. Görünüme varsayılan konmaz (geri yükleme nextval varsayılanlı sütunları tarar).
-- - İki sütunun yeni adlısı eklenir ve doldurulur; tetikleyici ikisini eşit tutar (eski sürüm eskisini yazar).
-- - Kasa kaynağının CHECK'i yeni değeri de kabul eder; değer değiştirilmez (yazılan eski değer).
-- Fonksiyonlar CREATE OR REPLACE, tetikleyiciler DROP ... IF EXISTS: yedeğin geri yüklemesi tabloları siler, fonksiyonları
-- silmez; migration'ı yeniden oynatırken düşmesin. Eski adlar temizlik PR'ında (A3) kalkar.

ALTER TABLE "lafpos_installs" RENAME TO "asilpos_installs";--> statement-breakpoint
ALTER SEQUENCE "lafpos_installs_id_seq" RENAME TO "asilpos_installs_id_seq";--> statement-breakpoint
ALTER TABLE "asilpos_installs" RENAME CONSTRAINT "lafpos_installs_pkey" TO "asilpos_installs_pkey";--> statement-breakpoint
ALTER TABLE "asilpos_installs" RENAME CONSTRAINT "lafpos_installs_token_hash_unique" TO "asilpos_installs_token_hash_unique";--> statement-breakpoint
ALTER TABLE "asilpos_installs" RENAME CONSTRAINT "lafpos_installs_branch_id_branches_id_fk" TO "asilpos_installs_branch_id_branches_id_fk";--> statement-breakpoint
ALTER TABLE "asilpos_installs" RENAME CONSTRAINT "lafpos_installs_created_by_users_id_fk" TO "asilpos_installs_created_by_users_id_fk";--> statement-breakpoint
ALTER INDEX "lafpos_installs_branch_idx" RENAME TO "asilpos_installs_branch_idx";--> statement-breakpoint
CREATE VIEW "lafpos_installs" AS SELECT * FROM "asilpos_installs";--> statement-breakpoint

ALTER TABLE "lafpos_day_ends" RENAME TO "asilpos_day_ends";--> statement-breakpoint
ALTER TABLE "asilpos_day_ends" RENAME CONSTRAINT "lafpos_day_ends_date_branch_id_pk" TO "asilpos_day_ends_date_branch_id_pk";--> statement-breakpoint
ALTER TABLE "asilpos_day_ends" RENAME CONSTRAINT "lafpos_day_ends_branch_id_branches_id_fk" TO "asilpos_day_ends_branch_id_branches_id_fk";--> statement-breakpoint
ALTER TABLE "asilpos_day_ends" RENAME CONSTRAINT "lafpos_day_ends_report_id_cash_reports_id_fk" TO "asilpos_day_ends_report_id_cash_reports_id_fk";--> statement-breakpoint
CREATE VIEW "lafpos_day_ends" AS SELECT * FROM "asilpos_day_ends";--> statement-breakpoint

ALTER TABLE "cash_outs" ADD COLUMN "asilpos_id" text;--> statement-breakpoint
UPDATE "cash_outs" SET "asilpos_id" = "lafpos_id" WHERE "lafpos_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_outs_asilpos_uq" ON "cash_outs" USING btree ("asilpos_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "cash_outs_asilpos_id_esle"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."asilpos_id" := COALESCE(NEW."asilpos_id", NEW."lafpos_id");
    NEW."lafpos_id" := NEW."asilpos_id";
  ELSIF NEW."asilpos_id" IS DISTINCT FROM OLD."asilpos_id" THEN
    NEW."lafpos_id" := NEW."asilpos_id";
  ELSIF NEW."lafpos_id" IS DISTINCT FROM OLD."lafpos_id" THEN
    NEW."asilpos_id" := NEW."lafpos_id";
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "cash_outs_asilpos_id_esle" ON "cash_outs";--> statement-breakpoint
CREATE TRIGGER "cash_outs_asilpos_id_esle" BEFORE INSERT OR UPDATE ON "cash_outs" FOR EACH ROW EXECUTE FUNCTION "cash_outs_asilpos_id_esle"();--> statement-breakpoint

ALTER TABLE "pos_daily_sales" ADD COLUMN "asilpos_service" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "pos_daily_sales" SET "asilpos_service" = true WHERE "lafpos_service";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "pos_daily_sales_asilpos_service_esle"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."asilpos_service" := NEW."asilpos_service" OR NEW."lafpos_service";
    NEW."lafpos_service" := NEW."asilpos_service";
  ELSIF NEW."asilpos_service" IS DISTINCT FROM OLD."asilpos_service" THEN
    NEW."lafpos_service" := NEW."asilpos_service";
  ELSIF NEW."lafpos_service" IS DISTINCT FROM OLD."lafpos_service" THEN
    NEW."asilpos_service" := NEW."lafpos_service";
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "pos_daily_sales_asilpos_service_esle" ON "pos_daily_sales";--> statement-breakpoint
CREATE TRIGGER "pos_daily_sales_asilpos_service_esle" BEFORE INSERT OR UPDATE ON "pos_daily_sales" FOR EACH ROW EXECUTE FUNCTION "pos_daily_sales_asilpos_service_esle"();--> statement-breakpoint

ALTER TABLE "branches" DROP CONSTRAINT "branches_pos_source_ck";--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_pos_source_ck" CHECK ("branches"."pos_source" in ('modpos','lafpos','asilpos','yok'));
