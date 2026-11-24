-- Kasada bekleyen fiyat şube başına (şube kapsamı A3, 24 Kasım 2026; docs/FIYATLAR.md › Kasaya işle). Şubeler öncesi
-- tek kasanın durumu (products.pos_stale_*) yeni tabloya kopyalanır; ürün sütunlarına dokunulmaz (bir sürüm geri dönüş
-- güvenliği için durur, okunmaz). Kural okuyucularla aynı (src/server/data/till-scope.ts tillProductFilter):
-- - Tuzla ve kasası ModPOS olan öbür etkin fiziksel şubeler: bütün işaretler olduğu gibi.
-- - Marina (LafPOS'un şubesi, src/lib/lafpos/switch.ts LAFPOS_BRANCH_ID): geçiş günü gelmişse (iş günü, 05:00 kuralı)
--   yalnız siteye bağlı olmayan ve fiyatı LafPOS başladıktan sonra panelde değişen ürünler; ModPOS'tan kalan işaret
--   LafPOS'un işi değildir. Geçiş günü yoksa ya da ileride ise Marina'nın kasası henüz ModPOS'tur: hepsi.
-- Geçiş günü okuması readLafposSwitchDay ile aynı (takvim günü, en erken LAFPOS_SWITCH_MIN = 2026-10-01). Online
-- kanalın kasası yok. Var olan satıra dokunulmaz (göç iki kez koşsa da aynı sonuç).
WITH "gecis" AS (
  SELECT (
    SELECT CASE WHEN jsonb_typeof(st."value") = 'string' AND (st."value" #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN st."value" #>> '{}' END
    FROM "settings" st
    WHERE st."key" = 'lafposGecisGunu'
  ) AS "gun"
),
"lafpos" AS (
  SELECT CASE WHEN g."gun" >= '2026-10-01' AND g."gun" <= to_char((now() AT TIME ZONE 'Europe/Istanbul') - interval '5 hours', 'YYYY-MM-DD') THEN g."gun" END AS "gun"
  FROM "gecis" g
)
INSERT INTO "pos_stale" ("branch_id", "product_id", "stale_price", "stale_since")
SELECT b."id", p."id", p."pos_stale_price", COALESCE(p."pos_stale_since", now())
FROM "products" p
CROSS JOIN "branches" b
CROSS JOIN "lafpos" l
WHERE p."pos_stale_price" IS NOT NULL
  AND b."kind" = 'fiziksel'
  AND (b."active" OR b."id" = 'tuzla')
  AND (
    b."id" <> 'marina'
    OR l."gun" IS NULL
    OR (
      p."site_menu_id" IS NULL
      AND EXISTS (
        SELECT 1
        FROM "product_prices" pp
        WHERE pp."product_id" = p."id" AND pp."on_site" = false AND pp."changed_at" >= (l."gun" || 'T05:00:00+03:00')::timestamptz
      )
    )
  )
ON CONFLICT ("branch_id", "product_id") DO NOTHING;
