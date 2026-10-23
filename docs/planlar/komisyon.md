# Plan: Komisyon ve hakediş kontrolü (yemek kartları ve platformlar)

Group key: `komisyon`. Base: `claude/oneriler` (= origin/main 71ac11f) **plus every batch-1 plan** (adminstepup, ops,
vkn, pricing, kasa, insight, menu, today) as merged per CRITIQUE §5. Next.js 16.4 (cacheComponents), Drizzle 0.45,
Turkish UI. Read `AGENTS.md`; the Next docs this plan relies on are listed in §12.

---

## 1. Goal

Every month the owner sees, for each meal-card company (Pluxee, Multinet, Edenred, Setcard, Metropol) and each order
platform (Yemeksepeti, Trendyol Go, Getir, Migros Yemek):

- how much was sold through it;
- what it invoiced, line by line (commission, early-payment fee, other fees);
- the **real rate** (everything it took ÷ what was sold through it);
- whether something looks wrong:
  - a meal-card rate above 6 %;
  - a banned extra fee (rent, device, support, maintenance, deposit…);
  - an "erken ödeme" fee pushing the rate up;
  - a platform fee for the core service;
  - no invoice in a month with sales;
  - a sudden rate jump;
- how much money should come back (hakediş) and by when (invoice date + 30 days);
- whether it came. There is no bank feed, so the owner marks "Hakediş geldi" with a date and an amount in two taps.

Late payouts and red flags ring the admin bell and get one line in the morning e-mail. Admin only. Staff only gets
optional per-card / per-platform amount fields on the nightly cash report, which they copy from the Z report.

Legal basis (texts in §3.7, sources in §13):
- **Meal cards:** Perakende Ticarette Uygulanacak İlke ve Kurallar Hakkında Yönetmelik md. 12/A (added by the
  amendment in RG 22.05.2018, no. 30428):
  - commission at most 6 %;
  - no separate charge under names such as application hosting, rent, maintenance or deposit;
  - payment within 30 days from the invoice date.
- **Platforms:** Ticaret Bakanlığı Genelgesi 2026/1 "Hizmet Bedellerinin Şeffaflığının Sağlanması Hakkında" (compliance
  date 1 April 2026):
  - every fee itemised in the seller panel;
  - no separate fee for taking and forwarding orders or for the payment infrastructure;
  - ads and campaigns are voluntary.

---

## 2. Key decisions (made here, so the implementer does not re-decide)

### 2.1 What the real data shows (local DB inspected, 22 Oct 2026)

`PGPASSWORD=postgres psql -h localhost -U postgres -d laffogato`:

| Supplier (as stored) | Invoices | Dates | Net (KDV hariç) | Payable | No. prefix | Source |
|---|---|---|---|---|---|---|
| Trendyol Go | 7 | 14.09–14.10.2026, weekly (Mondays) + one on 30.09 | 1.754,38 ₺ | 2.105,25 ₺ | `GCF…` weekly, `GDF…` once at month end | excel |
| Pluxee | 1 | 30.09.2026 (month end) | 26,78 ₺ | 32,14 ₺ | `HEF…` | excel |
| Set Kart | 1 | 30.09.2026 (month end) | 39,28 ₺ | 47,14 ₺ | `KOM…` | excel |
| Yemek Sepeti | 1 | 14.10.2026 | 157,30 ₺ | 188,76 ₺ | `M01…` | excel |

What this tells us:
- **VAT.** All rows carry 20 % VAT (payable = net × 1,2). The Excel rows store `vat = 0`, so VAT is taken as
  `payable − (amount − discount)`.
- **No line data locally.** All 10 rows came from the Excel seed. `parasut_bill_lines` is empty in the local DB (0 rows
  overall), so there are no real line descriptions, bases or rates to inspect. Line handling (§2.5) is therefore
  keyword-based and conservative, shows the raw line text, and is tuned by one read-only production query before merge
  (§11, task 0).
- **Sales.** The local DB has no `cash_reports`. The months table holds POS ciro only (July–October 2026), with no
  payment-type split. Locally, every rate is "satış bilinmiyor". The tests use fixtures (§9). Kasa started mid-October
  2026 in production (kasa plan §7), so **November 2026 is the first month with a real base**.
- **Size.** Meal-card commission is tiny today: Pluxee 26,78 ₺ and Set Kart 39,28 ₺ in September, about 1.000–1.300 ₺ of
  sales each at 2–3 %. The platform (Trendyol Go) is the larger channel.
- **Invoice timing.** Meal cards invoice monthly (dated on the month's last day). Trendyol Go invoices weekly, so its
  invoices straddle month ends (§2.5 attribution).

### 2.2 Where it lives: its own screen under "Satış & gider"

New screen **Komisyon & hakediş**, `/panel/komisyonlar`, in the sidebar group "Satış & gider" right after Tedarikçiler.
Admin only.

Why not inside Tedarikçiler:
- **Direction of money.** Tedarikçiler is "money we owe" (Kalan borç, Vadesi geçen, Ödeme talebi, IBAN). A commission
  channel is the reverse: the channel owes us the payout. Mixing both on one screen would make "Kalan borç" and the
  overdue badges ambiguous.
- **Sales.** The check needs the channel's sales (from the Z reports), which Tedarikçiler never shows.
- **Shape.** It is a monthly reconciliation of sales, invoices and payouts, the same shape as Satışlar and Gelir-gider
  in that group.

A commission channel's page in Tedarikçiler gets a one-line link here (§3.9), so the owner finds it from either side.

### 2.3 Channels and how an invoice finds its channel

The fixed registry lives in `src/lib/commission/channels.ts`:

| key | Label | Kind | Name prefixes (folded, spaces removed) |
|---|---|---|---|
| `pluxee` | Pluxee | meal | `pluxee`, `sodexo` |
| `multinet` | Multinet | meal | `multinet` |
| `edenred` | Edenred | meal | `edenred`, `ticketrestaurant` |
| `setcard` | Setcard | meal | `setcard`, `setkart` |
| `metropol` | Metropol | meal | `metropol` (excluded when the name also has `avm\|kira\|alisveris\|merkezi\|plaza\|residence\|otel`, same idea as `pickCategory`) |
| `yemeksepeti` | Yemeksepeti | platform | `yemeksepeti` |
| `trendyol` | Trendyol Go | platform | `trendyol`, `dsmgrup` (Trendyol's legal name; confirm with task 0) |
| `getir` | Getir | platform | `getir` |
| `migros` | Migros Yemek | platform | `migrosyemek`, `migros` |

Rules:
- **Only Komisyon invoices.** Only invoices with `category = COMMISSION_CATEGORY` ("Komisyon") are considered. That makes
  the loose prefixes (`migros`, `getir`, `dsmgrup`) safe: a Migros grocery bill is "Hammadde", never "Komisyon".
  `COMMISSION_SUPPLIERS` and `pickCategory` in `src/server/parasut/mapping.ts` are **not** changed, because adding legal
  names there could pull goods invoices into Komisyon. A test pins that every `COMMISSION_SUPPLIERS` name resolves to a
  channel.
- **Names tried for an invoice, in order:**
  1. the invoice's `supplier`;
  2. the supplier card's name and aliases. This uses vkn's `supplierResolver(cards, refs).resolve(supplier, taxNumber)`
     when present; fallback: `cardFor(cardIndex(cards), supplier)` from `src/app/panel/tedarikciler/logic.ts`, today's
     name match.

  The first one that maps to a channel wins.
- **Unmatched Komisyon invoices** (e.g. a bank's POS commission bill) are listed under "Kanalı bulunamayan komisyon
  faturaları" with the fix in plain words: add the name to the right supplier's "Diğer adlar" in Tedarikçiler. There is
  no new mapping UI.
- **Other categories.** Invoices from a channel supplier in another category (e.g. a Yemeksepeti ad bill filed as
  "Reklam & Tabela") are **not** counted. The card shows one hint line instead (§3.3), because recategorising is the
  owner's call.

### 2.4 Sales through a channel: the Z total is one number, so handle it honestly

The Z report form has one `mealCard` field ("Yemek kartı", hint "Multinet, Pluxee, Edenred, Setcard…") and one `online`
field ("Online", hint "Yemeksepeti, Getir, Trendyol…"). That hint already implies ModPOS lists each card or platform as
its own payment line, which staff add up today.

**Decision: add optional per-channel amounts to the cash report**, as a single nullable jsonb column
`cash_reports.channel_sales`. The fields appear **only** when two or more channels of a group are "in use" (§3.6):

- **Without it, a per-provider rate is impossible.** The legal 6 % limit applies per provider. An aggregate of 4 % can
  hide one provider at 8 % and another at 2 %.
- **For staff it is not extra work.** They type the lines as they appear on the Z, and the panel adds them up, so the
  "Yemek kartı" total fills itself (§3.8).
- **It is cheaper than the alternatives.** Typing each provider's monthly statement by hand is still offered as an
  override (§2.4 source 1), but it needs the owner to log into five portals each month.
- **With one channel per group** nothing appears. The whole group total is that channel's sales (source "tek", below).

Per channel and month, the sales figure (KDV dahil, the amount the customer paid through the channel) comes from the
**first** source that applies:

| # | Source (`source`) | Rule | Label on screen |
|---|---|---|---|
| 1 | `elle` | `commission_months.sales` typed by the owner (the channel's own statement) | `Kanalın ekstresinden (elle)` |
| 2 | `kasa` | Σ `channel_sales[key]` over the month's reports, **only if** every report day of the month with a group amount > 0 has a split for that group, **and** the month is not `partialFrom` (see below) | `Kasa raporlarından` |
| 3 | `fatura` | Every invoice of the channel-month states its base, parsed from line or description text (§2.5); Σ of those bases | `Faturada yazan işlem tutarı` |
| 4 | `tek` | The group has exactly one channel with an invoice or a split amount in the month, there is no split day, the month is not partial, and the group total > 0 → the whole group total | `Z'deki yemek kartı toplamı (bu ay tek yemek kartı faturası var)` / `… online toplamı (bu ay tek platform faturası var)` |
| – | none | otherwise | `Satış bilinmiyor` + the reason (§3.3) |

Coverage rules:
- **Partial first month.** `partialFrom` is set when the first cash report ever falls inside the month after day 1, the
  same rule as kasa's `tillMonths` (`src/lib/cash-month.ts`). Then sources 2 and 4 are not used, because the sum would
  cover only part of the month and the rate would look too high.
- **Missing report days.** Days in `[month start, min(month end, yesterday)]` with no report (kasa's `missing`) do not
  block sources 2 and 4. They add the info flag `kasa-eksik` and downgrade a ">6 %" flag from red to amber, because
  missing days make the rate look higher.
- **Meal-card aggregate** (always shown when the Z has meal-card money): Σ `mealCard` of the month (null when partial),
  Σ fees of all meal channels, the aggregate rate, Σ expected payouts and Σ received.

### 2.5 What a channel invoiced: invoices, lines, the month they cover

**Line classes** (`LineClass`), from the folded text `productName + " " + description` of each `parasut_bill_lines` row.
These cover both Paraşüt bill lines and UBL e-invoice lines (`src/server/parasut/lines.ts` writes both to the same
table). The first match wins:

| Class | Label | Meal card | Platform |
|---|---|---|---|
| `erken` | Erken ödeme | `\b(erken\|hizli\|aninda\|ayni gun) (odeme\|hakedis\|tahsilat)`, `vade farki`, `\bvalor` | same |
| `yasak` | Komisyon dışı ücret | strong: `kira(?!z)\w*\|kiralama\|cihaz\w*\|terminal\w*\|destek\w*\|bakim\w*\|depozito\w*\|teminat\w*\|barindirma\|aidat\w*\|uyelik\w*\|abonelik\w*\|lisans\w*\|kurulum\w*` (always); ads words (below); weak `\bpos\b\|yazilim\w*\|entegrasyon\w*\|islem basi\|islem ucret\w*\|kart bedel\w*\|sarf\w*\|rulo` only when the text has no `komisyon` | – |
| `asli` | Sipariş / ödeme altyapısı ücreti | – | `odeme altyapi\w*\|odeme islem\w*\|online odeme\|sanal pos\|siparis (iletim\w*\|alma)\|islem ucret\w*\|platform kullanim\w*` |
| `reklam` | Reklam / kampanya | (→ `yasak`) | `reklam\w*\|kampanya\w*\|one cikar\w*\|sponsor\w*\|banner\|vitrin\w*\|promosyon\w*\|joker\|kupon\w*\|indirim katilim\w*` |
| `komisyon` | Komisyon | `komisyon\w*\|hizmet bedel\w*\|aracilik\w*` | same |
| `diger` | Diğer ücret | anything else | same |

- **Single-line invoice.** An invoice with exactly one line classed `diger` counts that line as `komisyon` (e.g.
  "Hizmet faturası").
- **No lines** (Excel, manual, or an e-invoice not read yet). The whole invoice net (`amount − discount`) is `komisyon`
  and the invoice is marked `kalemsiz`. That is today's seed shape.
- **Scaling.** Line amounts are scaled to the invoice net: `classAmount = line.netTotal ÷ Σ line.netTotal × invoiceNet`.
  The classes then always add up to what Gelir-gider counts, after rounding and invoice-level discounts. Refund (minus)
  invoices reduce.
- **VAT** per invoice = `payable − invoiceNet`, used only for the expected payout.

**Stated base, rate and period** (`parseStated(text)`, conservative; anything doubtful → null):
- **Base:** a money amount right next to `islem tutar\w*|harcama tutar\w*|toplam harcama|toplam islem|satis tutar\w*|ciro\w*`,
  in either order, as `12.345,67`, `12345,67` or `12345.67` with optional `TL|TRY|₺`. It is accepted only when
  `invoiceNet ÷ base` is between 0,1 % and 40 %. The word `matrah` is ignored: it is the commission's own VAT base.
- **Rate:** `%3`, `% 3,5`, `3,5 %` between 0 and 40, shown as "Faturada yazan oran %3,5".
- **Period:** `dd.mm.yyyy – dd.mm.yyyy` (also `/`, `-`, `–`) or a Turkish month name and year (`Eylül 2026`).

**Which month an invoice belongs to** (`coverMonth`). Sales and invoices must be compared on the same month:
1. a parsed period → the month containing its midpoint;
2. else, for a **meal** channel invoice dated on day 1–5 of a month → the previous month. Monthly statements are issued
   at month end or in the first days of the next month;
3. else the invoice date's month.

When the result differs from the invoice date's month, the invoice row says so: `3 Kasım tarihli fatura · Ekim
satışları için`.

Gelir-gider keeps putting every invoice in its **invoice date** month (engine unchanged). This screen states its own
rule in the "Nasıl hesaplanır" text (§3.7).

**Weekly platforms.** A weekly invoice covers the previous week, so a month's invoices can be up to ~6 days off the
month's sales. Platform cards therefore headline the **3-month rate**: Σ fees ÷ Σ sales over the selected month and the
two before, using months with known sales, and at least 2 such months. Otherwise they show the monthly rate. The monthly
rates stay visible in the history strip. Meal cards headline the monthly rate.

### 2.6 Rates and flags

- `fees` = Σ class amounts of the channel-month (KDV hariç). `rate = fees ÷ sales`. The text shows the parts:
  `Komisyon %3,0 · erken ödeme %3,2`.
- **Legal comparison (meal):** **everything** the meal-card company took counts toward the 6 %. The law allows only the
  commission and bans every other fee, so total ÷ sales is the honest comparison. Threshold: `rate > 0,0605`, which
  absorbs rounding.

Flags (`FlagKey`, each with `level` and one Turkish sentence; exact texts in §3.3):

| Key | Kind | When | Level |
|---|---|---|---|
| `oran-sinir` | meal | rate > 6,05 % | `bad` if source is `elle` / `kasa` / `fatura` and no `kasa-eksik`; otherwise `warn` |
| `yasak-ucret` | meal | `yasak` > 0 | `bad` |
| `erken-odeme` | meal | `erken` > 0 | `warn` |
| `asli-ucret` | platform | `asli` > 0 on an invoice dated ≥ 2026-04-01 | `warn` |
| `kalemsiz` | platform | invoice dated ≥ 2026-04-01 with lines read, exactly one line, not classed `komisyon` by keyword | `info` |
| `reklam` | platform | `reklam` > 0 | `info` |
| `fatura-yok` | both | sales known and > 0 (sources 1–2), no invoice for the month, and today ≥ day 15 of the next month. Aggregate version on the meal card: meal sales > 0 and no meal invoice at all | `warn` |
| `oran-sicrama` | both | rate − mean(rates of up to 3 previous months, at least 2 present) ≥ 1,0 pp (meal) / 3,0 pp (platform), **and** ≥ 20 % relative | `warn` |
| `taban-farki` | both | stated base and source-1/2 sales both exist and differ > 5 % | `info` |
| `kasa-eksik` | both | source `kasa` or `tek` and the month has missing report days | `info` |
| `baska-kategori` | both | the channel supplier has non-Komisyon, non-goods invoices in the month | `info` |
| `hakedis-gecikti` / `hakedis-eksik` / `hakedis-gec` | both | §2.7 | `bad` / `warn` / `info` |

All keyword-based texts say **"olabilir"** ("may be"). They are prompts to check, not verdicts.

### 2.7 Payouts (hakediş): expected, due, marked

- **One mark per channel per month**, the sales month, in `commission_months` (§4). Weekly-paying platforms: the owner
  types the month's total (several transfers can be added up) and the date of the last transfer. Keeping it to one row
  per month is what keeps it light.
- **Expected** = sales − Σ `payable` of the channel-month invoices. The channel keeps the commission plus VAT and pays
  the rest. It is null when sales are unknown. The text always shows the formula:
  `Beklenen ~8.605,20 ₺ (satış 9.300 ₺ − faturalar 694,80 ₺)`. For platforms it is prefixed "yaklaşık" because of the
  week boundary.
- **Due** = latest invoice date of the channel-month + `payDays`:
  - `payDays` defaults to 30, set per channel in "Kanallar";
  - meal: 1–30, the legal maximum;
  - platform: 1–90;
  - null when the channel-month has no invoice.
- **Statuses** (`PayoutStatus`). Tolerance `tol = max(50 ₺, 2 % of expected)`:
  - `geldi`: received set, and expected null or received ≥ expected − tol;
  - `eksik`: received set and < expected − tol;
  - `bekliyor`: not received, today ≤ due;
  - `gecikti`: not received, today > due, and due ≥ `since`;
  - `takip-oncesi`: not received, today > due, due < `since`;
  - `faturasiz`: no invoice yet (due null) and sales > 0;
  - `yok`: nothing to expect.
  - Lateness: `lateDays = receivedOn − due` when > 0 → info flag `hakedis-gec`.
- **`since`** (`integration_state` key `komisyon.since`, YYYY-MM-DD) keeps launch from raising a wall of red for
  payouts that came long ago.
  - It is written once (`ON CONFLICT DO NOTHING`, `todayTR()`) only on write paths: in `loadDigestCommission` (the
    morning job) and in `saveChannelMonth`.
  - Read paths (page, bell, Bugün) treat a missing value as `todayTR()` and never write (CRITIQUE ops correction 2).
  - Before `since`, an unmarked past payout shows grey `Takip öncesi` and never alarms.
- **No bank feed.** Nothing is ever marked automatically. The commission invoices themselves stay "ödendi (fatura günü)"
  exactly as today (`newInvoicePayment`), and this feature does not touch the invoices' payment fields.

### 2.8 Where it shows up besides the screen (minimal)

- **Bell**, admin, group `fatura`. Not `odeme`: that group feeds the bottom-nav "Ödemeler" overdue badge, which is about
  bills we pay. At most 5 items:
  - each `hakedis-gecikti`;
  - `oran-sinir` (bad);
  - `yasak-ucret` for channel-months whose latest invoice is ≤ 45 days old.
- **Morning e-mail.** The same items, each sent **once** (notification_log key `komisyon:<key>`), in a small box after
  the invoices / price-hold boxes.
- **Bugün** (today plan): one optional admin row `komisyon` when payouts are late.
- **Nakit planı** (insight plan): pending payouts as estimated incoming lines.
- **Not on the dashboard** (not asked; the bell covers it).

---

## 3. User-facing behaviour (exact Turkish texts)

### 3.1 Navigation

- `NAV_TREE` › `para.children`: after `tedarikciler` add
  `{ id: "komisyonlar", label: "Komisyon & hakediş", href: "/panel/komisyonlar", roles: ["admin"] }`.
- `NAV_GROUPS` › "Para": after Tedarikçiler, with icon `Percent` (lucide):
  ```ts
  { href: "/panel/komisyonlar", label: "Komisyon & hakediş", icon: Percent, roles: ["admin"],
    keywords: "komisyon hakediş yemek kartı pluxee sodexo multinet edenred setcard metropol yemeksepeti trendyol getir migros oran yüzde 6 erken ödeme kesinti platform" }
  ```
- `SHORT_TITLES["/panel/komisyonlar"] = "Komisyonlar"` (phone top bar).
- Not in either bottom bar. Staff never see it: it is not in `STAFF_PATHS`, the proxy sends staff home, and the page
  calls `requireAdmin`.

### 3.2 Screen `/panel/komisyonlar`

`PageHeader`:
- eyebrow `Satış & gider`, title `Komisyon & hakediş`;
- description: `Yemek kartı şirketlerinin ve sipariş platformlarının her ay gerçekte ne kadar kestiği, faturadaki ücretler ve hakedişin gelip gelmediği. Faturalar Paraşüt'ten, satışlar kasa raporlarından gelir; hakediş gelince siz işaretlersiniz.`;
- actions: `<MonthPicker months={months} value={month} />` (`src/components/panel/month-picker.tsx`, `?ay=`).

Default month: the latest month ≤ the current month with a commission invoice attributed to it (§2.5), else the current
month. An invalid `?ay=` falls back to the default.

Suspense fallback: the same `PageHeader` with description `Yükleniyor…` + `PageSkeleton rows={6}`.

Order on the phone (390 px, single column):

1. **"Bekleyen hakedişler"** card. Shown only when at least one channel-month is `gecikti`, `bekliyor` with a due within
   7 days, or `eksik`, in **any** month.
   - Icon `HandCoins`. Description `Gelmesi gereken para. Geldiyse işaretleyin.`
   - Rows, earliest due first (most urgent on top): `Pluxee · Ekim 2026` / sub `~8.605,20 ₺ · son gün 30 Kasım` + status badge (`Gecikti`
     red, `Bu hafta` amber, `Eksik geldi` amber). On the right, a `Geldi` button (secondary, 44 px on touch) opens §3.5.
2. **Stats**, `grid grid-cols-2 lg:grid-cols-3`:
   - `Kesilen (KDV hariç)`, value Σ fees of the month for all channels; sub `{n} fatura`.
   - `Yemek kartı oranı`, value the aggregate rate or `–`; tone `bad` when > 6,05 %; sub `Satış {money}` or
     `Satış bilinmiyor`.
   - `Bekleyen hakediş`, value Σ (expected − received) over open rows of all months; sub `{n} gecikti` (tone `bad`) or
     `Gecikme yok`.
3. **"Yemek kartları"** section title (`SectionTitle`), then:
   - **"Yemek kartları (toplam)"** card (§3.4), when the month has Z meal-card money or a meal invoice;
   - one **channel card** (§3.3) per meal channel with activity: an invoice, split sales, a typed sale or a mark in this
     month or the 5 before.
4. **"Platformlar"** section title, then one channel card per platform with activity. Under the title, in muted text:
   `Kasa raporlarında online: {money(Σ online)}` (or `Kasa raporu yok`).
5. **"Kanalı bulunamayan komisyon faturaları"** card, only when there are any:
   - rows `{supplier} · {dateTR} · {money(net)}` linking to `/panel/faturalar?ara={supplier}&ay={YYYY-MM}`;
   - footer: `Bu bir yemek kartı ya da platformsa Tedarikçiler'de o tedarikçinin "Diğer adlar"ına bu adı ekleyin; fatura kanala geçer.`
6. **"Kanallar"** card (§3.6).
7. **"Kurallar ve hesap"** card: a `<details>` closed by default, summary row ≥ 44 px (§3.7).

Desktop (lg+): the stats row has 3 columns, and the channel cards sit in `grid lg:grid-cols-2 gap-4` per section. The
pending card and the aggregate card span full width.

Empty state, when there are no commission invoices at all and no Z meal-card / online money in the last 13 months:
`EmptyState` title `Henüz komisyon faturası yok`, description
`Yemek kartı ya da platform faturası Paraşüt'ten gelince (kategori Komisyon) burada ay ay görünür.`

### 3.3 Channel card (one per channel, the core of the screen)

`Card` with `id={key}` (anchor for bell and e-mail links).

**`CardHeader`**
- Icon `CreditCard` for meal, `ShoppingBag` for platforms (no courier imagery).
- Title = label.
- Description `Yemek kartı` / `Sipariş platformu`.
- `meta`: one status badge, the worst of:
  - `Sınırın üstünde` (red; `oran-sinir` bad);
  - `Kontrol edin` (amber; any `warn`);
  - `Hakediş gecikti` (red);
  - `Tamam` (green; rate known, no warn or bad, and payout `geldi` or `bekliyor`);
  - `Satış bilinmiyor` (gray).

**Body** (`space-y-3 px-5 pb-5`):

1. **Rate block**, two columns on `sm:`, stacked on the phone:
   - **Left:**
     - label `Gerçek oran` (meal) / `Gerçek oran (3 ay)` (platform with a 3-month rate);
     - big value `%6,2`, or `–` when sales are unknown;
     - sub `Komisyon %3,0 · erken ödeme %3,2`, listing only the non-zero classes in table order.
   - **Right:**
     - `KeyValue` `Satış` → `9.300 ₺` + muted source label (§2.4), or `bilinmiyor`;
     - `KeyValue` `Kesilen` → `579 ₺ + KDV` (KDV = Σ payable − Σ net, shown on hover/tap via `InfoTip`:
       `KDV dahil 694,80 ₺`);
     - for platforms with the 3-month headline, also `KeyValue` `Bu ay` → `%10,0`.
2. **History strip**: the last 6 months ending at the selected month, as a 6-cell row (`grid grid-cols-6 text-center
   text-xs`). Each cell has the short month (`Eyl`) and the rate (`%3,0`, or `–`). The selected month is bold, and a
   cell whose rate is > 6,05 % on a meal channel uses `text-bad`. No chart.
3. **Flags**: a `DotList` of sentences, red / amber / blue dot by level. Exact texts:
   - `oran-sinir`: `Toplam kesinti %{rate}: yemek kartında yasal üst sınır %6.` + when level warn:
     ` Satış tahmini olduğu için kesin değil; kontrol edin.`
   - `yasak-ucret`: `Komisyon dışı ücret olabilir: “{lineName}” {money}.` (up to 2 names, then ` ve {n} kalem daha`) +
     ` Yönetmelik kira, cihaz, destek, bakım, depozito gibi adlarla ayrı ücret alınmasını yasaklıyor.`
   - `erken-odeme`: `Erken ödeme ücreti {money} (oranı %{pp} artırıyor). Erken ödemeyi siz mi seçtiniz? Seçmediyseniz kapattırın.`
   - `asli-ucret`: `“{lineName}” {money}: 1 Nisan 2026'dan beri sipariş alma, iletme ve ödeme altyapısı için ayrı ücret alınamıyor.`
   - `kalemsiz`: `Faturada ücretler kalem kalem yazılmamış; platformun satıcı panelinden dökümü kontrol edin.`
   - `reklam`: `Reklam / kampanya ücreti {money}. Bunlar isteğe bağlıdır; onay vermediyseniz itiraz edin.`
   - `fatura-yok`: `{Ay} ayında {money} satış var ama komisyon faturası gelmedi.`
   - `oran-sicrama`: `Oran %{prev}'den %{now}'e çıktı (önceki {n} ayın ortalaması).`
   - `taban-farki`: `Faturada yazan işlem tutarı {money}; {kaynak} {money} (%{d} fark).`
   - `kasa-eksik`: `{n} gün kasa raporu yok; satış eksik kaldıysa oran yüksek görünür.`
   - `baska-kategori`: `Bu kanalın Komisyon dışında {n} faturası var ({kategori}, {money}); orana girmesi için kategorisini Komisyon yapın.`
   - Unknown-sales reasons (gray), one of:
     - `Satış bilinmiyor: bu ay kasa raporu yok. Kanalın ekstresindeki satışı yazarsanız oran hesaplanır.`;
     - `Satış bilinmiyor: kasa raporları ayın ortasında başladı.`;
     - `Satış bilinmiyor: Z'de yemek kartları tek toplam; kasa raporunda karta göre ayrım {k} / {n} günde girildi.`
       (platform: `Z'de online tek toplam; …`)
4. **Invoices**: `<details>`, summary `Faturalar ({n}) ve kalemler`. Each invoice:
   - top line `{dateTR} · {invoiceNo} · {money(net)} + KDV`, plus the badge `Kalemsiz` (gray) when there are no lines and
     the badge `Kontrol bekliyor` when `needsReview`;
   - then the cover note when it applies (§2.5);
   - then its lines: name (muted raw description underneath, `truncate`), class badge (`Komisyon` gray / `Erken ödeme`
     amber / `Komisyon dışı ücret` red / `Sipariş / ödeme altyapısı ücreti` amber / `Reklam / kampanya` blue /
     `Diğer ücret` gray), amount;
   - the stated base and rate when parsed: `Faturada yazan: %3 · işlem tutarı 9.300 ₺`;
   - a link `Faturada aç →` to `/panel/faturalar?ara={invoiceNo}`.
5. **Payout row** (`rounded-xl bg-panel px-3 py-2.5`). Texts by status:
   - `bekliyor`: `Hakediş: beklenen ~8.605,20 ₺ · son gün 30 Kasım` + sub `Satış 9.300 ₺ − faturalar 694,80 ₺`;
   - `gecikti`: the same in `text-bad` + `· {n} gün gecikti`;
   - `geldi`: `Hakediş geldi: 28 Kasım · 8.605,20 ₺` (good) + `· {n} gün geç` when late;
   - `eksik`: `Hakediş geldi: 28 Kasım · 8.000 ₺ · beklenenden 605,20 ₺ az` (warn);
   - `takip-oncesi`: `Hakediş: son gün 30 Eylül geçti (takip öncesi). İsterseniz işaretleyin.` (muted);
   - `faturasiz`: `Hakediş: fatura gelince son gün belli olur.` (muted);
   - expected unknown: `Hakediş: son gün 30 Kasım · beklenen tutar bilinmiyor (satış yok)`.

   Button: `Hakediş geldi` (primary, full width on the phone, 44 px) when not received; `Düzenle` (ghost) when received.
   Both open §3.5. A small text button `Satışı yaz` (or `Satışı düzelt` when typed) opens the same dialog with the
   sales field focused.

### 3.4 "Yemek kartları (toplam)" card

`CardHeader` icon `Wallet`, title `Yemek kartları (toplam)`, description `{Ekim 2026} · Z raporundaki yemek kartı ve
bütün yemek kartı faturaları`.

| Label | Value | Sub |
|---|---|---|
| Z'de yemek kartı | `15.500 ₺` | `31 / 31 gün raporlu`; or `3 gün rapor yok`; or `kasa raporları ayın ortasında başladı`; or `kasa raporu yok` |
| Kesilen | `977 ₺ + KDV` | `{n} fatura · {k} şirket` |
| Ortalama oran | `%6,3` | red when > 6,05 % |
| Beklenen hakediş | `~14.327,60 ₺` | `gelen {money}` |

Footer lines:
- Split coverage, only when ≥ 2 meal channels are active this month:
  - complete: `Karta göre ayrım her gün girildi: oranlar kart kart hesaplandı.` (info);
  - partial or none: `Kart kart oran için kasa raporunda yemek kartlarını ayrı girin (Z raporunda ayrı yazar). Bu ay {k} / {n} günde girildi.`
    (warn) + `ButtonLink` ghost `Kanallar` → `#kanallar`.
- Aggregate flags: `oran-sinir` on the aggregate (`Ortalama kesinti %6,3: en az bir yemek kartı %6'yı aşıyor.` — true
  by arithmetic, so `bad` when the source is complete); `fatura-yok` (aggregate text: `Ekim'de 15.500 ₺ yemek kartı
  satışı var ama hiçbir yemek kartı faturası gelmedi.`).

### 3.5 Dialog "Hakediş" (`channel-month-dialog.tsx`, client)

`Dialog` title `{Pluxee} · {Ekim 2026}`, description `Bankaya gelen hakedişi yazın. Banka hesabı panele bağlı değil;
geldiğini siz işaretlersiniz.`

Fields (single column, 48 px inputs on the phone):
1. `Segmented` `Geldi` / `Henüz gelmedi`. Default `Geldi` when opened from `Hakediş geldi`; the current state when
   opened from `Düzenle`.
2. `Geldiği gün` (date input), shown when Geldi. Default today, or the saved date. Allowed range: from the first day of
   the sales month to tomorrow. Error `Gün ayın başından önce ya da yarından sonra olamaz`.
3. `Gelen tutar (₺)` (`NumberInput`, decimal), shown when Geldi, required > 0. Default `expected` rounded to kuruş, or
   empty when unknown. Hint:
   `Banka hesabınıza geçen tutar. Beklenen: 8.605,20 ₺ (satış 9.300 ₺ − faturalar 694,80 ₺).` / when unknown:
   `Beklenen tutar bilinmiyor; bankadaki tutarı yazın.` Haftalık ödeyen platform:
   `Bu ayın satışları için gelen havalelerin toplamı.`
4. `Bu ayki satış (isteğe bağlı)` (`NumberInput`). Hint:
   `Kanalın kendi ekranındaki (ekstre, hakediş raporu) satış, KDV dahil. Boş bırakırsanız {source label}: {money}.` /
   `… Boş bırakırsanız satış bilinmez.`
5. `Not` (`Input`, max 200, optional).

Buttons: `Kaydet` (primary), `Vazgeç`. Both close the dialog before anything else happens. The dialog never navigates.

On success:
- toast `Pluxee Ekim hakedişi işaretlendi` / `Pluxee Ekim: hakediş işareti kaldırıldı` /
  `Pluxee Ekim satışı kaydedildi`;
- the toast has `Geri al` (10 s), which calls `saveChannelMonth` with the `previous` values the action returned.

### 3.6 "Kanallar" card (settings; `id="kanallar"`)

`CardHeader` icon `Settings2`, title `Kanallar`, description `Hangi kart ve platformları kullandığınızı ve hakedişin
kaç günde gelmesi gerektiğini seçin.`

One row per channel (all 9, meal first). Each row has:
- the label, and a muted kind (`Yemek kartı` / `Platform`);
- `Switch` `Kasa raporunda ayrı yaz`;
- `NumberInput` `Ödeme süresi (gün)`, width 5 rem. Hint for meal: `en çok 30 (yönetmelik)`; for platform: `sözleşmenizdeki süre`.

Footer note: `Bir grupta (yemek kartı ya da platform) iki ya da daha çok kanal "ayrı yaz" açıksa kasa raporunda o grubun
altında kanal kanal alanlar çıkar; toplam kendiliğinden dolar. Tek kanal açıksa alan çıkmaz, o grubun toplamı o kanalın
satışı sayılır.`

Button `Kaydet` (secondary). Toast `Kanallar kaydedildi`.

Default, when nothing has been saved: `split` is on for channels with a Komisyon invoice in the last 180 days, and
`payDays` is 30.

### 3.7 "Kurallar ve hesap" (details card)

Summary: `Kurallar ve hesap nasıl yapılır`. Body, short paragraphs:

- **Yemek kartı:** `Komisyon en çok %6 olabilir. Kira, cihaz, destek, bakım, depozito gibi adlarla ayrı ücret alınamaz. Hakediş, fatura tarihinden başlayarak en geç 30 gün içinde ödenir. (Perakende Ticarette Uygulanacak İlke ve Kurallar Hakkında Yönetmelik, madde 12/A)`
- **Sipariş platformları:** `1 Nisan 2026'dan beri kestikleri her ücreti satıcı panelinde kalem kalem göstermek zorundalar. Sipariş alma, iletme ve ödeme altyapısı için ayrı ücret alınamaz; reklam ve kampanya isteğe bağlıdır. (Ticaret Bakanlığı Genelgesi 2026/1)`
- **Gerçek oran:** `Kanalın o ay kestiği her şey (komisyon, erken ödeme ve diğer ücretler, KDV hariç) ÷ o kanaldan yapılan satış (KDV dahil). Satış önce sizin yazdığınızdan, sonra kasa raporlarındaki kanal kanal tutarlardan, sonra faturada yazan işlem tutarından alınır.`
- **Hangi ay:** `Yemek kartı faturası ayın ilk 5 gününde kesildiyse önceki ayın satışları için sayılır. Haftalık platform faturaları ay sınırında kaydığı için platformlarda 3 aylık oran gösterilir. Gelir-gider ise her faturayı kendi tarihinin ayına yazar.`
- **Hakediş:** `Beklenen = satış − kanalın faturaları (KDV dahil). Son gün = ayın son faturasının tarihi + ödeme süresi.`
- **Uyarılar:** `Uyarılar faturadaki kalem adlarına bakar; kesin hüküm değildir. Şüphede önce kanalın müşteri hizmetine yazın; çözülmezse Ticaret Bakanlığı'nın il müdürlüğüne şikâyet edebilirsiniz.`

### 3.8 Cash report form (staff and admin, `/panel/kasa`): per-channel amounts

Only when `splitChannels` returns ≥ 2 channels for a group (§5.2), plus any channel already stored on the report being
edited.

Under `Yemek kartı` in the "Z raporu (ModPOS)" card:
- A full-width sub-block `sm:col-span-2`, `rounded-xl bg-panel p-3`, label `Yemek kartları ayrı ayrı (isteğe bağlı)`
  and hint `Z raporunda her kart ayrı yazar; yazarsanız toplam kendiliğinden dolar.`
- Inside, `grid grid-cols-2 gap-2 sm:grid-cols-3`, one `NumberInput` per channel, labelled `Pluxee`, `Multinet`, … with
  placeholder `0`. 48 px height on touch, the same `field()` styling.
- When any sub-field has a value:
  - the `Yemek kartı` input becomes `readOnly` with the info background and shows Σ;
  - its hint becomes `Kartların toplamı`.

  When all sub-fields are emptied, the field becomes editable again and keeps the last sum.

The same block appears under `Online`, labelled `Platformlar ayrı ayrı (isteğe bağlı)`, with hint
`Z raporunda her platform ayrı yazar; yazarsanız toplam kendiliğinden dolar.`

Saved report view (`CashBreakdown`) and texts:
- the payment line gets a detail: `Yemek kartı 1.250 ₺ (Pluxee 800 ₺ · Multinet 450 ₺)`;
- WhatsApp: `• Yemek kartı: 1.250 ₺ (Pluxee 800 ₺, Multinet 450 ₺)`;
- e-mail: the same in the Z section.

A staff member sees only the labels of the channels in use. No rate, commission or payout reaches staff.

### 3.9 Tedarikçiler › channel supplier page

When the group has a Komisyon invoice and its name or aliases resolve to a channel (`channelOf`), one line appears under
the supplier info card (`Well`, `text-[13px]`):

`Komisyon kanalı: gerçek oran, faturadaki ücretler ve hakediş takibi` + link `Komisyon & hakediş →`
(`/panel/komisyonlar#{key}`).

### 3.10 Bell (admin, group `fatura`)

Items from `commissionAlerts(report, today)` (§5.3), at most 5. Hakediş items come first, then flags by date
descending:

| id | kind | title | body | href |
|---|---|---|---|---|
| `komisyon-gecikti-{key}-{month}` | danger | `Hakediş gecikti: {Pluxee} ({Ekim})` | `Son gün 30 Kasım · beklenen ~8.605,20 ₺. Geldiyse işaretleyin.` (no "beklenen" part when unknown) | `/panel/komisyonlar?ay={month}#{key}` |
| `komisyon-oran-{key}-{month}-{rate‰}` | warning | `{Pluxee} {Ekim}: kesinti %6,2` | `Yemek kartında yasal üst sınır %6.` | same |
| `komisyon-yasak-{key}-{month}-{invoiceIds}` | warning | `{Multinet} {Ekim}: komisyon dışı ücret olabilir` | `“POS Cihaz Kira Bedeli” 150 ₺` | same |

- `timeLabel`: the due date (hakediş) or the invoice date (flags), via `dateTR`.
- `unread: true`.
- The ids carry the facts, so a new rate or a new invoice shows as unread again.

### 3.11 Morning e-mail

A box `Komisyon ve hakediş` (amber, the same style as the pricing hold box) **after** the review and price-hold boxes:
- one line per new item: bold title + body;
- link `Komisyon & hakediş'te aç` → `{APP_URL}/panel/komisyonlar`.

Plain-text version: the same lines under `Komisyon ve hakediş:`.

Subject (R5 step 4 list, after holds):
- when these are the only news: `Sabah özeti: {first title}`, e.g. `Sabah özeti: Hakediş gecikti: Pluxee (Ekim)`;
- otherwise the extras list gets `hakediş gecikti` (when there is one) or `komisyon uyarısı`.

### 3.12 Bugün (today plan; optional row, admin)

Key `komisyon`, placed after `odeme`, only when ≥ 1 `gecikti`:
- status `warn`, title `Hakedişler`, badge `{n} gecikti`;
- detail `{Pluxee} ({Ekim}) · son gün {30 Kasım}` + ` ve {n−1} kanal daha`;
- href `/panel/komisyonlar`, action `Hakedişlere bak`.

### 3.13 Nakit planı (insight plan; optional lines)

Each pending payout with a known expected amount becomes an incoming, estimated line:
- title `Hakediş · {Pluxee} ({Ekim})`;
- date `max(today + 1, due)`; marked `Gecikmiş` when overdue;
- amount `expected − received`.

Pending payouts with an unknown amount are listed in the plan's notes:
`Tutarı bilinmeyen hakediş: Pluxee (Ekim).`

---

## 4. Data model (`src/server/db/schema.ts`; one migration generated at merge time per R2)

Name: `npm run db:generate -- --name komisyon_hakedis`. The number is decided at merge (R2); never hand-edit.

1. **New column on `cash_reports`** (kasa's columns are already there):
   ```ts
   /**
    * Z raporundaki kanal kanal tutarlar (isteğe bağlı): yemek kartları ve platformlar ayrı yazıldıysa
    * { pluxee: 800, multinet: 450, trendyol: 300 }. Bir grubun anahtarları varsa toplamı o grubun alanına (mealCard /
    * online) eşittir; boş = ayrılmadı. Anahtarlar src/lib/commission/channels.ts. Ayrıntı: docs/KOMISYON.md.
    */
   channelSales: jsonb("channel_sales").$type<Partial<Record<ChannelKey, number>>>(),
   ```
2. **New table `commission_months`**: one row per channel and sales month, created only when the owner marks or types
   something:
   ```ts
   /**
    * Komisyon kanalının ayı: elle girilen satış (kanalın ekstresinden) ve gelen hakediş. Banka hesabı bağlı olmadığı için
    * hakediş elle işaretlenir. Satır yalnız yönetici bir şey yazınca açılır; ekran faturalardan ve kasa raporlarından
    * hesaplar. Ayrıntı: docs/KOMISYON.md.
    */
   export const commissionMonths = pgTable(
     "commission_months",
     {
       id: serial("id").primaryKey(),
       /** Kanal anahtarı (pluxee, multinet, …, trendyol) */
       channel: text("channel").notNull(),
       /** Satışların ayı (YYYY-MM); faturanın kapsadığı ay */
       month: text("month").notNull(),
       /** Elle girilen satış, KDV dahil; boş = kasa raporlarından / faturadan */
       sales: doublePrecision("sales"),
       /** Hakedişin geldiği gün (YYYY-MM-DD); boş = gelmedi */
       receivedOn: text("received_on"),
       /** Gelen tutar (₺); receivedOn ile birlikte dolu ya da boş */
       received: doublePrecision("received"),
       note: text("note"),
       updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
       updatedByName: text("updated_by_name"),
       createdAt: createdAt(),
       updatedAt: updatedAt(),
     },
     (t) => [
       uniqueIndex("commission_months_channel_month_uq").on(t.channel, t.month),
       check("commission_months_received_pair", sql`(${t.receivedOn} is null) = (${t.received} is null)`),
     ],
   );
   ```
   A serial id plus a unique index follows the repo convention (the repo has no composite primary keys); the upsert
   targets `[channel, month]`. `check` is already imported in schema.ts.
3. **`integration_state` keys, no schema change:**
   - `komisyon.ayar`: `{ channels: Partial<Record<ChannelKey, { split: boolean; payDays: number }>> }`;
   - `komisyon.since`: `"YYYY-MM-DD"`.

Volumes: about 9 channels × 12 months a year in `commission_months`; the jsonb column is a few keys per report.

- **Backup:** ops discovers the table at runtime (R6). Null vs 0 stays distinct.
- **`db:reset`:** leaves `commission_months` and both keys alone. They are keyed by channel and month, not by invoice
  ids, so reloading invoices cannot point them at the wrong rows. Add "komisyon hakediş işaretleri" to README's
  "Silmedikleri". Truncating `cash_reports` is already not done.

Rollback (DEPLOY §7, ops): additive. Old code ignores the new column and table, so Instant Rollback is safe.

---

## 5. Logic

### 5.1 Pure: `src/lib/commission/channels.ts` (new; no server imports)

```ts
export type ChannelKind = "meal" | "platform";
export const CHANNEL_KEYS = ["pluxee", "multinet", "edenred", "setcard", "metropol", "yemeksepeti", "trendyol", "getir", "migros"] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];
export interface ChannelDef { key: ChannelKey; label: string; kind: ChannelKind; prefixes: readonly string[]; exclude?: RegExp }
export const CHANNELS: readonly ChannelDef[];                 // §2.3 table, meal first
export const channelDef: (key: ChannelKey) => ChannelDef;
export const isChannelKey: (v: string) => v is ChannelKey;

/** tr küçük harf, ı→i, NFKD aksan silme, harf/rakam dışı → boşluk, tek boşluk (insight'ın foldName'iyle aynı algoritma) */
export function fold(s: string): string;
/** İlk eşleşen ad kazanır; hiçbiri değilse null. compact(fold(name)).startsWith(prefix) && !exclude.test(fold(name)) */
export function channelOf(names: readonly (string | null | undefined)[]): ChannelKey | null;

export type LineClass = "komisyon" | "erken" | "yasak" | "asli" | "reklam" | "diger";
export const LINE_LABEL: Record<LineClass, string>;           // §2.5
export function classifyLine(text: string, kind: ChannelKind): LineClass;
export interface Stated { base: number | null; rate: number | null; period: { from: string; to: string } | null; month: string | null }
export function parseStated(text: string): Stated;           // §2.5, conservative
export function parseTRAmount(raw: string): number | null;   // "12.345,67" | "12345,67" | "12345.67" → number
```

### 5.2 Pure: `src/lib/commission/report.ts` (new)

Input, built by the server loader from plain rows:

```ts
export interface CommissionInvoiceIn {
  id: number; date: string; supplier: string; names: string[];      // names: supplier + kartın adı ve diğer adları
  invoiceNo: string | null; description: string | null; category: string;
  amount: number; discount: number; payable: number; needsReview: boolean;
  lines: { name: string; description: string | null; netTotal: number }[];
}
export interface TillRowIn { date: string; zTotal: number; mealCard: number; online: number; channelSales: Partial<Record<ChannelKey, number>> | null }
export interface ChannelMonthIn { channel: ChannelKey; month: string; sales: number | null; receivedOn: string | null; received: number | null; note: string | null }
export interface ChannelSettings { split: boolean; payDays: number }
export interface CommissionInput {
  today: string;                  // todayTR(), okunduktan sonra
  through: string;                // dün (iş günü − 1), eksik gün hesabı için
  since: string;                  // komisyon.since ?? today
  fromMonth: string;              // pencere başı (ekranda 12 ay geriden, zilde 4 ay)
  invoices: CommissionInvoiceIn[];// Komisyon + kanal tedarikçisinin mal dışı faturaları (baska-kategori için)
  till: TillRowIn[];
  firstReport: string | null;     // firstCashReportDate()
  marks: ChannelMonthIn[];
  settings: Partial<Record<ChannelKey, ChannelSettings>>;
}
```

Output:

```ts
export type SalesSource = "elle" | "kasa" | "fatura" | "tek";
export type PayoutStatus = "geldi" | "eksik" | "bekliyor" | "gecikti" | "takip-oncesi" | "faturasiz" | "yok";
export type FlagKey = "oran-sinir" | "yasak-ucret" | "erken-odeme" | "asli-ucret" | "kalemsiz" | "reklam" | "fatura-yok"
  | "oran-sicrama" | "taban-farki" | "kasa-eksik" | "baska-kategori" | "hakedis-gecikti" | "hakedis-eksik" | "hakedis-gec";
export interface Flag { key: FlagKey; level: "bad" | "warn" | "info"; text: string; lines?: string[] }
export interface InvoiceView {
  id: number; date: string; invoiceNo: string | null; net: number; vat: number; month: string; coverNote: string | null;
  lineless: boolean; needsReview: boolean; stated: Stated;
  lines: { name: string; description: string | null; amount: number; cls: LineClass }[];
}
export interface ChannelMonth {
  channel: ChannelKey; kind: ChannelKind; month: string;
  invoices: InvoiceView[];
  fees: Record<LineClass, number>; feesTotal: number; vat: number; payable: number;
  sales: { amount: number; source: SalesSource } | null; salesReason: string | null;
  kasaSales: number | null;                  // kaynak 2/4 hesabı (elle girilmiş olsa da, ipucu için)
  rate: number | null; rate3: number | null;
  payout: { expected: number | null; due: string | null; received: number | null; receivedOn: string | null;
            status: PayoutStatus; lateDays: number | null; daysOverdue: number | null };
  mark: ChannelMonthIn | null;
  otherCategory: { count: number; total: number; categories: string[] };
  flags: Flag[];
}
export interface GroupMonth {               // yemek kartı toplamı (ve platform özeti)
  kind: ChannelKind; month: string;
  zTotal: number | null; reportDays: number; missing: string[]; partial: boolean;
  splitDays: number; groupDays: number;      // ayrım girilen gün / grup tutarı > 0 olan gün
  feesTotal: number; payable: number; rate: number | null;
  expected: number | null; received: number; activeChannels: ChannelKey[]; flags: Flag[];
}
export interface CommissionReport {
  months: string[];                          // fromMonth … bu ay
  rows: ChannelMonth[];                      // yalnız etkinliği olan kanal-aylar
  groups: GroupMonth[];
  unmatched: { id: number; date: string; supplier: string; net: number }[];
  pending: ChannelMonth[];                   // §3.2 kart 1: gecikti | eksik | (bekliyor ve ≤ 7 gün)
  defaultMonth: string;
}

export const MEAL_LIMIT = 0.06;
export const LIMIT_TOLERANCE = 0.0005;
export const JUMP_PP = { meal: 0.01, platform: 0.03 } as const;
export const JUMP_REL = 0.2;
export const BASE_DIFF = 0.05;
export const PAYOUT_TOL = { abs: 50, rel: 0.02 } as const;
export const DEFAULT_PAY_DAYS = 30;
export const MEAL_MAX_PAY_DAYS = 30;
export const ALERT_INVOICE_DAYS = 45;
export const PLATFORM_RULES_FROM = "2026-04-01";
export const INVOICE_GRACE_DAY = 15;   // fatura-yok: sonraki ayın 15'inden sonra

export function coverMonth(inv: { date: string; text: string }, kind: ChannelKind): { month: string; note: string | null };
export function channelTill(rows: TillRowIn[], month: string, through: string, firstReport: string | null): {
  meal: number; online: number; split: Partial<Record<ChannelKey, number>>;
  reportDays: number; missing: string[]; partial: boolean;
  mealDays: number; mealSplitDays: number; onlineDays: number; onlineSplitDays: number;
};
export function resolveSales(/* §2.4 table */): { amount: number; source: SalesSource } | null;
export function payoutOf(cm: Pick<ChannelMonth, "sales" | "payable" | "invoices">, mark: ChannelMonthIn | null,
  payDays: number, today: string, since: string): ChannelMonth["payout"];
export function buildCommissionReport(input: CommissionInput): CommissionReport;

/** Kasa formunda ayrı alan çıkacak kanallar: bir grupta ≥ 2 kanal varsa o grup; kayıtlı raporun anahtarları her zaman */
export function splitChannels(settings: Partial<Record<ChannelKey, ChannelSettings>>, recent: readonly ChannelKey[],
  stored?: Partial<Record<ChannelKey, number>> | null): { meal: ChannelKey[]; platform: ChannelKey[] };
export function effectiveSettings(settings: Partial<Record<ChannelKey, ChannelSettings>>, recent: readonly ChannelKey[]): Record<ChannelKey, ChannelSettings>;

/** Zil ve sabah e-postası (§3.10–3.11): anahtar, düzey, başlık, metin, adres, tarih */
export interface CommissionAlert { key: string; level: "danger" | "warning"; title: string; body: string; href: string; date: string }
export function commissionAlerts(report: CommissionReport, today: string): CommissionAlert[];
export function overduePayouts(report: CommissionReport): ChannelMonth[];   // Bugün ve nakit planı
```

Algorithm of `buildCommissionReport` (order matters):

1. **Invoices.**
   - For each invoice, `channel = channelOf(names)`. When it is null and the category is Komisyon, the invoice goes to
     `unmatched`. Non-Komisyon invoices only feed `otherCategory` (not goods, not `SEPARATE_CATEGORIES`, not
     "Kuruluş & Demirbaş").
   - `text = [description, ...lines.map(l => l.name + " " + l.description)].join(" ")`. Compute `stated` (from the
     whole text) and `{month, note} = coverMonth(...)`.
   - Lines → `classifyLine` → scale to the invoice net (§2.5). Apply the single-line rule and the lineless rule.
2. **Group.** Group the invoices by `(channel, month)`. Sum `fees`, `feesTotal`, `payable`, `vat`.
3. **Till.** For every month in the window: `channelTill`.
   - Active channels of a group in a month = channels with an invoice in that month ∪ channels with a split amount > 0.
   - Create a `ChannelMonth` for every (channel, month) that has an invoice, a split amount, or a mark.
4. **Sales.** `resolveSales` in §2.4 order, plus `salesReason` when null.
   - `kasaSales` = the source 2/4 value even when an `elle` value exists (for the dialog hint and `taban-farki`).
5. **Rates.** `rate = feesTotal ÷ sales` when sales > 0.
   - `rate3` (platform): the window `[month−2, month]`, months with sales; null when fewer than 2.
6. **Flags** (§2.6). The jump uses the previous 3 months' `rate` of the same channel, ignoring nulls.
7. **Payout.** `payoutOf(...)` with `payDays = effectiveSettings(...)[channel].payDays`, then the payout flags.
8. **Groups.** `GroupMonth` per (kind, month) with any Z money or any invoice of that kind. The aggregate flags are
   `oran-sinir` (meal only) and `fatura-yok`.
9. **Pending and default month.** `pending` = `gecikti` ∪ `eksik` ∪ (`bekliyor` and due ≤ today + 7), sorted by due.
   `defaultMonth` per §3.2.

Rounding:
- money to 2 decimals (`r2`);
- rates are kept unrounded; display uses `pct(v, 1)`;
- comparisons use unrounded values with the tolerances above.

Dates: `addDays`, `shiftMonth`, `todayTR` from `src/lib/reminders.ts`. Days in a month come from the existing helper used
by engine (`daysInMonth`). No `new Date()` inside the lib.

### 5.3 `commissionAlerts` rules

- `gecikti` rows → `{ key: "gecikti:{ch}:{month}", level: "danger", … }`.
- `oran-sinir` with level bad, and `yasak-ucret`, on rows whose latest invoice date ≥ today − `ALERT_INVOICE_DAYS`:
  - `oran` → key `"oran:{ch}:{month}:{Math.round(rate*1000)}"`;
  - `yasak` → key `"yasak:{ch}:{month}:{invoiceIds.join(".")}"`.
- Order: danger first, then date descending. Cut at 5.

---

## 6. Server

### 6.1 `src/server/data/commission.ts` (new, `import "server-only"`)

```ts
export async function loadCommissionInput(opts: { months: number }): Promise<CommissionInput>
export async function loadCommissionReport(opts?: { months?: number }): Promise<CommissionReport>  // = build(load)
export async function loadChannelSettings(): Promise<Partial<Record<ChannelKey, ChannelSettings>>>
export async function recentChannels(days = 180): Promise<ChannelKey[]>   // Komisyon faturası olan kanallar
export async function loadSplitChannels(stored?: Partial<Record<ChannelKey, number>> | null): Promise<{ meal: { key: ChannelKey; label: string }[]; platform: { key: ChannelKey; label: string }[] }>
export async function ensureCommissionSince(): Promise<string>           // yalnız yazma yollarında
```

`loadCommissionInput` runs one `Promise.all`:
1. `invoices`: `category = 'Komisyon'`, or `category not in (GOODS_CATEGORIES, SEPARATE_CATEGORIES, 'Kuruluş & Demirbaş')`.
   The second branch is narrowed in JS to channel suppliers (for `baska-kategori`). Window: `date >= fromMonth-01`.
   - Columns: id, date, supplier, invoiceNo, description, category, amount, discount, payable, needsReview, plus
     `supplierTaxNumber` when vkn's column exists.
   - The whole set is small (tens of rows a month).
2. `parasut_bill_lines` for those ids (`invoiceId, productName, description, netTotal`), only for Komisyon ids.
3. `cash_reports` (`date, zTotal, mealCard, online, channelSales`) with `date >= fromMonth-01`, plus
   `firstCashReportDate()` (exists in `src/server/data/cash-reports.ts`).
4. `commission_months` with `month >= fromMonth`.
5. Supplier cards for the names: vkn's `supplierResolver(cards, await loadSupplierRefs())` when merged; fallback
   `cardIndex(await loadSupplierCards())` + `cardFor`. `names = [supplier, card?.name, ...card?.aliases]`.
6. `integration_state` keys `komisyon.ayar` and `komisyon.since`.

Then, **after** the awaited reads:
- `today = todayTR()`;
- `through = addDays(businessDate(), -1)`;
- `since = stored ?? today`.

Reading the clock after the awaited reads follows the dataset.ts / kasa pattern and Next's rule that the current time
must not be read in a prerender (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/io.md`,
`02-guides/migrating-to-cache-components.md` §3). The page is already dynamic: it calls `requireAdmin` (cookies) first.

**The bell window is 4 months** (`months: 4`); the screen window is 13.

### 6.2 Actions: `src/server/actions/commission.ts` (new, `"use server"`)

Pattern: `attempt(...)`, `UserError`, zod, `requireAdmin`, `refresh()` from `next/cache` (docs `04-functions/refresh.md`),
`logActivity`.

```ts
const monthInput = z.object({
  channel: z.enum(CHANNEL_KEYS),
  month: zMonth,
  received: z.object({ on: zDate, amount: z.number().finite().positive("Gelen tutarı yazın").max(10_000_000) }).nullable(),
  sales: z.number().finite().min(0, "Satış eksi olamaz").max(10_000_000).nullable(),
  note: zOptText(200),
});
export async function saveChannelMonth(input: z.input<typeof monthInput>): Promise<Attempt<{ previous: z.input<typeof monthInput> }>>
```

- **Validation.** `received.on` must be in `[month-01, addDays(todayTR(), 1)]`, else
  `UserError("Gün ayın başından önce ya da yarından sonra olamaz")`. The month must be ≤ the current month, else
  `UserError("Gelecek ay işaretlenemez")`.
- **Write.** In a transaction, upsert on `(channel, month)`:
  - `receivedOn` / `received` from `received` (null clears);
  - `sales`;
  - `note`;
  - `updatedBy` / `updatedByName` from `me`.

  When everything ends up null (no received, no sales, no note), the row is **deleted**, so no empty rows remain.
- **Return.** The previous row's values as `previous`, for "Geri al". The undo calls `saveChannelMonth(previous)`.
- **`ensureCommissionSince()`.** This is a write path; `ON CONFLICT DO NOTHING`.
- **`logActivity` detail texts:**
  - `Hakediş geldi: Pluxee Ekim 2026 · 8.605,20 ₺ (28 Kasım)`;
  - `Hakediş işareti kaldırıldı: Pluxee Ekim 2026`;
  - `Komisyon kanalı satışı: Pluxee Ekim 2026 → 9.300 ₺` / `… → boş (kasa raporlarından)`.

  Action name: `Komisyon & hakediş`.
- `refresh()`.

```ts
const settingsInput = z.object({ channels: z.record(z.enum(CHANNEL_KEYS), z.object({ split: z.boolean(), payDays: z.number().int().min(1).max(90) })) });
export async function saveCommissionSettings(input: z.input<typeof settingsInput>)
```

- Meal channels with `payDays > 30` → `UserError("Yemek kartında ödeme süresi en çok 30 gün olabilir (yönetmelik)")`.
- Upsert `integration_state` `komisyon.ayar`. Log `Kanallar: Pluxee, Multinet kasa raporunda ayrı · Trendyol Go 14 gün`.
- `refresh()`.

No step-up password is needed (adminstepup's `where` list is unchanged): neither action affects an admin or credentials.

### 6.3 Cash report changes (kasa files; after kasa merged)

- **`src/lib/cash-report.ts`:**
  - `CashReportFields.channelSales: Partial<Record<ChannelKey, number>> | null`;
  - `paymentLines(f)` items gain `detail?: string`, built by a new `splitText(f.channelSales, group)` →
    `"Pluxee 800 ₺ · Multinet 450 ₺"`;
  - `whatsappText` appends ` (Pluxee 800 ₺, Multinet 450 ₺)` to the line;
  - pure `normalizeSplit(raw, totals): { channelSales; error: string | null }`. It drops unknown keys and zeros. When a
    group has keys and `|Σ − total| ≥ 0,01`, the error is `Yemek kartı toplamı kartların toplamıyla tutmuyor` /
    `Online toplamı platformların toplamıyla tutmuyor`;
  - kasa's `FIELD_LABELS` gets `channelSales: "Kart / platform ayrımı"`; `revisionChanges` treats it like a text field
    (`Kart / platform ayrımı değişti`).
- **`src/server/actions/cash-report.ts`:**
  - `reportSchema.channelSales: z.record(z.string(), zAmount).nullable().default(null)`;
  - after parse, `normalizeSplit` → `UserError(error)` when set;
  - the stored `channelSales` is null when empty;
  - the revision snapshot (kasa) includes it automatically through `CashReportFields`.
- **`src/server/data/cash-reports.ts`:** `toCashDTO` adds `channelSales`.
- **`src/server/notify/cash-report-template.ts`:** the detail in the Z section.
- **`src/app/panel/kasa/page.tsx`:** loads `loadSplitChannels(report?.channelSales)` (staff too: labels only) and passes
  `split` to `CashForm`.
- **`src/app/panel/kasa/cash-form.tsx`:**
  - the §3.8 blocks;
  - `values.split: Record<ChannelKey, string>`;
  - the sum effect;
  - the dirty snapshot includes `split`;
  - submit sends `channelSales` (numbers, empty → omitted).
- **`src/app/panel/kasa/cash-summary.tsx`:** the detail under the payment line.

### 6.4 Bell: `src/server/actions/notifications.ts` (shared; additive per R5)

New `async function commissionNotifications(): Promise<PanelNotification[]>`:
- `loadCommissionReport({ months: 4 })` → `commissionAlerts(report, todayTR())` → map to §3.10 with `group: "fatura"`.

It joins the admin `Promise.all` next to `invoiceNotifications()`, with `.catch(() => [])`, and the result is appended
after `invoices`. The staff branch is untouched.

### 6.5 Morning e-mail (shared; additive per R4 / R5)

- **`src/server/notify/digest-template.ts`:**
  - `DigestInvoices.commission?: { items: { title: string; body: string }[] }`;
  - the box after the review box and pricing's holds box;
  - the plain-text lines;
  - the subject part `commissionPart` added to ops' step-4 candidates after holds (§3.11).
- **`src/server/notify/digest.ts`:**
  - new `loadDigestCommission(): Promise<{ items; keys: string[] }>`:
    1. `await ensureCommissionSince()` (a cron/manual write path);
    2. `loadCommissionReport({ months: 4 })` → `commissionAlerts`;
    3. drop alerts whose `komisyon:{key}` is already in `notification_log`;
  - `runReminderDigest`:
    - fills `invoices.commission`;
    - `invoiceNews ||= items.length > 0`;
    - the key seed gets `:k{keys.join(",")}`;
    - after a successful send, `logRows` gets `{ key: "komisyon:" + k, subject, recipients, ok: true }` for every key;
    - the whole commission part is wrapped in `.catch(() => ({ items: [], keys: [] }))`, so it can never block the
      e-mail.

### 6.6 Optional integrations (only if the plan's module is on the branch; otherwise skip, nothing else depends on them)

- **today:** `src/app/panel/bugun/logic.ts` gets `DayFacts.commission?: { overdue: { label: string; month: string; due: string }[] } | null`
  and a `commissionRow(f)` placed after `odeme` (admin only). `src/server/data/today.ts` › `adminFacts` gets
  `loadCommissionReport({ months: 4 }).then(overduePayouts)` inside the admin `Promise.all`, through `safe()`. One
  scenario in `tests/bugun.test.ts`. The source test there ("admin loaders only in `adminFacts`") must list
  `loadCommissionReport`.
- **insight cash plan:**
  - `PlanKind` adds `"payout"`;
  - `CashPlanInput.payouts?: readonly { key: string; title: string; due: string; amount: number; overdue: boolean }[]`;
  - in `buildCashPlan`, each payout is an `in`, `estimated: true` line at `max(i=1, due)` within the horizon;
  - the loader passes `overduePayouts` + `bekliyor` rows with a known expected amount;
  - one test in `tests/nakit-plani.test.ts` (or insight's test file name).

  The future-sales timing refinement is **deferred**: meal-card and online money for future days still lands the same
  day in insight's sales line. Pending payouts are past sales, so there is no double count.

---

## 7. Files

### Add
| File | Content |
|---|---|
| `src/lib/commission/channels.ts` | §5.1 |
| `src/lib/commission/report.ts` | §5.2–5.3 |
| `src/server/data/commission.ts` | §6.1 |
| `src/server/actions/commission.ts` | §6.2 |
| `src/app/panel/komisyonlar/page.tsx` | Sync page + `Suspense` + `async CommissionContent`; `requireAdmin()` first; `export const metadata = { title: "Komisyon & hakediş" }`; §3.2 layout |
| `src/app/panel/komisyonlar/channel-card.tsx` | Server component: §3.3 (rate block, history strip, flags, `<details>` invoices, payout row); renders `PayoutButton` |
| `src/app/panel/komisyonlar/meal-total-card.tsx` | Server component: §3.4 |
| `src/app/panel/komisyonlar/pending-card.tsx` | Server component: §3.2 card 1 |
| `src/app/panel/komisyonlar/channel-month-dialog.tsx` | `"use client"`: `PayoutButton` + dialog §3.5, sonner toast with `Geri al` |
| `src/app/panel/komisyonlar/channel-settings.tsx` | `"use client"`: §3.6 |
| `src/app/panel/komisyonlar/texts.ts` | Pure: status/badge/flag → Turkish text and tone (`payoutText`, `statusBadge`, `sourceLabel`, `reasonText`); tested |
| `tests/komisyon.test.ts` | §9 |
| `docs/KOMISYON.md` | §10 |
| `drizzle/00NN_komisyon_hakedis.sql` + meta | generated at merge (R2) |

### Change
| File | Change |
|---|---|
| `src/server/db/schema.ts` *(shared)* | §4 |
| `src/components/panel/nav.ts` *(shared)* | §3.1 (`Percent` import, NAV_GROUPS item, NAV_TREE child, SHORT_TITLES) |
| `src/lib/cash-report.ts` *(shared, kasa/today)* | §6.3 |
| `src/server/actions/cash-report.ts`, `src/server/data/cash-reports.ts`, `src/server/notify/cash-report-template.ts` | §6.3 |
| `src/app/panel/kasa/page.tsx`, `cash-form.tsx`, `cash-summary.tsx` | §3.8, §6.3 |
| `src/server/actions/notifications.ts` *(shared)* | §6.4 |
| `src/server/notify/digest.ts`, `digest-template.ts` *(shared)* | §6.5 |
| `src/app/panel/tedarikciler/[cari]/page.tsx`, `supplier-client.tsx` | §3.9: page computes `commissionChannel = g.invoices.some(i => i.category === COMMISSION_CATEGORY) ? channelOf([g.name, ...g.names]) : null` → prop `commission?: { label: string; href: string }`, one `Well` line |
| `src/app/panel/yardim/page.tsx` *(shared)* | §10 |
| `src/lib/cash-month.ts` *(kasa; owner question 4)* | `cardShare = Σ card ÷ Σ zTotal` (meal cards out), test updated |
| `src/app/panel/ayarlar/fields.ts` | `kartOrani` hint (owner question 4) |
| `tests/kasa-raporu.test.ts`, `tests/hatirlaticilar-digest.test.ts`, `tests/mobile-nav.test.ts`, `tests/yardim.test.ts` | §9 |
| `README.md`, `docs/KASA-RAPORU.md`, `docs/BILDIRIMLER.md`, `docs/TEDARIKCILER.md` | §10 |
| *(optional)* `src/app/panel/bugun/logic.ts`, `src/server/data/today.ts`, `tests/bugun.test.ts` | §6.6 |
| *(optional)* insight's cash plan lib, loader and test | §6.6 |

Not touched:
- `src/lib/calc/engine.ts` (Gelir-gider's commission rows stay per supplier by invoice date);
- `src/server/parasut/mapping.ts` (categorisation unchanged);
- `src/server/parasut/sync.ts`;
- `src/app/panel/page.tsx`.

---

## 8. Edge cases

- **Today's local data** (Excel commission invoices, no lines, no cash reports):
  - every card shows `Kalemsiz` invoices, `Satış bilinmiyor: bu ay kasa raporu yok…`, and a rate of `–`;
  - Eylül 2026 Pluxee (26,78 ₺, dated 30.09) → due 30.10;
  - with no `since` stored, `since = today`, so a past due shows `Takip öncesi` and never `Gecikti`;
  - Trendyol Go Eylül = 5 invoices, 1.184,78 ₺ net (the Excel finding says "1.185 TL"), headline `Gerçek oran (3 ay)` `–`.
- **Production, October 2026:** kasa started mid-month (`partialFrom`), so October rates stay unknown unless the owner
  types sales. November 2026 is the first real month. Said in the PR text.
- **A meal channel used rarely:**
  - its invoice shows up in a month where only one other channel has the split switched on → the active set has 2 →
    per-channel sales are unknown (not misattributed);
  - the aggregate still shows;
  - the aggregate card tells the owner to switch the split on.
- **A refund (iade) commission invoice** reduces fees and payable. A negative rate is shown as `–`.
- **Two invoices of the same channel in one month** (meal correction invoice): they are summed. The due date is the
  later one.
- **A platform pays weekly and the owner marks the month once:** received is compared with the month's expected amount
  within tolerance. Small week-boundary differences show `eksik` only beyond max(50 ₺, 2 %).
- **The owner types sales that disagree with kasa:** typed wins, and `taban-farki` shows only against the stated
  invoice base. The dialog hint shows the kasa value, so the difference is visible.
- **A mark for a month with no invoice and no sales** is allowed (an early transfer). Status `geldi`, no expected.
- **Report edited after the month closed:** the next page load recomputes (nothing is stored).
- **A channel switched off in settings** while old reports carry its key: those reports still show it, and the sums
  still count it.
- **Staff:**
  - never loads `loadCommissionReport`. The cash form's `loadSplitChannels` returns labels only; a source test checks
    that it selects no amounts;
  - submitting a split with a key that is not a channel → dropped by `normalizeSplit`.
- **Dialogs:** the dialog closes before toast/refresh and never navigates (Activity keeps hidden routes;
  `node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md`). The bell and e-mail links point at
  `?ay=…#key` anchors outside dialogs.
- **Unknown future Komisyon suppliers** (e.g. a new meal card brand) land in "Kanalı bulunamayan…". Adding a brand =
  one row in `CHANNELS` + a test.
- **VAT on Excel rows** is computed from payable − net (`vat` is 0 there).
- **The bell and the e-mail fail independently:** both are wrapped; the page shows its own data even when the bell
  part throws.

---

## 9. Tests (`npx tsx --test`)

### `tests/komisyon.test.ts` (new)

**Fixture F1.** Today `2026-12-02`, `through 2026-12-01`, `since 2026-11-10`, `firstReport 2026-08-01`.
- **Cash reports, 1–31 Oct**, every day:
  - zTotal 10.000;
  - mealCard 500 with `{pluxee: 300, multinet: 200}`;
  - online 400 with `{trendyol: 400}`.
- **Pluxee** `2026-10-31`, lines `Komisyon Bedeli` 279 and `Erken Ödeme Komisyonu` 300; payable 694,80.
- **Multinet** `2026-11-03`, lines `Komisyon` 248 and `POS Cihaz Kira Bedeli` 150; payable 477,60.
- **Trendyol Go**, four weekly invoices `2026-10-06/13/20/27`, 300 each `Komisyon`. The 27th also has
  `Online Ödeme Hizmet Bedeli` 40.
- **Pluxee** `2026-09-30` 270 with typed September sales 9.000. **Pluxee** August typed sales 9.000 with invoice
  `2026-08-31` 270.

Cases:
1. **`channelOf`:**
   - `"PLUXEE TÜRKİYE KURUMSAL HİZMETLER A.Ş."` → pluxee; `"Sodexo Avantaj ve Ödüllendirme"` → pluxee;
   - `"Set Kart"`, `"SETCARD"` → setcard; `"Yemek Sepeti"`, `"YEMEKSEPETİ ELEKTRONİK…"` → yemeksepeti;
   - `"Trendyol Go"` → trendyol; `"Metropol İstanbul AVM"` → null; `"MetropolCard"` → metropol; `"Kaldi"` → null;
   - the first name wins (card name used when the invoice name is unknown);
   - every name in `COMMISSION_SUPPLIERS` (imported from `src/server/parasut/mapping.ts`) resolves.
2. **`classifyLine`:**
   - meal: `Komisyon Bedeli` → komisyon; `Erken Ödeme Komisyonu` → erken; `POS Cihaz Kira Bedeli` → yasak;
     `POS İşlemleri Komisyonu` → komisyon (weak word with komisyon); `Teknik Destek Bedeli` → yasak; `Kiraz` (fake) →
     diger; `Reklam katılım` → yasak;
   - platform: `Online Ödeme Hizmet Bedeli` → asli; `Öne Çıkarma Reklamı` → reklam; `Komisyon` → komisyon;
     `Kira` → diger.
3. **`parseStated`:**
   - `"01.10.2026-31.10.2026 dönemi işlem tutarı 9.300,00 TL üzerinden %3"` → base 9300, rate 0.03, period Oct;
   - `"Eylül 2026 hizmet bedeli"` → month 2026-09;
   - `"matrah 279,00"` → base null;
   - a base whose ratio to the net is > 40 % → null.
4. **`coverMonth`:** Multinet `2026-11-03` → `2026-10` + note `3 Kasım tarihli fatura · Ekim satışları için`; Pluxee
   `2026-10-31` → `2026-10`, no note; a platform `2026-11-03` → `2026-11`; a period in the text wins over both rules.
5. **Scaling:** lines 100 + 50 with an invoice net of 140 → 93,33 / 46,67; a single-line `Hizmet faturası` → komisyon;
   no lines → `lineless` and komisyon = net.
6. **Sales sources:**
   - Pluxee Oct `kasa` 9.300; Multinet Oct `kasa` 6.200; Trendyol Oct `kasa` 12.400;
   - Pluxee Sep `elle` 9.000;
   - a month with one meal invoice and no split → `tek` = group total;
   - two meal channels and 10 / 31 split days → null with reason `… 10 / 31 günde girildi.`;
   - a partial first month → null (`…ayın ortasında başladı.`);
   - every invoice stating its base and no kasa → `fatura`.
7. **Rates and flags:**
   - Pluxee Oct rate 579 / 9.300 = 6,226 % → `oran-sinir` bad + `erken-odeme` (`+%3,2`);
   - Multinet 398 / 6.200 = 6,419 % → `oran-sinir` bad + `yasak-ucret` naming `“POS Cihaz Kira Bedeli” 150 ₺`;
   - a 6,04 % rate → no flag (tolerance);
   - Pluxee jump from 3,0 % (Aug, Sep) to 6,2 % → `oran-sicrama`;
   - Trendyol `asli-ucret` (invoice ≥ 2026-04-01); the same line on a `2026-03-20` invoice → no flag;
   - with 3 missing report days, `oran-sinir` drops to warn and `kasa-eksik` is added.
8. **Meal aggregate Oct:** sales 15.500, fees 977, rate 6,30 % → `oran-sinir` bad; expected 15.500 − 1.172,40 =
   14.327,60; `splitDays = groupDays = 31`.
9. **Payout:**
   - Pluxee Oct expected 8.605,20, due 2026-11-30, today 12-02, not received → `gecikti`, `daysOverdue 2`;
   - Multinet due 2026-12-03 → `bekliyor`;
   - received 8.605,20 on 11-28 → `geldi`, `lateDays null`; received on 12-01 → `geldi` + `hakedis-gec` (1 gün);
   - received 8.000 → `eksik` (605,20 > max(50, 172,10));
   - due before `since` → `takip-oncesi`;
   - no invoice and sales > 0 → `faturasiz`;
   - platform `payDays` 14 from settings.
10. **`fatura-yok`:** split Getir 2.000 in Oct and no Getir invoice → flag on and after 2026-11-15, none on 2026-11-14.
11. **`baska-kategori`:** a Yemeksepeti `Reklam & Tabela` invoice in Oct → info flag. A Migros `Hammadde & İçecek`
    invoice → ignored.
12. **`unmatched`:** a Komisyon invoice from `Garanti BBVA` → listed, not in any channel.
13. **`splitChannels` / `effectiveSettings`:** defaults from recent invoices; one meal channel → `meal: []`; two →
    both; stored keys always included; a meal `payDays` above 30 is clamped to 30 in effective settings.
14. **`commissionAlerts`:** order (gecikti first); keys embed rate‰ and invoice ids; an invoice older than 45 days does
    not alert; max 5.
15. **`texts.ts`:** payout texts for all 7 statuses, source labels, badge choice (worst wins).
16. **Seed-shaped fixture F2** (the 10 Excel invoices, no lines, no reports, today 2026-10-22): rows exist for Sep and
    Oct; all `lineless`; sales null; Trendyol Sep fees 1.184,78, Oct 569,60; Pluxee Sep due 2026-10-30 `bekliyor`; no alerts.
17. **Source checks** (`readFileSync`):
    - `src/app/panel/komisyonlar/page.tsx` calls `requireAdmin`;
    - every exported action in `src/server/actions/commission.ts` calls `requireAdmin`;
    - `loadSplitChannels` does not select `amount|payable|netTotal|received|sales`;
    - `notifications.ts` adds `commissionNotifications` only in the admin branch.

### Extended
- `tests/kasa-raporu.test.ts` (add `channelSales: null` to the fixture):
  - `normalizeSplit`: drops unknown keys and zeros, error texts on mismatch, null when empty;
  - `paymentLines` detail and the `whatsappText` split;
  - `revisionChanges` → `Kart / platform ayrımı değişti`.
- `tests/hatirlaticilar-digest.test.ts`:
  - `renderDigest` with `commission` → box title, lines and link;
  - subject `Sabah özeti: Hakediş gecikti: Pluxee (Ekim)` when it is the only news;
  - extras `hakediş gecikti` with payments.
- `tests/mobile-nav.test.ts`: `mobileTitleFor("/panel/komisyonlar") === "Komisyonlar"`.
- `tests/yardim.test.ts`: `pathOf("/panel/komisyonlar")` → `["Satış & gider", "Komisyon & hakediş"]`.
- Kasa's `cash-month` test: card share = card ÷ zTotal (owner question 4).

### Run
`npm test`, `npm run lint`, `npx tsc --noEmit`.

Manual check on the worktree DB (R3, `laffogato_komisyon`):
1. Insert ~31 October cash reports with split jsonb.
2. Insert two Komisyon invoices with `parasut_bill_lines`, as in F1.
3. Check `/panel/komisyonlar` at 390 px and 1280 px: dialog, undo, settings, `/panel/kasa` split fields (staff and
   admin), the bell, `runReminderDigest("manual")` output, and a Tedarikçiler channel page link.

---

## 10. Docs, Yardım, README

- **`docs/KOMISYON.md`** (new):
  - what the screen shows;
  - channels and name matching (how to fix "kanalı bulunamayan");
  - sales sources table (§2.4);
  - line classes and keywords (§2.5);
  - the month rule;
  - the rate definition;
  - the flags table with texts;
  - payout rules (expected, due, tolerance, statuses, `since`);
  - bell and e-mail;
  - the legal basis with citations (§13) and "uyarılar kesin hüküm değildir";
  - files and tests.
- **`docs/KASA-RAPORU.md`:**
  - the "Personel ne girer" Z row gets `yemek kartları ve platformlar ayrı ayrı (isteğe bağlı; iki ya da daha çok kanal kullanılıyorsa)`;
  - new short section **"Kart ve platform ayrımı"**;
  - "Gönderince" (WhatsApp / e-mail detail).
- **`docs/BILDIRIMLER.md`:** bell Faturalar group (hakediş gecikti, komisyon uyarıları); morning e-mail box
  "Komisyon ve hakediş" (sent once per item).
- **`docs/TEDARIKCILER.md`:** in "Paraşüt eşitlemesi ödeme durumuna dokunmaz", after the commission sentence:
  `Hakedişin gelip gelmediği ve gerçek oran: Komisyon & hakediş ([KOMISYON.md](KOMISYON.md)).`
- **`README.md`:**
  - screens table row: `Komisyon & hakediş: yemek kartı ve platformların ay ay gerçek oranı, faturadaki ücretler (%6 sınırı, yasak ücretler, erken ödeme), hakediş beklenen / son gün / geldi işareti ([docs/KOMISYON.md](docs/KOMISYON.md)) | /panel/komisyonlar | — (yeni)`;
  - the Kasa row adds `kart ve platform ayrımı (isteğe bağlı)`;
  - the `db:reset` "Silmedikleri" adds `komisyon hakediş işaretleri ve kanal ayarları`;
  - the `lib/` tree line for `commission/`.
- **`src/app/panel/yardim/page.tsx`:**
  - new FAQ item `id: "komisyon"`, icon `Percent`, q `Yemek kartı ve platform komisyonu doğru mu?`, a:
    ```
    <Path href="/panel/komisyonlar" /> ekranında her kart ve platformun o ay kestiği her şey satışa bölünür: gerçek oran.
    Yemek kartında %6'yı aşan oran, kira / cihaz / destek gibi ayrı ücret ve erken ödeme ücreti işaretlenir; platformda
    sipariş ve ödeme altyapısı ücreti. Satış kasa raporlarından gelir; Z'de kartlar ayrı yazıyorsa kasa raporunda ayrı
    girin. Hakediş bankaya gelince Hakediş geldi'ye dokunup günü ve tutarı yazın; son gün geçerse zil çalar.
    ```
    with `links: [{ href: "/panel/komisyonlar", label: "Komisyon & hakediş" }]`. Mind the `<Path>` line-start rule in
    `tests/yardim.test.ts`: the previous line ends with `>`;
  - the "tedarikci" answer's commission sentence gets ` Hakedişin gelip gelmediğini Komisyon & hakediş'te işaretleyin.`
    (plain text, no new `<Path>` needed).

---

## 11. Owner decisions (defaults implemented; nothing blocks)

0. **(Before merge, a developer with Neon access)** Run one read-only query to tune keywords and confirm Trendyol's
   legal name:
   ```sql
   select i.supplier, i.date, i.invoice_no, l.product_name, l.description, l.net_total
   from parasut_bill_lines l join invoices i on i.id = l.invoice_id
   where i.category = 'Komisyon' order by i.date desc limit 200;
   ```
   Adjust `classifyLine` / `parseStated` / `CHANNELS` and add each real line text as a test case. Without it, the
   defaults above stand.
1. **Location:** its own screen under Satış & gider (default), not a tab in Tedarikçiler.
2. **Per-card amounts on the nightly cash report:** optional, shown only when two or more channels of a group are in
   use (default yes). Alternative: no split; per-provider rates only from typed monthly sales.
3. **Due date:** commission invoice date + 30 days for every channel, editable per channel; meal at most 30. OK?
4. **Card share for the bank POS commission.** Kasa's derived card share, and the Ayarlar hint, count meal cards as
   bank-POS card sales: (card + meal card) ÷ Z. Meal-card commission is invoiced by Pluxee and the others and counted
   separately, so meal-card sales are charged twice in Gelir-gider: 2,5 % POS plus the company's invoice.
   - **Default:** kasa's derived share becomes card ÷ Z; the Ayarlar value (typed by the owner) stays, with the hint
     `Kredi / banka kartı ÷ ciro (yemek kartı hariç: onun komisyonu kendi faturasıyla sayılır)`.
   - Confirm by checking whether meal-card payments appear on the bank POS statement with a commission. If they do,
     revert this one line.
5. **Alerts on keyword-based "olabilir" flags** (banned fee, rate above 6 %) in the bell and the e-mail: default yes,
   once each.
6. **One payout mark per channel per month** (default), rather than one per invoice or per transfer.
7. **Tracking start:** payouts due on or after the first morning job after deploy (default). Older ones show "takip
   öncesi" and can still be marked.
8. **Other-category invoices from a channel** (e.g. Yemeksepeti ads filed as Reklam & Tabela): not counted, hint shown
   (default). Alternative: count them automatically.

---

## 12. Risks, dependencies and integration notes

- **Dependencies** (all batch-1, assumed merged; fallbacks given):
  - **kasa:**
    - `CashReportFields`, `FIELD_LABELS` / `revisionChanges` (`src/lib/cash-report.ts`), the cash-form layout,
      `tillMonths` rules (`src/lib/cash-month.ts`), owner question 4;
    - fallback: without kasa, add `channelSales` to today's `CashReportFields` and skip the revision label. My own
      `channelTill` does not import kasa's module (it mirrors the `partialFrom` / `missing` rules), so nothing breaks.
  - **vkn:**
    - `supplierResolver`, `loadSupplierRefs`, `invoices.supplierTaxNumber` for channel names;
    - fallback: `cardIndex` / `cardFor` name matching.
  - **ops:** the `renderDigest` 5th argument and R5 subject precedence. The commission part is supplied, not reordered.
    Read paths never write (`since`).
  - **pricing:** the `DigestInvoices.priceHolds?` box; the commission box goes after it. Without pricing, it goes after
    the review box.
  - **today / insight:** optional rows (§6.6). Skip them if absent.
  - **adminstepup:** not used.
- **Shared files** (R5, additive): `schema.ts`, `nav.ts`, `notifications.ts`, `digest.ts`, `digest-template.ts`,
  `cash-report.ts`, kasa form files, `yardim/page.tsx`, README, docs.
- **Migration:** one (`komisyon_hakedis`), generated at merge time, merged alone (R2). Branch from main after batch 1
  (R1). Own DB `laffogato_komisyon` (R3).
- **Keyword accuracy** is the main product risk, since there are no real lines locally. It is mitigated by:
  - the "olabilir" wording;
  - the raw line texts shown on every card;
  - task 0;
  - keywords kept in one tested module.
- **Week-boundary noise for platforms:** the 3-month headline and the tolerance absorb it. Platform payout amounts are
  labelled "yaklaşık".
- **Missing Z days inflate rates:** detected (`kasa-eksik`) and the legal flag is downgraded.
- **Staff burden:** the split appears only with ≥ 2 channels per group, and the total fills itself.
- **Legal texts:**
  - the 6 % cap, the banned-fee list ("uygulama barındırma, kira, bakım, depozito gibi adlarla") and the 30-day rule
    with reference to md. 5/2 are confirmed through search results (§13);
  - the user's wording adds "cihaz" and "destek"; the regulation says "gibi" (such as), so similar names are covered;
  - the full article text could not be fetched (the official sites were unreachable from this environment), and the
    Legal Data Hunter daily limit was reached;
  - the implementer pastes the exact text of md. 12/A and Genelge 2026/1 into `docs/KOMISYON.md` from mevzuat.gov.tr /
    ticaret.gov.tr before release, and adjusts the §3.7 sentences if they differ.
- **Performance:**
  - page: 6 small queries;
  - bell: the same loader with a 4-month window inside the existing admin `Promise.all`;
  - cash form: 2 tiny queries.
- **Next.js docs relied on** (`node_modules/next/dist/docs/`):
  - `01-app/03-api-reference/04-functions/refresh.md` (refresh only in Server Actions);
  - `01-app/03-api-reference/01-directives/use-server.md`;
  - `01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.md` (Activity keeps hidden routes);
  - `01-app/03-api-reference/04-functions/io.md` and `01-app/02-guides/migrating-to-cache-components.md` (no current
    time in prerender: read the clock after awaited dynamic reads, inside Suspense);
  - `01-app/02-guides/preserving-ui-state.md` (dialogs and navigation).

---

## 13. Sources (legal basis; verify the exact wording before release)

- Perakende Ticarette Uygulanacak İlke ve Kurallar Hakkında Yönetmelik, md. 12/A, added by the amendment published in
  RG 22.05.2018, no. 30428:
  - 6 % commission cap;
  - no separate charge "uygulama barındırma, kira, bakım veya depozito gibi adlarla";
  - payment term per md. 5/2 (30 days), counted from the invoice date.

  Summaries: [ekonomigazetesi (YEKADER)](https://www.ekonomigazetesi.com/sektor-haberleri/yekader-yemek-kartinda-komisyon-ust-siniri-yuzde-6-73633),
  [alomaliye 22.05.2018](https://www.alomaliye.com/2018/05/22/yemek-karti/),
  [RG PDF via TÜRMOB](https://www.turmob.org.tr/arsiv/mbs/resmigazete/30428-30428-1.pdf),
  [ahaber](https://www.ahaber.com.tr/ekonomi/2018/05/22/yemek-kartinda-yeni-donem-basladi).
- "Erken ödeme komisyonu" pushing the rate to 8 %: İTO statements,
  [muhasebenews](https://www.muhasebenews.com/?p=97796),
  [bloomberght](https://www.bloomberght.com/yemek-siparis-sitelerinin-komisyonlari-dayanma-sinirini-asti-2269854).
- Ticaret Bakanlığı Genelgesi 2026/1 "Hizmet Bedellerinin Şeffaflığının Sağlanması Hakkında" (food-order platforms):
  - itemised fees in the seller panel;
  - no fee for core intermediation (order taking / forwarding, payment infrastructure);
  - voluntary ads and campaigns;
  - compliance by 1 April 2026.

  [alomaliye 13.03.2026](https://www.alomaliye.com/2026/03/13/hizmet-bedellerinin-seffafliginin-saglanmasi-hakkinda-genelge-yayimlandi/),
  [alomaliye 13.04.2026](https://www.alomaliye.com/2026/04/13/yemek-siparis-platformlarina-yeni-duzenleme-komisyon-ve-hizmet-bedelleri/),
  [bloomberght](https://www.bloomberght.com/yemek-siparis-platformlarina-seffaflik-duzenlemesi-3771484),
  [forbes.com.tr](https://www.forbes.com.tr/para-yatirim/yemek-siparis-platformlarina-yeni-duzenleme-zorunlu-ek-ucretler-kaldirildi).
