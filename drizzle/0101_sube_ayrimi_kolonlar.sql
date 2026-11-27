-- Şube ayrımı parça 3 (27 Kasım 2026; docs/SUBE.md › Şube ayrımı › Şube sütunu gelen tablolar): şube sütunu olmayan dört
-- tabloya şube. Production'da `npm run build` sırasında, eski sürüm hâlâ hizmet verirken çalışır: eski sürüm yeni
-- sütunları bilmez, yazdığı satır aşağıdaki kurallarla doğru kalır.
--
-- (a) checklist_runs.branch_id: kontrol listesinin günlük kaydı şube başına. Şubeli listenin kaydı listenin şubesinde;
--     bütün şubelerin listesinin her şubede kendi kaydı olur (tekil anahtar şablon, gün, şube, sıra). Eski kayıtlar:
--     listenin şubesi, yoksa listeyi tamamlayanın, o da yoksa ilk yanıtlayanın (fiziksel) şubesi, o da yoksa Tuzla.
--     Varsayılan yok: sütunu bilmeyen yazımda (eski sürüm) tetikleyici listenin şubesini, yoksa Tuzla'yı yazar; şubeli
--     listede her yazım listenin şubesine iner (kayıt başka şubeye düşmez).
-- (b) activity_log.branch_id ve notification_log.branch_id: kaydın şubesi; boş = işletme geneli ya da bu göçten önceki
--     kayıt (geri doldurulmaz: hangi şubede yapıldığı bilinmiyor). Şube silinince boşalır.
-- (c) investments.branch_id: yatırımın şubesi; boş = işletme geneli (eski kayıtlar).
ALTER TABLE "checklist_runs" ADD COLUMN "branch_id" text;--> statement-breakpoint
UPDATE "checklist_runs" r SET "branch_id" = coalesce(
  (SELECT t."branch_id" FROM "checklist_templates" t WHERE t."id" = r."template_id"),
  (SELECT u."branch_id" FROM "users" u JOIN "branches" b ON b."id" = u."branch_id" AND b."kind" = 'fiziksel' WHERE u."id" = r."completed_by"),
  (SELECT u."branch_id" FROM "checklist_answers" a
     JOIN "users" u ON u."id" = a."answered_by"
     JOIN "branches" b ON b."id" = u."branch_id" AND b."kind" = 'fiziksel'
   WHERE a."run_id" = r."id" ORDER BY a."answered_at", a."id" LIMIT 1),
  'tuzla'
) WHERE r."branch_id" IS NULL;--> statement-breakpoint
ALTER TABLE "checklist_runs" ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "checklist_runs_branch_fill"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT coalesce(t."branch_id", NEW."branch_id") INTO NEW."branch_id" FROM "checklist_templates" t WHERE t."id" = NEW."template_id";
  IF NEW."branch_id" IS NULL THEN
    NEW."branch_id" := 'tuzla';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "checklist_runs_branch_fill_tg" BEFORE INSERT ON "checklist_runs" FOR EACH ROW EXECUTE FUNCTION "checklist_runs_branch_fill"();--> statement-breakpoint
DROP INDEX "checklist_runs_template_day_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_runs_template_day_uq" ON "checklist_runs" USING btree ("template_id","date","branch_id","seq");--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
