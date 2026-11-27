-- Çok şubeli AsilPOS (27 Kasım 2026; plan B1): yalnız veri, idempotent (iki kez çalışsa da aynı sonuç). Production'da
-- `npm run build` sırasında, eski sürüm hâlâ hizmet verirken çalışır: eski sürüm AsilPOS'un şubesini kütükten türetir
-- (kasa kaynağı AsilPOS olan şube, yoksa Marina) ve geçiş gününü şubenin ayarından okur; ikisi de bu göçten sonra yine
-- Marina ve aynı gün olur. Değerler eski adla yazılır (pos_source, ayar grubu; src/lib/asilpos/eski-adlar.ts).
--
-- (a) Eski genel geçiş günü (settings; yeni adlı kayıt varsa o) Marina'nın kendi ayar satırına kopyalanır. Var olan
--     satır kazanır (açıkça boş bırakılmış gün dahil), saklanan anahtar korunur.
-- (b) Marina'nın kasa kaynağı AsilPOS olur (sahibin kararı: Marina'da ModPOS tamamen bitti, föyü çekilmez). Yalnız
--     Marina'nın geçiş günü varsa: geçiş günü olmayan kurulumda (geliştirme, test) föyün çekimi kesilmez.
-- Bağlantının durum satırı taşınmaz: Marina'nınki genel satırda kalır (canlıdaki eski sürüm ve geri dönüş onu okur),
-- öteki kasalar kendi şube satırını açar (src/lib/asilpos/status.ts stateKeysOf).

INSERT INTO "branch_settings" ("branch_id", "grp", "value", "updated_by")
SELECT 'marina', 'pos.lafpos', jsonb_build_object('switchDay', st."value" #>> '{}'), 'göç 0099'
FROM "settings" st
WHERE st."key" = (
    CASE WHEN EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'asilposGecisGunu' AND jsonb_typeof("value") = 'string')
      THEN 'asilposGecisGunu' ELSE 'lafposGecisGunu' END
  )
  AND jsonb_typeof(st."value") = 'string'
  AND (st."value" #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  AND EXISTS (SELECT 1 FROM "branches" WHERE "id" = 'marina')
  AND NOT EXISTS (SELECT 1 FROM "branch_settings" WHERE "branch_id" = 'marina' AND "grp" = 'pos.asilpos')
ON CONFLICT ("branch_id", "grp") DO UPDATE
  SET "value" = "branch_settings"."value" || jsonb_build_object('switchDay', excluded."value" -> 'switchDay'), "updated_at" = now()
  WHERE "branch_settings"."same_as" IS NULL AND NOT ("branch_settings"."value" ? 'switchDay');--> statement-breakpoint

UPDATE "branches" SET "pos_source" = 'lafpos', "updated_at" = now()
WHERE "id" = 'marina' AND "kind" = 'fiziksel' AND "pos_source" = 'modpos'
  AND EXISTS (
    SELECT 1 FROM "branch_settings" bs
    WHERE bs."branch_id" = 'marina' AND bs."grp" IN ('pos.lafpos', 'pos.asilpos') AND bs."same_as" IS NULL
      AND (bs."value" ->> 'switchDay') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  );
