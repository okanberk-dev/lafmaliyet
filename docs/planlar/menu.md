# Plan — Suggestion 11: bulk menu price change, ModPOS checklist, price history

Repository: `/home/user/lafmaliyet`, branch `claude/oneriler` (= main @ 981692e). Next.js 16 (cacheComponents), Drizzle/Postgres.
Read before coding: `AGENTS.md`, `docs/SITE-MENU.md`, `docs/TASARIM.md`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md` (server actions inherit the **page's** `maxDuration`).

## 1. Goal

Today a menu price changes one at a time (list cell, recipe card, price-rise suggestion). Nothing records *when* a sale price changed or *who* changed it,
and the only reminder about the POS is a toast: "kasadaki (ModPOS) fiyatı da elle değiştir", which is easy to forget. This feature adds three things on one new
admin screen, **Ürünler › Fiyatlar** (`/panel/urunler/fiyatlar`). (1) **Toplu değiştir:** pick products (category, size, search, tick or untick),
choose a rule (percent, lira, or "raise to the suggested price") and a rounding. A live preview shows each row's new price, cost ratio, unit profit, status change and the
monthly effect. Applying the change writes every price. Products linked to laffogato.net go to the site first, through the existing per-item write path. The
result then reports what changed and what did not. (2) **Kasaya işle:** a persistent checklist of every product whose panel price differs from the price
ModPOS is believed to have. It includes changes made on the site, single edits and bulk edits. The owner ticks each item after changing it on the POS by hand.
(3) **Geçmiş:** an append-only price history for each product and for the whole menu. A bulk batch can be undone from there. The design reuses the existing site push
(`pushSaleChange`/`applyPushed`), the engine's formulas and the UI kit, and needs no new dependency.

## 2. What exists today (verified)

- Sale-price writes, all of which must record history:
  1. `updateProductPrice` (`src/server/actions/products.ts`): list `PriceCell`, `PriceImpactPanel` "Fiyatı X yap" (ack=true) and its toast "Geri al".
  2. `saveRecipe` (same file): recipe card, "Bu fiyatı uygula".
  3. `createProduct` (same file): initial price.
  4. `applyPlan` (`src/server/site-menu/sync.ts`): site → panel pulls (ping, page open, cron, "Siteyle eşitle"), the binding in `link.ts` (a newly linked product takes the site's price), and the siblings updated by `applyPushed`.
  5. `scripts/seed.ts` (seed/reset): no history is needed. `TRUNCATE products … CASCADE` also empties the new FK table.
- No product price history table exists (only `ingredient_prices`). `activity_log` has free-text "Satış fiyatı" entries.
- Site write contract: one item per `POST /api/panel/menu` with a body of `{"id","priceMinor"|"priceMinorL","isActive","actor"}` and an 8 s timeout. **There is no batch endpoint.** Each site write makes
  the site ping the panel, and the panel pulls the whole menu. The `lastSiteNow` guard keeps an older list from overwriting a newer write.
- `pos_mappings(pos_name PK, product_id)`: the normalized ModPOS name for each product (110 of 129 products are mapped locally, none has more than one name, `is_service` rows have no product).
- All 129 local prices are multiples of 5 ₺. `ceilTo(x, 5)` is the existing suggested-price rounding.
- `priceProduct` (`src/lib/calc/engine.ts`): net = price/(1+kdv), commission = price·komisyon·kartOrani, unitProfit = net − cost − commission, margin,
  costRatio = cost/net, `statusFor(cost, costRatio, hedefMaliyet)`; a price of 0 with a cost greater than 0 gives "Düşük kâr".

## 3. User-facing behaviour

### 3.1 Entry points

- **Ürünler page header** (`src/app/panel/urunler/page.tsx`): a new `ButtonLink` "Fiyatlar" (lucide `Tags`) between "Site menüsü" and "Yeni ürün". When
  `countPosPending() > 0` it shows a small amber pill `Kasa 12` with `title="Kasada (ModPOS) değişecek 12 fiyat"`, linking to `/panel/urunler/fiyatlar?sekme=kasa`.
  Without pending items it links to `/panel/urunler/fiyatlar`.
- **Ürün listesi card actions** (`products-table.tsx`): a new secondary button "Toplu fiyat" next to "CSV",
  `title="Görünen ürünlerin fiyatını birlikte değiştir"`. Its href carries the list's current filters: `/panel/urunler/fiyatlar?kategori=<id>&boy=<M|L|Tek>&ara=<q>&pasif=1`
  (the empty ones are omitted). On the phone the same button goes into the FilterSheet "Görünüm" section ("Görünenlere toplu fiyat"). **Because FilterSheet is a Dialog,
  the button must call `setSheet(false)` first and then `router.push(href)`.** A dialog must never be open during router navigation.
- **Toasts after a single price change** (`PriceCell`, `PriceImpactPanel`): when the write leaves a ModPOS item pending (`posPending: true` in the result), the description is:
  - linked to the site: `PRICE_PUSH_REMINDER` = "Fiyat sitede de değişti. Fiyat listesinin tarihini sitede (Ayarlar → Vergi) güncellemeyi unutma; kasadaki (ModPOS) fiyat Fiyatlar › Kasaya işle listesinde." (the existing text is updated)
  - not linked: `POS_PRICE_REMINDER` = "Kasadaki (ModPOS) fiyatı da değiştir; Fiyatlar › Kasaya işle listesine eklendi."
  - `posPending: false` (the price went back to what ModPOS already has): no POS hint.
- **⌘K:** a hidden sub-item in `NAV_GROUPS` › Menü (like "Site menüsü"): `{ href: "/panel/urunler/fiyatlar", label: "Fiyatlar", icon: Tags, roles: ["admin"], keywords: "toplu fiyat zam indirim yüzde yuvarla modpos kasa fiyat geçmişi geri al" }`.
  `SHORT_TITLES["/panel/urunler/fiyatlar"] = "Fiyatlar"`. `NAV_TREE` and `BOTTOM_NAV` do not change.
- **Bell** (admin only, see §5.6): "Kasada değişecek 12 fiyat".

### 3.2 `/panel/urunler/fiyatlar` page shell

- `PageHeader eyebrow="Menü" title="Fiyatlar"`, description: "Menü fiyatlarını toplu değiştirin, kasada (ModPOS) elle değiştirdiklerinizi işaretleyin; her fiyat değişikliği geçmişte kalır."
  Action: `ButtonLink` "← Ürünler" to `/panel/urunler`.
- `tabs`: `SegmentedLinks label="Fiyatlar"` with options `Toplu değiştir` (`?sekme` empty), `Kasaya işle` (`?sekme=kasa`, `count` = pending), `Geçmiş` (`?sekme=gecmis`). The other query
  params are kept only on the bulk tab.
- `export const maxDuration = 60;` because bulk apply and undo push to the site.
- Suspense with a `PageSkeleton` fallback that renders the header (the same pattern as `urunler/site/page.tsx`). `requireAdmin()`.
- Each tab loads only its own data: bulk → `loadModel()` and `loadSiteLinks()`; kasa → `loadPosChecklist()`; geçmiş → `loadPriceHistory({ limit: 500 })`.
  The pending count for the tab badge comes from `countPosPending()` on every tab.

### 3.3 Tab "Toplu değiştir" (client `bulk-editor.tsx`)

Layout: desktop `grid lg:grid-cols-[360px_minmax(0,1fr)] gap-4`. The left column holds the controls (`lg:sticky lg:top-6`) and the right column the preview. On the phone everything stacks.

**Card "Ürünler"** (`CardHeader icon={<ListChecks/>} title="Ürünler" meta="34 seçili"`):
- `SearchField` "Ürün ara". On desktop: category `FilterChip`s (multi-select, with counts, plus a "Tümü" chip), size chips "Tüm boylar · Medium · Large · Tek", and the `FilterChip` "Pasifleri de dahil et".
  On the phone: `FilterSheetButton` and `FilterSummaryLine`, with the same choices inside `FilterSheet` (reuse `urunler/filter-sheet.tsx`: categories as a two-column chip grid,
  sizes, a `SheetToggle` "Pasif ürünleri de dahil et").
- The filters live in the URL with the same names as the list (`useQueryState`): `kategori` (comma-separated ids; the list sends one), `boy`, `ara`, `pasif`. So the entry from the list
  arrives pre-filtered.
- Default scope: active products only (owner decision D5).

**Card "Değişiklik"** (`icon={<Percent/>}`):
- `Segmented stretch label="Kural"`: `Yüzde` | `Tutar (₺)` | `Önerilen fiyat`.
- Yüzde / Tutar: one `NumberInput inputMode="text"` (a minus sign must be typeable on iOS) with a `%` or `₺` suffix, placeholder "10" or "5", `aria-label="Değişiklik"`.
  Accepted input: "10", "%10", "+10", "-5", "7,5". Quick chips in a `grid grid-cols-3` (44px touch targets): `+%5 +%10 +%15` or `+5 ₺ +10 ₺ +20 ₺`.
  Errors under the field: "Sayı yazın (ör. 10 ya da -5)", "İndirim %100'den büyük olamaz".
- Yuvarlama `Select` (h-11 on touch): `5 ₺'ye yukarı` (default for an increase), `5 ₺'ye en yakın`, `5 ₺'ye aşağı` (default for a decrease), `10 ₺'ye yukarı`,
  `Tam liraya (en yakın)`, `Yuvarlama yok`. When the amount is negative and the user has not touched the select, the default switches to "5 ₺'ye aşağı".
- "Önerilen fiyat": no input and no rounding. Help text: "Fiyatı önerilen fiyatın altında kalan ürünleri önerilen fiyata çeker (hedef maliyet oranı %30, 5 ₺'ye yukarı). Hiçbir fiyat düşmez."

**Preview** (right column; `Card icon={<Eye/>} title="Önizleme"`):
- Summary: `Stat`s in a `grid grid-cols-2 xl:grid-cols-4`:
  "Değişecek" `34 ürün` (sub "12'si sitede de"), "Ortalama değişim" `+%9,8`, "Maliyet oranı (ort.)" `%33 → %30` (simple average, rows with a recipe only, same rule as `menuAverages`),
  "Aylık brüt kâr" `+4.250 ₺` (sub "Eylül adetleriyle; satış adedi aynı kalırsa"). The month is `latestSalesMonth(model)`; with no sales data the sub reads "Satış verisi yok" and the value "–".
- Rows, sorted by category order and then menu order:
  - **Desktop table** (`Table` with a sticky first column): ☐ | Ürün (name, `boy · kategori` underneath, site globe icon) | Şimdi | Yeni (editable, see below) | Fark (`+20 ₺` with `+%10,3` under it) |
    Maliyet oranı (`%34 → %31`, coloured like `ratioClass`) | Birim kâr (`92,10 → 108,40`) | Durum (`StatusBadge`, "Dikkat → İyi" badge if it changes) | Aylık etki (Δ unit profit × sold qty, `Signed`).
  - **Phone cards** (`ul.divide-y`): a 44px checkbox label on the left; name and size; on the right `195 ₺ → 215 ₺` (new price semibold); a second line `+20 ₺ · maliyet oranı %34 → %31 · birim kâr 92 → 108`;
    badges for a status change, "Sitede de değişir" (blue) and a block reason.
  - **Override:** tapping or clicking the new price turns it into a `NumberInput` (w-24, Enter/blur commits, Esc cancels; the `PriceCell` pattern). An overridden row shows the `Badge tone="gray"`
    "elle" and a link "kurala dön". An override wins over the rule and is still validated.
  - Ticking a row off excludes it. "Tümünü seç / Hiçbirini" sits in the card header.
  - Rows whose new price equals the current price after rounding are not listed. A collapsible line under the list reads "Değişmeyen 5 ürün (yuvarlama aynı fiyata getiriyor)".
  - **Blocked rows** (shown, unticked, checkbox disabled, red or amber text) come from `blockReason`, §5.1.
- Empty states:
  - The filter matches nothing: `EmptyState title="Bu seçimle ürün yok" description="Aramayı kısaltın ya da kategori süzgecini kaldırın."` with the action "Süzgeci temizle".
  - No amount yet: an info line "Bir değişiklik yazın: ör. %10 ya da 5 ₺. Önizleme burada görünür."
  - Everything is unchanged: "Bu kuralla hiçbir fiyat değişmiyor (yuvarlama aynı fiyata getiriyor). Yuvarlamayı değiştirin."
- **`FloatingBar`** (open when at least one row is applicable): the left text is "34 fiyat değişecek · 12'si sitede de". The primary button reads "Fiyatları değiştir" and is disabled while pending.
- **Confirm** (`ConfirmDialog tone="primary" confirmLabel="Değiştir"`), title "34 ürünün fiyatı değişsin mi?". Description: "+%10 · 5 ₺'ye yukarı. 12 ürün laffogato.net menüsünde de
  değişir (siteye tek tek yazılır, birkaç saniye sürebilir). Kasadaki (ModPOS) fiyatları elle değiştirmeniz gerekecek; liste Kasaya işle sekmesinde." If any rows go down, add:
  "3 ürünün fiyatı düşüyor." The dialog closes **before** the result is shown, and nothing navigates while it is open.
- While applying, the `FloatingBar` button reads "Değiştiriliyor…" with the sub "Siteye yazılıyor…" when linked rows are included.
- **Result** (it replaces the preview card and is kept in client state; `refresh()` updates the rows underneath, and after the result the amount input is cleared):
  - A success `Card` (`CheckCircle2`): "32 fiyat değişti (10'u sitede de)." When `siteChanged > 0`: "Fiyat listesinin tarihini sitede (Ayarlar → Vergi) güncellemeyi unutma."
  - Failures (red `Well`): "2 ürün değişmedi:" then `Latte · L — Siteye ulaşılamadı; denenmedi.` and so on. Button "Tekrar dene (2)": it calls `applyBulkPrices` again with the failed items, the same note and the same
    `batchId`, and their current `from` values from refreshed props.
  - Buttons: `ButtonLink` "Kasaya işle (32) →" to `?sekme=kasa`; "Değişikliği geri al" (ConfirmDialog → `undoPriceBatch(batchId)`); "Yeni toplu değişiklik" (resets the rule and result state).
  - A toast as well: `toast.success("32 fiyat değişti", { description: "Kasadaki (ModPOS) fiyatlar Kasaya işle listesinde." })`.
- One rule per batch. Mixed rules (+10 % for coffee, +5 ₺ for desserts) are done as two batches.

### 3.4 Tab "Kasaya işle" (client `pos-checklist.tsx`)

- Intro line: "Panelde ya da sitede değişen fiyatlar ModPOS'a kendiliğinden geçmez. Kasada değiştirdikçe işaretleyin; işaretlenen listeden düşer."
- Toolbar: "Metni kopyala" (`Copy` icon, uses `navigator.clipboard`; toast "Liste kopyalandı; WhatsApp'a yapıştırabilirsiniz") and "Hepsini işaretle" (ConfirmDialog "12 fiyatın hepsi
  kasada değişti mi?", `confirmLabel="İşaretle"`, `tone="primary"`).
- The list is grouped by category (`SectionTitle` with the category name and its count). Each row is a full-width `<label>` of at least 44px with a checkbox (size-5) and:
  - Line 1: "Latte · Medium". Right side: `195 ₺ → 205 ₺` (old struck through and muted, new semibold).
  - Line 2 (mono, 12px): "Kasada: LATTE MEDİUM" (all mapped POS names joined with " · "), or "Kasada adı bilinmiyor (satış raporunda eşleşmemiş)", then "· 2 gün önce · Toplu" (the source of the
    latest change since `pos_stale_since`).
- Ticking a row is optimistic: call `markPosDone([id])` and remove the row. The toast "Latte M kasada 205 ₺ olarak işaretlendi" has a "Geri al" action that calls `restorePosPending([...])`.
  On error, roll back and show `toast.error`.
- Empty: `EmptyState icon={<CheckCheck/>} title="Kasa güncel" description="Panelde ya da sitede değişen bütün fiyatlar kasada da değiştirildi. Yeni bir fiyat değişince burada listelenir."`

### 3.5 Tab "Geçmiş" (client `price-history.tsx`)

- `SearchField` "Ürün ara" (`?ara`), client-side over the loaded rows. Paginated 50 per page (`usePaged`).
- Rows are grouped by day ("Bugün", "Dün", `22 Eki 2026`, Europe/Istanbul).
  - Single change: "**Latte · Medium** 195 ₺ → 205 ₺ (`+%5,1`)", sub "14:05 · Selin · Elle · sitede de". It links to the product card.
  - Batch (rows sharing `batch_id`, collapsed): "**Toplu:** +%10 · 5 ₺'ye yukarı · 34 ürün", sub "14:05 · Selin · 12'si sitede de". A chevron expands the rows. A "Geri al" button appears
    when `undoPlan` has more than 0 revertible rows and the source is not `undo`. Its ConfirmDialog says: "34 ürünün fiyatı eski haline döner (12'si sitede de). Sonradan değişmiş 2 ürüne dokunulmaz."
  - Source labels: `manual` "Elle", `suggestion` "Zam önerisi", `bulk` "Toplu", `undo` "Geri alındı", `site` "laffogato.net", `create` "Yeni ürün".
- Empty: `EmptyState title="Henüz fiyat değişikliği yok" description="Bundan sonra panelde, toplu ya da laffogato.net'te değişen her satış fiyatı burada görünür."`

### 3.6 Product card (`/panel/urunler/[id]`)

- A new `PriceHistoryCard` in the editor's left column, directly after the `SiteMenuCard` block (on the phone it comes after "Ürün bilgileri" and "Site menüsü").
  `CardHeader icon={<History/>} title="Fiyat geçmişi" actions={<Link href="/panel/urunler/fiyatlar?sekme=gecmis&ara=<name>">Tümü →</Link>}`.
- When the product is pending on the POS, a warn `Well` at the top: "Kasada (ModPOS) hâlâ **195 ₺** · 2 gündür" with the button "Kasada değiştirdim" (`markPosDone([id])`; toast with Geri al).
- List of the last 20 changes, newest first: `22 Eki 14:05 · 195 ₺ → 205 ₺ · [Toplu] · Selin · sitede de`.
- Empty: "Fiyat değişikliği kaydı yok. Bundan sonraki değişiklikler burada görünür."
- Data comes in through a new `priceHistory` prop from `[id]/page.tsx` (`loadProductPriceHistory(id)`). The editor's `key={product.id}` stays as it is. The card renders straight from props, so it updates after `refresh()`.

## 4. Data model (`src/server/db/schema.ts`; migration generated with `npm run db:generate -- --name fiyat_gecmisi`, never hand-written)

### 4.1 `products`: two new nullable columns (no data migration; null means "the POS matches the panel")

```ts
/**
 * Kasada (ModPOS) hâlâ duran eski fiyat: panelde ya da sitede fiyat değişince kasa elle güncellenene kadar dolu kalır
 * ("Fiyatlar › Kasaya işle"). Boşsa kasa panelle aynı sayılır. Fiyat kasadaki fiyata geri dönerse kendiliğinden boşalır.
 */
posStalePrice: doublePrecision("pos_stale_price"),
/** Kasanın panelden geri kaldığı an (işlenmemiş ilk değişiklik) */
posStaleSince: timestamp("pos_stale_since", { withTimezone: true }),
```

Why columns and not a checklist table: the state is one value per product, it corrects itself (a price that goes back to the POS price clears it), and it is shared by every
write path. The checklist is `where pos_stale_price is not null`. `dataset.ts` maps product fields explicitly, so the calc model does not see these columns.

### 4.2 New table `product_prices` (append-only history)

```ts
/** Satış fiyatı geçmişi: her fiyat değişikliğinde bir satır (panel, toplu, site, yeni ürün). Ayrıntı: docs/FIYATLAR.md */
export const productPrices = pgTable(
  "product_prices",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    /** Önceki fiyat (TL, KDV dahil); yeni üründe boş */
    priceBefore: doublePrecision("price_before"),
    price: doublePrecision("price").notNull(),
    source: text("source", { enum: ["manual", "suggestion", "bulk", "undo", "site", "create"] }).notNull(),
    /** Panelin değişikliği laffogato.net'e de yazıldı */
    onSite: boolean("on_site").notNull().default(false),
    /** Aynı toplu değişikliğin (ve geri almasının) satırları; uuid */
    batchId: text("batch_id"),
    /** Toplu kuralın özeti ("+%10 · 5 ₺'ye yukarı · Espresso Bazlı") */
    note: text("note"),
    changedBy: text("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("product_prices_product_idx").on(t.productId, t.changedAt),
    index("product_prices_changed_idx").on(t.changedAt),
    index("product_prices_batch_idx").on(t.batchId),
  ],
);
```

- No separate batch table: the batch rule text is carried on each row as `note`, and the batch header is derived from its rows.
- Existing products start with no history and `pos_stale_price = null` (everything is assumed to match ModPOS on deploy; owner decision D6).
- `db:reset`: `TRUNCATE products … CASCADE` already empties `product_prices`. Update the README line only.
- Migration number: `0020_fiyat_gecmisi` on today's main. **If another group merges a migration first, regenerate on top of theirs** (delete our generated SQL and snapshot, then run `db:generate` again).

## 5. Server logic

### 5.1 Pure logic (`src/lib/prices/`, no server imports, tested)

`src/lib/prices/bulk.ts`
- `type Rounding = { step: 0 | 1 | 5 | 10; mode: "up" | "nearest" | "down" }`, `ROUNDINGS: { id, label, rounding }[]` (the six options in §3.3) and
  `defaultRounding(amount: number): RoundingId`.
- `type BulkRule = { kind: "percent" | "amount"; value: number; rounding: Rounding } | { kind: "suggested" }`.
- `parseRuleAmount(text: string, kind): { value: number | null; error: string | null }`, built on `parseNumberTR`. It strips a leading "%" or "+" and a trailing "%" or "₺". Percent below −100 → error.
- `roundMinor(minor: number, r: Rounding): number`, **integer kuruş arithmetic**: `stepMinor = step*100`, up = `Math.ceil(minor/stepMinor)*stepMinor` and so on; step 0 returns `minor`.
- `rulePrice(price: number, suggested: number, rule): number`. Percent: `raw = Math.round(toMinor(price) * (1 + value/100))` (round to kuruş **before** rounding to the step;
  this is the float guard that keeps `200 × 1.05 = 210.00000000000003` from ceiling to 215). Amount: `raw = toMinor(price) + toMinor(value)`. Then `roundMinor`, then `/100`.
  Suggested: `Math.max(price, suggested)`. Reuse `toMinor`/`fromMinor` from `src/lib/site-menu/slot.ts`.
- `economicsAt(price, cost, st: Pick<Settings,"kdv"|"komisyon"|"kartOrani"|"hedefMaliyet">)` returns `{ net, commission, unitProfit, margin, costRatio, status }`, with exactly the
  formulas of `priceProduct` (`safeDiv`, the 0-price → "Düşük kâr" rule, `statusFor`). A test asserts equality with `priceProduct` for all seed products.
- `blockReason(row: { price, newPrice, site: SiteMarkerKind | null }, ctx: { siteConfigured: boolean }): string | null`:
  - `newPrice <= 0` → "Fiyat 0 ₺'ye ya da altına iner"
  - `toMinor(newPrice) > SITE_MONEY_MAX_MINOR` and linked → "Sitenin üst sınırını aşıyor"
  - `site === "broken"` → "Site bağlantısı kopuk (sitede L fiyatı yok); önce bağlantıyı düzeltin"
  - `site === "missing"` → "Bağlı kalem sitede yok; bağlantı sonraki eşitlemede kalkar"
  - linked (`linked|pending`) and `!siteConfigured` → "Site bağlantısı kurulmamış; siteye bağlı ürünün fiyatı değiştirilemez"
  - `newPrice < cost` is **not** a block. It shows the warning badge "Zararına" (red).
- `previewRows(rows, rule, overrides: Map<id, number>, excluded: Set<id>, st, ctx)` returns rows with `{ newPrice, overridden, unchanged, blocked, before: Econ, after: Econ, monthlyDelta }`.
- `bulkSummary(preview)` returns `{ count, linked, decreases, avgPct, ratioBefore, ratioAfter, monthlyDelta, hasSales }`.
- `ruleSummary(rule, scope: { categories: string[]; size: string | null }): string`, for example "+%10 · 5 ₺'ye yukarı · Espresso Bazlı, Buzlu Kahveler", "+5 ₺ · yuvarlama yok", "Önerilen fiyata".
  At most 200 characters, with "… +3 kategori" when longer.
- `isSiteDown(failure: PushFailure): boolean`: `network | timeout | off`, or `http` with status 401 or ≥ 500 (the circuit breaker in §5.4).

`src/lib/prices/pos.ts`
- `posAfterPriceChange(state: { stalePrice: number | null; since: Date | null }, before: number, after: number, now: Date)` → the new state. If `stalePrice` is null, the POS price is
  `before`. If `toMinor(after) === toMinor(posPrice)`, it returns `{ null, null }`. Otherwise it returns `{ stalePrice: posPrice, since: state.since ?? now }`.
- `POS_PRICE_REMINDER` (text in §3.1).
- `posChecklistText(items, date: string)`, plain text for the clipboard:
  ```
  Kasada (ModPOS) değişecek fiyatlar · 22 Ekim 2026
  Espresso Bazlı
  - LATTE MEDİUM: 195 → 205 ₺
  Tatlılar
  - Marlenka (Tek): 270 → 285 ₺
  ```
- `groupByCategory(items)`, in category order and then product order.

`src/lib/prices/history.ts`
- `PRICE_SOURCE_LABEL: Record<Source, string>` (labels in §3.5).
- `groupHistory(rows)` → `({ kind: "single", row } | { kind: "batch", batchId, note, changedBy, changedAt, source, rows, onSite })[]`, newest first, grouped by Istanbul day.
- `undoPlan(batchRows, current: Map<productId, number>)` → `{ revert: { productId, from, to }[], skipped: { productId, label, reason }[] }`. Take the latest row per product in the batch.
  Revert only when `toMinor(current) === toMinor(row.price)`. Otherwise skip with "Sonradan değişti (şimdi 210 ₺)". A missing product is skipped with "Ürün silinmiş".

`src/app/panel/urunler/fiyatlar/logic.ts` (UI-only, pure): `filterBulkRows(rows, { categories, size, q, includeInactive })` using `matches()` from `ui/filters`;
`parseCategoryParam("3,5")`; `bulkHref(filters)`, used by `products-table.tsx` to build the "Toplu fiyat" link.

### 5.2 Recording helper (`src/server/prices/record.ts`, `import "server-only"`)

```ts
export type PriceSource = "manual" | "suggestion" | "bulk" | "undo" | "site" | "create";
export interface PriceChange { productId: number; before: number | null; after: number; source: PriceSource; changedBy: string; onSite?: boolean; batchId?: string | null; note?: string | null }
/** Fiyat yazımıyla aynı işlemde çağrılır: geçmişe satır düşer, kasanın (ModPOS) durumu güncellenir. Kuruşu aynı fiyat yazılmaz. */
export async function recordPriceChange(tx: Tx, c: PriceChange, at: Date, opts: { pos?: boolean } = {}): Promise<{ posPending: boolean }>
```
- If `before !== null` and the kuruş values are equal, return `{ posPending: <current state> }` without writing anything.
- `select pos_stale_price, pos_stale_since from products where id = ? for update`, then `posAfterPriceChange`, then `update products set pos_*`
  (skipped when `opts.pos === false`, which is used for `create`), then insert into `product_prices`.
- The `Tx` type is the same alias as in `sync.ts`.

### 5.3 Wiring the existing write paths (no behaviour change apart from recording)

- **`src/server/prices/write.ts`** (new, server-only): extract the body of `updateProductPrice` into
  `writeSalePrice(user, before: typeof s.products.$inferSelect, price: number, opts: { source; batchId?; note?; consequence: string; expectFrom?: number }): Promise<{ price: number; site: boolean; posPending: boolean }>`:
  1. When `expectFrom` is given and the kuruş values differ: `throw new UserError(\`Fiyat bu sırada değişti (şimdi ${tl(before.price)}); listeyi yenileyip tekrar dene\`)`.
  2. `pushSaleChange(user, before, desired, consequence)` (unchanged).
  3. One transaction: pushed → `applyPushed` and then `update`. Local → `update products set price where id = ?`. Then `recordPriceChange(tx, { before: before.price, after: written.price, onSite: pushed && push.price, … })`.
     The local path is now inside a transaction (today it is a bare `db.update`).
- **`updateProductPrice`** calls `writeSalePrice` with `source: ack ? "suggestion" : "manual"`. The ack and log logic stays. The return type gains `posPending`, which is additive and
  ignored by any caller that does not use it.
- **`saveRecipe`**: inside its existing transaction, after the product update, when the kuruş price changed:
  `recordPriceChange(tx, { before: before.price, after: sale.price, source: "manual", onSite: push.kind === "pushed" && push.price, changedBy: me.name }, now)`.
  Return `posPending` too, so the editor's toast can say it.
- **`createProduct`**: in its transaction, `recordPriceChange(tx, { before: null, after: data.price, source: "create" }, now, { pos: false })` when `price > 0`.
- **`applyPlan`** (`src/server/site-menu/sync.ts`): make each update `.returning({ id: s.products.id })`. For each change with `c.set.price !== undefined` that actually updated a row:
  `recordPriceChange(tx, { productId, before: c.before.price, after: c.set.price, source: "site", changedBy: SITE_ACTOR.name }, now)`.
  This covers pulls, binding (`link.ts` → `applySiteList`) and the siblings in `applyPushed`.
- **`pushSaleChange`** (`src/server/site-menu/push.ts`): throw `SitePushError extends UserError { failure: PushFailure }` (new export) instead of a plain `UserError` when the site
  request fails. Existing callers that catch `UserError` keep working, and the batch reads `failure` for the circuit breaker.

### 5.4 Batch (`src/server/prices/batch.ts`, server-only)

```ts
export interface BatchItem { productId: number; from: number; to: number }
export interface BatchResult {
  batchId: string;
  applied: { productId: number; label: string; from: number; to: number; site: boolean }[];
  failed: { productId: number; label: string; from: number; to: number; reason: string }[];
  siteDown: boolean;
}
export async function applyPriceBatch(user: { name: string }, items: BatchItem[], opts: { source: "bulk" | "undo"; note: string; batchId: string }): Promise<BatchResult>
```
1. Load the current rows: `select * from products where id in (…)`. A missing row fails with "Ürün bulunamadı".
2. Split into **local** rows (`siteMenuId` null) and **linked** rows.
3. **Local first, in one transaction:** for each row, `update products set price = to, updated_at = now where id = ? and round(price*100) = round(from*100) returning id` (an optimistic check in SQL; drizzle `sql` in the
   `where`). When no row is returned, it fails with "Fiyat bu sırada değişti; listeyi yenileyip tekrar dene". When a row is returned, call `recordPriceChange(...source, batchId, note)`.
4. **Linked rows:** group by `siteMenuId`. Inside a group the pushes run **sequentially**, so the M and L rows of one item never race (a sibling update in `applyPushed`
   could otherwise put back an older L price). Run the groups with a concurrency of 4 (a small local `pool()` helper; no dependency). For each row: re-read it, then `writeSalePrice(user, row, to, { expectFrom: from, consequence: "fiyat değişmedi", … })`.
   - `SitePushError` with `isSiteDown(failure)` → set `siteDown = true`. Every row not yet started fails with "Siteye ulaşılamadı; denenmedi. Tekrar dene.".
     The rows already in flight finish.
   - Any other `UserError` (refuse, 404, 400, changed) → a failure with `e.message`, and the batch continues.
   - **Deadline:** start no new push 40 s after the batch began. The remaining rows fail with "Süre doldu; denenmedi. Tekrar dene.". The page `maxDuration` is 60.
5. Return the result. The batch is not atomic (the site is external): applied rows stay applied, and the client offers "Tekrar dene" and "Geri al".

### 5.5 Server actions (`src/server/actions/prices.ts`, `"use server"`)

All of them use `attempt(...)`, `requireAdmin()`, zod validation, `refresh()` after writes and `logActivity`.
- `applyBulkPrices(input: { items: BatchItem[]; note: string; batchId?: string | null })`
  - zod: `items` 1–200 entries, `productId` int > 0 and unique ("Aynı ürün iki kez seçilmiş"), `from` ≥ 0 and `to` > 0 (`zMoney`), `note` trimmed to at most 200 characters,
    `batchId` an optional uuid (sent for "Tekrar dene"). Items where `to === from` in kuruş are dropped.
  - `applyPriceBatch(me, items, { source: "bulk", note, batchId: batchId ?? crypto.randomUUID() })`.
  - Log: `logActivity(me, "Toplu fiyat değişikliği", "<note> · 32 ürün (10'u sitede de); 2 değişmedi")`.
  - Returns `BatchResult`.
- `undoPriceBatch(batchId: string)`: load the batch rows (source `bulk`; reject `undo` batches with "Geri alma geri alınamaz; fiyatı yeniden değiştirin") and the current prices, then build
  `undoPlan`. If there is nothing to revert: "Bu değişiklikteki fiyatların hepsi sonradan değişmiş; geri alınacak bir şey yok". Otherwise
  `applyPriceBatch(me, revert, { source: "undo", note: \`Geri alındı: ${note}\`, batchId: crypto.randomUUID() })`. Log "Toplu fiyat geri alındı".
  Returns `BatchResult & { skipped }`.
- `markPosDone(productIds: number[])`: 1–200 unique ids. `update products set pos_stale_price = null, pos_stale_since = null where id in (…) and pos_stale_price is not null returning id, name, size, price, <old values>`
  (read the old values with a `select … for update` in the same transaction). Log "Kasaya işlendi": "Latte M 205 ₺, Mocha L 230 ₺" (500-character cap). Returns
  `{ done: { productId, label, price, stalePrice, since }[] }` for undo.
- `restorePosPending(items: { productId; stalePrice; since }[])`: restores only rows where `pos_stale_price is null` and the price still differs from `stalePrice`. Log "Kasaya işlendi geri alındı".

### 5.6 Read loaders (`src/server/data/prices.ts`, server-only)

- `countPosPending(): Promise<number>` is used by the Ürünler header, the tab badge and the bell, and is available to the "Bugün" view (group 13).
- `loadPosChecklist()`: products where `pos_stale_price is not null`, joined with categories (for order), the `pos_mappings` names for those ids, and the latest `product_prices` row per product
  since `pos_stale_since` (for the source label).
- `loadPriceHistory({ limit = 500 })`: rows joined with products and categories, newest first.
- `loadProductPriceHistory(productId, limit = 20)` together with the product's pos fields.

### 5.7 Bell (`src/server/actions/notifications.ts`, shared)

In `loadPanelNotifications`, admin only, inside the existing `Promise.all`: when `countPosPending() > 0`, add
`{ id: \`kasa-fiyat-${n}-${newestSince}\`, kind: "info", title: \`Kasada değişecek ${n} fiyat\`, body: "ModPOS'ta elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin", timeLabel: <relative oldest since>, unread: true, href: "/panel/urunler/fiyatlar?sekme=kasa", group: "uyari" }`.
The id changes when new items are added, so the item shows as unread again. `newestSince` comes from a `max(pos_stale_since)` query; extend `countPosPending` to return `{ count, oldest, newest }`
under a different name (`posPendingSummary()`).

## 6. Files

### Add
| File | Purpose |
|------|---------|
| `src/lib/prices/bulk.ts` | Rule, rounding, preview, block reasons, summary, rule text, `isSiteDown` (pure) |
| `src/lib/prices/pos.ts` | ModPOS state transition, clipboard text, grouping, `POS_PRICE_REMINDER` (pure) |
| `src/lib/prices/history.ts` | Source labels, batch grouping, undo plan (pure) |
| `src/server/prices/record.ts` | `recordPriceChange` (history and POS state inside the caller's transaction) |
| `src/server/prices/write.ts` | `writeSalePrice` (single price write; site first) |
| `src/server/prices/batch.ts` | `applyPriceBatch` (local transaction, then linked rows grouped by item with concurrency 4, circuit breaker, deadline) |
| `src/server/data/prices.ts` | `posPendingSummary`, `loadPosChecklist`, `loadPriceHistory`, `loadProductPriceHistory` |
| `src/server/actions/prices.ts` | `applyBulkPrices`, `undoPriceBatch`, `markPosDone`, `restorePosPending` |
| `src/app/panel/urunler/fiyatlar/page.tsx` | Server page, tabs, `maxDuration = 60` |
| `src/app/panel/urunler/fiyatlar/bulk-editor.tsx` | "Toplu değiştir" (client) |
| `src/app/panel/urunler/fiyatlar/pos-checklist.tsx` | "Kasaya işle" (client) |
| `src/app/panel/urunler/fiyatlar/price-history.tsx` | "Geçmiş" (client) |
| `src/app/panel/urunler/fiyatlar/logic.ts` | Page filter helpers (pure) |
| `src/app/panel/urunler/[id]/price-history-card.tsx` | Product card "Fiyat geçmişi" (client, "Kasada değiştirdim") |
| `drizzle/0020_fiyat_gecmisi.sql`, `drizzle/meta/0020_snapshot.json`, journal entry | **Generated** by drizzle-kit |
| `tests/fiyatlar.test.ts` | §8 |
| `docs/FIYATLAR.md` | §9 |

### Change
| File | Change | Shared? |
|------|--------|---------|
| `src/server/db/schema.ts` | Two `products` columns and the `productPrices` table | **shared** |
| `src/server/actions/products.ts` | `updateProductPrice` → `writeSalePrice`; `saveRecipe`/`createProduct` record history; return `posPending` | (group 8 may touch the price-impact flows) |
| `src/server/site-menu/sync.ts` | `applyPlan` records `site` price changes (`returning`) | site-menu owner |
| `src/server/site-menu/push.ts` | `SitePushError` | site-menu owner |
| `src/lib/site-menu/push.ts` | `PRICE_PUSH_REMINDER` text | |
| `src/app/panel/urunler/page.tsx` | "Fiyatlar" header button with Kasa badge (`posPendingSummary` in the existing loads) | |
| `src/app/panel/urunler/products-table.tsx` | "Toplu fiyat" button (card actions and FilterSheet; close the sheet before `router.push`); `PriceCell` toast uses `posPending` | |
| `src/app/panel/urunler/price-impact-panel.tsx` | Toast description uses `posPending` and `POS_PRICE_REMINDER` | **shared with group 8** |
| `src/app/panel/urunler/[id]/page.tsx` | Load `loadProductPriceHistory(id)` and pass it as `priceHistory` | |
| `src/app/panel/urunler/[id]/recipe-editor.tsx` | Render `PriceHistoryCard` after `SiteMenuCard`; save toast uses `posPending` | |
| `src/components/panel/nav.ts` | Hidden `NAV_GROUPS` item and `SHORT_TITLES` entry | **shared (group 13 edits BOTTOM_NAV)** |
| `src/server/actions/notifications.ts` | Bell item "Kasada değişecek N fiyat" | **shared (groups 4, 13)** |
| `src/app/panel/yardim/page.tsx` | FAQ "zam" updated, new FAQ "Kasaya (ModPOS) işle" | shared-ish |
| `tests/site-menusu.test.ts` | Expected `PRICE_PUSH_REMINDER` text | |
| `tests/mobile-nav.test.ts` | `mobileTitleFor("/panel/urunler/fiyatlar") === "Fiyatlar"` | shared |
| `README.md`, `docs/SITE-MENU.md`, `docs/BILDIRIMLER.md` | §9 | shared (README) |

Not touched: `src/lib/calc/engine.ts` (`economicsAt` mirrors it and a test pins the equality), dashboard, digest e-mail, `roles.ts`, `BOTTOM_NAV`, `scripts/seed.ts`.

## 7. Edge cases and interactions (no regressions)

- **Site as source of truth:** linked products are written through the same `pushSaleChange` → `applyPushed` path as a single edit, so the site's returned price is what gets
  written and recorded. A broken L link, a missing item and a link with no key are blocked in the preview and refused again on the server by `planPush`.
- **Ping storm:** each site write makes the site ping, and the panel pulls the whole menu. A bulk of N linked rows therefore causes up to N pulls. That is correct, because `lastSiteNow` blocks older lists,
  and a pull after our write sees no difference (no duplicate history). The load is acceptable for ≤ 130 items. If it becomes a problem, add a short coalescing window to the ping pull (not in scope).
- **M/L of the same site item:** they are processed sequentially inside the item's group (see §5.4). Without this, a sibling update could put back an older L price.
- **Concurrent edits** (another admin, a site pull, a recipe save between preview and apply): the optimistic `from` check fails only that row, with "Fiyat bu sırada değişti".
- **Partial failure:** the result lists failures. "Tekrar dene" reuses the same `batchId`, so undo covers both parts. Undo reverts only rows that are still at the batch price.
- **Rounding floats:** all arithmetic is in integer kuruş (test: 200 +5 % with "5'e yukarı" gives 210, not 215).
- **Decreases:** allowed. The default rounding turns to "aşağı" for a negative amount, the confirm mentions "N ürünün fiyatı düşüyor", and a price ≤ 0 is blocked.
- **"Önerilen fiyat" rule:** never lowers a price. A product with no recipe (suggested 0) is unchanged.
- **Price-rise acknowledgements (`PRICE_ACK_KEY`):** untouched. A bulk increase keeps acks valid; a decrease below the acknowledged price brings the alert back, as today.
- **QR menu (`/menu`, `/api/menu`):** reads `products.price`, so new prices show at once.
- **ModPOS state:** a change back to the POS price clears the item. Undoing a batch clears what the batch created. Deleting a product cascades its history away and drops its checklist
  item. Linking a product that takes the site's price adds a checklist item, so the owner verifies the POS (D7).
- **Create:** history row only, no checklist item (D3).
- **Recipe card open while a bulk runs elsewhere:** existing behaviour (the editor keeps local state; the next save writes what is on screen). This is no worse than today.
- **Dialogs and navigation:** the ConfirmDialogs close before the result and before any link. The FilterSheet closes before `router.push`. "Kasaya işle →" is a plain link shown only when no dialog is open.
- **Time limits:** concurrency 4, a deadline of 40 s and `maxDuration = 60`. A site outage stops the batch after the first failure instead of 8 s × N.
- **Staff:** none of this is visible to staff (admin pages and actions); `roles.ts` is unchanged (D1).
- **Excel export / backup:** the read-only Excel export is unchanged. **Group 3 (backup/restore) must include `product_prices` and the two new `products` columns** in the full backup.

## 8. Tests (`npx tsx --test tests/fiyatlar.test.ts`; then `npm test`, `npm run lint`, `npx tsc --noEmit`)

`tests/fiyatlar.test.ts`
- `rulePrice`:
  - 195 +10 % "5'e yukarı" → 215; 200 +5 % "5'e yukarı" → 210 (float guard); 60 +10 % "5'e en yakın" → 65; 175 −5 % "5'e aşağı" → 165.
  - 195 +7 ₺ "yok" → 202; 259,90 +0 % "yok" → 259,90.
  - Suggested 190/210 → 210; suggested 220/210 → 220.
- `parseRuleAmount`: "%10", "10%", "+10", "-5", "7,5", "abc" (null), "%" (null), "-120" percent (error).
- `roundMinor` for every rounding option, including exact multiples (no change).
- `economicsAt` equals `priceProduct` (net, commission, unitProfit, margin, costRatio, status) for all seed products at their price and at +10 % (load `excel-data.json` the way `tests/urunler.test.ts` does).
- `blockReason`: broken, missing, link off, ≤ 0, over the maximum, and an unlinked row with the link off (not blocked).
- `previewRows` and `bulkSummary`: an override wins over the rule; excluded and unchanged rows are not counted; `monthlyDelta = Σ Δ unitProfit × soldQty`; linked and decrease counts.
- `ruleSummary` texts, including the 200-character truncation.
- `isSiteDown`: network, timeout and off are down; 401 and 503 are down; 400 and 404 are not.
- `posAfterPriceChange`: null → stale(before) with since = now; stale 195 and 205→195 → cleared; stale 195 and 205→210 → still 195 with the original since; kuruş equality (195 vs 195.004).
- `undoPlan`: a revert, "Sonradan değişti", "Ürün silinmiş", and the latest row per product in a batch with duplicates.
- `groupHistory`: batch collapse and day grouping in Istanbul time (a 23:30 UTC row belongs to the next day).
- `posChecklistText`: format, a POS name when present, the panel name and size otherwise.
- Source check (light, `readFileSync`): `recordPriceChange` is referenced in `src/server/actions/products.ts`, `src/server/site-menu/sync.ts` and `src/server/prices/write.ts`/`batch.ts`,
  so a future price write path cannot silently skip the history.

Other files:
- `tests/site-menusu.test.ts`: the new `PRICE_PUSH_REMINDER` text.
- `tests/mobile-nav.test.ts`: the title "Fiyatlar".
- `tests/roller.test.ts` already checks that the new hidden nav item's roles match `canOpen`. `tests/yardim.test.ts` checks that the FAQ links exist.

Manual check (`run` skill, local Postgres):
- Bulk +10 % on "Espresso Bazlı" at 390px and 1280px; override one row; untick one; apply.
- The "Kasaya işle" list fills; tick, then Geri al.
- Product card history and the "Kasada değiştirdim" button.
- Undo the batch from Geçmiş.
- With `KARAOKE_SYNC_SECRET` unset and one product linked by SQL, the row is blocked with the "kurulmamış" reason.

## 9. Docs

- **New `docs/FIYATLAR.md`**, in the structure of SITE-MENU.md: the improved prompt (the owner's request), the screens, the bulk rules and rounding, the interplay with the site (per-item writes, grouping, circuit
  breaker, partial results, retry, undo), the ModPOS checklist (state model and what adds or clears an item), the history (sources, batch), the data (`product_prices`, `products.pos_stale_*`), and
  a files table.
- **`docs/SITE-MENU.md`**:
  - "Panel → site yazımı": bulk and undo use the same per-item write, grouped by item and four at a time, stopping when the site is down.
  - Step 6: the reminder text now points to "Fiyatlar › Kasaya işle".
  - Site → panel price changes are recorded in the price history and added to the ModPOS list.
  - Files table: add `src/server/prices/*`.
- **`README.md`**:
  - Feature sentence: toplu fiyat, kasaya işle listesi, fiyat geçmişi.
  - Screens table row: `Fiyatlar: toplu değiştir, kasaya (ModPOS) işle, fiyat geçmişi | /panel/urunler/fiyatlar | — (yeni)`.
  - `db:reset` row: it also deletes "fiyat geçmişi".
  - Bell description: "kasada değişecek fiyatlar".
  - Folder tree: `lib/prices/`, `server/prices/`.
- **`docs/BILDIRIMLER.md`**: the bell item "Kasada değişecek N fiyat" (admin, Uyarılar).
- **Yardım** (`src/app/panel/yardim/page.tsx`): FAQ "zam" mentions "Ürünler › Fiyatlar › Toplu değiştir" and "Kasaya işle". New FAQ `id: "kasa-fiyat"`, q "Kasadaki (ModPOS) fiyatlar",
  link `/panel/urunler/fiyatlar?sekme=kasa`.

## 10. Owner decisions (recommended defaults; implementation does not block on them)

| # | Question | Default |
|---|----------|---------|
| D1 | Can staff see and tick the "Kasaya işle" list (it shows names and prices only, no costs)? | **No**, admin only. Opening it later means adding a staff route outside `/panel/urunler`, which is not in scope. **24 Ekim 2026: personel işaretler, onaysız** (dalga 10 §2.2: `/panel/kasa/fiyatlar`, `pos_marks`, geri alma; docs/FIYATLAR.md). |
| D2 | Bell item for pending ModPOS prices? Morning e-mail line? | **Bell yes** (shown while ≥ 1 is pending). **E-mail no.** |
| D3 | Should a new product appear in the ModPOS list? | **No**: only price changes of existing products. |
| D4 | Default rounding | **5 ₺ up** for an increase and **5 ₺ down** for a decrease; all current prices are multiples of 5. |
| D5 | Are inactive (pasif) products in a bulk change by default? | **No**: the "Pasifleri de dahil et" toggle adds them. |
| D6 | Backfill history from old activity-log "Satış fiyatı" texts, and assume ModPOS is in sync on deploy? | **No backfill. Assume in sync.** History starts at deploy. |
| D7 | Should price changes made on laffogato.net (and the site price taken when a product is linked) go into the ModPOS list? | **Yes**: the POS must match the site. |
| D8 | Can "Önerilen fiyat" lower prices that are above the suggestion? | **No**: it only raises. |
| D9 | Undo window for a batch | **No time limit**: it reverts only rows still at the batch price. |

## 11. Out of scope

- A batch write endpoint on laffogato.net (one item per request stays).
- Checking ModPOS prices against the monthly sales report (revenue ÷ qty is distorted by discounts).
- Per-category rules inside one batch.
- Changing the price-list date on the site (it stays a reminder).
- Price history in the Excel export (group 3 owns backups).

## 12. Implementation order

1. Schema, then `npm run db:generate -- --name fiyat_gecmisi`, then `npm run db:migrate` locally.
2. `src/lib/prices/*` with `tests/fiyatlar.test.ts` (green).
3. `record.ts` and `write.ts`; refactor `updateProductPrice`, `saveRecipe` and `createProduct`; add `applyPlan` recording and `SitePushError`. Run `npm test`.
4. `batch.ts`, `actions/prices.ts`, `data/prices.ts`.
5. The Fiyatlar page with three tabs (phone first at 390px, then desktop).
6. Product card `PriceHistoryCard`, Ürünler header and table buttons, toasts.
7. Bell, nav entry, Yardım.
8. Docs; `npm run lint`, `npx tsc --noEmit`, `npm test`; manual run.
