# Plan: şubeler, kanallar ve Marina (4 Kasım 2026)

**İstek (sahip):** "şube yönetimi de yap ve laffogato.net cirosunu da ayrı tut; şimdi Laffogato Marina şubesi de
açılıyor, ona göre de bir sekme aç, güzel bir detay yap LafPOS, lafmaliyet için."

Kararlar `docs/SUBE.md`'nin başındaki tabloda. Bu dosya işin dalgalara bölünmüş hâli; kurallar `CRITIQUE.md` §1
(main'e doğrudan push yok, R2 migration protokolü, her dalga bir PR).

## Dalga 1 — kütük ve ekran (BİTTİ)

- `branches` tablosu (`0053_subeler.sql`), tohum (Tuzla, Marina, laffogato.net), `src/lib/branches.ts` (saf
  kurallar), `src/server/branches.ts`, `src/server/actions/branches.ts`, **Ayarlar › Şubeler** ekranı,
  `tests/subeler.test.ts` (11 test), `docs/SUBE.md`.
- Hiçbir ciro tablosuna dokunulmadı: bütün raporlar bugünkü gibi. Risk yok, geri alınabilir.

## Dalga 2 — şube sütunu ciro yoluna

Sırayla ve **tek migration** (R2): her tabloya `branch_id text not null default 'tuzla' references branches(id)`,
sonra default kaldırılmadan bırakılır (eski satırlar Tuzla'ya yazılmış olur; sahibin kararı).

| Tablo | Anahtar bugün | Anahtar sonra |
|---|---|---|
| `cash_reports` | `date` | `(date, branch_id)` |
| `pos_daily_sales` | `(date, pos_name)` uq | `(date, branch_id, pos_name)` uq |
| `pos_day_reports` | `date` | `(date, branch_id)` |
| `modpos_cash_sheets` | `day` | `(day, branch_id)` |
| `months` / `sales_lines` | `month` | `(month, branch_id)` |
| `expense_entries`, `cash_outs`, `waste_entries`, `stock_counts` | — | `+ branch_id` |
| `invoices`, `suppliers`, `ingredients`, `products`, `recipe_items` | — | **değişmez** (ortak) |

Dikkat: `months` birincil anahtarı birçok yerden referanslı; değişikliğin tamamı tek dalgada ve boş veritabanında
`db:migrate && db:seed` ile denenir. `src/server/branches.ts` › `branchUsageCount` bu dalgada gerçek sayımı yapar.

## Dalga 3 — seçici ve süzgeç

- Panel başlığında şube / kanal seçici: **Tümü · Tuzla · Marina · laffogato.net**. Seçim `laf_sube` çerezinde ve
  `?sube=` ile paylaşılabilir (`BRANCH_COOKIE`, `BRANCH_PARAM`; `parseBranchScope` tanınmayan ve kapalı değeri
  "Tümü"ye düşürür).
- Ciro okuyan her sorgu `branchScopeIds()` ile süzülür. Ortak veriler (menü, reçete, hammadde, tedarikçi)
  süzülmez: seçici onlarda görünmez.
- laffogato.net kanalı "Tümü"ye **girer** (işletmenin cirosudur) ama her yerde ayrı satır olarak görünür; bugünkü
  `/panel/gelir-gider` ayrımı bu kanala taşınır.

## Dalga 4 — Marina sekmesi ve karşılaştırma

- Genel bakış, Kasa raporu, Satışlar ve Gelir-gider'e şube sekmeleri (`SectionTab`): Tümü · Tuzla · Marina ·
  laffogato.net.
- Genel bakış'ta şube karşılaştırma kartı: şube başına net satış, brüt kâr, kişi başı sepet, gün sonu farkı.
- Marina'nın ModPOS bilgileri: `modpos` ayarları şube başına (bugün tek takım anahtar var, `docs/MODPOS-API.md`).
  Kasa föyü çekimi şube başına çalışır; günlük 2 istek sınırı şube başına sayılır.

## Dalga 5 — şubeye özel fiyat

- `product_prices`'a `branch_id` (boş = bütün şubeler): Marina'nın fiyatı farklıysa satır açılır, yoksa ortak
  fiyat geçerli. "Satışta / Tükendi" de şube başına (`docs/SITE-MENU.md` ile birlikte).
- Fiyatlar ekranında şube sütunu ve toplu değişiklikte şube seçimi.

## LafPOS tarafı (ayrı depo, `RiosenBeq/lafpos`)

Marina ModPOS kullanacağı için LafPOS'ta acil bir iş yok; yine de gün sonu gönderimi şubesiz kalmamalı:

- Kasanın ayarlarına **şube kimliği** (`sube_id`) eklenir, kurulumda yazılır ve gün sonu özetine konur.
- `POST /api/pos/gun` yükünde `sube` alanı: panel yoksa `tuzla` sayar (geri uyumlu), varsa o şubenin satırını
  yazar. Böylece ileride bir şubeye LafPOS kurulursa panel tarafında iş kalmaz.

## Açık sorular (cevap gelene kadar varsayılan uygulanır)

1. Marina'nın **giderleri ve personeli** ayrı mı izlenecek, yoksa yalnız ciro mu bölünecek? (Varsayılan: dalga
   2'de giderler de şubeye bağlanır, ortak giderler Tuzla'ya değil "işletme geneli"ne yazılır → bunun için
   `branch_id` null bırakılabilir bir sütun olmalı; dalga 2 öncesi netleşmeli.)
2. Marina'nın **ModPOS anahtarları** ayrı mı? (Varsayılan: evet, şube başına ayar.)
3. Stok ve sayım şube başına mı? (Varsayılan: evet, dalga 2'de `stock_counts` şubeye bağlanır.)
