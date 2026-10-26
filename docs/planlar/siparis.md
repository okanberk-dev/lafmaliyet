# Plan: Mal siparişi: sipariş önerisi, WhatsApp ile sipariş ve teslim kontrolü (group `siparis`)

Base: `claude/oneriler` (= origin/main 71ac11f). Read `AGENTS.md` first. This Next.js (16.4, cacheComponents) differs from
training data. The docs this plan relies on:

- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md`: `refresh()` only inside Server Actions.
- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` and `01-getting-started/07-mutating-data.md`.
- `node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md`: hidden routes keep state through `<Activity>`. Edited
  quantities survive a back navigation. Dialogs must be closed before navigating; close transient state in a
  `useLayoutEffect` cleanup.
- `node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md` §"Fix synchronous IO": `new Date()` and
  `crypto.randomUUID()` must not run in the prerendered shell. Read the clock only after `requireUser()` /
  `requireAdmin()` (cookies) inside the Suspense child. Generate the order token in the client click handler.
- `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md` §`onNavigate`: closing a dialog when a link
  inside it is clicked.
- `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`: `PageProps<"/panel/…">` with
  `searchParams` as a Promise.

Every rule in `CRITIQUE.md` applies (R1–R7). This group adds **one migration** (three new tables, no change to existing
tables), **no new dependency** and **no new cron**.

---

## 1. Goal

What the owner was told: every critical ingredient gets a minimum stock level (daily usage × supplier lead time + a
margin). Once a week, staff or admin quickly count 10–15 critical items on the phone. The panel then builds an order
list per supplier and opens the supplier's WhatsApp with a ready Turkish message. When the supplier's Paraşüt invoice
arrives, it is compared with what was ordered (missing items, extra items, different price), and the order is closed.

Concretely:

1. **Kalemler** (admin): pick the tracked items. For each one there is a target stock (**Hedef**), suggested from usage
   and editable, plus a lead time, a preferred supplier and an order unit (koli, paket…) with its size. Defaults come
   from the data: usage from sales × recipes + recorded zayi/ikram, the supplier last bought from via the Paraşüt
   product links, and the unit and product name of that supplier's last invoice line.
2. **Hızlı sayım** (staff and admin, phone first): the tracked items only, in count units (KG, LT, ADET, DİLİM), separate
   from the month-end Stok sayımı. Before counting, staff answer "Gelen mal var mı?" for open orders (due or early).
3. **Mal siparişi** (admin): the order list grouped by supplier. Suggested quantity = Hedef − Eldeki − Siparişte,
   rounded to the order unit. Quantities can be edited. **WhatsApp ile gönder** opens `wa.me` with the message for the
   phone on the supplier's card. A missing or landline phone is handled. The order is saved: sent at, lines, status.
4. **Teslim kontrolü** (admin): when a Paraşüt invoice of that supplier arrives (daily sync, or "Şimdi eşitle"), its
   lines are matched to the open order through the product → ingredient links and their factors. Rows read Tamam / eksik
   / gelmedi / fazla / fiyat farkı / siparişte yoktu. A clean match closes the order by itself. Differences show on the
   supplier page, in **Gönderilenler**, in the bell and on Bugün until the owner closes the order.
5. Usage is computed behind a **seam**. It uses the monthly ModPOS report today and the daily ModPOS product sales
   later, when that export exists. There is no import now.

Staff never see a price, an amount or a cost anywhere in this feature.

### Example (what the owner sees in a normal week)

- **Monday 26 Oct, 10:30.** Ayşe opens Bugün, where the row reads "Haftalık hızlı sayım · Bugün", and taps it. She marks
  last Thursday's Sütaş order as arrived ("Geldi"), counts 14 items and saves.
- **Monday 10:45.** The owner opens Mal siparişi:
  - Sütaş card: "Süt %2,5 yağlı 1 L: 2 koli". Eldeki 6 LT, hedef 26 LT.
  - Kaldi card: "Espresso Çekirdeği 1 KG: 5 adet". Az kaldı: eldeki 1 KG, en az 1,3 KG, hedef 6 KG.
  - The owner taps WhatsApp ile gönder on each card. WhatsApp opens with the message, the owner sends it, and both
    orders are saved as "Yolda".
- **Wednesday 07:30.** Paraşüt brings Kaldi's e-invoice and its lines are read. The order is compared:
  - Espresso: 4 instead of 5 (**1 adet eksik**).
  - Price +%6 against the last Kaldi invoice.

  The bell shows "Teslim kontrolü: Kaldi". The supplier page and Gönderilenler show the table. The owner calls Kaldi,
  then taps **Kapat** with the note "eksik 1 kg cuma gelecek".
- **The Sütaş invoice matches exactly**, so that order closes by itself ("Faturayla tuttu").

---

## 2. Decisions made here (so the implementer does not re-decide)

### D1. Names

The word "Sipariş" alone already means customer app orders: Karaoke › uygulama siparişleri, `src/lib/site-orders`,
`docs/SITE-SIPARIS.md`. This feature therefore uses **"Mal siparişi"** in the UI, `reorder` in code and
`docs/MAL-SIPARISI.md` for docs.

| Thing | UI name | Code |
|---|---|---|
| Order list screen | **Mal siparişi** | `/panel/siparis` |
| Weekly count | **Hızlı sayım** | `/panel/hizli-sayim`, table `quick_counts` |
| Sent orders | **Gönderilenler** | `/panel/siparis/gonderilen`, table `supplier_orders` |
| Tracked items | **Kalemler** | `/panel/siparis/kalemler`, table `reorder_items` |
| Invoice comparison | **Teslim kontrolü** | `src/lib/reorder/delivery.ts` |
| Target stock | **Hedef** (order up to) | `parBase` |
| Minimum | **En az** ("Az kaldı" below it) | computed, not stored |
| Ordered, not in the count | **Siparişte** | computed |

### D2. Roles

| | Admin | Staff |
|---|---|---|
| Hızlı sayım (count, edit today's counts) | yes | yes |
| "Gelen mal var mı?" → **Geldi** | yes | yes |
| Mal siparişi list, sending, Gönderilenler, Kalemler, Teslim kontrolü, bell items | yes | **no** |
| Sees prices or amounts | yes (estimates, price differences) | **never** |

Staff can count without seeing the list. The owner keeps control of spending, because the panel never sends anything
on its own and only the admin opens WhatsApp. Letting staff send orders is owner question 1, default **no**. The
loaders already separate the price fields (§6.2), so it can be enabled later.

### D3. Formulas (all quantities in the ingredient's own unit: gr / ml / adet / dilim)

- **Günlük kullanım** `perDay` = (sales usage + online usage + recorded zayi + recorded ikram of the reference month) ×
  `scale` ÷ 30.
  - `scale` = `settings.acikGun ÷ openDays`, the same as insight's `salesBasis`, so "per month" means the same thing
    everywhere (R4).
  - Reference month = `latestSalesMonth(model)`.
  - This is the Tutarlılık "beklenen tüketim" (`posUsage + onlineUsage`) plus the waste that Tutarlılık shows
    separately.
  - The general fire setting is **not** added: the margin covers unrecorded loss.
- **coverDays** = the longest gap between consecutive count weekdays. One count day a week gives 7, Monday + Thursday
  gives 4. Each order has to last until the next count.
- **leadDays** = item's `leadDays` ?? the most common `leadDays` among tracked items of the same resolved supplier ??
  `settings.defaultLeadDays` (2).
- **En az** `min` = perDay × leadDays × (1 + margin). Below it the line is **Az kaldı**: the stock runs out before an
  order placed now can arrive.
- **Hedef** `par` = `parBase` (typed by the owner) ?? `roundCount(perDay × (leadDays + coverDays) × (1 + margin))`.
  - `margin` = `settings.marginPct` (default 0.20).
  - When perDay is unknown or 0 and nothing is typed, the status is "Hedef yok".
- **Eldeki** `onHand` = the newest of:
  - the latest Hızlı sayım row (`quick_counts`, `qty × factor`, at `countedAt`);
  - the current or previous month's Stok sayımı row (`stock_counts`, `qty × factor`, at `monthEndCountAt(month,
    updatedAt)`: `updatedAt`, but no later than next month's 1st 05:00 TR − 1 ms; a newer quick count wins, deliveries
    after it stay Siparişte).

  The month-end count therefore also refreshes the order list.
- **Siparişte** `onOrder` = Σ base quantity of the item's lines in orders that are:
  - not cancelled;
  - sent within the last 14 days (`IN_TRANSIT_DAYS`) or expected no earlier than yesterday (`IN_TRANSIT_GRACE_DAYS`);
  - not yet in the count. That means not received at all, or received (marked "Geldi", or invoice matched) **after**
    `onHand.at`.

  The goods are on order or arrived after the count, so they are not in Eldeki.
- **need** = par − onHand − onOrder.
- **Önerilen** `packs` = `packsFor(need, orderUnitSize, critical)`:
  - need ≤ 0 gives 0;
  - otherwise p = need ÷ size, then `floor(p)`, plus 1 when the fraction is ≥ 0.25 (`MIN_PACK_FRACTION`);
  - if the line is Az kaldı (`onHand < min`) and the result is 0 while need > 0, the result is 1.

  Big packs (a 5,000-cup box) are then ordered only when actually needed.
- **roundCount**: KG and LT round **up** to 0.5, ADET and DİLİM round up to a whole number, in count units and stored in
  base.
- **Stale count**: `onHand.at` older than 4 days (`STALE_DAYS`) marks the line "Sayım eski". The suggestion is still
  computed, and a banner asks for a count.

Worked numbers (Excel seed, Eylül 2026, 30 open days, scale 1):

- **Süt %2,5**: 80.68 L/ay → 2.69 L/gün. Sütaş lead 1, cover 7, margin 20%.
  - Hedef = 2.69 × 8 × 1.2 = 25.8 → **26 LT**; en az = 2.69 × 1 × 1.2 = **3.2 L**.
  - Eldeki 6 LT gives need 20 L. With "koli = 12 LT": 1.67 → **2 koli**. With "adet = 1 LT": **20 adet**.
- **Espresso çekirdeği**: 16.3 kg/ay → 0.543 kg/gün. Kaldi lead 2.
  - Hedef = 0.543 × 9 × 1.2 = 5.87 → **6 KG**; en az **1.3 KG**.
  - Eldeki 2.5 KG gives need 3.5 → 1 kg bags → **4 adet**.

### D4. Count days and reminders

- `reorder.settings.countWeekdays` (1 = Pazartesi … 7 = Pazar), default `[1]`.
- On a count day there is a Bugün row (both roles) and one Web Push to devices with "Sabah özeti" on (the existing
  `reminders` topic). The push goes out from the daily `gunluk` job, since Hobby allows daily crons only.
- **No quick count on the month's last day**: the month-end Stok sayımı replaces it. Its rows feed Eldeki (D3), so no
  Bugün row and no push that day.
- A count is overdue when the last quick count is older than `coverDays + 1` days. The Bugün row then reads "Gecikti"
  on any day.

### D5. Supplier of an item (identity and default)

- Stored as a **name** in `reorder_items.supplier` (nullable). It is resolved at read time with the same resolver
  Tedarikçiler uses, so renames (old name → alias) and VKN grouping keep working. This follows the codebase rule that
  invoices reach cards by name.
- Default when the column is null (in this order):
  1. the supplier of the newest paid, linked Paraşüt line for this ingredient (pricing's `supplierPriceRows`, the row
     with the newest `last.date`). Label: "son alınan".
  2. `ingredients.supplier` (the Excel text): exact key match against the supplier groups, else `sameSupplier()`
     (`src/server/parasut/mapping.ts`) against exactly one group. Label: "Hammaddeler'deki tedarikçi".
  3. none: the item goes to the "Tedarikçisi seçilmemiş" group (no send button).
- Phone, contact name and slug come from the resolved group's card (`suppliers.phone`, `contactName`). Cardless suppliers
  have no phone.

### D6. Order unit and name in the message

- Default (when `reorder_items.order_unit` / `order_unit_size` are null): the preferred supplier's newest linked line,
  with unit `parasut_bill_lines.unit` lower-cased in Turkish ("Koli" → "koli", "Adet" → "adet") and size =
  `parasut_product_links.factor`. With no linked line it is "paket" with size = `ingredients.packageSize`.
- Default name in the message: that line's `productName` (the supplier's own name for it), else
  `ingredients.packageDesc`, else `ingredients.name`.
- All three are editable in Kalemler.

### D7. Sending and the order record

- The order is saved when the admin taps **WhatsApp'ta aç** in the send dialog. The link is an `<a target="_blank">` whose
  `onClick` starts `recordOrderSent` without waiting, so the browser's navigation is never blocked. The client-made
  `token` (`crypto.randomUUID()` in the click handler) makes retries and double taps idempotent (unique index).
- If saving fails, the toast offers **Yeniden dene** with the same token.
- **Metni kopyala** does not save. Its toast offers **Gönderildi say**, which saves with `channel = "kopya"`.
- Status (stored): `open` | `closed` | `cancelled`.
- Display state (pure `orderState`):
  - Yolda
  - Gecikti
  - Geldi · fatura bekleniyor
  - Fatura geldi · kalemler okunmadı
  - Fatura geldi · {fark}
  - Kapandı
  - İptal
- `expectedOn` = sent day (TR) + the largest lead time among the order's lines.

### D8. Delivery check (Teslim kontrolü)

- Matching runs **inside the Paraşüt sync** after `applyProductLinks`, and after product links are saved. It is
  non-fatal: a failure never fails the sync. It runs only for `open` orders sent within the last 60 days.
- **Candidate invoice**:
  - same resolved supplier (name, and VKN when 5 is on the branch);
  - category in `LINKABLE_CATEGORIES` and not `SEPARATE_CATEGORIES`;
  - date within [sent day, sent day + 10] (`MATCH_DAYS`);
  - not already linked to another order;
  - has lines (`parasut_bill_lines`), **or** has been without lines for ≥ 3 days (paper or manual invoice).
- **Choice**: the invoice whose linked ingredients overlap the order's lines most. Ties go to the date closest to
  `expectedOn`, then to the lowest id. An invoice with lines but **zero overlap** never matches, because it is another
  delivery.
- One invoice ↔ one order (a partial unique index). The owner can override with **Faturayı değiştir** (`manualMatch`);
  the automatic matcher then leaves that order alone.
- **Comparison** happens in base units through each line's link factor, so "units" are handled. Order rows:
  - `gelmedi` (0 delivered);
  - `eksik` (< 98 %);
  - `fazla` (> 102 %);
  - `tamam`.

  Price: the delivered unit price (Σ net ÷ Σ base of paid lines) against `expectedUnitPrice` stored on the order line
  (the last price from this supplier at send time, else the recipe unit cost). Outside ±3 % gives **fiyat farkı**.
  Invoice-only rows:
  - `siparis-disi`: linked to an ingredient that was not ordered;
  - `bagli-degil`: product not linked to any ingredient.
- **Auto-close** when lines have been read and every ordered row is `tamam`, there is no price flag and no `siparis-disi`
  row. `bagli-degil` alone does not block it (shipping lines and the like). The close note is "Faturayla tuttu",
  closed by "Sistem".
- Matched or marked orders get `receivedAt` = the invoice date at 12:00 TR when it is empty.
- Orders open more than 45 days with no invoice auto-close with the note "45 günde fatura gelmedi".

### D9. Where this shows up (and where it deliberately does not)

| Surface | What |
|---|---|
| Kenar çubuğu / ⌘K | Stok › Hızlı sayım (both roles), Stok › Mal siparişi (admin) |
| Bugün | `hizli-sayim` row (both roles), `siparis` row (admin) |
| Bell (admin, group `fatura`) | Teslim kontrolü differences; overdue deliveries |
| Web Push | Count-day morning push (`reminders` topic) |
| Tedarikçi page | "Siparişler" card |
| Paraşüt sync summary | `"{n} sipariş faturayla karşılaştırıldı"` |
| **Not touched** | Genel bakış, morning e-mail (digest), bottom bars, Faturalar, Tutarlılık, Stok sayımı |

---

## 3. User-facing behaviour (exact Turkish texts)

Mobile first (390 px): one column, 44 px touch targets (`pointer-coarse:min-h-11`), dialogs open as bottom sheets
(`Dialog`). Desktop: the same cards, wider.

### 3.1 Navigation and roles

- `NAV_GROUPS` › "Stok", after "Stok sayımı":
  - `{ href: "/panel/hizli-sayim", label: "Hızlı sayım", icon: ListChecks, roles: ["admin","staff"], keywords: "haftalık sayım kritik kalem eldeki stok sipariş öncesi" }`
  - `{ href: "/panel/siparis", label: "Mal siparişi", icon: ShoppingBasket, roles: ["admin"], keywords: "sipariş öneri tedarikçi whatsapp hedef stok en az teslim kontrolü eksik fazla fiyat farkı" }`
- `NAV_TREE` › `stok.children`, in this order:
  - `sayim` (both)
  - **`hizli-sayim`** `{ id: "hizli-sayim", label: "Hızlı sayım", href: "/panel/hizli-sayim", roles: ["admin","staff"] }`
  - **`siparis`** `{ id: "siparis", label: "Mal siparişi", href: "/panel/siparis", roles: ["admin"] }`
  - `zayi`
  - `tutarlilik`

  Staff see Stok › Stok sayımı, Hızlı sayım, Zayi & ikram.
- `SECTION_TABS.siparis`:
  - `{ href: "/panel/siparis", label: "Sipariş listesi" }`
  - `{ href: "/panel/hizli-sayim", label: "Hızlı sayım" }`
  - `{ href: "/panel/siparis/gonderilen", label: "Gönderilenler" }`
  - `{ href: "/panel/siparis/kalemler", label: "Kalemler" }`

  Admin pages render `<SectionTabs section="siparis" current=… />`. The Hızlı sayım page renders tabs for the admin
  only, the same way `sayim/page.tsx` does today.
- `SHORT_TITLES`:
  - `"/panel/siparis": "Mal siparişi"`
  - `"/panel/siparis/gonderilen": "Gönderilenler"`
  - `"/panel/siparis/kalemler": "Sipariş kalemleri"`

  "Hızlı sayım" comes from NAV_GROUPS.
- `src/lib/roles.ts`: `STAFF_PATHS` gains `"/panel/hizli-sayim"`. `/panel/siparis/**` stays admin-only, so the proxy
  sends staff to `STAFF_HOME`.
- `BOTTOM_NAV` is unchanged. Staff reach Hızlı sayım from Bugün, from the push, or from the drawer.
- Icons: `ListChecks` and `ShoppingBasket` from lucide-react. `Truck` stays with Tedarikçiler.

### 3.2 Hızlı sayım (`/panel/hizli-sayim`, both roles)

`PageHeader`:
- eyebrow "Stok", title "Hızlı sayım";
- description: `"Haftalık kısa sayım: {T} kritik kalem. Miktarı sayım biriminde yazın (KG, LT, ADET, DİLİM); yarım = 0,5. Ay sonu sayımı ayrıdır."`
- tabs for the admin only;
- action (admin only): `ButtonLink` "Sipariş listesi" → `/panel/siparis`.

Suspense fallback: the same header with description "Yükleniyor…" and `PageSkeleton rows={8}`.

1. **Status strip** (text-sm, muted, wraps):
   - `Bugün sayım günü` (amber badge) **or** `Sıradaki sayım: {longDateTR(next)}`.
   - `Son sayım: {longDateTR(day)} · {name}` or `Henüz hızlı sayım yok`.
   - On the month's last day: `Bugün ay sonu: Stok sayımı bu sayımın yerine geçer.` with a link "Stok sayımı →"
     (`/panel/sayim`).
2. **"Gelen mal var mı?"** card. It is shown for open orders that are not received and not matched, whatever their
   `expectedOn` (an early delivery is marked the day it arrives), sorted by `expectedOn`, then `sentAt`.
   - Icon `PackageCheck`, title "Gelen mal var mı?".
   - Description: `"Sayımdan önce gelenleri işaretleyin; işaretlenmezse sipariş listesinde ikinci kez sayılır."`
   - One row per order:
     - `{supplier} · {dateTR(sentDay)} siparişi` (bold), plus a muted ` · {dateTR(expectedOn)} bekleniyor` when
       `expectedOn > today`;
     - under it (xs): `{orderName} {qtyLabel}` joined with ", " (at most 3, then " ve {k} kalem daha");
     - right: secondary `Button` **Geldi**, 44 px on phones.
   - Tap: optimistic remove, `markOrderReceived({ id, received: true })`, toast `"{supplier} siparişi geldi"` with
     **Geri al**, which calls `markOrderReceived({ id, received: false })`.
   - No "Gelmedi" button: leaving it untouched means it has not arrived.
3. **Count list.** One `Card` per `countGroup` (the shelf order of Stok sayımı, sorted by `sortOrder`). Header: group
   name plus meta `"{n} / {k}"`. Rows:
   - Left: name; under it `packageDesc` (xs, muted).
   - Right: `NumberInput` (`inputMode="decimal"`, w-24) with the count unit suffix.
   - Under the row (xs):
     - `Geçen: {countText(qty)} {unit} · {dateTR(day)}` or `Daha önce sayılmadı`;
     - if today's row exists: green `Bugün kaydedildi · {name} {HH:MM}`;
     - if `unusualCount(value, last)` (reused from `sayim/logic.ts`): amber `Geçen sayımın 5 katından fazla: doğru mu?`
       or `Geçen sayımın beşte birinden az: doğru mu?`.
   - Enter moves to the next box (copy `focusNext` from `stock-form.tsx`).
4. **FloatingBar** (bottom; shows when something changed): `"{n} / {T} kalem"` + primary **Kaydet** (`Save` icon).
   - Admin success toast: `"{n} kalem kaydedildi"` with action **Sipariş listesi** (`router.push("/panel/siparis")`).
   - Staff success toast: `"{n} kalem kaydedildi"`, description `"Teşekkürler; sipariş listesi yöneticide hazır."`.
   - Conflict: the same rule and message as `saveStockCounts`: `"{adlar} bu arada başkası tarafından kaydedildi;
     hiçbir şey kaydedilmedi. İşaretli satırları kontrol edip yeniden kaydedin."`. The form uses `mergeCounts`.
   - Clearing a box deletes today's row for that item.
5. **Empty** (`EmptyState`, icon `ListChecks`, title "Sayılacak kalem seçilmemiş"):
   - admin: description `"Sipariş önerisi için 10–15 kritik kalem seçin."` + `ButtonLink` "Kalemleri seç" →
     `/panel/siparis/kalemler`;
   - staff: `"Yönetici kalemleri seçince burada görünür."`.

No price, amount or `unitPrice` reaches this page (§9 source test). Personel can only write today's business day
(`businessDate`, 05:00 rollover).

### 3.3 Mal siparişi (`/panel/siparis`, admin)

`PageHeader`:
- eyebrow "Stok", title "Mal siparişi", tabs "siparis";
- action: `ButtonLink` "Hızlı sayım" (`ListChecks`). Primary when stale or no count, secondary otherwise.
- description, one of:
  - `"Son hızlı sayım: {longDateTR(day)} {HH:MM} · {name} · {n} / {T} kalem. Öneri = hedef − eldeki − siparişte, sipariş birimine yuvarlanır."`
  - `"Henüz hızlı sayım yok. Önce kritik kalemleri sayın; liste sayıma göre hazırlanır."`

**Banners** (`role="status"`, the same style as the Tedarikçiler "listeden kaldırıldı" strip):
- Stale (> 4 days): `"Son sayım {k} gün önce: öneri eski stoka göre. Hızlı sayım yapın →"` (link).
- Old usage basis (reference month older than two months before the current month): `"Günlük kullanım {monthLabel}
  satışlarından; yeni satış raporu yükleyince öneriler güncellenir."` (link "Satışlar →").

**Empty** (no tracked items): `EmptyState` icon `ShoppingBasket`.
- Title `"Takip edilen kalem yok"`.
- Description `"Sipariş önerisi için önce 10–15 kritik kalem seçin: çabuk biten, pahalı ya da geç gelen. Önerilen kalemler satışlara göre hazır."`
- Action `ButtonLink` "Kalemleri seç" → `/panel/siparis/kalemler`.

**One card per supplier** (`id="tedarikci-{slug}"`, `scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]`). Order: suppliers
with suggested lines first (by name), then the rest, then the unassigned group.

- `CardHeader`:
  - icon `Truck`;
  - title: supplier name as a `Link` to `/panel/tedarikciler/{slug}` (cardless suppliers also have a slug);
  - meta: `"{k} kalem · ~{tl(estimate)}"`, with an `InfoTip` "Son alış fiyatlarıyla, KDV hariç; faturadaki tutar
    farklı olabilir.";
  - badge when an order was sent since the last count: green `Gönderildi {HH:MM}`.
- Description: one of
  - `WhatsApp: {formatPhone} · {contactName}` + ` · teslim ~{dayName(addDays(today, lead))}`
  - `Telefon kayıtlı değil · teslim ~{…}`
  - `Kayıtlı numara cep telefonu değil · teslim ~{…}`
- **Line** (suggested, `packs > 0`), sorted Az kaldı first, then by name:
  - Row 1: name. Badges:
    - `Az kaldı` (red, when onHand < min);
    - `Sayım eski` (gray);
    - `Düzenlendi` (blue, when the qty differs from the suggestion).

    Right: a stepper `[−] {qty} {unit} [+]`. Buttons are 44 px; the center opens a small number input. The pattern is
    copied from `hatirlaticilar/reminder-sheet.tsx` (Minus/Plus). 0 is allowed.
  - Row 2 (xs, muted): `Eldeki {6} LT · hedef {26} LT` + ` · siparişte {12} LT` when > 0 + ` · ~{tl(lineEstimate)}`.
  - Row 3, only when Az kaldı (xs, text-bad): `En az {3,5} LT: yeni sipariş gelmeden bitebilir.`
- **Yeterli olanlar** (`<details>`, closed, summary `Yeterli olanlar ({m})`, 44 px): lines with `packs = 0`. Row 2 is:
  - `Yeterli · eldeki 20 LT / hedef 26 LT`;
  - or `Sayılmadı`;
  - or `Hedef yok: Kalemler'den girin`.

  The stepper starts at 0, so the owner can still add the line.
- **Footer** (phone: two equal buttons, `grid grid-cols-2 gap-2 sm:flex sm:justify-end`):
  - secondary **Metni kopyala**;
  - primary **WhatsApp ile gönder** (`MessageCircle`), which opens the send dialog.

  Both are disabled when no line has qty > 0, with the hint `"Gönderilecek kalem yok."`.
- **Unassigned group**:
  - title `"Tedarikçisi seçilmemiş"`;
  - description `"Kalemler'den tedarikçi seçin; seçilince bu kalemler o tedarikçinin listesine geçer."`;
  - lines as above, no footer.
- **"Siparişte" card** (bottom; only if there are open orders):
  - title `"Yoldaki siparişler ({n})"`;
  - rows: `{supplier} · {dateTR(sentDay)} · {state label}`, with a **Geldi** button when not received;
  - footer link "Gönderilenler →".

**Send dialog** (`Dialog` size md):
- Title `"{supplier} siparişi"`. Description `"{n} kalem · ~{tl(estimate)} (son fiyatlarla, KDV hariç)"`.
- **Kime** box (rounded, `bg-panel`). One of:
  - `WhatsApp: {formatPhone} · {contactName}` (ok).
  - amber: `"Tedarikçinin telefonu kayıtlı değil. WhatsApp açılınca kişiyi siz seçersiniz."`, link `"Telefonu
    ekle →"` (`/panel/tedarikciler/{slug}`; `onNavigate` closes the dialog first).
  - amber: `"Kayıtlı numara ({formatPhone}) cep telefonu değil; WhatsApp'ta kişiyi siz seçersiniz."` plus an `Ara`
    link (`telHref`).
- `Field` "Not (isteğe bağlı)", `Textarea` max 300, hint `"Mesajın sonuna eklenir, ör. “Perşembe sabah 10'dan önce”"`.
- "Mesaj" `<pre>` preview (the same class as the request dialog).
- Footer:
  - ghost "Vazgeç";
  - secondary "Metni kopyala";
  - primary `<a>` **WhatsApp'ta aç**. It closes the dialog on click and starts `recordOrderSent` (D7).
- Toasts:
  - saved: `"{supplier} siparişi kaydedildi"`, description `"Fatura gelince teslim kontrolü yapılır."`, action
    **Geri al**. Geri al calls `cancelOrder(id)` and then shows `"Sipariş iptal edildi"`.
  - failed: error text plus action **Yeniden dene**.
  - copy: `"Sipariş metni kopyalandı"` with action **Gönderildi say**.

**The message** (built by the pure `orderMessage`; the server stores the text the client opened):

```
Merhaba, *L'Affogato* siparişimiz:

• SÜT %2,5 YAĞLI 1 L: 2 koli
• SÜT LAKTOZSUZ 1 L: 1 koli

Not: Perşembe sabah 10'dan önce
Teşekkürler.
```

- The bold name is `reorder.settings.signature` (default `L'Affogato`).
- Lines appear in the order shown, and only those with qty > 0.
- Quantity: a whole number prints without decimals; otherwise `num(qty, 1)`.
- Units are lower-cased in Turkish.
- No prices.

**Link**:
- with a mobile number: `whatsappHref(phone, text)` (`tedarikciler/logic.ts`; only 5xx in TR);
- otherwise: `whatsappShareHref(text)`.

### 3.4 Gönderilenler (`/panel/siparis/gonderilen`, admin)

- `PageHeader`: eyebrow "Stok", title "Gönderilenler", description `"Panelden gönderilen mal siparişleri. Paraşüt
  faturası gelince kalem kalem karşılaştırılır; fark yoksa sipariş kendiliğinden kapanır."`, tabs "siparis".
- Filter (`Segmented`, query `?durum=`): **Açık ({n})** (default) · **Fark var ({k})** · **Kapanan** · **Tümü**.
  `?tedarikci={slug}` narrows to one supplier, with a chip `"{supplier} ×"`.
- The list shows the last 90 days plus every open order, newest first. **Order card** (`OrderCard`, a client component shared with the
  supplier page; `id="siparis-{id}"`). The hash anchor uses the `ListAnchor` pattern from `hammaddeler/list-anchor.tsx`.
  - Header: `{supplier}` (link) · `{dateTimeTR(sentAt)}` · `{sentByName}`. Right: state badge:
    - `Yolda · {dayName(expectedOn)} bekleniyor` (blue)
    - `Gecikti · {dateTR(expectedOn)} bekleniyordu` (amber)
    - `Geldi · fatura bekleniyor` (blue)
    - `Fatura geldi · kalemler okunmadı` (gray)
    - `Fatura geldi · {checkSummary}` (red when eksik/gelmedi or the price went up, amber otherwise)
    - `Kapandı` (+ ` · {closeNote}`; green)
    - `İptal` (gray)
  - Before matching, a table `Kalem | Sipariş | Tahmini`, e.g. `Süt %2,5 yağlı 1 L | 2 koli (24 LT) | ~1.244 ₺`.
  - After matching:
    - Line: `Fatura: {invoiceNo ?? "numarasız"} · {dateTR(invoiceDate)} · {tl(payable)}` + link "Faturayı aç" →
      `/panel/faturalar?ara={invoiceNo ?? supplier}#fatura-listesi`.
    - Table `Kalem | Sipariş | Faturada | Durum`. On phones each row stacks: name, then
      `{ordered} → {delivered} · {status}`.
    - Status texts:
      - `Tamam` (green)
      - `{x} {unit} eksik` / `Gelmedi` (red)
      - `{x} {unit} fazla` (amber)
      - `Siparişte yoktu` (amber)
      - `Hammaddeye bağlı değil` (gray) + link "Bağla →" → `/panel/parasut?durum=bekleyen&ara={productName}#urun-baglantilari`
    - Price note under a row when flagged: `Fiyat +%6 (51,85 → 54,90 ₺/L)`, red when up and green when down. Units
      (₺/kg, ₺/L, ₺/adet) come from pricing's `bulkUnit`.
    - Hints (amber, xs):
      - `Faturadaki miktar siparişin yaklaşık 12 katı: ürün bağlantısının çarpanı yanlış olabilir.` (`ratioHint`)
      - `Fatura birden çok siparişi kapsıyor gibi (toplu fatura); farkları buna göre değerlendirin.` (`looksConsolidated`)
  - Collapsible "Gönderilen mesaj" (`<details>`, the `<pre>` text, `channel` "WhatsApp" / "Kopyalandı").
  - Actions (phone: a wrapping row, 44 px):
    - **Geldi**: open, not received, no invoice.
    - **Kapat**: open. Opens `Dialog` sm:
      - title `"Sipariş kapatılsın mı?"`;
      - text `"{supplier} · {dateTR(sentDay)}: {checkSummary or state}. Kapatılınca açık listeden ve bildirimden kalkar; Kapananlar'da durur."`;
      - `Input` "Not (isteğe bağlı)" max 300, placeholder `"ör. eksik kalan cuma gelecek"`;
      - buttons "Vazgeç" / "Kapat".
    - **Faturayı değiştir**: open. Opens `Dialog` sm with a `Select`:
      - the supplier's invoices dated sent day − 3 … sent day + 30: `"{dateTR} · {invoiceNo ?? "numarasız"} · {tl(payable)}"`;
      - plus `"Fatura yok (eşleşmeyi kaldır)"`;
      - Save → `setOrderInvoice`, toast `"Teslim kontrolü yenilendi"`.
    - **İptal**: open, not received, no invoice. `ConfirmDialog`, title `"Sipariş iptal edilsin mi?"`, text
      `"Tedarikçiye ayrıca haber verin; panel yalnız kaydı iptal eder."`.
    - **Yeniden aç**: closed (not cancelled) within 30 days.

### 3.5 Kalemler (`/panel/siparis/kalemler`, admin)

`PageHeader`: eyebrow "Stok", title "Sipariş kalemleri", description `"Hızlı sayımda sayılan ve sipariş önerilen
kalemler, hedef stokları ve tedarikçileri."`, tabs "siparis".

1. **Card "Ayarlar"** (icon `Settings2`):
   - **Sayım günleri**: seven toggle chips `Pzt Sal Çar Per Cum Cmt Paz` (at least one). Hint `"Hızlı sayım bu günlerde
     hatırlatılır (Bugün ekranı ve telefon bildirimi). Sipariş bir sonraki sayıma kadar yetecek kadar önerilir: {coverDays} gün."`
   - **Emniyet payı** (%; 0–100; default 20). Hint `"Günlük kullanımın üstüne eklenir: satış dalgalanır, teslim gecikebilir."`
   - **Teslim süresi** (gün, 0–30; default 2). Hint `"Kalemde ya da tedarikçide yazılmamışsa."`
   - **Mesajdaki ad** (max 60; default "L'Affogato"). Hint `"WhatsApp mesajında “Merhaba, {ad} siparişimiz:” diye geçer."`
   - Button "Kaydet" → toast `"Sipariş ayarları kaydedildi"`.
2. **Card "Takip edilen kalemler"** (meta `"{n} kalem"`):
   - Description: `"10–15 kritik kalem yeterli: çabuk biten, pahalı ya da tedarikçisi geç getiren."`
   - Basis line (xs, muted). One of:
     - `"Günlük kullanım: {Eylül 2026} satışları (ModPOS + online) ve kayıtlı zayi / ikram; ayda {30} açık güne göre, 30 güne bölündü. Tutarlılık'taki beklenen tüketimle aynı hesap."`
     - daily basis: `"Günlük kullanım: son {28} günün günlük satışları (ModPOS) ve kayıtlı zayi / ikram."`
     - `"Satış verisi yok: hedefleri elle girin."`
   - Grouped by resolved supplier. Group header: `{supplier} · teslim {lead} gün` plus a ghost button "Teslim süresi".
     It opens a tiny `Dialog` sm with one `NumberInput` and the hint `"Bu tedarikçinin {k} kalemine yazılır."`
     (`setLeadDays`).
   - Row (a button; opens the edit dialog):
     - Name, then badges `Elle` (when `parBase` is set) and `Tedarikçi seçilmedi` (amber).
     - Right: `Hedef {26} LT`.
     - xs, one of:
       - `Günde ~{2,7} L · en az {3,5} LT · 1 {koli} = {12} LT · {Sütaş · son alınan}`
       - `Satış verisi yok · hedef elle`
3. **Edit dialog** (`Dialog` md; title = ingredient name; description `"{packageDesc} · sayım birimi {countUnit}"`):
   - **Tedarikçi** `Select`:
     - `"Varsayılan: {Sütaş} (son alınan, 14.10.2026)"` (value "");
     - optgroup "Bu kalemi satanlar": `"{name} · son {dd.mm.yyyy} · {31,20 ₺/kg}{ · en ucuz}"` from `supplierPriceRows`;
     - optgroup "Diğer tedarikçiler": every supplier group with a card, by name.

     Hint for a stored name that no longer resolves: `"“{name}” adlı tedarikçi bulunamadı; yeniden seçin."`.
   - **Tedarikçideki adı** `Input`, placeholder = the default (D6). Hint `"WhatsApp mesajında bu ad yazılır."`
   - **Sipariş birimi** `Input` (placeholder default, e.g. "koli") + **1 birim =** `NumberInput` with the count unit
     suffix (placeholder the default size in count units). Hint `"Son faturada: {120} {Adet}, 1 {Adet} = {1} LT"` or
     `"Paket: {packageDesc}"`.
   - **Teslim süresi (gün)** `NumberInput`, placeholder the inherited value. Hint `"Boşsa {Sütaş}'ın diğer kalemlerinden / genel ayardan: {1} gün"`.
   - **Hedef stok** `NumberInput` with the count unit suffix, placeholder the suggestion. Hint:
     - `"Öneri: {26} LT = günde {2,7} L × ({1} gün teslim + {7} gün sayım aralığı) × {1,2}. Boş bırakılırsa öneri kullanılır."`
     - or `"Satış verisi yok: hedefi elle girin."`

     Ghost button "Öneriyi kullan" clears the field.
   - Read-only line: `"En az: {3,5} LT. Eldeki bunun altına inince listede “Az kaldı” yazar."`
   - Optional hint (cuttable, §12): when Tutarlılık has a complete stock comparison for the basis month and
     `actualUsage > 1.15 × usage`: `"Sayıma göre {Eylül}'de gerçek tüketim {92} L (reçeteye göre {81} L): hedefi biraz artırmayı düşünün."`
   - `footerStart`: ghost danger **Takipten çıkar**. Toast `"{name} takipten çıktı"` with Geri al
     (`restoreReorderItem`).
   - Footer: "Vazgeç", "Kaydet". Toast `"{name} kaydedildi"`.
4. **Card "Eklenebilecek kalemler"**:
   - Description: `"Ayda en çok tutan, sayım birimi olan ve henüz takip edilmeyen kalemler (satış ve reçeteye göre)."`
   - Up to 15 rows: `{name} · ayda ~{tl(monthly cost)}` + secondary **Ekle**. Header button **Hepsini ekle ({k})**.
   - Below: a `SearchInput` over all active countable untracked ingredients, each with **Ekle**.
   - Toast `"{k} kalem eklendi"`.
   - Water/ice and items without a count unit are never listed. The text under the search reads `"Listede yoksa
     Hammaddeler'den sayım birimi seçin."`.

### 3.6 Tedarikçi sayfası (`/panel/tedarikciler/[cari]`): card "Siparişler"

- Rendered between "Tedarikçi bilgileri" and "Faturalar", only when this supplier has orders in the last 90 days **or**
  has tracked items.
- Card `id="siparisler"`, icon `ShoppingBasket`, title "Siparişler", meta `"{n} açık"`. Description `"Panelden
  WhatsApp ile gönderilen siparişler; fatura gelince kalem kalem karşılaştırılır."`.
- Header actions:
  - `ButtonLink` "Sipariş listesi" → `/panel/siparis#tedarikci-{slug}`, when the supplier has tracked items;
  - "Tümü →" → `/panel/siparis/gonderilen?tedarikci={slug}&durum=tumu`.
- Body: the 3 newest orders as compact `OrderCard`s (same component and actions). Open orders with differences come
  first.

### 3.7 Bell (admin, group `fatura`, at most 5 items)

| id | kind | title | body | href |
|---|---|---|---|---|
| `teslim-{orderId}-{issuesKey}` | warning | `Teslim kontrolü: {supplier}` | `{dateTR(sentDay)} siparişi · {checkSummary} · fatura {dateTR(invoiceDate)}` | `/panel/siparis/gonderilen#siparis-{id}` |
| `siparis-gelmedi-{orderId}` | info | `Sipariş gelmedi mi: {supplier}` | `{dateTR(sentDay)} gönderildi, {dateTR(expectedOn)} bekleniyordu. Geldiyse işaretleyin.` | same |

- `issuesKey` = the counts joined (`e2-f0-p1-d0`), so a changed check shows as unread again.
- "Gelmedi" applies when the order is open, not received, has no invoice, and today > `expectedOn` + 1.
- Staff get nothing; the staff branch is untouched (R5).

### 3.8 Bugün rows (today's `dayTasks`)

Positions:
- admin: `… zam, sayim-gecen, **hizli-sayim**, **siparis**, kasa, sayim-son`;
- staff: `kasa-dun, sayim-gecen, **hizli-sayim**, zayi, kasa, sayim-son`.

| Key | Role | Rule → status, title, badge, detail, href, action |
|---|---|---|
| `hizli-sayim` | Both | Shown only if `total > 0` and the day is not the month's last day, and either it is a count day **or** the count is overdue (`lastCountDay` older than `coverDays + 1` days). Title "Haftalık hızlı sayım". `countedToday ≥ total` → `done`, `"{T} kalemin hepsi sayıldı."` (admin adds `" Sipariş listesi hazır."`); admin `/panel/siparis` "Sipariş listesi", staff `/panel/hizli-sayim` "Sayımı aç". `0 < n < T` → `todo`, badge `"{n} / {T}"`, `"{n} / {T} kalem sayıldı; kalanları da girin."`, `/panel/hizli-sayim`, "Sayıma devam". `n = 0` on a count day → `todo`, badge "Bugün", `"Bugün hızlı sayım günü: {T} kritik kalemi sayın; sipariş listesi sayıma göre hazırlanır."`, "Sayıma başla". `n = 0` and overdue → `todo`, badge "Gecikti", `"Son hızlı sayım {longDateTR(last)} ({k} gün önce). Sipariş önerisi eski stoka göre."`, "Sayıma başla". `countedToday` also counts tracked items whose month-end instant (`monthEndCountAt`) falls on today's business day; a previous month's row typed today does not count |
| `siparis` | Admin | The first that applies. (1) Delivery differences → `warn`, "Teslim kontrolü", badge `"{n} sipariş"`, detail `"{supplier}: {checkSummary}"` for the first two joined with "; " + `"…"`, `/panel/siparis/gonderilen`, "Kontrol et". (2) Ready list → `todo`, "Mal siparişi", badge `"{s} tedarikçi"`, `"{lines} kalem sipariş öneriliyor: {first 3 suppliers}{…}. WhatsApp'tan tek dokunuşla gönderin."`, `/panel/siparis`, "Listeyi aç". (3) Late deliveries → `todo`, "Gelmeyen sipariş", badge `"{n}"`, `"{n} sipariş beklenen günde gelmedi; geldiyse işaretleyin."`, `/panel/siparis/gonderilen`, "Bak". Otherwise no row. "Ready" means: the last count is from today or yesterday, and there are suppliers with `packs > 0` that have had no order sent since that count |

### 3.9 Count-day push (daily job)

On a count day (D4), when tracked items exist and fewer than all are counted today, `pushCountDay()` sends to the
`reminders` topic (all active users with "Sabah özeti" on):
- title `"Bugün hızlı sayım günü"`;
- body `"{T} kritik kalem · telefondan birkaç dakika; sipariş listesi sayımdan hazırlanır"`;
- url `/panel/hizli-sayim`, tag `hizli-sayim-{day}`, ttl 8 h, urgency normal.

No amounts. A Hobby cron runs between 08:00 and 09:00 TR, which is fine for a reminder.

### 3.10 Paraşüt sync summary and activity log

- Sync summary part: `"{n} sipariş faturayla karşılaştırıldı"` (+ `" · {k} kendiliğinden kapandı"`), only when n > 0.
- `logActivity` actions (Turkish, `detail` ≤ 500):

| Action | Detail |
|---|---|
| `Hızlı sayım` | `"{n} kalem"` (+ `", {k} silindi"`) |
| `Sipariş gönderildi` | `"{supplier}: {k} kalem · WhatsApp"` / `"· kopyalandı"` |
| `Sipariş iptal edildi` | `"{supplier} {dd.mm}"` |
| `Sipariş geldi` / `Sipariş geldi işareti kaldırıldı` | `"{supplier} {dd.mm}"` |
| `Sipariş kapatıldı` / `Sipariş yeniden açıldı` | `"{supplier} {dd.mm}: {checkSummary}{ · not}"` |
| `Teslim kontrolü` (Sistem) | `"{supplier} {dd.mm} siparişi ↔ {invoiceNo}: {checkSummary}"`, written once per new match |
| `Sipariş kalemi` | `"{name}: hedef {26 LT}, teslim {1} gün, {Sütaş}"` |
| `Sipariş kalemleri` | `"{k} kalem eklendi"` / `"{name} takipten çıktı"` |
| `Sipariş ayarları` | `"Sayım: Pzt · pay %20 · teslim 2 gün"` |

---

## 4. Data model (`src/server/db/schema.ts`; one migration, generated at merge time)

Add a section `// ---------------------------------------------------------------- Mal siparişi (docs/MAL-SIPARISI.md)`
after `wasteEntries`. Turkish doc comments explain *why*. The jsonb types live in the pure `src/lib/reorder/types.ts`
and are imported **type-only and relative** (`import type { ReorderLine, DeliveryCheck } from "../../lib/reorder/types"`)
so drizzle-kit does not have to resolve the `@/` alias.

```ts
/**
 * Hızlı sayımda sayılan ve sipariş önerilen kalemler (10–15 kritik hammadde). Boş alanlar verilerden gelir: hedef
 * kullanımdan, tedarikçi son alınan Paraşüt faturasından, sipariş birimi ve adı o tedarikçinin son fatura kaleminden
 * (src/lib/reorder/levels.ts). Miktarlar malzemenin kendi biriminde (gr, ml, adet, dilim): sayım birimi sonradan
 * değişse de anlamı değişmez.
 */
export const reorderItems = pgTable("reorder_items", {
  ingredientId: integer("ingredient_id").primaryKey().references(() => ingredients.id, { onDelete: "cascade" }),
  /** Hedef stok (siparişle tamamlanacak miktar); boş = günlük kullanımdan önerilen */
  parBase: doublePrecision("par_base"),
  /** Teslim süresi (gün); boş = aynı tedarikçinin diğer kalemleri ya da genel ayar */
  leadDays: integer("lead_days"),
  /** Tercih edilen tedarikçinin adı (Tedarikçiler'deki gibi adla eşleşir); boş = son alınan */
  supplier: text("supplier"),
  /** Mesajda yazılacak ad (tedarikçinin ürün adı); boş = son fatura kalemi / paket açıklaması */
  orderName: text("order_name"),
  /** Sipariş birimi ("koli", "paket") ve 1 biriminin içeriği (kendi biriminde); boş = son faturadaki birim ve çarpan */
  orderUnit: text("order_unit"),
  orderUnitSize: doublePrecision("order_unit_size"),
  updatedBy: text("updated_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Haftalık hızlı sayım (ay sonu stok sayımından ayrı): kalem başına iş günü başına bir satır; aynı gün yeniden
 * kaydedilince güncellenir. Eldeki stok = en yeni hızlı sayım ya da ay sonu sayımı (hangisi yeniyse). Personel de yazar.
 */
export const quickCounts = pgTable(
  "quick_counts",
  {
    id: serial("id").primaryKey(),
    ingredientId: integer("ingredient_id").notNull().references(() => ingredients.id, { onDelete: "cascade" }),
    /** İş günü (YYYY-MM-DD, Türkiye; 05:00'te döner) */
    day: text("day").notNull(),
    /** Sayım birimindeki miktar ve sayıldığı andaki çarpanı (KG/LT = 1000) */
    qty: doublePrecision("qty").notNull(),
    factor: doublePrecision("factor").notNull(),
    countedAt: timestamp("counted_at", { withTimezone: true }).notNull().defaultNow(),
    countedBy: integer("counted_by").references(() => users.id, { onDelete: "set null" }),
    countedByName: text("counted_by_name").notNull(),
  },
  (t) => [uniqueIndex("quick_counts_ingredient_day_uq").on(t.ingredientId, t.day), index("quick_counts_counted_idx").on(t.countedAt)],
);

/**
 * Tedarikçiye gönderilen mal siparişi (WhatsApp ya da kopyalanan metin). Kalemler gönderim anının kopyası (jsonb):
 * hammadde sonradan değişse de siparişte ne istendiği okunur. Paraşüt faturası gelince eşitleme faturayı bağlar ve
 * kalem kalem karşılaştırır (check); fark yoksa sipariş kendiliğinden kapanır. Fiyatlar yalnız yöneticiye gösterilir.
 */
export const supplierOrders = pgTable(
  "supplier_orders",
  {
    id: serial("id").primaryKey(),
    /** İstemcinin ürettiği kimlik: çift dokunuş ya da yeniden deneme ikinci sipariş açmaz */
    token: text("token").notNull(),
    /** Tedarikçinin adı (gönderim anında; Tedarikçiler'deki gibi adla, varsa vergi noyla eşleşir) */
    supplier: text("supplier").notNull(),
    /** Mesajın gittiği numara (E.164); boş: kişi WhatsApp'ta seçildi ya da metin kopyalandı */
    phone: text("phone"),
    channel: text("channel", { enum: ["whatsapp", "kopya"] }).notNull(),
    message: text("message").notNull(),
    note: text("note"),
    lines: jsonb("lines").$type<ReorderLine[]>().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    sentBy: integer("sent_by").references(() => users.id, { onDelete: "set null" }),
    sentByName: text("sent_by_name").notNull(),
    /** Beklenen teslim günü (YYYY-MM-DD): gönderim günü + kalemlerin en uzun teslim süresi */
    expectedOn: text("expected_on").notNull(),
    status: text("status", { enum: ["open", "closed", "cancelled"] }).notNull().default("open"),
    /** Mal geldi: elle "Geldi" ya da eşleşen faturanın günü; sayımdan sonra gelen sipariş listede "siparişte" sayılır */
    receivedAt: timestamp("received_at", { withTimezone: true }),
    receivedByName: text("received_by_name"),
    /** Eşleşen Paraşüt / elle fatura; silinirse boşalır ve eşitleme yeniden arar */
    invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    /** Fatura elle seçildi ya da eşleşme elle kaldırıldı: eşitleme dokunmaz */
    manualMatch: boolean("manual_match").notNull().default(false),
    check: jsonb("check").$type<DeliveryCheck>(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByName: text("closed_by_name"),
    closeNote: text("close_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("supplier_orders_token_uq").on(t.token),
    // Bir fatura en çok bir siparişe bağlanır
    uniqueIndex("supplier_orders_invoice_uq").on(t.invoiceId).where(sql`invoice_id is not null`),
    index("supplier_orders_status_idx").on(t.status, t.sentAt),
  ],
);
```

**Migration**: `npm run db:generate -- --name mal_siparisi` at merge time (R2): rebase, restore the journal, regenerate,
review the SQL, `npm run db:migrate` on a fresh copy, run `tests/migrations.test.ts`. The SQL is additive (three
`CREATE TABLE` + indexes), so it is Instant-Rollback-safe (DEPLOY §7). Develop against
`DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_siparis` (R3).

**Settings** (no schema): `integration_state` key `reorder.settings`, value `{ countWeekdays: number[], marginPct:
number, defaultLeadDays: number, signature: string }`. Defaults are in `DEFAULT_REORDER`.

**db:reset (R7)**: `TRUNCATE … ingredients, invoices … CASCADE` also empties all three new tables (FKs to
`ingredients` / `invoices`), which is correct because the ids restart. `reorder.settings` survives (it carries no ids).
README's db:reset sentence gains "mal siparişi kalemleri, hızlı sayımlar ve gönderilen siparişler". No script change.

**Backup (R6)**: covered automatically. Re-run `YEDEK_TEST_DATABASE_URL=… npm test` after this merge.
`supplier_orders.lines` is a NOT NULL jsonb column (ops' COALESCE rule covers it).

**Retention**: none needed. About 15 × 52 quick-count rows and about 150 orders a year.

---

## 5. Pure logic (`src/lib/reorder/*`; no DB, no browser; unit-tested)

### 5.1 `src/lib/reorder/types.ts`

```ts
import type { Unit } from "../calc/types";

export interface ReorderSettings { countWeekdays: number[]; marginPct: number; defaultLeadDays: number; signature: string }
export const DEFAULT_REORDER: ReorderSettings = { countWeekdays: [1], marginPct: 0.2, defaultLeadDays: 2, signature: "L'Affogato" };

/** supplier_orders.lines: gönderim anının kopyası */
export interface ReorderLine {
  ingredientId: number; name: string; orderName: string;
  qty: number;            // sipariş biriminde (mesajdaki sayı)
  unit: string;           // "koli"
  unitSize: number;       // 1 birim = ? (kendi biriminde)
  baseUnit: Unit;
  leadDays: number;
  suggested: number | null;          // önerilen adet (düzenlendi mi)
  onHand: number | null; par: number | null; // gönderim anında (kendi biriminde)
  expectedUnitPrice: number | null;  // ₺ / kendi birimi, KDV hariç; yalnız yönetici görür
}

export type CheckStatus = "tamam" | "eksik" | "gelmedi" | "fazla" | "siparis-disi" | "bagli-degil";
export interface CheckRow {
  ingredientId: number | null; name: string; productNames: string[];
  ordered: number | null; delivered: number | null;         // kendi biriminde
  unit: string; unitSize: number; baseUnit: Unit | null;    // metin için (sipariş biriminde)
  status: CheckStatus;
  unitPrice: number | null; expectedUnitPrice: number | null; priceDiff: number | null; priceFlag: boolean;
  ratioHint: number | null;                                  // ≈ tam kat: çarpan yanlış olabilir
}
export interface DeliveryCheck {
  invoiceId: number; invoiceNo: string | null; invoiceDate: string; payable: number;
  linesRead: boolean; rows: CheckRow[];
  counts: { eksik: number; gelmedi: number; fazla: number; fiyat: number; disi: number; bagliDegil: number };
  ok: boolean; consolidated: boolean; at: string;
}
```

### 5.2 `src/lib/reorder/usage.ts`: the usage seam

```ts
export const DAYS_PER_MONTH = 30;
export interface UsageBasis { kind: "ay" | "gunluk"; label: string; month: string | null; from: string | null; to: string | null; openDays: number | null; scale: number }
export interface IngredientUsage { perDay: number; sales: number; online: number; waste: number }  // perDay: kendi biriminde / takvim günü
export interface UsageEstimate { basis: UsageBasis; byIngredient: Map<number, IngredientUsage> }

/** Bugünkü kaynak: ayın ModPOS satışı + online + kayıtlı zayi/ikram; ayda acikGun açık güne ölçekli, 30 güne bölünür. Satışsız ayda null */
export function monthlyUsage(model: Model, month: string | null): UsageEstimate | null;

/** ModPOS günlük ürün satışı (henüz yok; aktarım gelince sunucu doldurur) */
export interface DailyProductSale { date: string; productId: number; qty: number }
/**
 * Son `days` günün (varsayılan 28) satırlarından: ilk ve son veri günü arasındaki takvim günlerine bölünür; veri olan
 * gün `minCoverage`'dan (14) azsa null. Kayıtlı zayi/ikram aynı aralıktan (wasteBetween).
 */
export function dailyUsage(model: Model, sales: DailyProductSale[], opts: { today: string; days?: number; minCoverage?: number }): UsageEstimate | null;
/** Günlük yeterliyse günlük, değilse aylık */
export function pickUsage(daily: UsageEstimate | null, monthly: UsageEstimate | null): UsageEstimate | null;
/** Aralıktaki zayi/ikramın malzeme tüketimi (engine.recordedUsage'ın tarih aralıklı hâli; aynı kural) */
export function wasteBetween(model: Model, from: string, to: string): Map<number, number>;
```

`monthlyUsage` rules:

- `sb = salesBasis(model, month)` (insight, `src/lib/calc/price-loss.ts`). Map `sb.perMonth` (products incl. online
  mapped lines, already scaled) to ingredients with `model.itemsByProduct` × `model.evalQty(it).qty`.
- `sales` and `online` are reported separately: compute both from `model.ingredientUsage(month)` and
  `model.onlineUsage(month)` × `sb.basis.scale` (equal to the perMonth mapping; a test pins this).
- `waste` = (zayi + ikram of `model.recordedUsage(month)`) × scale.
- `perDay = (sales + online + waste) / DAYS_PER_MONTH`.
- `basis.label` = `"{monthLabel} satışları"`. Insight's basis line may carry the kasa open-day source (CRITIQUE kasa
  note 5); show it when present.
- **Fallback if insight is not on the branch:** `scale = st.acikGun / (model.monthInfo.get(month)?.openDays ||
  st.acikGun)`, usage = `ingredientUsage + onlineUsage`. Replace it with `salesBasis` at rebase.

### 5.3 `src/lib/reorder/levels.ts`

```ts
export const STALE_DAYS = 4, IN_TRANSIT_DAYS = 14, IN_TRANSIT_GRACE_DAYS = 1, MIN_PACK_FRACTION = 0.25, TRACK_SUGGEST_LIMIT = 15;

export function trWeekday(day: string): number;                       // 1 = Pazartesi … 7 = Pazar
export function coverDays(weekdays: number[]): number;                // en uzun ara; boş/tek gün → 7
export function isCountDay(day: string, s: ReorderSettings): boolean; // ayın son günü false (isLastDayOfMonth)
export function nextCountDay(day: string, s: ReorderSettings): string;   // bugün dahil değil
export function countOverdue(lastDay: string | null, today: string, s: ReorderSettings): number | null; // gecikme günü ya da null

export function roundCount(base: number, countFactor: number, countUnit: string): number;  // KG/LT 0,5'e, ADET/DİLİM tama yukarı; kendi biriminde döner
export function suggestedLevels(i: { perDay: number | null; leadDays: number; coverDays: number; marginPct: number; countUnit: string; countFactor: number }):
  { par: number; min: number } | null;
export function packsFor(need: number, unitSize: number, critical: boolean): number;

export interface OnHand { base: number; at: string; day: string; source: "hizli" | "ay-sonu"; by: string | null }
export function monthEndCountAt(month: string, updatedAt: Date): Date;   // updatedAt, capped at next month's 1st 05:00 TR − 1 ms
export function latestOnHand(quick: { qty: number; factor: number; countedAt: string; day: string; by: string } | null,
  monthEnd: { qty: number; factor: number; at: string; day: string; by: string | null } | null): OnHand | null;

export interface OrderLite { id: number; supplier: string; sentAt: string; sentDay: string; expectedOn: string; status: "open" | "closed" | "cancelled";
  receivedAt: string | null; invoiceId: number | null; manualMatch: boolean; lines: ReorderLine[]; check: DeliveryCheck | null;
  closedAt: string | null; closeNote: string | null; phone: string | null; channel: "whatsapp" | "kopya"; message: string; sentByName: string }
/** D3 "siparişte": iptal olmayan, son 14 gün, sayımda olmayan (gelmedi ya da sayımdan sonra geldi) */
export function onOrderFor(orders: OrderLite[], ingredientId: number, onHandAt: string | null, today: string): { base: number; orderIds: number[] };

export function inheritLeadDays(supplierKey: string | null, tracked: { supplierKey: string | null; leadDays: number | null }[], fallback: number): number;
export function defaultOrderUnit(link: { unit: string | null; factor: number } | null, ing: { packageSize: number }): { unit: string; size: number };

export interface PlanItem {
  ingredientId: number; name: string; baseUnit: Unit; countUnit: string; countFactor: number;
  supplierKey: string | null; leadDays: number; orderName: string; orderUnit: string; orderUnitSize: number;
  parBase: number | null; perDay: number | null; onHand: OnHand | null; onOrder: number; expectedUnitPrice: number | null;
}
export type PlanStatus = "siparis" | "yeterli" | "sayilmadi" | "hedef-yok";
export interface PlanLine extends PlanItem { par: number | null; parSource: "elle" | "oneri" | null; min: number | null; need: number;
  packs: number; status: PlanStatus; critical: boolean; stale: boolean; estimate: number | null }
export function planLine(item: PlanItem, settings: ReorderSettings, now: Date): PlanLine;
export function planGroups(lines: PlanLine[]): { supplierKey: string | null; lines: PlanLine[]; packs: number; estimate: number | null }[]; // atanmamış sonda
export function readySuppliers(groups: ReturnType<typeof planGroups>, orders: OrderLite[], lastCountAt: string | null): string[];

/** Takibe önerilen: sayım birimi olan, aktif, su değil, takipte olmayan; aylık tutara (perDay × 30 × birim maliyet) göre ilk 15 */
export function suggestTracked(items: { id: number; countable: boolean; tracked: boolean; perDay: number | null; unitCost: number }[], limit?: number): number[];
```

`planLine` rules:
- `sayilmadi` when `onHand` is null.
- `hedef-yok` when `par` is null.
- Otherwise `need = par − onHand.base − onOrder`; `packs = packsFor(…)`; status `siparis` when `packs > 0`, else
  `yeterli`.
- `critical = min !== null && onHand.base < min`.
- `stale = now − onHand.at > STALE_DAYS`.
- `estimate = expectedUnitPrice × packs × orderUnitSize`.

### 5.4 `src/lib/reorder/message.ts`

```ts
export function qtyLabel(qty: number, unit: string): string;   // "2 koli", "2,5 kg" (birim tr küçük harf)
export function orderMessage(o: { signature: string; lines: { orderName: string; qty: number; unit: string }[]; note?: string | null }): string;  // §3.3 metni, qty > 0 olanlar
export function orderLink(phone: string | null | undefined, text: string): { href: string; target: "numara" | "sec"; reason: null | "yok" | "sabit" };
// whatsappHref (cep) → numara; telefon boş → sec/"yok"; phoneE164 var ama cep değil → sec/"sabit" (whatsappShareHref)
export function dayName(day: string): string;   // "Perşembe" (tr-TR, Europe/Istanbul)
```

`tedarikciler/logic.ts`'s `whatsappHref`, `whatsappShareHref` and `phoneE164` are reused, not copied.

### 5.5 `src/lib/reorder/delivery.ts`

```ts
export const MATCH_DAYS = 10, LINELESS_WAIT_DAYS = 3, QTY_TOL = 0.02, PRICE_TOL = 0.03, AUTO_CLOSE_DAYS = 45, LATE_GRACE_DAYS = 1;

export interface InvoiceCandidate { id: number; date: string; supplierId: string; invoiceNo: string | null; payable: number;
  hasLines: boolean; ingredientIds: Set<number> }
export function pickInvoice(order: { sentDay: string; expectedOn: string; supplierId: string; ingredientIds: Set<number> },
  candidates: InvoiceCandidate[], taken: Set<number>, today: string): InvoiceCandidate | null;

export interface InvoiceLineLite { productKey: string; productName: string; quantity: number; unit: string | null; netTotal: number }
export function deliveryCheck(order: { lines: ReorderLine[] }, invoice: { id: number; invoiceNo: string | null; date: string; payable: number; lines: InvoiceLineLite[] },
  links: Map<string, { ingredientId: number; factor: number; name: string; baseUnit: Unit }>, now: Date): DeliveryCheck;
export function shouldAutoClose(check: DeliveryCheck): boolean;          // linesRead && ok
export function checkSummary(check: DeliveryCheck): string;              // "1 eksik, 1 fiyat farkı" | "Faturayla tuttu"
export function rowText(row: CheckRow): string;                          // "1 koli eksik", "Gelmedi", "Tamam"…
export function ratioHint(ordered: number, delivered: number): number | null; // 2..1000 ya da 1/k, ±%5
export function looksConsolidated(rows: CheckRow[]): boolean;            // ≥2 sipariş satırı ve ≥%60'ı ≥1,8 kat

export type OrderStateKey = "yolda" | "gecikti" | "geldi" | "kalem-bekleniyor" | "fark" | "kapandi" | "iptal";
export function orderState(o: OrderLite, today: string): { key: OrderStateKey; label: string; tone: "blue" | "amber" | "red" | "green" | "gray" };
export function needsAutoExpire(o: OrderLite, today: string): boolean;   // open, faturasız, AUTO_CLOSE_DAYS geçti

/** Zil satırları (PanelNotification biçiminde, group "fatura"); en çok 5 */
export function deliveryNotifications(orders: OrderLite[], today: string): { id: string; kind: "warning" | "info"; title: string; body: string; timeLabel: string; unread: true; href: string; group: "fatura" }[];
/** Bugün olguları (yönetici) */
export function deliveryDayFacts(orders: OrderLite[], today: string): { issues: { supplier: string; summary: string }[]; late: number };
```

`deliveryCheck` rules (D8):
- Group invoice lines by linked ingredient (`base += quantity × factor` for all lines, so returns reduce it; price only
  from lines with `quantity > 0 && netTotal > 0`).
- Order rows: `status` by ratio. `priceDiff = unitPrice / expected − 1`; `priceFlag = |priceDiff| > PRICE_TOL`.
- Linked ingredients not ordered give `siparis-disi`. Unlinked lines with `quantity > 0` give one `bagli-degil` row
  per product.
- `linesRead = lines.length > 0`. `ok` per D8. `consolidated = looksConsolidated(rows)`.

---

## 6. Server

### 6.1 `src/server/reorder/match.ts` (new, `server-only`)

```ts
export async function matchSupplierOrders(opts: { orderIds?: number[]; until?: number } = {}): Promise<{ matched: number; updated: number; closed: number }>;
```

1. Load `open` orders sent in the last 60 days (or `orderIds`). If there are none, return zeros. That is one indexed
   query per sync.
2. **Supplier resolver.**
   - With 5 on the branch: `supplierResolver(cardsWithTax, await loadSupplierRefs())` from
     `src/app/panel/tedarikciler/logic.ts` / `src/server/data/suppliers.ts`. `supplierId` of an invoice =
     `resolve(inv.supplier, inv.supplierTaxNumber).id`; of an order = `resolve(order.supplier, null).id`.
   - **Fallback** (5 absent): `cardIndex(cards)`; id = `card ? "kart:" + id : "ad:" + supplierMatchKey(name)`.
3. Candidates:
   - `invoices` with `date >= min(sentDay)` and `date <= max(sentDay) + MATCH_DAYS`, category in
     `LINKABLE_CATEGORIES` and not in `SEPARATE_CATEGORIES`;
   - their `parasut_bill_lines`;
   - all `parasut_product_links` joined with `ingredients` (name, unit);
   - `taken` = every non-null `supplier_orders.invoice_id`.
4. For each open order without an invoice and with `!manualMatch`, oldest first: `pickInvoice`. If one is found, set
   `invoiceId`, `matched++`, and log once.
5. For each open order with an invoice (new or old): `check = deliveryCheck(...)`. Write
   `check, checkedAt, receivedAt ??= invoiceDate 12:00 TR, receivedByName ??= "Fatura"` only when the JSON changed. If
   `shouldAutoClose`, set `status: "closed", closedAt, closedByName: "Sistem", closeNote: "Faturayla tuttu"`
   (`closed++`).
6. For open orders without an invoice and `needsAutoExpire`: close them with `"45 günde fatura gelmedi"`.
7. Every update has `where status = 'open'` (a concurrent close wins). Insert races are impossible; the partial unique
   index guards a double assignment, and a unique violation is caught and skipped.
8. Stop when `Date.now() > until`; the next sync continues.

**Hooks** (each in its own `try/catch`, `console.error("[siparis] teslim kontrolü", e)`, never fatal):
- `syncParasut`: after `if (ctx.touchedMonths.size) await applyProductLinks(...)`, when
  `Date.now() - started < deadline - 3_000`, call `matchSupplierOrders({ until: started + deadline - 1_000 })`. Push
  the part from §3.10 into `parts`. This is an append to the same `parts` array that 5 and pricing edit; resolve the
  trivial conflict there.
- `syncSupplierHistory`: the same, after its `applyProductLinks`.
- `src/server/actions/parasut.ts`: `saveProductLink`, `saveProductLinks`, `deleteProductLink` and `readParasutLines`.
  After `applyProductLinks` they call `await matchSupplierOrders().catch(console.error)`, because a new link can turn
  `bagli-degil` into a real comparison.

### 6.2 `src/server/data/reorder.ts` (new, `server-only`)

```ts
export async function loadReorderSettings(): Promise<ReorderSettings>;   // integration_state "reorder.settings" ∪ DEFAULT_REORDER
export async function loadTracked(): Promise<TrackedRow[]>;             // reorder_items ⋈ ingredients (active, countUnit)
export async function loadOnHand(ids: number[]): Promise<Map<number, OnHand>>;
//   select distinct on (ingredient_id) … from quick_counts where ingredient_id = any($1) order by ingredient_id, counted_at desc
//   + stock_counts for current and previous month (month, updatedAt → monthEndCountAt, countedBy)
export async function loadOrders(opts: { sinceDays: number; status?: ("open" | "closed" | "cancelled")[] }): Promise<OrderLite[]>;
export async function loadUsage(model: Model, today: string): Promise<UsageEstimate | null>;
//   pickUsage(dailyUsage(model, await loadDailyProductSales(addDays(today, -28), today), { today }), monthlyUsage(model, latestSalesMonth(model)))
/** Seam: ModPOS günlük ürün satışı aktarımı gelince doldurulur (ör. tablo daily_sales_lines). Şimdilik boş. */
export async function loadDailyProductSales(from: string, to: string): Promise<DailyProductSale[]>;  // return []
export async function loadPurchaseRows(ingredientIds: number[]): Promise<Map<number, { rows: SupplierPriceRow[]; lastLine: { supplierKey: string; productName: string; unit: string | null; factor: number } | null }>>;

export async function loadOrderPlan(): Promise<OrderPlanView>;          // /panel/siparis (yönetici; fiyatlı)
export async function loadReorderItemsView(): Promise<ReorderItemsView>; // /panel/siparis/kalemler
export async function loadQuickCountSheet(): Promise<QuickCountSheet>;   // /panel/hizli-sayim (fiyatsız; loadModel YOK)
export async function loadOrderHistory(f: { durum: string; tedarikci: string | null }): Promise<OrderHistoryView>;
export async function loadSupplierOrders(group: { keys: string[]; slug: string }): Promise<SupplierOrdersView | null>;
export async function reorderNotifications(): Promise<PanelNotificationLike[]>;  // zil (tek sorgu: açık siparişler)
export async function loadReorderDay(role: "admin" | "staff", now: Date, model?: Model): Promise<ReorderDayFacts | null>;  // Bugün
```

Notes:

- **Supplier identity for the plan**:
  - `loadSupplierLedger()` gives the groups.
  - `groupOf(name)` = the group whose name/alias keys (and, with 5, `keys`) include `supplierMatchKey(name)`.
  - The price-line supplier comes from `Map<invoiceId, group>` built from `groups[].invoices`, exactly as pricing's
    `loadSupplierPrices` does. No name matching of our own.
- **`loadPurchaseRows`**:
  - One query: `parasut_bill_lines ⋈ parasut_product_links (ingredient_id = any($ids)) ⋈ invoices`, excluding
    `SEPARATE_CATEGORIES`, newest first.
  - Per ingredient, `supplierPriceRows(lines, { today })` (pricing, `src/lib/supplier-prices.ts`).
  - `lastLine` = the newest paid line of the **preferred** supplier (for the D6 defaults).
  - **Fallback** (pricing absent): a 12-line local reduce (newest paid line per supplier key → `{ date, unitPrice }`),
    and no "en ucuz".
- **`expectedUnitPrice`** = the preferred supplier's `row.last.unitPrice`, else `model.unitCost.get(id)`.
- **`loadQuickCountSheet`** reads `reorder_items ⋈ ingredients` (name, packageDesc, countUnit, countGroup, sortOrder),
  the last and today's `quick_counts`, settings, the last count summary, and the open orders due today. For those
  orders it returns only `{ id, supplier, sentDay, lines: { orderName, qty, unit } }`. No model, no prices.
- **`loadReorderDay`**:
  - Staff: `total`, `countedToday` (quick counts today plus `stock_counts` updated today), `lastCountDay`, `countDay`,
    `coverDays`. No model.
  - Admin: the same, plus `ready` (via `loadOrderPlan` pieces with the passed `model`) and `deliveryDayFacts`.
- Every loader used by a shared surface (bell, Bugün, supplier page) is wrapped by its caller in `.catch(() => null)`.
  Previews share the production DB and do not migrate, so the new tables may be missing there.

### 6.3 Server actions: `src/server/actions/reorder.ts` (new, `"use server"`)

All use `attempt`, zod, `UserError`, `logActivity` and `refresh()`. Admin-only unless stated.

| Action | Rules |
|---|---|
| `saveQuickCounts(entries: { ingredientId; qty: number \| null; base?: number \| null }[])` | **`requireUser`** (staff allowed). `day = businessDate(new Date())`, set by the server only. Every id must be tracked, active and countable, else `UserError("{ad} hızlı sayım listesinde değil; sayfayı yenileyin.")`. qty finite and ≥ 0 (`"Miktar negatif olamaz"`), max 200 entries. Stale check against `base`, copied from `saveStockCounts`. `null` deletes today's row. Upsert on `(ingredient_id, day)` with `factor = countFactor(ing.countUnit)`, `countedAt = now`, `countedBy*`. Log "Hızlı sayım" |
| `markOrderReceived({ id, received })` | **`requireUser`**. `received: true`: order open, no `receivedAt`, else `UserError("Bu sipariş zaten işaretli; sayfayı yenileyin.")`. Sets `receivedAt = now` and `receivedByName = me.name`. `false`: only when the order has no invoice and (admin, or `receivedByName === me.name` and marked < 30 min ago), else `UserError("Geri almak için yöneticiye yazın.")`. Log |
| `recordOrderSent({ token, supplier, lines: { ingredientId, qty }[], note, message, channel })` | `token` uuid. `supplier` 1–120 chars. 1–40 lines, `qty` 0 < q ≤ 9999. `message` ≤ 4000. If the token exists, return that order (idempotent). The server rebuilds each line snapshot from current data (orderName, unit, size, lead, suggested, onHand, par, `expectedUnitPrice`) and never trusts client numbers except `qty`. `phone` = the resolved card's E.164 when `channel = "whatsapp"` and the number is a mobile. `expectedOn = addDays(todayTR(sentAt), max lead)`. Returns `{ id }`. Log |
| `cancelOrder(id)` | Open, no invoice, not received. Status `cancelled`, `closedAt`, `closedByName`. Log |
| `closeOrder({ id, note })` | Open. Status `closed`, `closeNote` (≤ 300), `closedByName`. Log |
| `reopenOrder(id)` | Status `closed` with `closedAt` within 30 days. Back to `open`, close fields cleared. Then `matchSupplierOrders({ orderIds: [id] })` so the check is fresh. Log |
| `setOrderInvoice({ id, invoiceId: number \| null })` | Open. The invoice must exist and not be linked to another order (`UserError("Bu fatura başka bir siparişe bağlı.")`). Set `invoiceId`, `manualMatch: true`, and clear `check` when null. Then `matchSupplierOrders({ orderIds: [id] })`. Log |
| `trackIngredients(ids)` | Each id active, `countUnit` set, not water. Insert with `onConflictDoNothing`. Log `"{k} kalem eklendi"` |
| `untrackIngredient(id)` → snapshot; `restoreReorderItem(snapshot)` | Delete / re-insert (the undo toast) |
| `saveReorderItem({ ingredientId, supplier, leadDays, parCount, orderName, orderUnit, orderUnitCount })` | Values typed in count units are converted with `countFactor(ing.countUnit)` (`parBase = parCount × f`, `orderUnitSize = orderUnitCount × f`). `leadDays` int 0–60; `parCount` ≥ 0; `orderUnitCount` > 0. Text fields trimmed, empty → null. When `supplier` is set and resolves to no group, `UserError("Tedarikçi bulunamadı; listeden seçin.")`. Log |
| `setLeadDays({ ingredientIds, leadDays })` | Updates those tracked rows (the group's items, sent by the client). Log |
| `saveReorderSettings(input)` | `countWeekdays` 1–7 unique, min 1. `marginPct` 0–1. `defaultLeadDays` 0–30. `signature` 1–60. Upsert `integration_state`. Log |

### 6.4 Pages and components

| File | Content |
|---|---|
| `src/app/panel/hizli-sayim/page.tsx` | Sync page + Suspense + async content. `requireUser()`, then `loadQuickCountSheet()`, then `QuickCountForm`. `metadata = { title: "Hızlı sayım" }` |
| `src/app/panel/hizli-sayim/quick-count-form.tsx` | `"use client"`: §3.2. Reuses `parseCount`, `countText`, `unusualCount`, `mergeCounts` from `../sayim/logic` and `FloatingBar` |
| `src/app/panel/siparis/page.tsx` | `requireAdmin()`, then `loadOrderPlan()`, then `OrderPlanClient` |
| `src/app/panel/siparis/order-plan.tsx` | `"use client"`: supplier cards, stepper, `<details>`, send dialog, copy, `recordOrderSent`. Client state `Record<ingredientId, qty>` keyed by plan `renderedAt`. Activity keeps edits on back navigation; close the dialog in a `useLayoutEffect` cleanup (preserving-ui-state.md) |
| `src/app/panel/siparis/gonderilen/page.tsx` | `requireAdmin()`, then `loadOrderHistory(sp)`, then the list of `OrderCard`s |
| `src/app/panel/siparis/order-card.tsx` | `"use client"`: §3.4 card plus its dialogs (Kapat, Faturayı değiştir, İptal), `useOptimistic` for Geldi/Kapat. Also used by the supplier page |
| `src/app/panel/siparis/kalemler/page.tsx` | `requireAdmin()`, then `loadReorderItemsView()` |
| `src/app/panel/siparis/reorder-items.tsx` | `"use client"`: settings form, tracked list, edit dialog, add list |
| `src/app/panel/siparis/list-anchor.tsx` | Re-export the `ListAnchor` from `../hammaddeler/list-anchor` (or move it to `src/components/panel/list-anchor.tsx` if two pages share it) |

Every page: `PageHeader` with eyebrow "Stok" in the Suspense fallback too, and `PageSkeleton`. Read the clock only after
the auth call (cacheComponents note in the header).

### 6.5 Daily job push: `src/server/notify/reorder-push.ts` (new)

`pushCountDay(now = new Date())` returns `{ status: "sent" | "skip"; sent: number }`. It skips when it is not a count day,
when nothing is tracked, or when everything is counted today. Otherwise it calls `sendPush("reminders", …)` (§3.9) to all
subscribers.

In `src/app/api/cron/gunluk/route.ts` `extras()`, add
`pushCountDay().then((r) => r.status).catch((e: Error) => ({ error: e.message }))` as `count`. With ops-jobs on the
branch:
- add `count?: string` to `dailyOutcome`'s input, and treat its `error` like the other extras (→ `partial`);
- add `STEP_LABELS.gunluk.count = "Hızlı sayım bildirimi"`.

---

## 7. Files

### Add

| File | What |
|---|---|
| `src/lib/reorder/types.ts`, `usage.ts`, `levels.ts`, `message.ts`, `delivery.ts` | §5 |
| `src/server/data/reorder.ts` | §6.2 |
| `src/server/reorder/match.ts` | §6.1 |
| `src/server/actions/reorder.ts` | §6.3 |
| `src/server/notify/reorder-push.ts` | §6.5 |
| `src/app/panel/hizli-sayim/page.tsx`, `quick-count-form.tsx` | §3.2 |
| `src/app/panel/siparis/page.tsx`, `order-plan.tsx`, `order-card.tsx`, `reorder-items.tsx` | §3.3–3.5 |
| `src/app/panel/siparis/gonderilen/page.tsx`, `src/app/panel/siparis/kalemler/page.tsx` | §3.4, §3.5 |
| `src/app/panel/tedarikciler/[cari]/supplier-orders.tsx` | Server component: the "Siparişler" card (§3.6), wrapping `OrderCard` |
| `drizzle/00NN_mal_siparisi.sql` + meta | Generated at merge (R2) |
| `tests/siparis.test.ts`, `tests/teslim-kontrolu.test.ts` | §9 |
| `docs/MAL-SIPARISI.md` | §10 |

### Change

| File | Change | Shared? |
|---|---|---|
| `src/server/db/schema.ts` | Three tables (§4) | **shared** (R2) |
| `src/components/panel/nav.ts` | §3.1: two NAV_GROUPS items, two NAV_TREE children, `SECTION_TABS.siparis`, `SHORT_TITLES` | **shared** (today, insight, menu; additive) |
| `src/lib/roles.ts` | `STAFF_PATHS` += `"/panel/hizli-sayim"`; comment ("hızlı sayım ve gelen mal işareti") | **shared** (today) |
| `src/server/parasut/sync.ts` | Matcher hook and summary part in `syncParasut` and `syncSupplierHistory` (§6.1) | **shared** (5, pricing: other functions; `parts` append) |
| `src/server/actions/parasut.ts` | Matcher after link changes (§6.1) | shared-ish (pricing passes `held`) |
| `src/server/actions/notifications.ts` | Admin `Promise.all` gains `reorderNotifications().catch(() => [])`, spread after `invoices` | **shared** (R5) |
| `src/app/panel/bugun/logic.ts`, `src/server/data/today.ts`, `tests/bugun.test.ts` | `DayTaskKey` += `"hizli-sayim" \| "siparis"`; `DayFacts.reorder?: ReorderDayFacts \| null`; two row functions at the §3.8 positions; `staffFacts` / `adminFacts` call `loadReorderDay` (admin passes its `model`) | today (merges before this) |
| `src/app/api/cron/gunluk/route.ts` (+ ops' `src/lib/job-health.ts` `dailyOutcome`, `STEP_LABELS`) | §6.5 | **shared** (ops-jobs) |
| `src/app/panel/tedarikciler/[cari]/page.tsx` | `loadSupplierOrders(g).catch(() => null)`, pass `ordersCard={<SupplierOrders …/>}` | 5 edits the same page (other lines) |
| `src/app/panel/tedarikciler/[cari]/supplier-client.tsx` | New prop `ordersCard?: ReactNode`, rendered after `<CariPanel …/>` (one line, like `stats`) | 5 edits it |
| `src/app/panel/yardim/page.tsx` | Two FAQs (§10) | **shared** |
| `tests/roller.test.ts`, `tests/mobile-nav.test.ts`, `tests/yardim.test.ts` | §9 | shared tests |
| `README.md`, `docs/TEDARIKCILER.md`, `docs/PARASUT.md`, `docs/BILDIRIMLER.md`, `docs/BUGUN.md`, `docs/TASARIM.md` | §10 | **shared** |
| `src/app/manifest.ts` *(optional)* | Shortcut "Hızlı sayım" → `/panel/hizli-sayim` | today edits it |

Not touched: `src/lib/calc/*` (engine, insights, price-impact), `src/server/data/dataset.ts`, `src/app/panel/sayim/*`
(only imported), `src/app/panel/page.tsx`, the digest, `src/app/panel/hammaddeler/*`, `card-dialog.tsx`.

---

## 8. Edge cases and interactions (no regressions)

1. **No sales data** (fresh install; the local DB has Eylül only):
   - `monthlyUsage` returns null, so suggestions read "Hedef yok" until a target is typed.
   - Kalemler says "Satış verisi yok: hedefleri elle girin". Nothing crashes.
2. **Old sales month.** Suggestions still work; the banner names the month (§3.3).
3. **Item without a recipe** (Çay, Antep fıstığı tozu): perDay 0, so the target is entered by hand. Kalemler's "Eklenebilecek
   kalemler" only lists items with usage.
4. **Water/ice and items without a count unit** cannot be tracked (action check plus UI filter).
5. **Count unit changed after a count**: `quick_counts.factor` keeps the old meaning; `parBase` and `orderUnitSize` are
   in base units, so nothing shifts.
6. **Ingredient made passive or "Sayılmaz"**: it drops out of Hızlı sayım and the plan (loader filter). Its
   `reorder_items` row stays, and Kalemler shows it greyed with "Pasif: takipten çıkarın".
7. **Ingredient deleted**: cascades remove `reorder_items` and `quick_counts`. `supplier_orders.lines` keeps the name
   snapshot (`ingredientId` dangles harmlessly; the check uses the order snapshot).
8. **Month-end count newer than the quick count**: it becomes Eldeki (D3). On the month's last day no quick count is
   asked for (D4).
9. **Delivered between the count and now** but not marked:
   - Arrived **before** the count and never marked: when its invoice matches, `receivedAt` = invoice day 12:00. If the
     invoice is dated on the count day before 12:00 that is fine; otherwise it is counted twice.
   - This is why the count screen asks "Gelen mal var mı?". The list shows "siparişte {x}" transparently, and the admin
     can tap Geldi there.
   - Any order older than 14 days stops counting (D3).
10. **Order list edited, then the admin leaves**: Activity keeps state (up to 3 routes). If evicted, the list re-suggests
    from data. Nothing is lost that was sent.
11. **Two admins send to the same supplier**: two orders (different tokens). The second sees the "Gönderildi" badge
    after refresh. Both are matched separately; the second gets no invoice, shows "Gecikti", and the owner cancels it.
12. **Double tap / retry**: same token, same order (unique index).
13. **WhatsApp not installed / desktop**: `wa.me` opens WhatsApp Web. The record is saved either way.
14. **Cardless supplier / no phone / landline**: §3.3. The share link lets the admin pick the contact. "Telefonu ekle"
    goes to the supplier page (Bilgileri ekle).
15. **Supplier renamed or merged**: names resolve through aliases (and VKN with 5), so stored `supplier` names and
    old orders still resolve. A stored name that resolves to nothing shows the Kalemler hint and falls back to
    unassigned.
16. **Invoice arrives without lines** (e-invoice UBL not read yet): it is not matched until it has lines, or until it is
    3 days old (then "Fatura geldi · kalemler okunmadı", re-checked each sync). Paper or manual invoices are matched
    after 3 days or by hand.
17. **Invoice for another delivery from the same supplier** (Sütaş delivers 3×/week): an invoice with lines and no
    overlapping ingredient never matches. Dates before the order are excluded.
18. **Consolidated (monthly) invoice**: it may match the most recent order and show "fazla". The `looksConsolidated`
    hint explains it, and the owner closes the order. Owner question 4.
19. **Wrong link factor** (koli vs adet): quantities look ×12; `ratioHint` says so. Pricing's hold may also fire on the
    price. Fixing the link reruns the matcher (§6.1 hooks) and the check updates.
20. **Invoice deleted or moved to Karaoke box / Alp Koç**:
    - Deleted: the FK sets `invoiceId` to null, and the next run clears `check` and searches again.
    - Moved: the category filter drops it, so the matcher clears the link unless `manualMatch` is set.
    - Implement: in step 5, an order whose invoice is no longer a valid candidate and `!manualMatch` gets
      `invoiceId = null, check = null`.
21. **Price holds (pricing)**: independent. The check compares against the order's `expectedUnitPrice`. A big jump shows
    as fiyat farkı here and as a hold on Hammaddeler. *(Optional:)* when `ingredient_price_holds` has a pending row for
    the ingredient, add a "Fiyat onayda →" link to the row.
22. **Paraşüt not configured**: no automatic matching. Orders are closed by hand, or matched to a manual invoice via
    Faturayı değiştir. Everything else works.
23. **Preview deployments** (shared DB, no migration): the new tables may not exist.
    - Bell/Bugün/supplier-page loaders are wrapped in `.catch`.
    - The sync hook is in `try/catch`.
    - The new pages show the error boundary. That is accepted for previews (CRITIQUE R1).
24. **db:reset**: the new tables are truncated by cascade (§4). Orders reference reset invoice ids, so truncating them is
    correct.
25. **Staff and prices**: staff loaders never select `unitCost`, `packagePrice`, `expectedUnitPrice`, `check` or
    `payable`. A source test pins this (§9). Staff cannot open `/panel/siparis/**` (proxy + `requireAdmin`).
26. **Time zones**: count day = `businessDate` (05:00). Sent day / expected day = `todayTR(sentAt)`. Weekday from
    `trWeekday(todayTR(now))`.
27. **Performance**:
    - Hızlı sayım (staff): 4 small queries, no model.
    - Mal siparişi: `loadModel` + ledger + one lines query + counts + orders (about 8 queries, parallel).
    - Bell: one query on `supplier_orders` (open, any age).
    - Sync: one query when there are no open orders.

---

## 9. Tests (`npx tsx --test tests/<file>.test.ts`; fixed clocks, e.g. `new Date("2026-10-26T07:30:00Z")` = Pazartesi 10:30 TR)

**`tests/siparis.test.ts`**

1. `trWeekday("2026-10-22") === 4`, `("2026-10-26") === 1`. `coverDays([1]) === 7`, `([1,4]) === 4`, `([1,3,5]) === 3`,
   `([]) === 7`, duplicates ignored. `nextCountDay("2026-10-22", {countWeekdays:[1]}) === "2026-10-26"`.
   `isCountDay("2026-08-31", …)` is false (month's last day, a Monday).
2. `countOverdue`: last 2026-10-12, today 2026-10-22, cover 7 → 10; last 2026-10-19 → null.
3. `suggestedLevels`: Süt (perDay 2689.33 ml, lead 1, cover 7, margin 0.2, LT) → par 26000, min ≈ 3227. Espresso
   (543.3 g, lead 2) → par 6000, min ≈ 1304. perDay 0 or null → null.
4. `roundCount`: 25.82 LT → 26; 25.2 → 25.5; 201.7 ADET → 202; 5.87 KG → 6.
5. `packsFor`: (20000, 12000) → 2; (13000, 12000) → 1; (2000, 12000, false) → 0; (2000, 12000, true) → 1; (−5, 1000) → 0;
   (3500, 1000) → 4.
6. `latestOnHand`: newer quick wins; newer month-end wins; `qty × factor`; both null → null.
7. `onOrderFor`:
   - unreceived open, sent 3 days ago → counted;
   - received before the count → no; received after the count → yes;
   - cancelled → no; sent 15 days ago → no;
   - invoice-matched with `receivedAt` before the count → no.
8. `planLine`: `sayilmadi`; `hedef-yok`; manual `parBase` beats the suggestion (`parSource "elle"`); `onOrder` reduces
   need; `critical` forces one pack; `stale` at 5 days; `estimate` = price × packs × size.
9. `planGroups`: grouping by `supplierKey`, unassigned last, suppliers with packs first. `readySuppliers` excludes a
   supplier with an order sent after the count.
10. `defaultOrderUnit`: `{unit:"Koli",factor:12000}` → `{unit:"koli",size:12000}`; null → `{unit:"paket", size:
    packageSize}`. `inheritLeadDays`: the most common value of the same supplier wins, else the fallback.
11. `suggestTracked` on the Excel dataset (Eylül): the 15 ids by monthly cost include Espresso çekirdeği and Süt %2,5;
    they exclude Buz/Su (no count unit) and already tracked ids.
12. `orderMessage`: an exact string snapshot of §3.3 (bold signature, bullets, note, "Teşekkürler."). qty 0 lines are
    dropped. `qtyLabel(2.5,"KG") === "2,5 kg"`, `qtyLabel(2,"Koli") === "2 koli"`. No `₺` in the text.
13. `orderLink`:
    - `"0532 123 45 67"` → `https://wa.me/905321234567?text=…`, target `numara`;
    - `null` → `https://wa.me/?text=…`, reason `yok`;
    - `"0212 123 45 67"` → share, reason `sabit`.
14. `monthlyUsage` (Excel, Eylül):
    - Süt `perDay` ≈ 80680 / 30;
    - with `openDays` 15 the value doubles;
    - adding one `waste` entry of 2 L Süt adds 2000/30 per day;
    - online mapped lines are included (fixture with `siteSales`);
    - month without sales → null;
    - with insight present, it equals the `salesBasis` perMonth mapping.
15. `dailyUsage`:
    - 20 days of fixture sales → per day = Σ ÷ span;
    - 10 days → null;
    - `pickUsage` prefers daily, else monthly;
    - `wasteBetween` equals `recordedUsage` for a full month.

**`tests/teslim-kontrolu.test.ts`**

1. `deliveryCheck`, exact delivery: all `tamam`, `ok`, `shouldAutoClose` true. 1.5 % short → `tamam`; 3 % short →
   `eksik`; 0 → `gelmedi`; 3 % over → `fazla`.
2. Factors: an invoice in "Adet" with factor 1000 against an order in "koli" of 12000 → compares 24 adet = 2 koli as
   `tamam`. A wrong factor (×12) → `fazla`, `ratioHint === 12`.
3. Price: +6 % flagged, +2 % not. A free line (net 0) counts in quantity, not in price. A return (−1) reduces delivered.
4. Extras: a linked, not-ordered ingredient → `siparis-disi`, not ok. An unlinked "NAKLİYE" line → `bagli-degil` while
   ordered rows are `tamam` → still ok.
5. `linesRead` false → not ok and no auto close. `orderState` → `kalem-bekleniyor`.
6. `pickInvoice`:
   - another supplier is ignored;
   - dated before the order → ignored; after sent + 10 → ignored;
   - lines with zero overlap → ignored;
   - the highest overlap wins; a tie goes to the date closest to `expectedOn`;
   - lineless: ignored when 2 days old, picked when 3 days old;
   - a `taken` invoice is ignored.
7. `orderState` with a fixed today: `yolda`, `gecikti` (today > expectedOn), `geldi`, `fark` (tone red with `eksik`),
   `kapandi`, `iptal`. Labels as in §3.4.
8. `checkSummary`: `"1 eksik, 1 fiyat farkı"`, `"Faturayla tuttu"`. `rowText`: `"1 koli eksik"`, `"Gelmedi"`.
9. `looksConsolidated` true at 3 of 4 rows ≥ 1.8×, false otherwise. `needsAutoExpire` at 46 days.
10. `deliveryNotifications`:
    - the id changes when the counts change;
    - late shows only after `expectedOn + 1`;
    - at most 5 items;
    - group `fatura`.

**Source checks** (inside `tests/siparis.test.ts`, the repo's `readFileSync` pattern):

- `src/app/panel/hizli-sayim/page.tsx` uses `requireUser` and not `requireAdmin`. Its source and `loadQuickCountSheet`'s
  body do not match `/unitCost|packagePrice|expectedUnitPrice|payable|loadModel|tl\(/`.
- `src/app/panel/siparis/**/page.tsx` use `requireAdmin`.
- In `src/server/actions/reorder.ts`, every exported function except `saveQuickCounts` and `markOrderReceived` contains
  `requireAdmin`.
- `src/server/parasut/sync.ts`: `matchSupplierOrders` appears inside a `try` block (regex on the surrounding lines).

**Updated tests**

- `tests/roller.test.ts`: `canOpen("staff","/panel/hizli-sayim")` is true; `/panel/siparis`, `/panel/siparis/kalemler`
  and `/panel/siparis/gonderilen` are false. The existing "menu role equals access rule" and "every staff screen in
  menu" tests cover the new items.
- `tests/mobile-nav.test.ts`:
  - staff screens not in the bar = `["/panel/hatirlaticilarim","/panel/hesap","/panel/hizli-sayim","/panel/sayim"]`
    (sorted; today's list plus ours);
  - `mobileTitleFor("/panel/hizli-sayim") === "Hızlı sayım"`, `("/panel/siparis") === "Mal siparişi"`,
    `("/panel/siparis/gonderilen") === "Gönderilenler"`;
  - `bottomNavActive(admin, "/panel/siparis") === "menu"`.
- `tests/yardim.test.ts`:
  - `pathOf("/panel/siparis")` → `["Stok","Mal siparişi"]`;
  - `pathOf("/panel/siparis/kalemler")` → `["Stok","Mal siparişi","Kalemler"]`;
  - `pathOf("/panel/hizli-sayim")` → `["Stok","Hızlı sayım"]`.
  - The `SECTION_TABS` loop then covers the new tabs.
- `tests/bugun.test.ts`:
  - Monday count day, 0 / 5 / 14 of 14 → `todo` "Bugün" / `"5 / 14"` / `done` (admin href `/panel/siparis`);
  - Tuesday, last count 12 days ago → `todo` "Gecikti";
  - a fresh non-count day → no row; month's last day → no row;
  - admin `siparis`: issues → `warn` first; ready → `todo`; late → `todo`; none → no row;
  - staff facts with `ready`/`issues` filled → no `siparis` row;
  - source check: `loadReorderDay` is called without `model` in `staffFacts`.

**Manual** (local `laffogato_siparis`):
1. Track 5 items in Kalemler.
2. Count as staff at 390 px (Hızlı sayım; check that no ₺ shows).
3. Open Mal siparişi as admin. Edit a quantity, then send. WhatsApp Web opens; check the record and the
   "Gönderildi" badge.
4. Insert an invoice and `parasut_bill_lines` + links by SQL. Run "Kalemleri şimdi oku" or save a link to trigger the
   matcher. Check the Gönderilenler table, the bell, the supplier page card and Bugün.
5. Run `npm run lint`, `npx tsc --noEmit` and `npm test`.

---

## 10. Docs and Yardım

- **`docs/MAL-SIPARISI.md`** (new):
  - the weekly flow (§1 example);
  - formulas (D3) with the worked numbers;
  - count days and the month-end exception;
  - defaults (supplier, unit, name) and how to override them;
  - the message and missing-phone cases;
  - order states;
  - Teslim kontrolü rules (window, overlap, tolerances, auto-close, 45 days, consolidated invoices, factor hint);
  - roles;
  - data (three tables, `reorder.settings`);
  - **the usage seam**: `loadDailyProductSales` returns `[]` today. When the ModPOS daily export arrives, add the import
    (table plus loader) and nothing else changes: `pickUsage` switches to daily when ≥ 14 days exist in the last 28.
    (26 Oct: the table and loader exist; LafPOS's day-close push fills them instead of a ModPOS export, `docs/LAFPOS.md`.)
- **`README.md`**:
  - Screens table, two rows:
    - "Hızlı sayım: haftalık kritik kalem sayımı (personel de), gelen mal işareti" | `/panel/hizli-sayim` | —;
    - "Mal siparişi: tedarikçi tedarikçi sipariş önerisi (hedef − eldeki − siparişte), WhatsApp ile gönderme, gönderilenler ve faturayla teslim kontrolü, sipariş kalemleri ve hedef stoklar" | `/panel/siparis` | —.
  - Personel paragraph: "Hızlı sayım".
  - Bell sentence: "teslim kontrolü farkları".
  - db:reset list: §4.
- **`docs/TEDARIKCILER.md`**: the "Siparişler" card. The card's phone is used for WhatsApp orders, which must be a mobile
  number.
- **`docs/PARASUT.md`**: the new step after the product links: "Teslim kontrolü" (matching rules in short; link to
  MAL-SIPARISI.md). The summary text.
- **`docs/BILDIRIMLER.md`**: bell items (group Faturalar); the count-day push under "Sabah özeti" devices.
- **`docs/BUGUN.md`**: the two rows (§3.8).
- **`docs/TASARIM.md` §3**: the Stok group in the menu tree.
- **`src/app/panel/yardim/page.tsx`**: two FAQs in the group "Alış ve malzeme", each `<Path>` preceded by a tag or
  `{" "}` (the yardim test rule).
  - `id: "siparis"`, q "Mal siparişi nasıl verilir?", icon `ShoppingBasket`, links `[{ href: "/panel/siparis", label: "Mal siparişi" }]`:
    > Önce <Path href="/panel/siparis/kalemler" /> ekranında 10–15 kritik kalem seçin; hedef stok satışlara göre önerilir,
    > isterseniz elle yazın. Sayım gününde personel ya da siz <Path href="/panel/hizli-sayim" /> ekranında bu kalemleri
    > sayarsınız. <Path href="/panel/siparis" /> ekranı her tedarikçi için ne kadar sipariş edileceğini hazırlar (hedef −
    > eldeki − siparişte, koli ya da pakete yuvarlanmış); miktarı değiştirip WhatsApp ile gönder'e dokunun. Mesaj
    > tedarikçinin kartındaki cep telefonuna hazır açılır; telefon yoksa WhatsApp'ta kişiyi siz seçersiniz. Gönderilen
    > sipariş kaydedilir.
  - `id: "teslim"`, q "Gelen mal siparişle tutmuyor", icon `PackageCheck`:
    > Paraşüt faturası gelince sipariş kalem kalem karşılaştırılır: eksik, fazla, fiyat farkı ve siparişte olmayan kalem
    > <Path href="/panel/siparis/gonderilen" /> ekranında, tedarikçinin sayfasında ve zilde görünür. Fark yoksa sipariş
    > kendiliğinden kapanır. Tedarikçiyi arayıp konuştuktan sonra Kapat'a dokunun (not yazabilirsiniz). Yanlış faturayla
    > eşleştiyse Faturayı değiştir. Miktar 12 kat gibi tuhaf görünüyorsa faturadaki ürünün hammadde bağlantısındaki çarpanı
    > düzeltin.

  The Yardım `STAFF_SCREENS` list picks "Hızlı sayım" up automatically from `NAV_TREE`.

---

## 11. Owner decisions (defaults implemented; nothing blocks)

1. **Personel siparişi gönderebilsin mi?** Default: **no**. Staff count and mark "Geldi"; only the admin sees the list
   and opens WhatsApp. If wanted later, the list needs a price-free view (the loader already isolates prices).
2. **Sayım günü:** default **Pazartesi**, once a week. Two days (e.g. Pzt + Per) make each order cover 4 days instead
   of 7.
3. **Emniyet payı %20, varsayılan teslim süresi 2 gün.** Both can be changed in Kalemler.
4. **Toplu (aylık) fatura kesen tedarikçi:** for these suppliers the check per order is not meaningful. Default: show the
   "toplu fatura" hint and the owner closes the order. A per-supplier "teslim kontrolü yapma" switch can come later.
5. **Otomatik kapanma:** an exact match closes itself; differences wait for the owner. An order with no invoice closes
   after 45 days. OK?
6. **Fiyat farkı eşiği ±%3, miktar ±%2.** OK?
7. **Ay sonu günü hızlı sayım istenmez** (the month-end count replaces it). OK?

---

## 12. Risks, dependencies and integration notes

**Depends on** (assumed merged before this; fallbacks given so the branch also builds without them):

| Plan | Module / function used | Fallback if absent |
|---|---|---|
| today | `src/app/panel/bugun/logic.ts` (`DayFacts`, `dayTasks`, `DayTaskKey`), `src/server/data/today.ts` (`staffFacts` / `adminFacts`), `tests/bugun.test.ts` | Skip §3.8. The bell and push still remind. Add the rows when today lands |
| insight | `salesBasis(model, month)` in `src/lib/calc/price-loss.ts` (R4) | Inline scale (§5.2); switch at rebase |
| pricing | `supplierPriceRows`, `bulkUnit`, `SupplierPriceRow` in `src/lib/supplier-prices.ts`; the invoice → group map pattern of `loadSupplierPrices` | Local reduce for the last price per supplier; no "en ucuz"; a local `bulkUnit` (gr→kg, ml→L) |
| 5 (vkn) | `supplierResolver`, `loadSupplierRefs`, `SupplierGroup.keys`, `invoices.supplier_tax_number` | Name-only `cardIndex` / `supplierMatchKey` (today's rule) |
| ops-jobs | `dailyOutcome` / `STEP_LABELS` in `src/lib/job-health.ts`; R5 bell ordering | Put `count` in `extras()` only |
| ops-backup | Runtime table discovery (R6) | — |

**Shared-file edits are additive**: nav, roles, notifications (one loader in the admin `Promise.all`, R5), `sync.ts` (a
hook plus one `parts` entry, after pricing's `held` part), the supplier page (one prop), Yardım/README/docs (own
sections).

**Merge position**: after today (CRITIQUE merge #9), so this is #10, with a migration. Serialise per R2: rebase,
regenerate `mal_siparisi`, `tests/migrations.test.ts`, `npm test`, lint, tsc, a 390 px check of Hızlı sayım (staff) and
Mal siparişi (admin), merge, and confirm the production build reports `✓ Veritabanı şeması güncel`. Then re-run the
backup restore test (R6).

**Risks**

- *Usage quality.* Monthly sales are uploaded late and vary. Mitigations:
  - a visible basis line;
  - an editable target;
  - a 20 % margin;
  - the Tutarlılık hint;
  - the daily seam.

  The worst case is a slightly wrong suggestion that the owner edits before sending; the panel never sends on its own.
- *Received-but-unmarked goods counted as "siparişte"* (§8 item 9): mitigated by the count-time prompt, the visible
  "siparişte" figure with Geldi, and the 14-day expiry.
- *Matcher false positives* (another delivery of the same supplier): mitigated by the overlap rule, the date window,
  the manual override and the `manualMatch` lock.
- *Sync time budget*: the matcher is guarded by the deadline and resumes on the next run.
- *Name collision with app orders*: avoided with "Mal siparişi", `reorder` and `MAL-SIPARISI.md`.

**Cuttable extras** (if the group runs long, cut in this order):
1. the Tutarlılık hint in the edit dialog;
2. the "Fiyat onayda" link;
3. the manifest shortcut;
4. the count-day push (Bugün still reminds);
5. `looksConsolidated`.

Keep everything else: it is the requested feature.
