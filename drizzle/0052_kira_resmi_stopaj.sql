ALTER TABLE "fixed_expenses" ADD COLUMN "official_amount" double precision;--> statement-breakpoint
ALTER TABLE "fixed_expenses" ADD COLUMN "official_basis" text;--> statement-breakpoint
ALTER TABLE "fixed_expenses" ADD COLUMN "prorate" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Kira resmi kira ve stopajı (sahibin kararı, 4 Kasım 2026): kira kalemi varsayılan olarak tam ay (açık güne göre
-- oranlanmaz; süren ayda bugüne kadarki pay). Adı "Kira" ile başlayan, stopaj olmayan kira bölümü kalemleri.
UPDATE "fixed_expenses" SET "prorate" = false
WHERE "section" = 'kira' AND "name" ILIKE 'kira%' AND "name" NOT ILIKE '%stopaj%';
--> statement-breakpoint
-- Elle eklenmiş "Kira stopajı (resmi 100.000 TL x %20)" kalemi kira kalemine taşınır: resmi brüt kira = stopaj ÷ 0,20,
-- Gelir-gider'in "Kira stopajı" satırı bundan hesaplanır (çift sayılmasın diye kalem silinir; elle yazılmış hücreleri
-- yeni satıra taşınır). Korumalar: adında hem "kira" hem "stopaj" geçen tek kalem ve tek kira kalemi (adı "Kira" ile
-- başlar, stopaj değil, resmi kirası boş); stopaj kaleminin tutar geçmişi yok. Uymazsa hiçbir şey değişmez ve işlem
-- geçmişine yazılır (Sabit giderler'den elle taşınır). Yeniden çalışırsa bir şey yapmaz.
WITH "stopaj" AS (
  SELECT "id", "amount" FROM "fixed_expenses"
  WHERE "name" ILIKE '%stopaj%' AND "name" ILIKE '%kira%'
),
"kira" AS (
  SELECT "id" FROM "fixed_expenses"
  WHERE "section" = 'kira' AND "name" ILIKE 'kira%' AND "name" NOT ILIKE '%stopaj%' AND "official_amount" IS NULL
),
"uygun" AS (
  SELECT s."id" AS "stopaj_id", s."amount", k."id" AS "kira_id"
  FROM "stopaj" s, "kira" k
  WHERE (SELECT count(*) FROM "stopaj") = 1
    AND (SELECT count(*) FROM "kira") = 1
    AND s."amount" > 0
    AND NOT EXISTS (SELECT 1 FROM "fixed_expense_versions" v WHERE v."fixed_expense_id" = s."id")
),
"resmi" AS (
  UPDATE "fixed_expenses" f SET "official_amount" = round((u."amount" / 0.2)::numeric, 2)::double precision, "official_basis" = 'brut'
  FROM "uygun" u WHERE f."id" = u."kira_id"
  RETURNING f."id"
),
"hucre" AS (
  INSERT INTO "pnl_entries" ("month", "row_key", "amount", "note")
  SELECT p."month", 'stopaj:' || u."kira_id", p."amount", p."note"
  FROM "pnl_entries" p, "uygun" u
  WHERE p."row_key" = 'fixed:' || u."stopaj_id"
  ON CONFLICT DO NOTHING
  RETURNING "id"
),
"eski_hucre" AS (
  DELETE FROM "pnl_entries" p USING "uygun" u WHERE p."row_key" = 'fixed:' || u."stopaj_id"
  RETURNING p."id"
),
"silinen" AS (
  DELETE FROM "fixed_expenses" f USING "uygun" u WHERE f."id" = u."stopaj_id"
  RETURNING f."name"
)
INSERT INTO "activity_log" ("user_name", "action", "detail")
SELECT 'Sistem', 'Sabit giderler',
  CASE
    WHEN EXISTS (SELECT 1 FROM "silinen") THEN
      (SELECT string_agg("name", ', ') FROM "silinen") || ' kira kalemine taşındı: resmi brüt kira '
        || (SELECT replace(to_char(u."amount" / 0.2, 'FM999G999G990'), ',', '.') FROM "uygun" u) || ' ₺, stopaj Gelir-gider''de "Kira stopajı" satırında'
        || CASE WHEN (SELECT count(*) FROM "eski_hucre") > 0 THEN ' (' || (SELECT count(*) FROM "eski_hucre") || ' elle yazılmış ay taşındı)' ELSE '' END
    ELSE 'Kira stopajı kalemi kira kalemine taşınamadı (tek kira ve tek stopaj kalemi bulunamadı ya da tutar geçmişi var): Sabit giderler''de kira kaleminin resmi kirasını girip stopaj kalemine bitiş ayı verin'
  END
WHERE EXISTS (SELECT 1 FROM "stopaj");
