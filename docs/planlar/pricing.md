# Plan: price approval for big Paraşüt price jumps (7) and supplier price comparison (12)

Group: pricing. Suggestions 7 and 12. Repository `/home/user/lafmaliyet`, branch `claude/oneriler`.
Read `AGENTS.md` first. This Next.js version differs from training data, so check `node_modules/next/dist/docs/` for
route handlers (`params` is a Promise, `connection()`), `refresh()` from `next/cache` and Suspense/cacheComponents before
writing code.

---

## 1. Goal

**(7)** Today `applyProductLinks` (`src/server/parasut/sync.ts`) writes the newest linked invoice's unit price straight
into the ingredient whenever it differs by 0.5% or more. A wrong link factor (koli vs adet, kg vs gr) or a one-off invoice
therefore changes every recipe cost without anyone noticing. It also raises a false "Hammadde zammı" alert and suggests
higher menu prices. After this change, a new price that differs from the ingredient's current unit price by **more than
±40%** is not applied. It becomes a **price hold** ("onay bekleyen fiyat") that the owner approves or rejects. Prices
within ±40% are still applied silently, exactly as today.

**(12)** In the ingredient window (Hammaddeler), a new section **"Tedarikçilere göre fiyat"** shows who sold this ingredient
at what unit price over time. The unit price is per base unit (shown as ₺/kg, ₺/L or ₺/adet), excludes VAT and has
discounts already deducted. The data comes from linked Paraşüt invoice lines, grouped by supplier the same way the
Tedarikçiler page groups them.

Both features reuse existing data (`parasut_bill_lines`, `parasut_product_links`, `invoices`, `ingredient_prices`). They
add one new table, no new dependency and no new nav item.

---

## 2. User-facing behaviour

### 2.1 Price hold (7)

**Where it shows**

| Place | What | Link |
|---|---|---|
| Hammaddeler page, new card **"Onay bekleyen fiyatlar"** (`id="fiyat-onayi"`), between the stat cards and the list | Every pending hold, with Onayla / Reddet | — |
| Hammaddeler list row (`IngredientName`) | Amber badge `Fiyat onayda` (dot), next to the existing ↑/↓ badge | opens the row's window as today |
| Ingredient window (right column, above "Birim maliyet geçmişi") | Amber note: "Faturadan gelen yeni fiyat onay bekliyor: 48,64 ₺/L (Sütaş, 21.10.2026)." + button **Onaya git**. The button closes the window, then scrolls to `#fiyat-onayi` (same page, so no navigation). | — |
| Bell, group **Onaylar** (admin only) | `{n} hammadde fiyatı onay bekliyor` · body `Süt +%52, Kahve −%45: faturadaki fiyat %40'tan fazla farklı` | `/panel/hammaddeler#fiyat-onayi` |
| Genel bakış › Dikkat edilmesi gerekenler | Warning `Fiyat onayı: {n} hammadde` · detail `Faturadaki fiyat şimdikinden %40'tan fazla farklı: Süt +%52, …. Onaylanana kadar maliyetler şimdiki fiyatla hesaplanır.` | same |
| Sabah e-postası, Paraşüt section | Amber box like the "kontrol bekleyen" box: `{n} hammadde fiyatı onay bekliyor (Süt +%52, …). Faturadaki fiyat şimdikinden %40'tan fazla farklı. Bakın →` | same (absolute URL) |
| Paraşüt page toasts (link one / link all / edit link) | Adds ` · {held} fiyat onay bekliyor` and an action button **Bak** (router push to `/panel/hammaddeler#fiyat-onayi`) | — |
| Eşitleme geçmişi (sync run summary) | Adds a part `{held} fiyat onaya düştü (%40'tan fazla fark)` | — |

Staff never see holds. All of the places above are admin-only already.

**Card "Onay bekleyen fiyatlar"** (client component; layout follows `price-impact-panel.tsx`)

- `CardHeader` icon `TriangleAlert`, title **Onay bekleyen fiyatlar**, meta `{n} hammadde`. Description: "Paraşüt
  faturasındaki birim fiyat şimdikinden %40'tan fazla farklı. Çoğu zaman çarpan yanlıştır (koli ↔ adet); fiyat doğruysa
  onaylayın. Onaylanana kadar maliyetler şimdiki fiyatla hesaplanır."
- When the card shows: if there are pending holds, **or** a decision was made in the last 3 days (so that a mis-tap can
  still be undone after the toast has gone). If nothing is pending, the body says `Onay bekleyen fiyat yok.` above the
  "Son kararlar" section.
- One `<li>` per pending hold (`grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center`, divider list like
  ImpactItem):
  1. Title row:
     - Ingredient name, as a Link to `/panel/hammaddeler?ara={name}#hammadde-listesi` (same route, so this is not dialog
       navigation).
     - Badge `↑ %52` (red) or `↓ %45` (green). The percentage is computed live against the current price.
     - If `repeats ≥ 2`, a gray badge `Son {repeats} faturada da bu fiyat`.
  2. `Şimdi **32,00 ₺/L** → faturada **48,64 ₺/L**`.
  3. `{supplier} · {dd.mm.yyyy}{ · invoiceNo}`, followed by a `Faturayı aç` link to
     `/panel/faturalar?ara={invoiceNo ?? supplier}#fatura-listesi`.
  4. `Faturadaki ürün: {productName} · {qty} {unit ?? "birim"} · 1 {unit ?? "birim"} = {factor} {ingredient.unit}`.
  5. If a previous invoice exists: `Önceki fatura: 31,20 ₺/L · {supplier} · {date}`.
  6. Impact, computed on the server from the model:
     - Increase: `{k} ürünün maliyeti artar · en çok {Latte · Büyük}: 18,40 ₺ → 21,10 ₺`. If last sales month usage > 0,
       add ` · ayda ~{tl(monthly)} fark` (usage of the latest sales month × unit difference).
     - Decrease: `{k} üründe kullanılıyor; maliyetleri düşer`.
     - Not used in any recipe: `Hiçbir reçetede yok`.
  7. If `factorHint` matches (see §4), an amber box: `Fiyat şimdikinin yaklaşık 12 katı: çarpan yanlış olabilir (1 Koli =
     12.000 ml mi?). Çarpan yanlışsa alınan miktar da yanlış sayılır.` When the suggested factor is a whole number, also
     show a secondary button **Çarpanı 12.000 yap**.
  8. Actions:
     - Primary **Onayla** and secondary **Reddet**. On phones they sit side by side, equal width
       (`grid grid-cols-2 gap-2 sm:flex`), with touch height `pointer-coarse:min-h-11`.
     - Text link **Bağlantıyı düzelt** to `/panel/parasut?durum=bagli&ara={productName}#urun-baglantilari`.
- **Reddet** opens a small `Dialog` (size `sm`, not `ConfirmDialog`, because it needs fields):
  - Title `Bu fiyat uygulanmasın mı?`.
  - Text `{name} şimdiki fiyatında ({32,00 ₺/L}) kalır. Sonraki faturada fiyat yine %40'tan fazla farklıysa yeniden
    sorulur. Bu faturanın miktarı alınana ve stok değerine girmez; Tutarlılık'ta elle yazabilirsiniz.` (denetim B03:
    the rejected invoice stays out of Alınan and the stock lots.)
  - `Checkbox` `Bu üründen fiyat güncellemesini kapat (sonraki faturaların miktarı yine sayılır)`, unchecked by default.
  - `Input` `Not (isteğe bağlı)`, max 300.
  - Buttons `Vazgeç` / `Reddet` (tone danger).
- Toasts. Each has a **Geri al** action that calls `undoPriceHold`:
  - Approve: `{name}: 32,00 ₺/L → 48,64 ₺/L uygulandı`.
  - Reject: `{name} fiyatı değişmedi`, with description `Bu üründen fiyat güncellemesi kapatıldı` when checked.
  - Factor fix: `Çarpan {x} oldu · fiyat uygulandı` or `Çarpan {x} oldu · fiyat hâlâ %40'tan fazla farklı, onay bekliyor`.
- **Son kararlar** is a collapsed toggle, `Son kararlar ({n})`, using the `ChevronDown` toggle pattern from
  price-impact-panel. It lists approved, rejected and superseded holds from the last 3 days, newest first, at most 10.
  Each line reads `{name} · {48,64 ₺/L} · Onaylandı / Reddedildi / Geçersiz: {note} · {decidedByName} · {date}`. Approved
  and rejected lines have **Geri al**.
- Anchor scrolling: the page streams in Suspense, and Next keeps hidden copies of earlier pages, so copy the
  `ListAnchor` effect. On mount, if `location.hash === "#fiyat-onayi"`, scroll the *visible* element with that id into
  view. Use the class `scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]`.
- Optimistic UI: use `useOptimistic` to remove an approved or rejected item from the list straight away, as the Paraşüt
  link list does. `refresh()` on the server re-renders the page.

### 2.2 Supplier comparison (12)

The ingredient window (`IngredientDialog`, right column) gets a new section **after** "Birim maliyet geçmişi" and
**before** "Kullanıldığı ürünler". On phones the right column stacks under the form, as it does today. The section is a
client component and fetches `GET /api/hammaddeler/{id}/fiyatlar` when the window opens, the same pattern as
`faturalar/invoice-lines.tsx`.

- Header: **Tedarikçilere göre fiyat** · sub `₺ / kg · KDV hariç, iskonto düşülmüş` (the unit follows the ingredient:
  kg, L, adet or dilim) · right side `{s} tedarikçi · {n} fatura`.
- One block per supplier (`rounded-2xl bg-panel` list with `divide-y`):
  - Row 1:
    - Supplier name, as a Link to `/panel/tedarikciler/{slug}`.
    - Badge `En ucuz` (green) only when at least 2 suppliers have bought within the last 90 days.
    - Badge `Eski fiyat` (gray) when the last purchase is older than 90 days.
    - Right, bold: last price `31,20 ₺/kg`.
  - Row 2 (xs, muted): `Son {dd.mm.yyyy}`, then:
    - if there is a previous invoice from the same supplier, ` · öncekine göre +%4`, red when up and green when down;
    - if the price is more than 0.5% above the cheapest, ` · en ucuzdan %12 pahalı`.
  - Row 3 (xs, muted): `12 ayda 28,00–31,20 · ort. 29,85 · 9 fatura`. The average is weighted by quantity. If there is
    only one invoice in 12 months, show `{n} fatura` only.
  - Toggle `Faturalar ({n})` (ChevronDown). It expands to a list with `max-h-56 overflow-y-auto`. Each line:
    `{dd.mm.yyyy} · {12 Koli | 2 kalem} · 31,20 ₺/kg · {invoiceNo}`, where the invoice number links to
    `/panel/faturalar?ara={invoiceNo ?? supplier}#fatura-listesi`.
- Footer (xs, muted): `Reçetedeki fiyat: {current}/kg`. Add ` · {k} bedava kalem, {r} iade sayılmadı` when either count
  is above 0.
- Sort order: suppliers with a purchase in the last 90 days first, by last price ascending. Then older ones, newest first.
- Empty and edge states (Turkish copy):
  - Loading: `Tedarikçi fiyatları yükleniyor…` (pulse).
  - Error: the message in `text-bad`.
  - No linked Paraşüt product: `Bu hammadde henüz bir Paraşüt ürününe bağlı değil. Faturadaki ürünü bağlayınca
    tedarikçilerin fiyatları burada karşılaştırılır.` + link `Bağlanmayı bekleyenler →`
    (`/panel/parasut?durum=bekleyen#urun-baglantilari`).
  - Linked but no line yet: `Bağlı ürünlerin faturası henüz gelmedi ya da kalemleri okunmadı.`
  - One supplier: show its block, plus the hint `Tek tedarikçi. Başka bir tedarikçinin aynı ürününü de bu hammaddeye
    bağlarsanız fiyatlar yan yana görünür.`
- **Dialogs close before navigation.** Every Link inside the window calls the window's `onClose` in its `onClick` (pass
  `onNavigate={onClose}` into the section). In the same file, apply the same fix to the existing "Kullanıldığı ürünler"
  links (`/panel/urunler/{id}`), which do not close the window today.
- No new chart. The existing "Birim maliyet geçmişi" chart stays as the trend of the recipe price, and the per-supplier
  rows and invoice lists cover "over time".

---

## 3. Data model

New table in `src/server/db/schema.ts`, placed after `parasutCategoryRules` in the Paraşüt section. Add Turkish doc
comments that explain *why* each column exists.

```ts
/**
 * Paraşüt faturasından gelen, hammaddenin şimdiki birim fiyatından %40'tan fazla farklı fiyat: kendiliğinden uygulanmaz,
 * yönetici onaylar ya da reddeder (docs/PARASUT.md 5b). Hammadde başına en çok bir bekleyen öneri olur.
 */
export const ingredientPriceHolds = pgTable(
  "ingredient_price_holds",
  {
    id: serial("id").primaryKey(),
    ingredientId: integer("ingredient_id").notNull().references(() => ingredients.id, { onDelete: "cascade" }),
    // Kaleme değil faturaya bağlı: kalemler her eşitlemede silinip yeniden yazılır (sync.ts, lines.ts)
    invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    productKey: text("product_key").notNull(),
    productName: text("product_name").notNull(),
    /** Bağlantının öneri anındaki çarpanı: bağlantı değişirse öneri geçersiz olur */
    factor: doublePrecision("factor").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    unit: text("unit"),
    netTotal: doublePrecision("net_total").notNull(),
    invoiceDate: text("invoice_date").notNull(),
    supplier: text("supplier").notNull(),
    invoiceNo: text("invoice_no"),
    /** Önerilen paket fiyatı ve boyu (= çarpan); onaylanınca hammaddeye yazılır */
    packagePrice: doublePrecision("package_price").notNull(),
    packageSize: doublePrecision("package_size").notNull(),
    /** Öneri anında (onaylanınca: değiştirilen) paket fiyatı ve boyu; "Geri al" bunu yazar */
    prevPackagePrice: doublePrecision("prev_package_price").notNull(),
    prevPackageSize: doublePrecision("prev_package_size").notNull(),
    /** Aynı hammaddenin bir önceki faturadaki birim fiyatı (₺/gr, ₺/ml, ₺/adet), tarihi, tedarikçisi; yoksa boş */
    lastUnitPrice: doublePrecision("last_unit_price"),
    lastDate: text("last_date"),
    lastSupplier: text("last_supplier"),
    /** Arka arkaya kaç faturada benzer (±%10) fiyat geldi: 2+ ise fiyat büyük olasılıkla gerçek */
    repeats: integer("repeats").notNull().default(1),
    status: text("status", { enum: ["pending", "approved", "rejected", "superseded"] }).notNull().default("pending"),
    /** Geçersiz kalma nedeni ("Daha yeni fatura geldi", "Çarpan değişti") ya da yöneticinin red notu */
    note: text("note"),
    /** Reddederken bu ürünün fiyat güncellemesi kapatıldı (geri almada yeniden açılır) */
    stoppedUpdates: boolean("stopped_updates").notNull().default(false),
    decidedBy: integer("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedByName: text("decided_by_name"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ingredient_price_holds_pending_uq").on(t.ingredientId).where(sql`status = 'pending'`),
    index("ingredient_price_holds_status_idx").on(t.status, t.createdAt),
  ],
);
```

Why a table and not `integration_state` JSON:

- A partial unique index guarantees one pending hold per ingredient, the same pattern as `recipe_change_requests`.
- The bell, dashboard and e-mail each need a cheap count.
- Each hold has a status lifecycle and an audit of who decided.
- FK cascades clean up holds when an invoice or ingredient is deleted.

Migration: `npm run db:generate -- --name fiyat_onayi`, generated by drizzle-kit and never hand-written. **Generate it
last, after rebasing on the other groups' schema changes**, so the number and snapshot do not conflict.

`db:reset` (`scripts/seed.ts`): `TRUNCATE ingredients, invoices … CASCADE` already empties the new table, so no script
change is needed. Mention it in the README's db:reset list.

No new columns on existing tables. No backfill. At deploy the `parasut.prices` "applied" map already holds dates, so only
invoices that arrive after the deploy are evaluated.

---

## 4. Server logic

### 4.1 Pure rules: `src/lib/price-hold.ts` (new, unit-tested)

```ts
export const PRICE_HOLD_PCT = 0.4;     // ±%40: bundan büyük fark onaya düşer
export const SAME_PCT = 0.005;         // mevcut kural: %0,5'ten küçük fark yazılmaz
export const REPEAT_PCT = 0.1;         // ardışık faturalarda "aynı fiyat" toleransı

/** Yeni birim fiyatın akıbeti. before: hammaddenin şimdiki birim fiyatı; exempt: su/buz (fiyatı su faturasından) */
export function priceStep(i: { before: number; after: number; exempt?: boolean; threshold?: number }): "same" | "apply" | "hold";
//   before <= 0 → "apply" (korunacak fiyat yok); |after/before−1| < SAME_PCT → "same";
//   !exempt && |after/before−1| > threshold → "hold"; aksi "apply". Exactly ±40% is "apply".

/** Fiyat şimdikinin yaklaşık tam katı ya da tam bölümüyse (2..1000, ±%5) çarpan çarpanı; değilse null */
export function factorHint(before: number, after: number): { multiplier: number; times: number; direction: "up" | "down" } | null;
/** Önerilecek yeni çarpan: tam sayıysa (≥1) döner, değilse null (düğme gösterilmez, yalnız uyarı metni) */
export function suggestedFactor(factor: number, hint: { multiplier: number }): number | null;

/** Ardışık benzer fiyat sayısı: önceki öneri başka faturadan ve birim fiyatı ±%10 içindeyse +1 */
export function nextRepeats(prev: { invoiceId: number; unitPrice: number; repeats: number } | null, cur: { invoiceId: number; unitPrice: number }): number;

/** Geçersiz kalan bekleyen öneriler ve nedeni (bağlantı silindi/çarpanı/hammaddesi değişti/fiyat güncellemesi kapandı/kalem yok) */
export function staleHolds(
  pending: { id: number; ingredientId: number; productKey: string; factor: number; invoiceId: number }[],
  links: { productKey: string; ingredientId: number; factor: number; updatePrice: boolean }[],
  lines: { invoiceId: number; productKey: string }[],
): { id: number; reason: string }[];
// reasons (Turkish, shown in "Son kararlar"): "Bağlantı kaldırıldı", "Bağlantı başka hammaddeye geçti",
// "Çarpan değişti", "Fiyat güncellemesi kapatıldı", "Faturadaki kalem artık yok"

/** Aynı hammaddenin, verilen faturadan önceki en yeni ücretli faturasındaki birim fiyatı (bütün bağlı ürünler) */
export function previousInvoicePrice(
  lines: { invoiceId: number; productKey: string; date: string; supplier: string; quantity: number; netTotal: number }[],
  links: Map<string, { ingredientId: number; factor: number }>,
  ingredientId: number,
  current: { invoiceId: number; date: string },
): { unitPrice: number; date: string; supplier: string } | null;

/** Onaylanırsa ürün maliyetleri: hammaddenin birim fiyatı proposed olsaydı (priceProduct ile, productImpacts gibi) */
export function holdImpact(model: Model, ingredientId: number, proposedUnit: number, month: string | null):
  { products: number; top: { name: string; size: string; costBefore: number; costAfter: number }[]; monthlyDelta: number | null };
// active products using the ingredient (cost > 0). top: by |delta| desc, max 3. monthlyDelta = usage(month) × (proposed − current), null if no usage

/** Genel bakış ve zil metni (insights.Alert biçimi); bekleyen yoksa null */
export function holdAlert(holds: { name: string; pct: number }[]): { level: "warning"; title: string; detail: string; href: string } | null;
// title `Fiyat onayı: {n} hammadde`; detail "Faturadaki fiyat şimdikinden %40'tan fazla farklı: Süt +%52, Kahve −%45
// ve 2 hammadde daha. Onaylanana kadar maliyetler şimdiki fiyatla hesaplanır."; href "/panel/hammaddeler#fiyat-onayi"
```

`holdImpact` cannot reuse `productImpacts`. That function treats the *model* price as "after", while a hold's proposed
price is not in the model. Copy its `priceProduct(p.product, lines.map(…unitCost replaced…), model.settings)` loop
instead. Leave `src/lib/calc/price-impact.ts` untouched, because group 8 is likely to edit it.

### 4.2 `applyProductLinks` changes (`src/server/parasut/sync.ts`)

Quantities stay unchanged. Only the price section changes:

1. Extend the `rows` select with `invoiceId: s.invoices.id`, `productName: s.parasutBillLines.productName` and
   `unit: s.parasutBillLines.unit`.
2. **Early return when there are no links:** first supersede every pending hold (`Bağlantı kaldırıldı`), then return
   `{ quantities: 0, prices: 0, held: 0 }`.
3. Before the price loop:
   - Load all holds for the ingredients in `latest` in one query (any status, newest first).
   - Supersede the pending holds returned by `staleHolds(pending, links, rows)`, using the given reason.
4. Price loop. Keep the existing `latest`, `appliedKey` and `applied[appliedKey] = r.date` logic. Then
   `step = priceStep({ before, after, exempt: ing.priceSource === "water" })`:
   - **same**: if a hold is pending for this ingredient, supersede it with `Daha yeni faturada fiyat aynı`. Write
     nothing else (as today).
   - **apply**: update the ingredient and insert history (as today), plus supersede any pending hold with
     `Daha yeni faturanın fiyatı uygulandı ({x})`. Wrap these 2–3 writes in one `db.transaction`.
   - **hold**:
     - If a pending hold already has the same `invoiceId + productKey + factor`, do nothing. Re-runs and crash recovery
       must not churn rows.
     - If a **rejected** hold has the same `invoiceId + productKey + factor`, do nothing. The owner's no stands.
     - Otherwise, in one transaction: supersede the current pending hold (`Daha yeni fatura geldi`), then insert the new
       pending row with `onConflictDoNothing` on the partial unique index (`where status = 'pending'`) as the race guard.
       Fill the row with the invoice/line snapshot, `packagePrice/packageSize` (the values today's code would write),
       `prevPackagePrice/Size` = the ingredient's current values, `last*` from `previousInvoicePrice`, and
       `repeats = nextRepeats(most recent hold for this ingredient, current)`. Count it in `held`.
5. After the loop, if `held.length > 0`, call
   `logActivity(null, "Fiyat onaya düştü", "Süt +%52 (Sütaş 21.10.2026), …")` once.
6. Return `{ quantities, prices, held: held.length }`.
7. In `syncParasut`, keep the result of the `applyProductLinks([...touchedMonths])` call and add
   `held ? \`${held} fiyat onaya düştü (%40'tan fazla fark)\` : ""` to `parts`. Do the same in `syncSupplierHistory`'s
   summary.

Comment why in Turkish. A wrong factor or one-off invoice must not silently change every recipe cost, and the zam alert
must not fire on a factor mistake.

### 4.3 Data loaders: `src/server/data/price-holds.ts` (new, `server-only`)

- `loadPriceHolds()` returns `{ pending, recent }`:
  - `pending`: rows joined with `ingredients` (name, unit, packagePrice, packageSize, priceSource), ordered by
    `createdAt`.
  - `recent`: decided in the last 3 days (approved, rejected or superseded), at most 10.
  - Dates are serialised to ISO strings.
- `pendingHoldSummary()` returns `{ count, latestId, items: { name, pct }[] }`. `pct` is live: proposed unit ÷ current
  ingredient unit − 1. Used by the bell, the dashboard and the e-mail. Group 13 ("Bugün") can reuse it.

### 4.4 Server actions: `src/server/actions/price-holds.ts` (new, `"use server"`)

All three use `attempt`, `requireAdmin`, zod, `UserError`, `logActivity` and `refresh()`.

- `approvePriceHold(id: number)`:
  - In a transaction, lock the hold `for update`. It must be `pending`, else UserError
    `Bu fiyat önerisi artık geçerli değil; sayfayı yenileyin.`
  - Read the link by `productKey`. If it is missing or its ingredient or factor changed, mark the hold superseded
    **outside** the rolled-back transaction (commit the status change, then throw) with UserError
    `Paraşüt bağlantısı değişti; bu öneri geçersiz oldu.`
  - Lock the ingredient and set `packagePrice`, `packageSize`, `isEstimate: false` and `updatedAt`.
  - Insert `ingredient_prices` with `changedBy: "Paraşüt"` and
    `note: "{supplier} {invoiceNo} ({date}) · onaylayan: {me.name}"`.
  - Set the hold to `approved`, with `decided*` and `prevPackagePrice/Size` = the values just replaced.
  - Log `Fiyat onaylandı`, detail `Süt: 32,00 ₺/L → 48,64 ₺/L (Sütaş 21.10.2026)`.
  - Return `{ name, unit, before, after }`.
- `rejectPriceHold({ id, stopUpdates, note })`:
  - Lock the hold, which must be pending. Set `rejected`, `decided*`, `note` and `stoppedUpdates`.
  - If `stopUpdates`, set `parasut_product_links.update_price = false` for `productKey` (and the same ingredient).
  - Log `Fiyat reddedildi` (`… uygulanmadı`, plus ` · bu üründen fiyat güncellemesi kapatıldı`).
- `undoPriceHold(id)` (the toast's **Geri al** and "Son kararlar"):
  - Allowed only for `approved` or `rejected` decided within 30 days.
  - If another hold is pending for the ingredient, UserError
    `Bu hammadde için yeni bir fiyat önerisi var; önce onu karara bağlayın.`
  - Approved case: if the ingredient's current price is no longer the approved one, UserError
    `Fiyat sonradan değişti; geri alınamaz. Hammaddeler'den elle düzeltin.` Otherwise write `prevPackagePrice/Size` back
    and insert history `changedBy: me.name, note: "Fiyat onayı geri alındı"`.
  - Rejected case with `stoppedUpdates`: set `updatePrice = true` again.
  - Set the hold back to `pending`, clearing `decided*`, `note` and `stoppedUpdates`. Log `Fiyat kararı geri alındı`.
- The factor fix reuses the existing **`saveProductLink`** with `{ productKey, productName, ingredientId, factor:
  newFactor, updatePrice: true }`. Its `applyProductLinks()` call supersedes the hold (`Çarpan değişti`) and re-evaluates
  the newest invoice with the new factor.
- `src/server/actions/parasut.ts`: `saveProductLink` and `saveProductLinks` already return the `applyProductLinks`
  result, so they now include `held`. `readParasutLines` adds `· {held} fiyat onayda` to its activity detail.

### 4.5 Supplier comparison

**Pure: `src/lib/supplier-prices.ts`** (new, unit-tested)

```ts
/** Okunur birim: gr → kg (×1000), ml → L (×1000), adet/dilim → kendisi */
export function bulkUnit(unit: string): { per: string; scale: number };

export interface PriceLine { invoiceId: number; date: string; invoiceNo: string | null; supplierKey: string; supplierName: string; supplierSlug: string;
  productName: string; quantity: number; unit: string | null; factor: number; netTotal: number }
export interface SupplierPoint { invoiceId: number; date: string; invoiceNo: string | null; unitPrice: number /* ₺ per base unit */; qtyText: string }
export interface SupplierPriceRow { key: string; name: string; slug: string; points: SupplierPoint[] /* newest first */;
  last: SupplierPoint; change: number | null; min: number | null; max: number | null; avg: number | null; windowCount: number;
  fresh: boolean; cheapest: boolean; vsCheapest: number | null }

export function supplierPriceRows(lines: PriceLine[], opts: { today: string; freshDays?: number /*90*/; windowDays?: number /*365*/ }):
  { rows: SupplierPriceRow[]; invoiceCount: number; freeLines: number; returnLines: number };
```

Rules:

- Skip lines with `quantity <= 0`, `netTotal <= 0` or `factor <= 0`.
  - Count `netTotal == 0 && quantity > 0` as `freeLines`.
  - Count `quantity < 0 || netTotal < 0` as `returnLines`.
- Merge lines of the same `(supplierKey, invoiceId)` into one point: `unitPrice = Σnet / Σ(quantity × factor)`.
  `qtyText` is `"{qty} {unit}"` for a single line and `"{k} kalem"` otherwise.
- Per supplier:
  - `change` = last ÷ previous − 1.
  - Over points dated within `windowDays`: min, max, and a weighted average (Σnet / Σbase qty).
  - `fresh` = last date within `freshDays`.
- `cheapest` is set only when at least 2 fresh rows exist (lowest last price among fresh rows).
- `vsCheapest` = last ÷ cheapest last − 1, for fresh rows only.
- Sort: fresh rows by last price ascending, then stale rows by last date descending.

**Loader: `src/server/data/supplier-prices.ts`** (new, `server-only`)

`loadSupplierPrices(ingredientId)`:

1. Select from `parasut_bill_lines`, inner join `parasut_product_links` on `productKey` where
   `ingredientId = id` (all links, including those with `updatePrice` false), inner join `invoices`, excluding
   `SEPARATE_CATEGORIES`. This is the same scope as `applyProductLinks`.
2. Count the ingredient's links, read the ingredient (unit, packagePrice, packageSize) and its last `ingredient_prices`
   row.
3. Supplier identity:
   - Call `loadSupplierLedger()` and build `Map<invoiceId, { key, name, slug }>` from `groups[].invoices`.
   - This keeps the grouping, the display name and the `/panel/tedarikciler/{slug}` link exactly as on the Tedarikçiler
     page. When group 5 makes the grouping VKN-aware, this follows automatically.
   - Do not re-implement name matching.

**Route: `src/app/api/hammaddeler/[id]/fiyatlar/route.ts`** (new). Copy the auth and shape of
`api/faturalar/[id]/kalemler`:

- `await connection()`.
- 403 for non-admin, 400 for a bad id, 404 when the ingredient is missing.
- `Cache-Control: private, no-store`.
- Body type `SupplierPricesResponse` (exported from the lib):

```ts
{ ingredient: { id; name; unit; per; scale; current: number /* ₺ per base unit */ }; links: number;
  rows: SupplierPriceRow[]; invoiceCount: number; freeLines: number; returnLines: number }
```

---

## 5. Files

### New

| File | Content |
|---|---|
| `src/lib/price-hold.ts` | pure hold rules (§4.1) |
| `src/lib/supplier-prices.ts` | pure comparison and `bulkUnit` (§4.5) |
| `src/server/data/price-holds.ts` | loaders (§4.3) |
| `src/server/data/supplier-prices.ts` | loader (§4.5) |
| `src/server/actions/price-holds.ts` | approve, reject, undo (§4.4) |
| `src/app/api/hammaddeler/[id]/fiyatlar/route.ts` | GET comparison |
| `src/app/panel/hammaddeler/price-holds.tsx` | card "Onay bekleyen fiyatlar" (client) |
| `src/app/panel/hammaddeler/supplier-prices.tsx` | dialog section "Tedarikçilere göre fiyat" (client) |
| `drizzle/00xx_fiyat_onayi.sql` + meta snapshot | generated |
| `tests/fiyat-onayi.test.ts`, `tests/tedarikci-fiyatlari.test.ts` | tests (§7) |

### Changed

| File | Change | Shared? |
|---|---|---|
| `src/server/db/schema.ts` | new table | **shared** |
| `src/server/parasut/sync.ts` | `applyProductLinks` hold logic, `held` in return and summaries | **shared** (group 5 may touch matching here) |
| `src/server/actions/parasut.ts` | `held` passthrough; readParasutLines log | shared-ish |
| `src/app/panel/parasut/parasut-client.tsx` | toasts mention held + "Bak" action (3 places: `link`, `linkAll`, `update`) | — |
| `src/app/panel/hammaddeler/page.tsx` | load holds, build view model (live pct, `holdImpact`, `factorHint`), render card, `pendingHold` on rows | — |
| `src/app/panel/hammaddeler/ingredients-client.tsx` | `IngredientRow.pendingHold?: { pct: number; proposed: number; supplier: string; date: string } \| null`; badge in `IngredientName`; note + "Onaya git" in dialog; `<SupplierPrices ingredientId unit onNavigate={onClose} />`; close-before-navigate fix on "Kullanıldığı ürünler" links | — |
| `src/server/actions/notifications.ts` | admin `holdNotifications()` → group `onay`, id `fiyat-onay-{count}-{latestId}` | **shared** (groups 4, 13) |
| `src/app/panel/page.tsx` | `holdAlert(...)` first in `alertItems` | **shared** (groups 4, 9, 13) |
| `src/server/notify/digest.ts` | `loadDigestInvoices` adds `priceHolds: { count, fresh, items }` (fresh = holds created after the same `since`); `invoiceNews` also true when `fresh > 0`; key seed adds `:h{fresh}` | **shared** (groups 4, 8) |
| `src/server/notify/digest-template.ts` | `DigestInvoices.priceHolds?`; amber box after the review box; plain-text line; subject `Sabah özeti: {n} fiyat onay bekliyor` when it is the only news; button → `/panel/hammaddeler#fiyat-onayi` in that case | **shared** |
| `src/app/panel/yardim/page.tsx` | "Yeni fatura geldi" answer: one sentence on price holds; "Bildirim zili": Onaylar group holds recipe proposals and price approvals | **shared** |
| `tests/hatirlaticilar-digest.test.ts` | holds box cases | — |
| `docs/PARASUT.md`, `docs/BILDIRIMLER.md`, `README.md` | §8 | **shared** |

No change to `nav.ts`, `roles.ts`, `price-impact.ts`, `ingredient_prices` or `suppliers.ts`.

---

## 6. Edge cases and interactions (no regressions)

1. **Exactly ±40%** is applied. Only differences strictly greater are held.
2. **No current price** (`before <= 0`) is applied directly. **Water/ice** (`priceSource = "water"`) never holds, as
   today; the model ignores its package price anyway.
3. **Free lines (100% discount), returns and kafe dışı invoices** are already excluded from price. Their exclusion is
   unchanged, so they never create holds.
4. **Later invoices.** Each newest invoice is evaluated once (the `parasut.prices` map), always against the ingredient's
   *current* price:
   - within ±0.5%: the pending hold is superseded;
   - within ±40%: the price is applied and the pending hold superseded;
   - beyond ±40%: the new invoice replaces the pending hold, and `repeats` goes up when the price is similar (±10%) to
     the previous hold.
5. **After rejection** the current price stays. The next invoice is asked again if it is still beyond ±40%, with
   `Son N faturada da bu fiyat`. To stop being asked, the owner ticks "fiyat güncellemesini kapat" or fixes the factor.
   The rejected invoice itself is never re-asked, even if re-evaluated.
6. **After approval** the approved price is the base for later invoices.
7. **Link edited, deleted or "Fiyatı güncelle" turned off** supersedes the pending hold (sweep). With a new factor, the
   newest invoice is re-evaluated at once (new `appliedKey`).
8. **Invoice deleted** cascades the hold away. The price is not re-proposed, because the date stays in the applied map,
   which matches today's behaviour for applied prices. The same holds if it is restored from "Silinen Paraşüt
   faturaları". **Invoice moved to Karaoke box / Alp Koç**, or **cancelled in Paraşüt**: its lines leave the price scope
   and the sweep supersedes the hold (`Faturadaki kalem artık yok`).
9. **Line rewrite** (every sync rewrites lines, UBL re-read) does not touch holds, because they point at the invoice and
   keep a snapshot.
10. **Manual price edit while pending** (Hammaddeler row/dialog): the hold stays pending. The card shows the live current
    price and live %. Approve writes the proposed price and records what it replaced, so undo works.
11. **Several products linked to one ingredient**: the newest invoice line across links wins (unchanged). The hold carries
    its `productKey`, and "Önceki fatura" may show another supplier, which helps spot a different product or quality.
12. **Concurrency**: sync and a manual link save can overlap. The partial unique index plus `onConflictDoNothing`
    prevents two pending holds. Approve/reject lock the row, and the sweep only touches `status = 'pending'`.
13. **Zam alert** (`price-alerts.ts`, Ürünler › Hammadde zamları, e-mail zam section) reads `ingredient_prices`, so held
    prices raise no zam alert until approved. After approval the zam alert works as today, with `changedAt` set to the
    approval time.
14. **Alınan miktar (Tutarlılık)** is not held. It still uses the link factor, which is why the card says a wrong factor
    also skews quantities.
15. **First-time linking / "Hazır olanları bağla"** may hold several prices against Excel estimates at once. The toast
    says so and links to the card. There is no bulk approve.
16. **Undo window**: 30 days in the action. The card's "Son kararlar" shows 3 days, and the toast has Geri al.
17. **Supplier comparison:**
    - It uses all linked lines, including links with "Fiyatı güncelle" off.
    - A wrong factor skews ₺/kg here too; fixing the factor fixes both.
    - Suppliers are grouped exactly as on Tedarikçiler.
    - Placeholder supplier "Paraşüt tedarikçisi" shows as its own group, as there.
    - Holds do not hide lines from the comparison: the invoice is real.
18. **Performance**: `applyProductLinks` adds one holds query and at most a few small writes. The comparison route runs
    `loadSupplierLedger()` once per window open (all invoices, a few thousand rows), which is acceptable.
19. **Backup (group 3)** must include the new table `ingredient_price_holds`.

---

## 7. Tests (`npx tsx --test`)

`tests/fiyat-onayi.test.ts`

- `priceStep`:
  - before 0 → apply; +0.4% → same; +40% → apply; +40.01% → hold; ×0.6 → apply; ×0.599 → hold;
  - water exempt at +200% → apply.
- `factorHint` and `suggestedFactor`:
  - 12.3× → 12 (up); 1.6× → null; 2.05× → 2; 7.5× → null (8 is out of the ±5% tolerance); 1/1000 → down 1000;
  - `suggestedFactor(1000, {multiplier: 1/12})` → null (83.3 is not whole); `(1, 12)` → 12.
- `nextRepeats`: no previous → 1; same invoice → unchanged; other invoice within 10% → +1; outside → 1.
- `staleHolds`: each of the 5 reasons, plus an intact hold that is not stale.
- `previousInvoicePrice`:
  - picks the newest earlier paid line across all links of the ingredient;
  - ignores free lines, returns and the same invoice;
  - uses each line's own factor.
- `holdImpact` on the Excel dataset (`excelToDataset`, as `price-impact.test.ts` does): Süt +50% gives products = active
  products using Süt with cost > 0, `top[0]` has the largest delta, and `monthlyDelta` = usage × diff. A decrease gives
  negative deltas.
- `holdAlert`: null for empty input; 1 hold; 5 holds → "ve 2 hammadde daha"; href.

`tests/tedarikci-fiyatlari.test.ts`

- `bulkUnit` for gr, ml, adet and dilim.
- Two lines on one invoice merge into one weighted point. Free lines and returns are counted, not priced.
- `last`, `change`, 12-month min, max and weighted avg; points older than 365 days are excluded from the window but
  still listed.
- Fresh/stale at 90 days. `cheapest` only with at least 2 fresh rows; `vsCheapest`; sort order.

`tests/hatirlaticilar-digest.test.ts` (extend)

- `renderDigest` with `priceHolds` includes the amber box text and `/panel/hammaddeler#fiyat-onayi`.
- The plain text includes the line.
- The subject is `Sabah özeti: … fiyat onay bekliyor` when holds are the only news.

Also run `npm run lint`, `npx tsc --noEmit` and the full `npm test`. Manual check against local Postgres: insert lines
and links by hand, then call `applyProductLinks` through "Kalemleri şimdi oku" or by saving a link. Screenshot the card
and the dialog section at 390 px and on desktop.

---

## 8. Docs

- `docs/PARASUT.md`:
  - §5: in the "Fiyatı güncelle" bullet, add that a price differing by more than ±40% is not applied and goes to approval
    (5b).
  - New **§5b Fiyat onayı**: the rule, where it shows, approve / reject / factor fix, what later invoices do (§6 items
    4–8), undo, the data in `ingredient_price_holds`.
  - New **§5c Tedarikçilere göre fiyat**: source, units, the 90-day and 12-month rules, grouping as on Tedarikçiler.
  - §5a: one line saying held prices do not create zam alerts until approved.
- `docs/BILDIRIMLER.md`: the e-mail bullet list gets "onay bekleyen hammadde fiyatları (Paraşüt bölümünde)". The bell:
  the Onaylar group holds recipe proposals and price approvals.
- `README.md`:
  - Hammaddeler row: "onay bekleyen fiyatlar (%40'tan büyük değişim), tedarikçilere göre fiyat".
  - API row: add `/api/hammaddeler/[id]/fiyatlar`.
  - Bell sentence: "fiyat onayları".
  - db:reset list: "fiyat onayları".
- `src/app/panel/yardim/page.tsx`: the two answers (§5).

---

## 9. Owner decisions (defaults are what this plan implements)

1. **Threshold**: fixed ±40% constant (`PRICE_HOLD_PCT`), no settings UI. A setting can come later if it proves noisy.
2. **Hold the first Paraşüt price of an ingredient whose current price is an Excel estimate ("Tahmini")?** Default: yes,
   hold it. First links are where factor mistakes happen, and approval is one tap.
3. **Auto-apply after N invoices in a row with the same price?** Default: no. The card only shows
   `Son N faturada da bu fiyat`.
4. **Bulk "Hepsini onayla"?** Default: no. Each hold is meant to be looked at.
5. **E-mail**: the holds line rides in the Paraşüt section and triggers the morning e-mail only when a hold is new since
   the last Paraşüt-section e-mail. Default: yes.
6. **Supplier comparison windows**: "fresh" = 90 days (used for "En ucuz"), summary = 12 months. Default as stated.
7. **Pending holds never expire.** Default: no expiry; they stay in the bell until decided or superseded.

---

## 10. Integration notes for other groups

- **Group 3 (backup)**: include `ingredient_price_holds` in the full backup and the restore order. It comes after
  `ingredients` and `invoices` because of the FKs.
- **Group 4 (silent failures)** also edits `notifications.ts`, `page.tsx` alerts and `digest*.ts`. Our additions are one
  function and one item each, so merge by appending.
- **Group 5 (VKN matching)**: the comparison groups suppliers through `loadSupplierLedger()` and does no name matching of
  its own, so it inherits VKN grouping without code changes. Both groups may touch `sync.ts`, but in different functions
  (`applyProductLinks` vs supplier mapping).
- **Group 8 (price rise as lira lost)** is near `price-impact.ts`, the zam panel and the digest zam section. This plan does
  not modify `price-impact.ts`. `holdImpact` lives in `src/lib/price-hold.ts`.
- **Group 13 (Bugün)** can list `pendingHoldSummary().count` as an owner to-do linking `/panel/hammaddeler#fiyat-onayi`.
- **Migration**: generate last, after rebasing on all schema changes.
