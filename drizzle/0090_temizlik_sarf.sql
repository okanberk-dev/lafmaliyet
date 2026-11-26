-- "Temizlik & Sarf" fatura kategorisi (25 Kasım 2026; docs/PARASUT.md › 4. Kategori, › 5f): sarf ve temizlik malzemesi
-- faturaları (ve karışık faturanın "Sarf" denmiş kalemleri) Gelir-gider'de bir harcama satırında sayılsın diye, bu
-- kategoriye bağlı Aylık harcamalar kategorisi yoksa "Temizlik & sarf malzemesi" açılır (İşletme genel giderleri).
-- Var olan faturaların kategorisine dokunulmaz; ad başka kategoride kullanılıyorsa açılmaz. İki kez koşsa da aynı sonuç.
INSERT INTO "expense_categories" ("name", "section", "panel_group", "invoice_category", "sort_order")
SELECT 'Temizlik & sarf malzemesi', 'genel', 'diger', 'Temizlik & Sarf', x."n"
FROM (SELECT coalesce(max("sort_order"), 0) + 1 AS "n" FROM "expense_categories") AS x
WHERE NOT EXISTS (SELECT 1 FROM "expense_categories" WHERE "invoice_category" = 'Temizlik & Sarf')
ON CONFLICT ("name") DO NOTHING;
