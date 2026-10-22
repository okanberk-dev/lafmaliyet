# Plan: add items to the stock count (staff too), seven new items, staff propose new products

Owner request (22 Oct 2026, verbatim): _"Ayrıca stok sayımına da ürün ekleyebilelim personel de ekleyebilsin ve
aşağıdakileri de ekle: çilek şurubu, cookie şurubu, lemon tea şurubu, hazelnut şurubu, vanilya sos, yaban mersini
püre, böğürtlen püre. Menüye de eklenebilsin ürün"_. Clarified: "Menüye de eklenebilsin ürün" = **staff can add
products too** (today only the admin has Ürünler › Yeni ürün); staff never see prices or costs, the admin completes.

Base: `claude/kalan-isler` after wave 1 (ops-backup, vkn). Conventions as in `BRIEF2.md`; rules R1–R7 of `CRITIQUE.md`.

## 1. Decisions

1. **A count item is an ingredient.** The stock count (`/panel/sayim`) lists active ingredients that have a count
   unit (`ingredients.count_unit`), grouped by `count_group`. "Listeye ekle" creates such an ingredient right away
   (no approval): it appears in this and every later month. Its price is unknown: package price 0 and "Tahmini";
   the admin enters the price in Hammaddeler. A 0-price ingredient changes nothing but its own stock value (0 ₺)
   until then. "Listede olmayanlar" (per-month free lines, `stock_extras`) stays as it is, for one-off items.
2. **Staff add products by proposal.** A product with price 0 would pollute profitability, alerts and analyses, so a
   staff-added product goes through the existing "personel önerir, yönetici onaylar" flow: staff propose the new
   product with its recipe from Reçete defteri; the admin opens it in Reçete onayları, sees the cost, types the sales
   price and approves; only then is the product created (active, with the recipe). Same bell, same pages, same
   "Önerilerim" list. The admin keeps using Ürünler › Yeni ürün directly.
3. **The seven items** are added to every database that already has data by one guarded data migration (custom SQL),
   following the Excel convention for items not seen on invoices: supplier `(faturada yok)`, `is_estimate = true`, a
   price estimated from the same family (DVG syrup 750 ml ≈ 760 ₺, DVG sauce 2 L ≈ 1.352 ₺, DVG purée 1 L ≈ 1.080 ₺).
   A fresh empty database gets nothing (the Excel seed must still run there); a name that already exists
   (case-insensitive) is skipped. The first Paraşüt price replaces the estimate (pricing's ±40 % hold applies).

## 2. Stok sayımı › Listeye ekle (admin and staff)

- Button `Listeye ekle` (icon `Plus`) next to the count's existing actions; on the phone it must not crowd the sticky
  bar (put it at the end of the list, above "Listede olmayanlar", or in the header — whichever the form's layout
  allows without horizontal scroll at 390 px). Shown for every month the user may edit (staff: this and last month).
- Dialog (bottom sheet on the phone), title `Sayım listesine ekle`, description:
  `Kalem bu aydan itibaren her ay listede çıkar. Fiyatını yönetici Hammaddeler'den girer.`
  (admin: `Kalem bu aydan itibaren her ay listede çıkar. Fiyatını Hammaddeler'den girin.`).
  Fields:
  - `Ad` (placeholder `ör. Çilek şurubu`), required, 2–120 characters.
  - `Grup`: select of the existing count groups in list order (default: the group the user is looking at, if any).
  - `Sayım birimi`: `KG`, `LT`, `ADET`, `DİLİM` (`COUNT_UNITS`), hint `Şişe ya da kutu tane tane sayılıyorsa ADET;
    açık şişe litreyle sayılıyorsa LT.`
  - `Paket` (optional, placeholder `ör. 750 ml şişe`) and `Paket içeriği` (number in the base unit gr / ml / adet /
    dilim; default 1000 for KG/LT, 1 for ADET/DİLİM; label shows the unit, e.g. `Paket içeriği (ml)`).
  - No price field for anyone (the admin sets it in Hammaddeler, where VAT and package rules already live).
- Server action `addCountItem` in `src/app/panel/sayim/actions.ts` (`requireUser`; staff may add only while they may
  edit the month shown, same rule as `saveStaffStockExtras`):
  - zod; the group must be one of the DB's existing `count_group` values; unit mapping `KG→gr`, `LT→ml`, `ADET→adet`,
    `DİLİM→dilim` (must satisfy `countUnitsFor`).
  - Duplicate rule (pure, Turkish-aware: `toLocaleLowerCase("tr-TR")`, trimmed, inner spaces collapsed):
    - same name, active, counted → `“Çilek şurubu” zaten sayım listesinde.`
    - same name, active, not counted (no count unit) → staff: `“…” hammaddelerde var ama sayılmıyor; yöneticiye
      yazın.`; admin: `“…” hammaddelerde var ama sayılmıyor; Hammaddeler'den sayım birimini seçin.`
    - same name, passive → `“…” pasif; yönetici Hammaddeler'den yeniden açabilir.`
  - Insert: `category` = the most common category among ingredients of that group (fallback `Diğer`), `vat_rate` = the
    group's most common rate (fallback the column default), `package_price` 0, `is_estimate` true,
    `price_source` manual, `supplier` null, `count_unit`, `count_group`, `active` true, `sort_order` so that it lands
    at the end of its group in the count list (check how the list orders rows).
  - **Price history:** do not write an `ingredient_prices` row for the 0 price. The admin's first real price must not
    look like a price rise ("zam") anywhere: price alerts, dashboard, bell, sabah e-postası (check
    `src/server/data/price-alerts.ts` and every reader of `ingredient_prices`; add a test).
  - `logActivity(me, "Sayım listesine eklendi", "Çilek şurubu · SOS / ŞURUP / PÜRE · LT")`, `refresh()`.
  - Toast `Listeye eklendi: Çilek şurubu`; admin toast has an action `Fiyatını gir` → Hammaddeler (the row).
- Admin bell (group `uyari`, count-style query joined to the admin `Promise.all` with `.catch(() => [])`, R5):
  active ingredients with `package_price = 0` and `price_source = 'manual'`:
  title `Fiyatı girilmemiş 2 hammadde`, body `Çilek şurubu, Böğürtlen püre · Hammaddeler'den paket fiyatını girin.`,
  href to Hammaddeler (use or add a filter that shows exactly these rows). Staff bell: nothing.
- Hammaddeler: such rows already show "Tahmini"; if there is no visible cue for price 0, add a small `Fiyat yok`
  badge (admin only page).

## 3. The seven items (migration `sayim_yeni_kalemler`, custom SQL)

`npm run db:generate -- --custom --name sayim_yeni_kalemler`, then write the SQL (one statement per breakpoint):

| name | category | unit | count | count_group | package_desc | size | price (estimate) |
|---|---|---|---|---|---|---|---|
| Çilek şurubu | Sos & Şurup | ml | LT | SOS / ŞURUP / PÜRE | Şurup 750 ml | 750 | 760 |
| Cookie şurubu | Sos & Şurup | ml | LT | SOS / ŞURUP / PÜRE | Şurup 750 ml | 750 | 760 |
| Lemon tea şurubu | Sos & Şurup | ml | LT | SOS / ŞURUP / PÜRE | Şurup 750 ml | 750 | 760 |
| Hazelnut şurubu | Sos & Şurup | ml | LT | SOS / ŞURUP / PÜRE | Şurup 750 ml | 750 | 760 |
| Vanilya sos | Sos & Şurup | ml | LT | SOS / ŞURUP / PÜRE | Sos 2 L | 2000 | 1352 |
| Yaban mersini püre | Püre | ml | LT | SOS / ŞURUP / PÜRE | Püre 1 L | 1000 | 1080 |
| Böğürtlen püre | Püre | ml | LT | SOS / ŞURUP / PÜRE | Püre 1 L | 1000 | 1080 |

All: supplier `(faturada yok)`, `vat_rate` 0.01, `is_estimate` true, `price_source` manual, `active` true,
`sort_order` after the current maximum, one `ingredient_prices` row each (`changed_by` `Sistem`, note
`Sayım listesine eklendi (tahmini fiyat)`) so the estimate has a history start like the Excel rows.
Guards: insert only `WHERE EXISTS (SELECT 1 FROM ingredients)` (a fresh database stays empty, so `db:seed` still
loads Excel) and `AND NOT EXISTS (… lower(name) = lower(v.name))`. Postgres `lower()` on a `C` collation folds only
ASCII; that is enough here (the existing names that could clash start with ASCII letters; test it). Add one
`activity_log` row (`Sistem`, `Sayım listesine eklendi`, the names) only when rows were inserted (a CTE). Restore
(ops-backup) replays migrations newer than the backup after loading rows, so the guard is also right there.
`db:reset` removes them (Excel only) — say so in the README `db:reset` line.

## 4. Staff propose a new product (Reçete defteri → Reçete onayları)

**Data model** (`recipe_change_requests`, generated migration `recete_yeni_urun`):
- `product_id` becomes nullable (a new-product request has no product until approved; on approval it is set to the
  created product, so "Önerilerim" and the bell link to it).
- `kind` text enum `["change", "new"]` not null default `'change'`.
- `proposed` jsonb nullable, `{ name: string; size: "M" | "L" | "Tek"; categoryId: number }` (kind `new` only).
- `before` stays NOT NULL: an empty snapshot for kind `new`.
- The pending unique index on `(product_id, requested_by)` does not cover nulls; the duplicate rule below is enforced
  in the action inside the transaction (take a transaction-level advisory lock so two staff cannot propose the same
  name + size at once).

**Staff UI** (`/panel/receteler`): button `Yeni ürün öner` (staff). For the admin the same place shows `Yeni ürün`
linking to Ürünler (where the admin creates products directly; if Ürünler can open its dialog from a query string,
use it, otherwise just link).
- Sheet: `Ürün adı`, `Kategori` (product categories), `Boy` (`M`, `L`, `Tek boy`; one or more), a recipe per chosen
  size with the same line editor as "Değişiklik öner" (`change-editor.tsx`; reuse, do not copy), `Not` (to the
  admin, optional). A `Diğer boydan kopyala` shortcut when two sizes are chosen is welcome if cheap.
- Validation (pure function + server): name 2–120; at least one size; each size at least one recipe line;
  `“Çilekli Latte · M” zaten var` if the product exists (Turkish-aware name compare + same size);
  `“Çilekli Latte · M” için bekleyen bir öneri var` if any pending `new` request has the same name + size.
- Action `proposeNewProduct` in `src/server/actions/recipe-requests.ts` (`requireUser`): one request row per size
  (kind `new`, `proposed`, `before` empty, `after` with the lines; quantities from formulas recomputed on the server
  as in `proposeRecipeChanges`), `logActivity(me, "Yeni ürün önerisi", "Çilekli Latte · M, L")`, `refresh()`.
  Toast `Öneriniz yöneticiye gitti`.
- "Önerilerim" (`my-requests.tsx`): new-product rows read `Yeni ürün: Çilekli Latte · M`, with status and withdraw.

**Admin review** (`/panel/onaylar`, `review-list.tsx`): a `Yeni ürün` badge; name · size · category; the recipe
with cost per line and the total (as in change reviews); a required `Satış fiyatı` field with the live margin
(`Kâr marjı %62`); name and category editable before approval (size fixed); `Onayla ve ürünü ekle` /
`Reddet` (reason, as today).
- Approve (`reviewRecipeChange` branch or a new `approveNewProduct`; `requireAdmin`), one transaction: lock the
  request row, re-check status and the duplicate rule, create the product with the same rules as `createProduct`
  (fire rate from `categoryFireDefault`, `sort_order` max + 1, `active` true, `show_on_menu` default), insert the
  recipe items, set `product_id`, `status = approved`, reviewer fields. **Extract the shared create logic** from
  `createProduct` into one server-only helper both paths call (no duplicated insert code).
  `logActivity(admin, "Yeni ürün (öneriden)", "Çilekli Latte M · 165 ₺ · Ayşe'nin önerisi")`, `refresh()`.
- Reject: as today (reason required), product never created.
- Bell: admin `onay` group must count and title these (`Yeni ürün önerisi: Çilekli Latte · M (Ayşe)`); staff bell
  shows the result like a change result (`Çilekli Latte · M eklendi` / `… önerisi reddedildi: <neden>`). Check every
  place that assumes `product_id` is not null (bell, my-requests, review list, recipe book, push texts, activity,
  backup TABLE_RULES are automatic) and handle `null`.
- Site menu: a product created here is not linked to laffogato.net (as with Yeni ürün); linking stays in
  Ürünler › Site menüsü.

## 5. Files

Add: `src/lib/count-item.ts` (pure: name key, duplicate rule, unit mapping, group defaults), tests
`tests/sayim-ekle.test.ts`, `tests/yeni-urun-onerisi.test.ts`, `drizzle/00NN_recete_yeni_urun.sql`,
`drizzle/00NN_sayim_yeni_kalemler.sql` (+ snapshots, journal; regenerated at merge per R2, the custom one by
re-running `--custom` and pasting the same SQL).
Change: `src/server/db/schema.ts`, `src/app/panel/sayim/{actions.ts,stock-form.tsx,page.tsx}`,
`src/server/actions/recipe-requests.ts`, `src/server/actions/products.ts` (extract helper),
`src/app/panel/receteler/*`, `src/app/panel/onaylar/*`, `src/server/actions/notifications.ts` (R5, additive),
`src/lib/recipe-change.ts` if the snapshot helpers need the `new` kind, README (screens table rows for Stok sayımı,
Reçete defteri, Reçete onayları; `db:reset` line), Yardım (`Sayım listesine nasıl kalem eklenir?`,
`Personel yeni ürünü nasıl ekler?`).

## 6. Tests

- Pure: name key (`"  Çilek  Şurubu "` = `"çilek şurubu"`, `I`/`ı` and `İ`/`i`), duplicate outcomes, unit mapping,
  group defaults, new-product validation.
- Migration (against a scratch DB): fresh empty DB → 0 of the seven; seeded DB → 7 inserted with a price history row
  each; a DB that already has `Çilek Şurubu` → 6.
- No fake "zam": an ingredient created at 0, then priced, yields no price-rise alert.
- Source/role tests: staff can call `addCountItem` and `proposeNewProduct`, never `createProduct`; the staff count
  page and the dialog render no price.
- Browser at 1440 and 390 px: staff adds a count item and proposes a product; admin sees the bell items, prices the
  ingredient, approves the product; staff sees the result.

## 7. Integration notes

- **menu** (later wave) must record price history in the new approval path too (its `recordPriceChange`).
- **today** (later wave) may show `Fiyatı girilmemiş N hammadde` as an admin `todo` row from the same count query.
- **pricing**: the seven estimates follow the "first Paraşüt price of an estimated ingredient" hold rule.
- ops-backup: new columns and rows are covered automatically (R6).
