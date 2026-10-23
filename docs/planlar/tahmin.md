# Plan: 7 günlük satış tahmini (group `tahmin`)

Base: `claude/oneriler` (planned from 71ac11f; checked again at 488a389 with ops-jobs staged in the working tree,
`drizzle/0020_gunluk_isler.sql`). Next.js 16.4.2 (cacheComponents), Drizzle 0.45, Postgres, Turkish UI.
Builds on `today.md` (Bugün screen), `ops.md` §3 (job runs, `dailyOutcome`, digest 5th argument) and `CRITIQUE.md`
R1–R7. No new dependency. One migration (`satis_tahmini`, three new tables, generated at merge time per R2).

---

## 1. Goal

Every morning the panel works out how much the café will sell (Z total) on each of the next 7 business days. It uses
the cash-report history, the weekday pattern, a verified Turkish calendar (resmî tatiller, bayramlar and arife
half-days, Ramazan, MEB school holidays), the weather forecast for Tuzla, Opera AVM (MET Norway, free) and the "özel gün"
entries the admin types in (derbi, AVM etkinliği, kampanya, kapalı gün). The result is shown as:

- a number and a range;
- a busy level (Yüksek / Normal / Düşük);
- a suggested staff count;
- dessert prep ("bu hafta ≈ 20 dilim San Sebastian, 1,7 bütün").

Each morning's forecast is stored. When the Z report comes in, the panel compares the two and shows "Son 4 haftada
ortalama sapma %X". The model is deliberately simple: a weekday baseline from recent normal days, multiplied by named
calendar, weather and özel gün factors. Each factor is shown on screen with its source (varsayılan, geçmişten
öğrenildi, sizin seçiminiz). With little data the panel says so calmly and widens the range.

Where it shows:

- **New admin screen** `/panel/tahmin` ("Satış tahmini").
- **Bugün** (today.md):
  - admin: a "Satış tahmini" card;
  - staff: a single line "Bugün yoğunluk: Yüksek · Cumhuriyet Bayramı" plus the dessert count, with no amounts.
- **Morning e-mail**: a short "Satış tahmini" box, added only to an e-mail that is going out anyway.

---

## 2. Facts that drive the design (verified in the repo and the local DB)

- **Daily history is very thin.** `cash_reports` landed on 2026-10-21 (commit 3265cd0). The local DB has 0 reports.
  kasa.md says production reports started mid-October 2026 (`partialFrom`). So for the first weeks after launch the
  forecast must work from almost nothing.
- **Monthly history exists.** In `months` (Excel import), `pos_revenue` / `open_days` are:

  | Month | POS revenue | Open days | Per day |
  |---|---|---|---|
  | 2026-07 | 173.587 | 23 | ≈ 7.547 |
  | 2026-08 | 500.000 | 31 | ≈ 16.129 |
  | 2026-09 | 429.698 | 30 | ≈ 14.323 |
  | 2026-10 | 293.909 | 16 (1–16 Ekim) | ≈ 18.369 |

  The café is new and still ramping up, which argues for a short, recent window plus a trend check.
- **Product mix exists only monthly.** `sales_lines` holds only 2026-09, 125 lines. "Tatlılar" sold 183 units for
  49.985 ₺ against a POS of 429.698 ₺, which is ≈ 4,3 desserts per 10.000 ₺. There is no daily product data until the
  ModPOS export arrives, so the plan adds a seam (§8.6).
- **Desserts are bought as whole cakes and sliced.** Examples from `ingredients`:
  - "San Sebastian dilim", unit `dilim`, `package_size` 12, AEM Lojistik;
  - "Marlenka dilim" 8;
  - "Tiramisu dilim" 12;
  - "Magnolia (adet)" 1 (in-house kase).

  Every dessert recipe also carries "Peçete" (category `Ambalaj` = `PACKAGING_CATEGORY`). So the prep unit is the recipe
  ingredient, and package size gives "slices per whole".
- **Business day.** `businessDate()` (05:00 rollover, Europe/Istanbul via `Intl`) is the cash day. `addDays` and
  `daysBetween` work on `YYYY-MM-DD` through `Date.UTC`, so there is no DST anywhere. Türkiye has been UTC+3 all year
  since 2016, and the code does not rely on that either.
- **Crons.**
  - `/api/cron/gunluk` runs at 05:00 UTC (08:00 TR). It does: optional Paraşüt retry sync (≤ 35 s), then
    `runReminderDigest("cron")`, then extras in parallel. `maxDuration = 60`.
  - `/api/cron/parasut` runs at 04:30 UTC with a 45 s sync.
  - Hobby allows daily crons only.
- **Settings storage.** Small settings live in `integration_state` (`notify.settings`, `cash.settings`). The
  `settings` table holds calc settings and is truncated by `db:reset`.
- **Morning e-mail.** `runReminderDigest` sends only when there is news (payments, invoices, sync error, zam).
  `renderDigest(rows, today, invoices?, prices?)` is positional; ops appends a 5th `system?` (R4).
- **Analiz & senaryo** (`/panel/analiz`) is month-scoped: it has a `MonthPicker` and shows an empty state without
  `sales_lines`. CRITIQUE §3 already cut a third Analiz tab (insight).

---

## 3. Decisions made here (the implementer does not re-decide)

1. **Own screen, not an Analiz tab.** The tahmin is day-scoped and forward-looking, it works without `sales_lines`, and
   it has its own writes (özel gün, settings). The Analiz page would need its month picker and empty state bypassed.
   The new screen is `/panel/tahmin`, admin only, listed under "Satış & gider" after "Kasa raporları".
2. **The target is the Z total** (`cash_reports.z_total`, KDV dahil, after discounts, comps excluded). This is the same
   meaning as `months.pos_revenue`. laffogato.net online sales are not included, because they don't pass through the
   kasa.
3. **Business day everywhere.**
   - D0 = `businessDate(now)`. The horizon is D0…D0+6.
   - History is days `< D0`. D0's own Z is never used for D0's forecast, which rules out leakage.
4. **Model = weekday baseline × named factors** (§4). No regression and no library. Every number is explainable in
   one Turkish sentence.
5. **Data tiers, with a calm message** (§4.2):
   - "tam" / "karma": own weekday data;
   - "ortalama": ≥ 7 normal days in the last 28 × default weekday shares;
   - "ay": last month's POS ÷ open days × default shares;
   - "yok": nothing is shown except an empty state.
6. **Learning.**
   - Event factors (resmî tatil, arife, bayram) and weather factors are learned from past days once there are enough
     of them, shrunk toward the default.
   - Seasons (Ramazan, okul tatili) keep fixed defaults in v1: they are long, and learning them needs a year of data.
   - Manual özel gün effects are the admin's choice. The screen shows the realised effect afterwards.
7. **Snapshots.**
   - The morning cron stores the forecast for D0…D0+6 (one row per target date and made-on day, first write wins).
   - Accuracy uses the same-morning forecast (made before 12:00 TR). The week-ahead accuracy is a second line.
   - Previews never write snapshots, because they share the production DB.
8. **Weather is cached in the DB, once per morning.**
   - Fetched in the gunluk job, in parallel with the Paraşüt retry sync, before the digest.
   - Manual refresh respects MET's `Expires`. Past days are frozen, so the table becomes a weather history for
     learning.
   - Weather is optional (setting). On any failure the factor is 1 and the screen says why.
9. **Roles.**
   - Staff never see amounts, the staff count suggestion or settings.
   - Staff see the busy level, the reason names and the dessert count on Bugün (setting, default on).
   - Only the admin enters özel günler (owner decision 6).
10. **The e-mail line never triggers an e-mail.** It is added only when the digest sends anyway, and it does not change
    the subject or headline (R5 precedence is untouched).
11. **Rounding.**
    - Point forecast to the nearest 100 ₺.
    - Range: low floored and high ceiled to 500 ₺.
    - Staff: `ceil`.
    - Desserts: whole units; wholes to one decimal.

---

## 4. The model (pure, `src/lib/forecast/model.ts`)

### 4.1 Constants

```ts
export const MODEL_VERSION = "t1";
export const HORIZON_DAYS = 7;
export const BASE_WINDOW_DAYS = 42;     // hafta günü tabanı: son 6 hafta (kafe yeni, büyüyor)
export const LEVEL_WINDOW_DAYS = 28;    // "ortalama gün" yedeği
export const TREND_WINDOW_DAYS = 14;    // son 2 hafta eğilimi
export const MIN_WEEKDAY_DAYS = 3;      // bir hafta günü kendi verisiyle hesaplanması için
export const MIN_LEVEL_DAYS = 7;
export const LEARN_WINDOW_DAYS = 400;
export const SHRINK = { event: 3, weather: 5 };      // öğrenilen ↔ varsayılan harmanı (sözde gözlem sayısı)
export const MIN_LEARN = { event: 2, weather: 5 };
export const BUSY = { high: 1.12, low: 0.88 };       // ortalama normal güne oran
export const FACTOR_CLAMP = [0.4, 2.5] as const;     // bütün çarpanların çarpımı (kapalı hariç)
/** Pazar … Cumartesi; AVM içi kafe için varsayılan paylar (ortalaması 1) */
export const DEFAULT_WEEKDAY = [1.15, 0.85, 0.85, 0.9, 0.95, 1.05, 1.25];
export const DEFAULT_FACTORS = {
  resmi: 1.2,              // yalnız hafta içi (hafta sonu 1)
  arife: 1.1,              // yalnız hafta içi
  "ramazan-bayrami": 1.15,
  "kurban-bayrami": 1.0,   // şehir dışına gidenler / kalanlar: bilinmiyor, nötr
  ramazan: 0.92,           // mevsim (sabit)
  "okul-tatili": 1.1,      // mevsim (sabit), yalnız hafta içi
  yagmur: 1.05,            // gün içi (09–23) ≥ 5 mm
  sicak: 1.05,             // en yüksek ≥ 35 °C
} as const;
```

### 4.2 Steps for target day t (D0 ≤ t ≤ D0+6)

1. **Annotate history.** For each day d `< D0` within `LEARN_WINDOW_DAYS`:
   - `calendarDay(d)`: one event with priority bayram > resmi > arife, plus seasons;
   - manual entries covering d;
   - weather kind (if stored);
   - weekday.

   A day is **open** when `total > 0`. **Normal** means open, no event, no manual entry. The normalised value is
   `v_d = total_d ÷ (Π season factors × weather factor)`, so Ramazan, school holidays and rain don't bias the baseline.
2. **Weekday baselines.** Use the normal days in `[D0 − 42, D0 − 1]`. For weekday w with `n_w ≥ 3`:
   `base_w = robustMean(v)`, where `robustMean` is:
   - n ≥ 5: the mean after dropping one min and one max;
   - n = 3–4: the median.
3. **Level fallback** for weekdays with `n_w < 3`:
   - **"ortalama"** when there are ≥ 7 normal days in the last 28: `L = mean(v_d ÷ DEFAULT_WEEKDAY[w_d])`, then
     `base_w = L × DEFAULT_WEEKDAY[w]`;
   - **"ay"** otherwise, from the latest `months` row (≤ the current month) with `open_days > 0 && pos_revenue > 0`:
     `L = pos_revenue ÷ open_days`, then `base_w = L × DEFAULT_WEEKDAY[w]`;
   - **"yok"** otherwise: no forecast.

   Quality is:
   - `tam`: all 7 weekdays have their own data;
   - `karma`: some do;
   - `ortalama` / `ay`: none do.

   `normalDay = mean(base_0…base_6)` is the yardstick for busy levels.
4. **Trend.** Only for `tam` / `karma`, and only with ≥ 5 normal days in the last 14:
   - `r = mean(v_d ÷ base_{w_d})`;
   - if `|r − 1| ≥ 0,10`, apply factor `clamp(r, 0.8, 1.25)`, labelled "Son 2 hafta eğilimi".
5. **Factors for t.** Each factor is listed only when ≠ 1:
   - **event:**
     - `resmi`, `arife`: weekday only;
     - `ramazan-bayrami` / `kurban-bayrami`: every day;
     - value learned (§4.3) or default;
   - **seasons:** `ramazan`, and `okul-tatili` on weekdays only;
   - **weather kind:** `yagmur` when `precipMm ≥ 5`, else `sicak` when `tMax ≥ 35`. Weather off or missing means no
     factor;
   - **manual:** each covering entry gives `1 + effect`; overlaps multiply;
   - **trend** (step 4).

   The product is clamped to `FACTOR_CLAMP`.
6. **Closed.** A manual entry of kind `kapali` covering t gives `amount = low = high = 0` and level `kapali`. Staff and
   desserts are 0.
7. **Point.** `amount = round100(base_{w(t)} × Π factors)`.
8. **Range**, computed from the rounded amount.
   - If there are ≥ 14 past ratios (`actual ÷ same-morning snapshot`, last 56 days):
     - `qLow = quantile(0.2)`, `qHigh = quantile(0.8)`;
     - `low = floor500(amount × min(qLow, 0.95))`, `high = ceil500(amount × max(qHigh, 1.05))`;
     - spread kind `gecmis`.
   - Otherwise ±15 % for `tam` / `karma` and ±25 % for `ortalama` / `ay`, plus 5 points when an unlearned event factor
     applies. Spread kind `varsayilan`.
9. **Level.**
   - `amount ÷ normalDay ≥ 1.12` → `yuksek`;
   - `≤ 0.88` → `dusuk`;
   - otherwise `normal`.

   With the defaults:
   - Saturday (1,25), Sunday (1,15) and a weekday resmî tatil are Yüksek;
   - Monday and Tuesday (0,85) are Düşük.

**Worked example** (local data, D0 = 2026-10-22, no cash reports, quality `ay`, L = 293.909 ÷ 16 = 18.369 ₺):

| Day | Calculation | Point | Range | Level | Staff (10.000 ₺/kişi, min 2) | Desserts (4,26 / 10.000 ₺) |
|---|---|---|---|---|---|---|
| Thu 22 Oct | 18.369 × 0,95 | 17.500 | 13.000–22.000 | Normal | 2 | ≈ 7 |
| Sat 24 Oct | 18.369 × 1,25 | 23.000 | 17.000–29.000 | Yüksek | 3 | ≈ 10 |
| Wed 28 Oct (arife) | 18.369 × 0,90 × 1,10 | 18.200 | 12.500–24.000 | Normal | 2 | ≈ 8 |
| Thu 29 Oct (Cumhuriyet Bayramı) | 18.369 × 0,95 × 1,20 | 20.900 | 14.500–27.500 | Yüksek | 3 | ≈ 9 |

The 28 and 29 October ranges are wider (±30 %) because the arife and resmî factors are not learned yet (§4.2 step 8).

### 4.3 Learning (`learnFactors`)

**Events.** For each past open day d with event kind k, no manual entry, a weekday when k is weekday-only, and within
`LEARN_WINDOW_DAYS`:

- `expected_d = baseFor(d)`: the same steps 1–4, run with D0 = d over days `< d`. A day whose `baseFor` quality is `ay`
  is skipped as too rough.
- `ratio = total_d ÷ (expected_d × seasons × weather)`.
- When `n ≥ MIN_LEARN.event`, the learned value is

  ```
  f = exp((n·mean(ln ratio) + K·ln default) / (n + K)),   K = 3
  ```

  Example: 3 days at 1,5 with default 1,2 give 1,342.

**Weather.** The same for days with kind `yagmur` / `sicak` and no event or manual entry: `K = 5`, `n ≥ 5`, ratio over
`expected × seasons`.

**Manual entries are not learned.** Instead, `realisedEffect(entry)` = `actual ÷ (expected × seasons × weather ×
event) − 1` per past day, shown in the list. `kindHistory(kind)` gives "Geçmiş 3 derbide ortalama +%18" (≥ 3 days) as
a hint in the dialog.

**The weekday shares shown** on screen are `base_w ÷ normalDay` for weekdays with their own data, and the default
otherwise.

### 4.4 Staffing (`src/lib/forecast/staffing.ts`)

```ts
export interface ForecastSettings {
  perPerson: number;            // bir kişinin günde karşıladığı satış (₺), varsayılan 10.000
  minStaff: number;             // 2
  maxStaff: number;             // 6
  dessertCategories: string[] | null;  // kategori ADLARI (db:reset kimlikleri baştan sayar); null → adında "tatlı" geçenler
  weather: boolean;             // true
  staffSeesLevel: boolean;      // true
  emailLine: boolean;           // true
}
export const DEFAULT_FORECAST_SETTINGS: ForecastSettings;
export function parseForecastSettings(raw: unknown): ForecastSettings;   // bozuk/eksik alan → varsayılan; maxStaff < minStaff → minStaff
export function staffFor(day: { amount: number; high: number; closed: unknown }, s: ForecastSettings): { count: number; ifBusy: number | null };
// count = clamp(ceil(amount / perPerson), min, max); ifBusy = clamp(ceil(high / perPerson)) when > count; closed → { 0, null }
```

### 4.5 Desserts (`src/lib/forecast/desserts.ts`)

```ts
export interface PrepItem { key: string; label: string; unit: "dilim" | "adet"; perWhole: number | null }
export interface ProductMix {
  /** Dayanak: bugün aylık ürün satışı; ModPOS günlük ürün satışı gelince "daily" (bkz. 8.6) */
  basis: { kind: "month"; months: string[]; revenue: number } | { kind: "daily"; from: string; to: string; revenue: number };
  items: PrepItem[];
  perTL: Record<string, number>;               // hazırlık kalemi → birim / ₺
  dessertsPerTL: number;                       // tatlı ürün adedi / ₺ (günün toplamı için)
  byWeekday?: Record<string, number[]>;        // günlük veri gelince: Pazar…Cumartesi oranları (varsa perTL yerine)
}
export function isDessertCategory(name: string, chosen: string[] | null): boolean;   // tr küçük harf + ı→i + aksan silme; null → "tatl" içerir
export function prepLabel(ingredientName: string): string;   // "San Sebastian dilim" → "San Sebastian", "Magnolia (adet)" → "Magnolia"
export function buildMix(i: {
  months: { month: string; revenue: number }[];          // posRevenue, yoksa satış satırlarının cirosu
  lines: { productId: number | null; qty: number }[];
  products: { id: number; name: string; categoryName: string }[];
  recipes: { productId: number; ingredientId: number; qty: number }[];
  ingredients: { id: number; name: string; unit: string; category: string; packageSize: number }[];
  chosen: string[] | null;
}): ProductMix | null;
export function dessertPlan(days: ForecastDay[], mix: ProductMix): {
  items: { item: PrepItem; perDay: number[]; total: number; wholes: number | null }[];   // haftalık çoka göre
  perDay: number[];     // günün tatlı adedi (yuvarlanmış)
  per10k: number;       // "her 10.000 ₺ satışta 4,3 tatlı"
};
```

The rules for `buildMix`:

- **Dessert products** are those whose category passes `isDessertCategory`.
- **Prep items** are the recipe ingredients that are not `PACKAGING_CATEGORY` and whose unit (case-folded) is `dilim`
  or `adet`.
  - A dessert with no such ingredient becomes its own item: product name, `adet`.
  - `perWhole = packageSize` when the unit is `dilim` and `packageSize > 1`; otherwise null.
- **Ingredient quantities:** `units_i = Σ qty_p × recipeQty`; `perTL_i = units_i ÷ revenue`.
- **Fallbacks:** no dessert line, or revenue 0, returns null.
- **ml/gr ingredients are ignored.** For example, "Vanilya dondurma" (ml) in "Cookie Aşkı" is not a prep item.

### 4.6 Accuracy (`src/lib/forecast/accuracy.ts`)

```ts
export const MIN_ACCURACY_DAYS = 7;
export const ACCURACY_WINDOW_DAYS = 28;
export const MORNING_CUTOFF_HOUR = 12;   // aynı günün tahmini 12:00'den (TR) önce kaydedilmişse sayılır
export interface SnapshotLite { date: string; madeOn: string; amount: number; low: number; high: number; closed: boolean; createdAt: string }
export function pastRatios(snaps: SnapshotLite[], actuals: ReadonlyMap<string, number>, today: string): number[];  // son 56 gün, aynı sabah
export function accuracy(snaps: SnapshotLite[], actuals: ReadonlyMap<string, number>, today: string): {
  days: number;                     // eşleşen gün (aynı sabah, açık, rapor var)
  miss: number | null;              // Σ|gerçek − tahmin| ÷ Σ gerçek (days ≥ 7 ise)
  bias: number | null;              // Σ(gerçek − tahmin) ÷ Σ tahmin: + ise tahmin düşük kalıyor
  inRange: number;                  // gerçekleşenin aralıkta kaldığı gün
  weekAhead: { days: number; miss: number | null };   // madeOn = date − 6
  list: { date: string; forecast: number | null; actual: number | null; deviation: number | null;
          status: "ok" | "rapor-yok" | "kapali" | "kayit-yok" }[];   // son 14 gün, yeni önce
};
```

The definitions:

- **Window:** `[today − 28, today − 1]`. Today joins the list (not the metric) once its report exists.
- **Same-morning:** `madeOn === date` and `trHour(createdAt) < 12`. If kasa/today's `trHour` is absent, use
  `Intl.DateTimeFormat` `hour` (as in `businessDate`).
- **Closed days:** `actual === 0` or a closed snapshot counts as "kapali".
- **`deviation`** is `(actual − forecast) ÷ forecast`.

### 4.7 Text helpers (`src/lib/forecast/text.ts`)

These cover:

- the exact Turkish strings of §5;
- `signedPct(0.2)` → `"+%20"`, `signedPct(-0.08)` → `"−%8"` (U+2212);
- `levelLabel`, `dayTitle(date, offset)` ("Bugün · 22 Ekim Perşembe", "Yarın · …", then `longDateTR`);
- `reasonChips(day)`, `explainLines(day, ctx)`;
- `staffView(...)`, `digestForecast(...)`, `digestLines(...)`.

---

## 5. User-facing behaviour (Turkish texts are final)

### 5.1 Navigation

- `NAV_TREE` › `para` ("Satış & gider") children: after `kasa-raporlari`, add
  `{ id: "tahmin", label: "Satış tahmini", href: "/panel/tahmin", roles: ["admin"] }`.
- `NAV_GROUPS` › "Günlük": add
  `{ href: "/panel/tahmin", label: "Satış tahmini", icon: TrendingUp, roles: ["admin"], keywords: "tahmin yoğunluk ciro kaç kişi personel vardiya tatlı pasta hazırlık bayram ramazan tatil okul hava durumu derbi maç kampanya özel gün" }`.
  `mobileTitleFor` then returns "Satış tahmini" with no `SHORT_TITLES` entry.
- Not in `STAFF_PATHS`. `canOpen("staff", "/panel/tahmin") === false`.
- `BOTTOM_NAV` is unchanged.

### 5.2 `/panel/tahmin` (admin)

**`PageHeader`:**

- eyebrow "Satış & gider", title "Satış tahmini";
- description: "Önümüzdeki 7 günde beklenen satış (Z toplamı), kaç kişinin çalışması ve kaç tatlı hazırlanması
  gerektiği. Kasa raporları, takvim (bayram, resmî tatil, Ramazan, okul tatili), hava durumu ve girdiğiniz özel
  günlerden hesaplanır.";
- actions:
  - `Button` "Özel gün ekle" (icon `CalendarPlus`);
  - `Button` secondary "Güncelle" (icon `RefreshCw`, `aria-label` "Hava durumunu al ve bugünün tahminini kaydet").

The `Suspense` fallback is the same header with description "Yükleniyor…" plus `PageSkeleton rows={8}`.

**Quality banner** (`role="status"`, info tone `rounded-2xl bg-info-soft px-4 py-3 text-sm`, under the header):

| Quality | Text |
|---|---|
| `ay` | "Henüz {n} günlük kasa raporu var. Tahmin şimdilik {Ekim 2026} ortalamasına (günde {18.369 ₺}, {16} açık gün) ve AVM'lerde tipik hafta günü farklarına dayanıyor; aralık bu yüzden geniş. Her hafta günü için 3 rapor birikince (yaklaşık 3 hafta) kendi verinizle hesaplanır." (`n = 0` → "Henüz kasa raporu yok.") |
| `ortalama` | "Son 28 günde {12} günlük kasa raporu var. Hafta günü farkları şimdilik varsayılan; her gün için 3 rapor birikince kendi verinizden hesaplanır." |
| `karma` | "{Pazartesi, Salı} için henüz 3 rapor yok; o günler ortalama güne göre hesaplandı." |
| `tam` | (no banner) |

The calendar coverage note (from `coverageNote(today)`) is appended when set:

- from 2027-08-01: "Okul takvimi 2027–2028 için henüz eklenmedi (docs/SATIS-TAHMINI.md)."
- from 2028-11-01: "Takvim tablosu 2028 sonunda bitiyor; 2029 eklenmeli."

**Quality `yok`:** an `EmptyState`.

- Icon `CalendarClock`, title "Tahmin için veri yok".
- Description: "Kasa raporu girildikçe ya da Satışlar'da bir ayın cirosu ve açık gün sayısı yazılınca önümüzdeki 7
  günün tahmini burada görünür."
- Action `ButtonLink` "Kasa raporu" → `/panel/kasa`.
- The Özel günler and Ayarlar cards are still shown.

**Layout:** `grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]`.

- Left column: "Önümüzdeki 7 gün", "Tatlı hazırlığı".
- Right column: "Tutturma", "Özel günler", "Takvim ve etkiler", "Tahmin ayarları".
- On a phone (390 px) everything stacks in that order in a single column, with no horizontal scroll and 44 px touch
  rows.

**Card "Önümüzdeki 7 gün"** (icon `CalendarRange`, description "Z toplamı, KDV dahil · laffogato.net online hariç").
It is an `<ol>`, one `<li id="gun-{date}">` per day, each a `<details>` with a summary at least 44 px tall:

- **Left:** a date tile (weekday short "Per", day number). The label is "Bugün", "Yarın" or the weekday name.
- **Middle:**
  - title "Bugün · 22 Ekim Perşembe";
  - chips (from `reasonChips`):
    - "Cumhuriyet Bayramı +%20", "Arife +%10", "Ramazan Bayramı +%15", "Ramazan −%8", "Okul tatili +%10";
    - "Yağmur +%5", "Sıcak +%5";
    - "{özel gün adı} +%15";
    - "Eğilim +%12";
  - weather text: "Yağmurlu · 6 mm · 19°/12°", "Güneşli · 24°/15°" or "Hava bilgisi yok". The icon comes from the
    kind and MET symbol: `CloudRain` / `Sun` / `CloudSun` / `Cloud` / `ThermometerSun`.
- **Right:**
  - "≈ 18.500 ₺" (semibold, tabular);
  - under it "16.000–21.000";
  - a `Badge` with the level: "Yüksek" (warn tone), "Normal" (neutral), "Düşük" (info);
  - "2 kişi" (`Users` icon); "3 kişi · yoğunsa 4" when `ifBusy`;
  - "≈ 8 tatlı" (when there is a mix).
- **Closed day:** right side shows "Kapalı" and the title, with no numbers.
- **Body, "Nasıl hesaplandı"** (`explainLines`, one line each):
  - **Base, hafta-gunu:** "Taban: son {6} Perşembe gününün ortalaması {16.800 ₺} (en yüksek ve en düşük gün hariç)."
    For n = 3–4 the ending is "(ortanca)".
  - **Base, ortalama:** "Taban: son 28 günün {12} kasa raporuna göre ortalama gün {17.200 ₺} × Perşembe payı %95
    (varsayılan) = {16.340 ₺}."
  - **Base, ay:** "Taban: {Ekim 2026} ortalaması günde {18.369 ₺} ({16} açık gün) × Perşembe payı %95 (varsayılan) =
    {17.451 ₺}."
  - **Trend:** "Son 2 hafta tabanın %{12} {üstünde|altında}: ×{1,12}."
  - **Each factor:** "{label}: {+%20} ({varsayılan | geçmişteki 3 günden öğrenildi | sizin seçiminiz | sabit
    varsayılan})". Labels:
    - "Cumhuriyet Bayramı (hafta içi resmî tatil)";
    - "Cumhuriyet Bayramı arifesi (yarım gün tatil)";
    - "Ramazan Bayramı 1. gün", "Kurban Bayramı 2. gün";
    - "Ramazan ayı";
    - "1. dönem ara tatili (okullar kapalı, hafta içi)";
    - "Yağmurlu gün (AVM kalabalıklaşır)", "Çok sıcak gün (35 °C ve üstü)";
    - "{Göztepe – Karşıyaka} (Derbi / maç)".
  - **Weather:** "Hava (MET Norway): {Yağmurlu} · gün içi {6} mm · en yüksek {19} °C."
  - **Result:** "Tahmin ≈ {18.500 ₺}; çoğu gün {16.000}–{21.000 ₺} arasında kalır" plus, by spread kind:
    - `gecmis`: " (son 4 haftanın tahmin sapmalarına göre)."
    - `varsayilan`: " (veri az: ±%{25})."
  - **Staff:** "Personel: {18.500} ÷ {10.000 ₺} kişi başı → {2} kişi{; yoğun geçerse 3}." When the count exceeds the
    active staff of this month (`staff` table), add " Kadroda {2} kişi var."
  - **Desserts:** "Tatlı: ≈ {8} ({Eylül 2026}'da her 10.000 ₺ satışta {4,3} tatlı)."
  - **Snapshot:** "Bu sabah kaydedilen tahmin: {18.300 ₺}; tutturma bununla ölçülür." This line is shown only when a
    same-morning snapshot exists and differs from the live amount by ≥ 2 %.
  - A small text button "Bu güne özel gün ekle" opens the dialog with the date filled in.
- **Card footer** (mute, 12 px):
  - normal: "Hava durumu: MET Norway (Norveç Meteoroloji Enstitüsü) verisi, CC BY 4.0 · {22 Ekim 08:02}'de alındı."
    with a link "api.met.no" → `https://api.met.no/` (`rel="noopener"`);
  - weather off: "Hava durumu kullanılmıyor (Tahmin ayarları).";
  - last fetch failed: "Hava durumu alınamadı ({HTTP 403}); tahmin havasız hesaplandı.";
  - no rows yet: "Hava durumu henüz alınmadı; her sabah 08:00–09:00 arasında alınır."

**Card "Tatlı hazırlığı"** (icon `CakeSlice`, description "Önümüzdeki 7 gün · {Eylül 2026} satışındaki payına göre"):

- **Rows** sorted by weekly quantity, descending:
  - left: `label`;
  - right: "≈ {20} dilim · {1,7} bütün ({12}'lik)" or "≈ {9} adet";
  - sub line: "Bugün ≈ {3} · en çok {Cumartesi} ({4})".
- **Top line:** "Bu hafta ≈ {58} tatlı · bugün ≈ {8}".
- **Footer note:** "ModPOS'un günlük ürün satışı gelince her gün kendi oranıyla hesaplanacak. Hesapta yalnız {Tatlılar}
  kategorisi var; Tahmin ayarları'ndan değişir. Satışı olmayan yeni tatlılar hesapta yok."
- **No mix:** "Tatlı önerisi için Satışlar'a en az bir ayın ürün satışını yükleyin." plus `ButtonLink` ghost
  "Satışlar" → `/panel/satislar`.
- **Closed or `yok`:** the card is hidden.

**Card "Tutturma"** (icon `Target`):

- **`days ≥ 7`:**
  - big line "Son 4 haftada ortalama sapma %{11}";
  - sub line "{21} gün · gerçekleşen {15} günde aralıkta kaldı" plus, when `|bias| ≥ 0,03`, " · tahmin genelde
    %{4} {düşük|yüksek} kalıyor";
  - second line when `weekAhead.days ≥ 7`: "Bir hafta önceden yapılan tahminlerde %{14}.";
  - list (last 14 days): "21 Eki Çar · tahmin 17.000 · gerçekleşen 18.950 · +%11". The deviation tone is good ≤ 10 %,
    warn ≤ 25 %, bad beyond. The statuses read "Rapor yok", "Kapalı" and "Tahmin kaydı yok".
- **`days < 7`:** "Her sabah o günün tahmini kaydedilir; gerçekleşen Z toplamıyla karşılaştırma 7 gün sonra görünür
  (şimdi {3} gün)."

**Card "Özel günler"** (icon `CalendarHeart`, description "Derbi, AVM etkinliği, kampanya ya da kapalı gün: tahmin o
günlere göre değişir.", action `Button` ghost sm "Ekle"):

- **Upcoming** (today … +60 days), as tappable rows (open the edit dialog):
  - "25 Eki Cmt · Göztepe – Karşıyaka · Derbi / maç · +%15";
  - multi-day "16–20 Kas · AVM yılbaşı etkinliği · AVM etkinliği · +%15";
  - closed "3 Kas Sal · Tadilat · Kafe kapalı".
- **Past** (last 30 days), muted, plus "gerçekleşen +%22" / "rapor yok".
- **Suggestions** (`suggestedDays(today, 21)`, not already covered by an entry):
  - row "Yaklaşıyor: Sevgililer Günü · 14 Şubat Pazar";
  - `Button` ghost sm "Ekle" opens the dialog pre-filled (kind `diger`, effect 0, title);
  - candidates are Sevgililer Günü (14 Şubat), Anneler Günü (Mayıs'ın 2. Pazarı), Babalar Günü (Haziran'ın 3. Pazarı),
    İzmir'in Kurtuluşu (9 Eylül), Yılbaşı gecesi (31 Aralık).
- **Empty:** "Henüz özel gün yok. Maç, AVM etkinliği ya da kampanya olacaksa ekleyin."

**Dialog "Özel gün ekle" / "Özel günü düzenle"** (`ui/dialog`, phone bottom sheet, 48 px fields):

- **Description:** "Tahmin bu günlerde seçtiğiniz etkiyle değişir; gün geçince gerçekleşen etkiyi görürsünüz. Geçmiş bir
  günü de işaretleyebilirsiniz: o gün normal günlerin ortalamasına katılmaz."
- **Fields:**
  - "Ne var?" `Select`: Derbi / maç · AVM etkinliği · Kampanya · Kafe kapalı · Diğer.
  - "Ad" (placeholder "Göztepe – Karşıyaka maçı").
  - "Başlangıç" (`type="date"`) and "Bitiş" (`type="date"`, empty = same day).
  - "Satışa etkisi" `Select`, hidden for "Kafe kapalı":
    - "Çok artırır (+%30)";
    - "Artırır (+%15)";
    - "Etkisini bilmiyorum (yalnız not)";
    - "Azaltır (−%15)";
    - "Çok azaltır (−%30)".

    Under it, when `kindHistory` has ≥ 3 days: "Geçmiş {3} {derbide} ortalama {+%18}." The noun comes from a kind map:
    derbide, AVM etkinliğinde, kampanyada, özel günde.
  - "Not" (optional).
- **Buttons:** "Kaydet", "Vazgeç", and "Sil" (ghost, danger) when editing.
- **Toasts:**
  - "Özel gün eklendi: {25 Ekim Cumartesi} · {Göztepe – Karşıyaka}";
  - "Özel gün güncellendi";
  - "Özel gün silindi", with "Geri al" re-saving the old values.
- **Errors:**
  - "Ad gerekli";
  - "Bitiş başlangıçtan önce olamaz";
  - "En çok 14 gün seçilebilir";
  - "En çok 400 gün geriye işaretlenebilir";
  - "En çok 1 yıl ileriye girilebilir".
- The dialog does not navigate, so the "close before navigating" rule does not apply.

**Card "Takvim ve etkiler"** (a closed `<details>`, summary "Takvim ve etkiler · {3} öğrenildi" at least 44 px):

- **Table** "Gün | Etkisi | Dayanağı":
  - "Hafta içi resmî tatil | +%20 | varsayılan" or "geçmişteki 3 günden";
  - "Arife (hafta içi yarım gün) | +%10";
  - "Ramazan Bayramı | +%15";
  - "Kurban Bayramı | %0";
  - "Ramazan ayı | −%8 | sabit varsayılan";
  - "Okul tatili (hafta içi) | +%10 | sabit varsayılan";
  - "Yağmurlu gün (5 mm ve üstü) | +%5";
  - "Çok sıcak gün (35 °C ve üstü) | +%5";
  - "Hafta günü payları | Pzt %85 · Sal %85 · Çar %90 · Per %95 · Cum %105 · Cmt %125 · Paz %115 | varsayılan" or
    "kendi verinizden".
- **Then:** "Önümüzdeki 60 gün" with up to 6 entries:
  - "28 Ekim Çarşamba · Cumhuriyet Bayramı arifesi";
  - "29 Ekim Perşembe · Cumhuriyet Bayramı";
  - "16–20 Kasım · 1. dönem ara tatili".
- **Footer:** "Resmî tatiller ve bayramlar 2028 sonuna, okul tatilleri 2026–2027 öğretim yılına kadar tabloda (Diyanet
  dini günler takvimi, MEB çalışma takvimi; 2027 yaz tatilinin bitişi tahmini). Varsayılanlar kendi veriniz biriktikçe
  geçmiş günlerden öğrenilir."

**Card "Tahmin ayarları"** (client form, `SectionCard`-like, description "Kişi ve tatlı önerisinin dayanağı."):

- **"Bir kişinin günde karşıladığı satış (₺)"** (`NumberInput`, `parseNumberTR`). Hint: "Kaç kişi önerisi = günün
  tahmini ÷ bu tutar (yukarı yuvarlanır). Örnek: 23.000 ₺'lik gün, 10.000 ₺ ile 3 kişi."
- **"En az kişi"** (hint "Sakin günde bile çalışan sayısı") and **"En çok kişi"**.
- **"Tatlı sayılan kategoriler"**: `Checkbox` per category, default ticked = names containing "tatlı". Hint "Tatlı
  hazırlığı bu kategorilerdeki ürünlerin satış payından hesaplanır."
- **`ToggleRow` "Hava durumunu kullan"**: "MET Norway'den (Norveç Meteoroloji Enstitüsü) ücretsiz, günde bir kez;
  kafenin konumu (Tuzla, Opera AVM) için."
- **`ToggleRow` "Personel bugünün yoğunluğunu görsün"**: "Bugün ekranında Yüksek / Normal / Düşük ve tatlı sayısı;
  tutar ve kişi önerisi görünmez."
- **`ToggleRow` "Sabah e-postasına tahmin satırı"**: "Yalnız zaten giden sabah e-postasına eklenir; tahmin için
  ayrıca e-posta gönderilmez."
- **Button** "Kaydet". Toast "Tahmin ayarları kaydedildi".
- **Errors:**
  - "Kişi başı satış 1.000 ₺ ile 200.000 ₺ arasında olmalı";
  - "Kişi sayısı 0 ile 20 arasında olmalı";
  - "En çok kişi en az kişiden küçük olamaz".

**"Güncelle" results** (toast):

- "Hava durumu alındı · 7 günün tahmini kaydedildi";
- "Hava durumu güncel ({08:02}'de alındı) · tahminler zaten kayıtlı";
- "Hava durumu alınamadı; tahmin havasız kaydedildi";
- "Hava durumu kapalı · tahmin kaydedildi";
- on a preview (`VERCEL_ENV === "preview"`): "Önizlemede tahmin kaydedilmez (canlının veritabanı)."

The button shows a pending state. Server Actions are dispatched one at a time per client
(`node_modules/next/dist/docs/01-app/02-guides/server-actions.md` § "Sequential dispatch"), so the weather fetch is
capped at 6 s.

### 5.3 Bugün, admin card "Satış tahmini" (`src/app/panel/bugun/today-forecast.tsx`, server component)

- **Placement:** in the right column (xl), after "Yaklaşan ödemeler" and before "Bugün kafede". The phone order is the
  same.
- **`CardHeader`:** icon `TrendingUp`, title "Satış tahmini", description "Bugün · {22 Ekim Perşembe}", action
  `ButtonLink` ghost sm "Ayrıntı" → `/panel/tahmin`.
- **Body:**
  - "≈ 18.500 ₺" (24 px); sub "16.000–21.000 ₺ · Z toplamı";
  - a row with the level `Badge`, "2 kişi" (or "3 kişi · yoğunsa 4") and "≈ 8 tatlı";
  - reason chips (at most 3, then "+2");
  - a 7-day strip: seven CSS bars (`flex items-end gap-1.5 h-16`) scaled to the week's maximum.
    - Under each bar is the weekday initial ("Per Cum Cmt Paz Pzt Sal Çar"). Today has a dark outline; closed days are
      a dashed outline.
    - Each bar is a `Link` to `/panel/tahmin#gun-{date}` with `aria-label` "{24 Ekim Cumartesi}: yaklaşık {23.000 ₺},
      {yüksek}".
    - There are no numbers on the bars (they don't fit at 390 px).
- **Footer** (one line, mute), in order of preference:
  - "Bugün gerçekleşen {19.200 ₺} ({+%4})" when today's report exists;
  - "Dün: tahmin {17.000 ₺}, gerçekleşen {18.950 ₺} ({+%11})";
  - "Son 4 haftada ortalama sapma %{11}";
  - nothing.
- **Quality `ay` / `ortalama`:** an extra mute line "Kaba tahmin: kasa raporu biriktikçe netleşir."
- **Closed today:** "Bugün kafe kapalı olarak işaretli ({Tadilat})."
- **`yok`:** a single line "Tahmin için veri yok: kasa raporu girildikçe burada bugünün ve haftanın tahmini görünür."
  plus a link "Satış tahmini".
- **Load failure:** the card is not rendered (today.md `safe()`).

### 5.4 Bugün, staff (no amounts)

In "Bugün kafede" (today.md `cafeLines`), the forecast lines come first. They appear only when
`settings.staffSeesLevel` is on and quality ≠ `yok`:

- **Level line:** "Bugün yoğunluk: {Yüksek}{ · Cumhuriyet Bayramı, yağmur}". Tone `warn` for Yüksek, `info` otherwise.
  Reason names come without percentages; manual entries appear by title.
- **Dessert line:** "Tatlı: bugün ≈ {8} satılır (en çok {San Sebastian, Marlenka})". Shown only with a mix and when not
  closed.
- **Closed:** "Bugün kafe kapalı olarak işaretli."

The card's "hide when empty" rule counts these lines as content. Staff never receive the amount, range, staff count or
settings: the server maps to `StaffForecastView = { level; reasons: string[]; desserts: { today: number; top: string[] } | null; closed: boolean }`
before anything leaves `loadStaffForecast` (pinned by test 15).

### 5.5 Morning e-mail (shared: `digest.ts`, `digest-template.ts`)

**When:** only if `settings.emailLine` is on, quality ≠ `yok`, and the digest is sending anyway (after its skip
checks).

**Content:** a box titled "Satış tahmini" after the price section. Same `FONT`; light grey tile `#f4f4f5`,
`border-radius:14px`, `padding:12px 14px`, 14 px text. Lines from `digestLines`:

1. "Bugün ≈ 18.500 ₺ (16.000–21.000) · yoğunluk yüksek · 2 kişi{ · Cumhuriyet Bayramı arifesi, yağmur}". When closed:
   "Bugün kafe kapalı olarak işaretli ({Tadilat})."
2. Only if yesterday has a pair: "Dün: tahmin 17.000 ₺, gerçekleşen 18.950 ₺ (+%11){ · son 4 hafta ortalama sapma
   %11}".
3. "Haftanın en yoğun günü: {Cumartesi} ≈ {23.000 ₺}{ · 7 günde ≈ {62} tatlı}".
4. Small: "Hava: MET Norway · Ayrıntı: {APP_URL}/panel/tahmin" (link).

The text version uses the same lines under a blank line and "Satış tahmini". The subject, headline, preheader and
button are unchanged (R5).

### 5.6 Yardım

Add one FAQ in "Gider, ödeme ve ekip":

- **Question:** "Önümüzdeki hafta ne kadar satarız, kaç kişi çalışmalı?"
- **Answer:** "<Path href="/panel/tahmin" /> her sabah önümüzdeki 7 günün satışını kasa raporlarından, hafta gününden,
  bayram ve tatillerden, Ramazan ve okul tatilinden, hava durumundan ve sizin girdiğiniz özel günlerden (derbi, AVM
  etkinliği, kampanya) hesaplar. Kaç kişi önerisi 'bir kişinin günde karşıladığı satış' ayarından, tatlı önerisi son
  satış ayındaki tatlı payından gelir. Her sabahki tahmin kaydedilir ve gerçekleşen Z toplamıyla karşılaştırılır; ilk
  haftalarda veri az olduğu için aralık geniştir."
- **Link:** `{ href: "/panel/tahmin", label: "Satış tahmini" }`.
- `<Path>` is valid because the screen is in `NAV_TREE` (`tests/yardim.test.ts`).

---

## 6. Calendar table (`src/lib/forecast/calendar.ts`, static, verified)

```ts
export type EventKind = "resmi" | "arife" | "ramazan-bayrami" | "kurban-bayrami";
export type SeasonKind = "ramazan" | "okul-tatili";
export interface CalendarEntry { from: string; to: string; kind: EventKind | SeasonKind; name: string; estimated?: true }
export const TR_CALENDAR: readonly CalendarEntry[];
export const CALENDAR_COVERAGE = { holidaysTo: "2028-12-31", schoolTo: "2027-06-25", schoolEstimatedTo: "2027-09-12" } as const;
export const CALENDAR_SOURCES: readonly { label: string; url: string }[];   // §15'teki adresler
export interface CalendarDay { date: string; weekday: number; event: { kind: EventKind; name: string; day?: number } | null; seasons: { kind: SeasonKind; name: string }[] }
export function weekdayOf(date: string): number;      // 0 = Pazar; Date.UTC ile, saat dilimsiz
export function isWeekend(date: string): boolean;
export function calendarDay(date: string): CalendarDay;   // olay önceliği: bayram > resmi > arife; bayramda day = 1..4
export function upcomingCalendar(today: string, days: number): { from: string; to: string; name: string }[];
export function coverageNote(today: string): string | null;
export type SpecialKind = "derbi" | "avm" | "kampanya" | "kapali" | "diger";
export function suggestedDays(today: string, horizon: number): { date: string; title: string }[];
```

**Resmî tatiller (kind `resmi`, single days, every year 2026–2028):**

- 1 Ocak Yılbaşı;
- 23 Nisan Ulusal Egemenlik ve Çocuk Bayramı;
- 1 Mayıs Emek ve Dayanışma Günü;
- 19 Mayıs Atatürk'ü Anma, Gençlik ve Spor Bayramı;
- 15 Temmuz Demokrasi ve Millî Birlik Günü;
- 30 Ağustos Zafer Bayramı;
- 29 Ekim Cumhuriyet Bayramı;
- arife (half day, kind `arife`): 28 Ekim Cumhuriyet Bayramı arifesi.

**Religious days** (Diyanet; bayram days are kind `ramazan-bayrami` / `kurban-bayrami`; arife is a half day, kind
`arife`; Ramazan runs from the first fast to the arife, as season `ramazan`):

| Year | Ramazan (season) | Ramazan Bayramı arifesi | Ramazan Bayramı | Kurban Bayramı arifesi | Kurban Bayramı |
|---|---|---|---|---|---|
| 2026 | 19 Şub (Per) – 19 Mar | 19 Mar Per | 20–22 Mar (Cum–Paz) | 26 May Sal | 27–30 May (Çar–Cmt) |
| 2027 | 8 Şub (Pzt) – 8 Mar | 8 Mar Pzt | 9–11 Mar (Sal–Per) | 15 May Cmt | 16–19 May (Paz–Çar) |
| 2028 | 28 Oca (Cum) – 25 Şub | 25 Şub Cum | 26–28 Şub (Cmt–Pzt) | 4 May Per | 5–8 May (Cum–Pzt) |

**Overlaps**, resolved by priority (tested):

- 2027-05-19 is Kurban Bayramı 4. gün and also 19 Mayıs: it is shown as the bayram, with name "Kurban Bayramı 4. gün ·
  19 Mayıs".
- 2027-03-08 is arife, Ramazan and the 2nd-term ara tatil at once: the event is `arife`, the seasons are `ramazan` and
  `okul-tatili`.
- 2028-10-28/29 fall on Saturday/Sunday, so the weekday-only factors give 1.

**School holidays (season `okul-tatili`, MEB):**

| Range | Name | Note |
|---|---|---|
| 2026-06-27 – 2026-09-13 | Yaz tatili | 2025–26 ended 26 June 2026 (Cuma); 2026–27 started 14 Sep 2026 |
| 2026-11-16 – 2026-11-20 | 1. dönem ara tatili | |
| 2027-01-25 – 2027-02-05 | Yarıyıl tatili | Karne 22 Jan 2027 |
| 2027-03-08 – 2027-03-12 | 2. dönem ara tatili | |
| 2027-06-26 – 2027-09-12 | Yaz tatili | Last lesson day 25 Jun 2027. **The end is an estimate** (`estimated: true`) until MEB publishes 2027–2028 |

The 2028 Ramazan start (28 Jan) comes from Diyanet's 2028 page via secondary sites. The "Diyanet 2028" link in §15
must be re-checked by the implementer, and the source line kept in the file comment. Weekdays above were computed
(`Date.UTC`) and are pinned by tests. The table lives in code with a source comment per block. A maintenance note
explains how to add 2029 and MEB 2027–28 (§13).

---

## 7. Weather: MET Norway Locationforecast 2.0 (`src/lib/forecast/weather.ts` pure + `src/server/forecast/weather.ts`)

**Endpoint and position:**

- `GET https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=40.8160&lon=29.3010`.
- The café is in **Tuzla, Opera AVM** (Istanbul; `docs/PROMPT-VE-PLAN.md`). MaviBahçe AVM (İzmir) is the separate
  karaoke-box business and must not be used (corrected per CRITIQUE2 R19). Tuzla centre is used; replace it with the
  mall's own map pin if that is more than about 5 km away (it does not change MET's grid). The coordinates are
  truncated to 4 decimals: MET blocks more (403/400) and needs it for caching.
- Constant `TUZLA = { lat: 40.8160, lon: 29.3010 }`. It is not a setting.

**Terms**, followed in code and in `docs/SATIS-TAHMINI.md`:

- **Free, no key.**
- **Identifying `User-Agent`** with app name and contact, otherwise 403:
  `LAffogatoPanel/1.0 (+${APP_URL}${WEATHER_CONTACT ? "; " + WEATHER_CONTACT : ""})`. `WEATHER_CONTACT` is an optional
  env (an e-mail or URL; never hard-coded).
- **Respect `Expires`.** Don't re-request before it; the stored `expires` gates both cron and manual refresh.
- **Send `If-Modified-Since`** with the stored `Last-Modified`. 304 means "keep".
- **Data licence:** NLOD 2.0 and CC BY 4.0. Credit "Data from MET Norway" with a link, which is done on the screen
  footer and in the e-mail.
- **Volume:** we make about one request a day, far below any limit. No public numeric limit was confirmed; don't
  overload.
- 203 means a deprecated product: use the data and `console.warn`.

**Fetch:** `fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(6000) })`. Route handlers and actions
don't memoize fetch, and we cache in the DB ourselves (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/fetch.md`
§ `options.cache`, § Memoization).

**Parse:** `parseMetCompact(json: unknown): WeatherDay[]` is pure and defensive. Bad JSON gives `[]`.

- Take `properties.timeseries[]` (`time` UTC ISO, `data.instant.details.air_temperature`,
  `data.next_1_hours.{summary.symbol_code, details.precipitation_amount}`,
  `data.next_6_hours.{summary.symbol_code, details.precipitation_amount}`).
- Bucket by **Türkiye calendar day** via `todayTR(new Date(time))`. For example, `2026-10-22T21:00:00Z` belongs to
  23 Ekim.
- **Daytime** means local hours 09–22.
- **`tMax`:** max instant temperature in daytime.
- **`tMin`:** min over the whole day.
- **`precipMm`:**
  - the sum of `next_1_hours` amounts for daytime hourly steps when there are ≥ 10 of them;
  - otherwise the sum of `next_6_hours` amounts for the steps starting at local 09:00 and 15:00 (06Z, 12Z);
  - otherwise null.
- **`symbol`:** `next_6_hours` at local 15:00, else 09:00, else hourly 15:00. Strip the `_day` / `_night` suffix.
- **`hours`:** how many steps fed the day.
- `tMax` / `precipMm` are not taken from `next_6_hours.details.air_temperature_max`. They are not guaranteed in
  `compact`, and instant values are.

**Kind and text:**

- `weatherKind(w)`: `precipMm ≥ 5` → `yagmur`; else `tMax ≥ 35` → `sicak`; else `normal`; `null` when there is no data.
- `weatherText(w)`:
  - "Yağmurlu · 6 mm · 19°/12°";
  - "Güneşli · 24°/15°";
  - "Bulutlu …", "Parçalı bulutlu …", "Karlı …" (symbol map; unknown → no word).

**`refreshWeather(now)`** (server, `server-only`). State key `forecast.weather`:
`{ fetchedAt, expires, lastModified, error }`.

1. Setting off → `"off"`.
2. `now < expires` → `"fresh"`.
3. Fetch.
4. Result handling:
   - 304: update `expires`, `fetchedAt` → `"not-modified"`;
   - 200/203: parse, then **upsert `weather_days` only for dates ≥ `todayTR(now)`** (past days stay frozen as the
     weather history), then save state → `"fetched"`;
   - any other status or network error: `error = "HTTP 403"` / `"Bağlantı kurulamadı"` → `"error"`, with no retry.

Never throws.

---

## 8. Server logic

### 8.1 Data model (`src/server/db/schema.ts`, one migration `npm run db:generate -- --name satis_tahmini`, R2)

```ts
// ---------------------------------------------------------------- Satış tahmini
/**
 * Yöneticinin tahmine eklediği özel günler (derbi, AVM etkinliği, kampanya, kafe kapalı). effect: −0,30 … +0,30
 * (kapalı −1). Geçmiş günler de girilebilir: o gün normal günlerin ortalamasına katılmaz. Ayrıntı: docs/SATIS-TAHMINI.md.
 */
export const specialDays = pgTable(
  "special_days",
  {
    id: serial("id").primaryKey(),
    dateFrom: text("date_from").notNull(),   // iş günü YYYY-MM-DD
    dateTo: text("date_to").notNull(),
    kind: text("kind", { enum: ["derbi", "avm", "kampanya", "kapali", "diger"] }).notNull(),
    title: text("title").notNull(),
    effect: doublePrecision("effect").notNull().default(0),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("special_days_from_idx").on(t.dateFrom),
    check("special_days_range_ck", sql`${t.dateFrom} <= ${t.dateTo}`),
    check("special_days_effect_ck", sql`${t.effect} >= -1 and ${t.effect} <= 1`),
  ],
);

/** MET Norway'in günlük özeti (Türkiye takvim günü). Sabah işi bugün ve sonrasını günceller; geçmiş günler donar ve
 * hava etkisinin öğrenilmesinde "o günün havası" olarak kullanılır. */
export const weatherDays = pgTable("weather_days", {
  date: text("date").primaryKey(),
  tMax: doublePrecision("t_max"),
  tMin: doublePrecision("t_min"),
  precipMm: doublePrecision("precip_mm"),   // gün içi (09–23)
  symbol: text("symbol"),
  hours: integer("hours").notNull().default(0),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

/** Her sabah kaydedilen tahmin (hedef gün × yapıldığı gün; ilk yazan kalır). Tutturma bununla ölçülür. */
export const forecastSnapshots = pgTable(
  "forecast_snapshots",
  {
    id: serial("id").primaryKey(),
    date: text("date").notNull(),            // tahmin edilen iş günü
    madeOn: text("made_on").notNull(),       // tahminin yapıldığı iş günü (date − madeOn: 0…6)
    amount: doublePrecision("amount").notNull(),
    low: doublePrecision("low").notNull(),
    high: doublePrecision("high").notNull(),
    closed: boolean("closed").notNull().default(false),
    staff: integer("staff"),
    detail: jsonb("detail").$type<SnapshotDetail>().notNull(),   // { v, quality, base: {amount, source, n}, factors: [{key, value}], weather }
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("forecast_snapshots_date_made_uq").on(t.date, t.madeOn), index("forecast_snapshots_made_idx").on(t.madeOn)],
);
```

**Not tables:**

- Settings go in `integration_state` `forecast.settings` (`ForecastSettings`).
- Weather HTTP state goes in `forecast.weather`.

**Volumes and lifecycle:**

- Snapshots grow by 7 rows a day (≈ 2.555 a year) and weather by 1 row a day. There is no retention job; both are tiny.
- The migration is additive, so it is Instant-Rollback-safe (ops DEPLOY §7).
- Backup covers it automatically (R6).
- `db:reset` touches none of these, and `forecast.settings` stores category **names**, so it survives the id restart
  (R7 lesson).

### 8.2 Pure modules (`src/lib/forecast/`, no server imports; tests in `tests/satis-tahmini.test.ts`)

| File | Exports |
|---|---|
| `calendar.ts` | §6 |
| `model.ts` | constants §4.1; types `DayTotal { date; total; source: "kasa" \| "pos" }`, `SpecialDay`, `WeatherDay`, `MonthLevel`, `ForecastInput`, `Factor`, `ForecastDay`, `Forecast`, `LearnedFactor`; `buildForecast`, `baseFor`, `learnFactors`, `realisedEffect`, `kindHistory`, `robustMean`, `quantile`, `mergeDailyTotals(kasa, pos)` (kasa wins; seam §8.6) |
| `weather.ts` | `TUZLA`, `metUrl()`, `userAgent(appUrl, contact?)`, `parseMetCompact`, `weatherKind`, `weatherText`, `canRefetch(state, now)` |
| `staffing.ts` | §4.4 |
| `desserts.ts` | §4.5 |
| `accuracy.ts` | §4.6 |
| `text.ts` | §4.7 (all Turkish strings of §5; one place) |
| `index.ts` | re-exports |

`buildForecast(input)`:

```ts
export interface ForecastInput {
  today: string;                              // businessDate(now)
  history: readonly DayTotal[];               // date ≥ today olanlar yok sayılır (sızıntı yok)
  months: readonly MonthLevel[];
  special: readonly SpecialDay[];
  weather: readonly WeatherDay[] | null;      // null: ayar kapalı
  pastRatios: readonly number[];
  days?: number;                              // 7
}
export interface ForecastDay {
  date: string; weekday: number; offset: number;
  calendar: CalendarDay; special: SpecialDay[];
  weather: (WeatherDay & { kind: "yagmur" | "sicak" | "normal" }) | null;
  closed: { title: string } | null;
  base: { amount: number; source: "hafta-gunu" | "ortalama" | "ay"; n: number; month?: string; openDays?: number; share?: number };
  factors: Factor[];          // { key, label, value, source: "varsayilan" | "ogrenildi" | "sabit" | "sizin" | "egilim", n? }
  amount: number; low: number; high: number;
  level: "yuksek" | "normal" | "dusuk" | "kapali";
}
export interface Forecast {
  today: string; days: ForecastDay[];
  quality: "yok" | "ay" | "ortalama" | "karma" | "tam";
  missingWeekdays: number[];                // karma'da kendi verisi olmayanlar
  normalDay: number;
  reports: { normal: number; last28: number };
  shares: { weekday: number; value: number; own: boolean }[];
  learned: LearnedFactor[];                 // { key, label, value, default, n, source }
  spread: { kind: "gecmis" | "varsayilan"; pct?: number; n: number };
}
```

### 8.3 Server loaders (`src/server/forecast/*.ts`, all `import "server-only"`)

**`load.ts`:**

```ts
export const FORECAST_SETTINGS_KEY = "forecast.settings";
export async function loadForecastSettings(): Promise<ForecastSettings>;
export async function saveForecastSettings(v: ForecastSettings): Promise<void>;   // eylem içinden
/** Günlük toplamlar: bugün kasa raporları; ModPOS günlük satışı gelince mergeDailyTotals ile (8.6) */
export async function loadDailyTotals(from: string, to: string): Promise<DayTotal[]>;
export async function loadForecastCore(now?: Date): Promise<{
  today: string; settings: ForecastSettings; forecast: Forecast;
  actuals: Map<string, number>; snapshots: SnapshotLite[]; accuracy: ReturnType<typeof accuracy>;
  weatherState: WeatherState | null;
}>;
export async function loadForecastPage(now?: Date);    // core + mix + dessertPlan + specials (−30…+60 gün) + realised + staff count + categories
export async function loadForecastCard(now?: Date);    // Bugün yönetici kartı: core + mix (yalnız sayılar)
export async function loadStaffForecast(now?: Date): Promise<StaffForecastView | null>;   // ayar kapalıysa null; tutar yok
export async function loadDigestForecast(now?: Date): Promise<DigestForecast | null>;     // emailLine kapalı / yok → null
```

`loadForecastCore` reads in parallel:

1. **Cash totals:** `select date, z_total from cash_reports where date between today−400 and today`.
2. **Month levels:** `select month, open_days, pos_revenue from months where open_days > 0 and pos_revenue > 0 order by month desc limit 3`.
3. **Special days:** rows overlapping `[today−400, today+60]`.
4. **Weather:** `weather_days` with `date ≥ today−400` (skipped when the setting is off).
5. **Snapshots:** `forecast_snapshots` with `date between today−56 and today+6`.
6. **Settings.**
7. **Weather state.**

The function calls `businessDate(now)` **after** the first awaited DB read. Pages call it after `requireAdmin()` /
`requireUser()`. Reason: no current-time read during prerender under Cache Components
(`node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md` § "Fix synchronous IO";
`…/03-api-reference/04-functions/connection.md`).

**`mix.ts`**: `loadProductMix(settings): Promise<ProductMix | null>`, the seam (§8.6). It reads:

- the latest ≤ 3 months that have `sales_lines`, and those months' `pos_revenue` (else Σ `sales_lines.revenue`);
- the lines (`product_id`, `qty`);
- products and categories;
- `recipe_items` joined to `ingredients` for the dessert products only.

It then calls `buildMix`.

**`weather.ts`:** `refreshWeather(now)` (§7).

**`job.ts`:**

```ts
export function canWriteSnapshots(): boolean;   // process.env.VERCEL_ENV !== "preview"
export async function snapshotForecast(now?: Date): Promise<number>;   // D0…D0+6, INSERT … ON CONFLICT (date, made_on) DO NOTHING; kaç satır yazıldı
export async function runForecastJob(now?: Date): Promise<{ status: "ok" | "partial" | "skipped" | "error"; weather: string; saved: number; error?: string }>;
// weather = refreshWeather(); snapshot yalnız canWriteSnapshots(); hava "error" → "partial"; veri "yok" → "skipped" ("veri yok")
```

### 8.4 Server actions (`src/server/actions/forecast.ts`, `"use server"`)

Every action uses `attempt`, `requireAdmin`, zod, `refresh()` and `logActivity`. `refresh` works only inside Server
Actions (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md`), so the cron path never calls
it.

**`saveSpecialDay(input)`**:

- Input `{ id?, kind, title (1–60), dateFrom, dateTo?, effect, note? (≤ 200) }`.
- Effect values:
  - `z.union([z.literal(0.3), z.literal(0.15), z.literal(0), z.literal(-0.15), z.literal(-0.3)])`;
  - kind `kapali` forces −1.
- Rules, each a `UserError` with the text of §5.2:
  - `dateTo ≥ dateFrom`;
  - span ≤ 14 days;
  - `dateFrom ≥ businessDate() − 400`;
  - `dateTo ≤ businessDate() + 365`.
- Insert, or update by id (`UserError("Özel gün bulunamadı (sayfayı yenileyin)")`).
- Log "Özel gün" / "Özel gün güncellendi" with "{25 Ekim Cumartesi} · {Göztepe – Karşıyaka} (Derbi / maç, +%15)".

**`deleteSpecialDay(id)`**:

- Deletes the row and returns its values for "Geri al".
- Log "Özel gün silindi".

**`saveForecastSettings(input)`**:

- Validation:
  - `perPerson` 1.000–200.000;
  - `minStaff` / `maxStaff` integers 0–20, `max ≥ min`;
  - `dessertCategories`: array of ≤ 30 names, kept only if the category exists; empty becomes null;
  - three booleans.
- Saves with an upsert.
- Log "Tahmin ayarları" / "kişi başı 10.000 ₺, en az 2, en çok 6, hava açık, personel görür".

**`refreshForecastNow()`**:

- Calls `runForecastJob()` and returns the toast text (§5.2). It never throws for weather.
- `refresh()`. No log (no business data changes).

### 8.5 Cron and digest

**`src/app/api/cron/gunluk/route.ts`** (shared). The ops-jobs version is already in the working tree: `startJobRun`,
`parasutSyncedToday`, `dailyOutcome({ sync, digest, reminders, karaoke, menu, sales })`, and `extras()` typed as
`Record<Exclude<DailyStep, "sync" | "digest">, StepResult>`.

- Right after `startJobRun("gunluk")`, start
  `const forecastP = runForecastJob().catch((e: Error) => ({ status: "error" as const, weather: "error", saved: 0, error: e.message }))`
  so it runs in parallel with the Paraşüt retry block.
- `const forecast = await forecastP` just before `runReminderDigest(...)`. The digest then sees fresh weather and the
  same numbers as the stored snapshot.
- Worst-case wall time is unchanged: max(35 s sync, 6 s fetch + ~1 s) + digest + extras.
- Add `forecast: forecast.status` to both JSON bodies.
- Pass `forecast: forecastStep(forecast)` into both `dailyOutcome(...)` calls (the success and the `catch` branch).
- Change the `extras()` step type to `Exclude<DailyStep, "sync" | "digest" | "forecast">`.

**`src/lib/job-health.ts`** (ops, shared, additive):

- `DailyStep` gains `"forecast"`.
- `STEP_NAMES.forecast = "Satış tahmini"`.
- `STEP_LABELS.forecast`, inserted after `sales` so the Ayarlar order reads naturally:
  - `ok` "Tahmin kaydedildi";
  - `noweather` "Tahmin kaydedildi, hava alınamadı";
  - `nodata` "Tahmin: veri yok";
  - `error` "Tahmin hata".
- `dailyOutcome`'s `order` gains `"forecast"` at the end. Only the code `error` fails the step (existing `stepFailed`),
  so a forecast error makes the run `partial`, never `error`. `noweather` and `nodata` are not failures.
- New pure helper:

  ```ts
  forecastStep(r: { status; weather; error? }): StepResult
  ```

  It maps `error` → `{ code: "error", error }`, `skipped` → `nodata`, `weather === "error"` → `noweather`, otherwise
  `ok`.
- `tests/gunluk-isler.test.ts` gets one case: forecast `error` → run `partial`, with the message
  "Satış tahmini: …"; `noweather` → still `ok`.

Route handlers under Cache Components run at request time and the cron reads headers
(`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` § Cache Components).

**`src/server/notify/digest.ts`** (shared): in `runReminderDigest`, after the skip check and recipients:

```ts
const forecast = await Promise.race([loadDigestForecast().catch(() => null), sleep(4000).then(() => null)])
```

Pass it as the **6th optional positional argument** of `renderDigest(rows, today, invoices?, prices?, system?, forecast?)`.
In the working tree the 5th argument `system?: DigestSystem | null` already exists (ops).

- This is the only signature touch. R4 fixed the 5th (ops) for batch 1; a trailing optional parameter is additive and
  every existing call compiles.
- The forecast is not added to `keySeed` and is not news.

**`src/server/notify/digest-template.ts`** (shared):

- New type `DigestForecast = { lines: string[]; href: string }` (lines from `digestLines`).
- Render the box after `${priceSection}`, and the text lines before the button line.

### 8.6 Seam for ModPOS daily product / sales data (not built now)

- **Daily totals.** `DayTotal.source: "kasa" | "pos"`. `mergeDailyTotals(kasa, pos)` lets kasa win per date.
  - `loadDailyTotals` has one marked spot: `// ModPOS günlük satış: pos = await loadPosDailyTotals(from, to)`.
  - An export that includes past months would backfill the history at once, moving quality from "ay" to "tam" with no
    model change.
- **Product mix.** `ProductMix.basis.kind = "daily"` and `byWeekday`. `dessertPlan` uses `byWeekday[key][weekday]`
  when present, else `perTL`.
  - `loadProductMix` has one marked spot.
  - Without daily data the behaviour is exactly the monthly mix (tested).
- **Hourly staffing** (needs hourly POS data) is out of scope. `staffFor` stays daily.

### 8.7 Bugün integration (today.md files, shared)

- **`src/server/data/today.ts`:**
  - `TodayData.forecast: { admin: ForecastCardData | null; staff: StaffForecastView | null }`.
  - `adminFacts` adds `safe(loadForecastCard(now))`; `staffFacts` adds `safe(loadStaffForecast(now))`.
  - The source test (today.md §8) adds `loadForecastCard` to the admin-only list and `loadStaffForecast` to the
    staff-only list.
- **`src/app/panel/bugun/logic.ts`:** `cafeLines(k, openOrders, busy?: StaffForecastView | null)` puts the §5.4 lines
  first (keys `yogunluk`, `tatli`).
- **`src/app/panel/bugun/page.tsx`:** renders `<TodayForecast data={…admin} />` for admins in the right column (§5.3).
- **Optional, recommended (one fact, one test):** `DayFacts.closedYesterday?: boolean` from a `kapali` special day
  covering yesterday. When true, the `kasa-dun` row is not produced. This closes today.md decision 5 ("kapalı gün
  işareti yok") for the admin's own marks.
- **Fallback if Bugün is not on the branch:**
  - render `TodayForecast` on Genel bakış (`src/app/panel/page.tsx`, right column under `DashboardPayments`, wrapped in
    its own `Suspense` with `.catch(() => null)`);
  - skip the staff line;
  - add the Bugün wiring when today merges.

---

## 9. Files

### Add

| File | Content |
|---|---|
| `src/lib/forecast/{calendar,model,weather,staffing,desserts,accuracy,text,index}.ts` | §6, §4, §7 (pure) |
| `src/server/forecast/{load,mix,weather,job}.ts` | §8.3 (server-only) |
| `src/server/actions/forecast.ts` | §8.4 |
| `src/app/panel/tahmin/page.tsx` | Sync page + `Suspense` + async `ForecastContent`: `requireAdmin()`, `loadForecastPage()`, `PageHeader`, banner, grid. `export const metadata = { title: "Satış tahmini" }` |
| `src/app/panel/tahmin/forecast-days.tsx` | Server: 7-day `<details>` list, footer attribution |
| `src/app/panel/tahmin/forecast-desserts.tsx` | Server: dessert card |
| `src/app/panel/tahmin/forecast-accuracy.tsx` | Server: accuracy card |
| `src/app/panel/tahmin/forecast-calendar.tsx` | Server: "Takvim ve etkiler" `<details>` |
| `src/app/panel/tahmin/special-days.tsx` | `"use client"`: list, suggestions, dialog, delete + undo toast |
| `src/app/panel/tahmin/forecast-settings.tsx` | `"use client"`: settings form |
| `src/app/panel/tahmin/forecast-actions.tsx` | `"use client"`: header "Özel gün ekle" (opens the shared dialog via a small context) and "Güncelle" |
| `src/app/panel/bugun/today-forecast.tsx` | Server: Bugün admin card (§5.3) |
| `tests/satis-tahmini.test.ts` | §11 |
| `tests/fixtures/met-compact.json` | Trimmed real-shaped MET response (≈ 60 steps: hourly then 6-hourly; one rainy afternoon; one step at 21:00Z) |
| `docs/SATIS-TAHMINI.md` | §12 |
| `drizzle/00NN_satis_tahmini.sql` + meta | Generated at merge (R2) |

### Change

| File | Change |
|---|---|
| `src/server/db/schema.ts` *(shared)* | §8.1 |
| `src/components/panel/nav.ts` *(shared)* | §5.1 (`TrendingUp` import) |
| `src/app/api/cron/gunluk/route.ts` *(shared)* | §8.5; header comment adds "satış tahmini (hava durumu + günün tahmin kaydı)" |
| `src/lib/job-health.ts` *(ops, shared; present in the working tree)* | `DailyStep` + `"forecast"`, `STEP_NAMES` / `STEP_LABELS.forecast`, `dailyOutcome` order, `forecastStep()` (§8.5) |
| `src/server/notify/digest.ts`, `digest-template.ts` *(shared)* | §8.5 |
| `src/server/data/today.ts`, `src/app/panel/bugun/{page.tsx,logic.ts,today-cafe.tsx}` *(today, shared)* | §8.7 |
| `src/app/panel/yardim/page.tsx` *(shared)* | FAQ §5.6 |
| `tests/bugun.test.ts`, `tests/hatirlaticilar-digest.test.ts`, `tests/gunluk-isler.test.ts` | One case each (§11) |
| `README.md`, `docs/BILDIRIMLER.md`, `docs/KASA-RAPORU.md`, `docs/DEPLOY.md`, `docs/BUGUN.md` | §12 |

Not touched: `src/lib/roles.ts`, the bell (`notifications.ts`), `src/app/panel/page.tsx` (except the fallback),
Analiz, kasa files, `scripts/seed.ts`.

---

## 10. Edge cases and interactions

- **No data at all** (local DB has no cash reports but has `months`): quality `ay` from October 2026, with the banner,
  wide ranges and the dessert card from September. With `months` emptied too: the empty state, no Bugün numbers and no
  e-mail box.
- **First weeks in production.**
  - Days 1–6: `ay`.
  - From 7 normal days in 28: `ortalama`.
  - After ~3 weeks: `karma` → `tam`.
  - The range shrinks to past quantiles after 14 stored morning forecasts with actuals.
- **Missing report vs closed.** A missing day is simply absent: it is not used and the list says "Rapor yok". A day with
  `zTotal = 0` is closed and excluded (same as kasa.md). A `kapali` special day forces 0, and accuracy skips it.
- **Leakage.** Today's own Z is never used for today's forecast (test). A same-morning snapshot counts only if written
  before 12:00 TR. That keeps a late manual "Güncelle" (after the admin learned the day's story) out of the metric.
- **Special day added after the morning.** The live forecast changes; the stored snapshot does not. The day's details
  show "Bu sabah kaydedilen tahmin: …".
- **Past special day.** It removes that day from the baseline and shows the realised effect. Old snapshots are
  unchanged.
- **Weather.**
  - Fetch failure, MET block, or the setting off → factor 1 and the footer says why.
  - Days beyond MET's ~9-day horizon don't occur (the horizon is 7).
  - Learning weather needs ≥ 5 rainy days with stored weather, so in practice the weather factor stays at default for
    months. That is stated in the calendar card ("varsayılan").
- **Rain and a holiday on the same day:** both factors multiply. The clamp `[0,4; 2,5]` guards extreme stacks.
- **Ramazan normalisation.** History days inside Ramazan are divided by 0,92 before averaging. Right after Ramazan the
  baseline is not dragged down, and inside Ramazan the factor puts it back (test 7).
- **Long school summer.** Weekday history inside the summer is divided by 1,10, so the September baseline is not
  inflated.
- **Growth / ramp-up.** The 6-week window plus the "Son 2 hafta eğilimi" factor. The trend is capped at ×0,8–1,25 and
  needs ≥ 5 days.
- **Business day 00:00–05:00.** D0 is still yesterday, so the Bugün card and `/panel/tahmin` keep showing "Bugün" =
  the open business day. Bugün's `nextRefreshAt` already refreshes at 05:00.
- **Preview deployments** share the production DB:
  - `canWriteSnapshots()` is false, so no snapshot rows are written from preview code (a different model must not
    pollute production accuracy);
  - weather upserts are harmless (same data);
  - before the migration reaches production a preview's `/panel/tahmin` errors (expected for every migration branch,
    R1). Bugün and the digest swallow the error (`safe`, `.catch`).
- **Roles.**
  - `/panel/tahmin` and all actions are `requireAdmin`.
  - Staff reach only `loadStaffForecast` through Bugün. The view has no ₺, no amount, no staff count and no settings
    (test).
  - The staff count is not a salary or cost, but it is still kept from staff (owner decision 4).
- **Settings with renamed or deleted dessert categories:** names that no longer exist are ignored. If none remain,
  the default rule applies (`/tatl/`).
- **Concurrency.**
  - Snapshot inserts are `ON CONFLICT DO NOTHING` (cron plus manual).
  - Weather upserts are idempotent.
  - Settings saves are last-write-wins (single admin).
- **Time budget.** The weather fetch is capped at 6 s. The forecast computation is in memory over ≤ 400 days. The digest
  waits for its forecast box at most 4 s and then sends without it.
- **Cash plan (insight).** It still uses its flat 28-day average. A follow-up could feed days 1–6 of the cash plan's
  sales line from `buildForecast`. That is not in this plan.
- **Kasa missing-days lists** (kasa.md): they could skip `kapali` special days via a small exported
  `closedDays(from, to)`. That is a follow-up, not done here.

---

## 11. Tests (`npx tsx --test tests/satis-tahmini.test.ts`; then `npm test`, `npm run lint`, `npx tsc --noEmit`)

Fixed clocks, for example `new Date("2026-10-22T05:30:00Z")` (08:30 TR).

1. **Calendar table sanity.**
   - Every entry has `from ≤ to` and valid dates; same-kind entries don't overlap.
   - Coverage reaches 2028-12-31.
   - Pinned weekdays: 2026-10-29 Perşembe, 2027-03-09 Salı, 2028-02-26 Cumartesi, 2028-05-05 Cuma.
   - `calendarDay`:
     - "2026-10-28" → `arife`;
     - "2026-10-29" → `resmi`;
     - "2027-05-19" → `kurban-bayrami` day 4 (beats 19 Mayıs);
     - "2027-03-08" → event `arife`, seasons `ramazan` + `okul-tatili`;
     - "2026-11-18" → season `okul-tatili`;
     - "2027-02-15" → season `ramazan`;
     - "2026-12-15" → nothing.
   - `coverageNote`: null in 2026, set from 2027-08-01.
2. **Weekday-only factors.** Resmî tatil on Sunday 2026-08-30, arife on Saturday 2027-05-15 and okul-tatili on a
   Saturday all give 1. On a weekday the default applies.
3. **Sparse data and tiers.**
   - No history and no months → `yok`, `days.length === 0`.
   - Months only (Oct 2026: 293.909 / 16) → `ay`. Saturday 24 Oct = 23.000; Thu 22 Oct = 17.500; range ±25 %
     (17.000–29.000 for Saturday).
   - 8 normal days → `ortalama`.
   - 3 of each weekday → `tam`, base = median.
   - Missing weekdays → `karma` plus `missingWeekdays`.
4. **`robustMean` / `quantile`.** `[9,10,11,12,50]` → 11; n = 3 → median; n = 4 → median of the middle two; quantile
   interpolation.
5. **Exclusions.**
   - A derbi day with 3× sales does not move the baseline.
   - A `zTotal = 0` day is excluded.
   - A `kapali` entry gives 0, level `kapali`, staff 0 and dessert 0.
   - Overlapping manual entries multiply.
6. **Holiday multipliers and learning.**
   - With `tam` data, 29 Oct 2026 = Thursday base × 1,20.
   - Learned: three past weekday resmî tatiller each at 1,5× their rolling base → 1,342 (`n = 3`, source
     `ogrenildi`).
   - One past day → default.
   - Days whose rolling base is `ay` are skipped.
7. **Season normalisation.** Constant weekday sales of 11.000 inside `okul-tatili` → normalised base 10.000. A target
   outside the season gets 10.000 and one inside gets 11.000. Ramazan works the same with 0,92.
8. **Weather.**
   - `parseMetCompact(fixture)`:
     - TR-day bucketing (`…T21:00:00Z` → next day);
     - hourly precipitation sum over 09–22;
     - the 6-hourly fallback (06Z + 12Z);
     - `symbol` without `_day`.
   - `{}` / `null` / bad shapes → `[]`.
   - `weatherKind` thresholds (4,9 mm normal; 5 yağmur; 35 °C sıcak).
   - A rainy target day gets ×1,05.
   - `weather: null` → no factor.
   - `metUrl()` has exactly 4 decimals; `userAgent()` contains `LAffogatoPanel/` and the app URL and never an `@` unless
     the contact is given.
9. **Range.**
   - Fewer than 14 ratios → default spreads, +5 points for an unlearned event.
   - ≥ 14 → quantiles clamped to ≤ 0,95 / ≥ 1,05.
   - `low ≤ amount ≤ high`; rounding to 500 and to 100.
10. **Business day and leakage.**
    - `businessDate(new Date("2026-10-23T01:59:00Z"))` = "2026-10-22"; 02:00Z → "2026-10-23".
    - Adding a huge actual on `today` (or later) to `history` does not change any forecast.
11. **DST-free dates.** Forecasts starting on 2027-03-25 and 2027-10-29 give 7 consecutive, distinct dates with the
    right weekdays (spanning the EU DST changes).
12. **Trend.**
    - Last-14 normal days at 1,2× base → factor 1,2 with label "Son 2 hafta eğilimi".
    - At 1,05× → none.
    - At 2× → clamped 1,25.
    - Fewer than 5 days → none.
13. **Staffing.** 17.500 / 10.000 → 2; 23.000 → 3; `ifBusy` only when `high` crosses; min/max clamp; closed → 0.
    `parseForecastSettings` with garbage → defaults; `max < min` → `max = min`.
14. **Desserts.**
    - A September-like fixture (183 desserts / 429.698 ₺) → `per10k` ≈ 4,26; 23.000 ₺ → ≈ 10.
    - Peçete (Ambalaj) and ml ingredients are excluded.
    - Magnolia shared by 3 products sums into one item.
    - `perWhole` 12 → `wholes` to 1 decimal.
    - A product without a prep ingredient becomes its own item.
    - `byWeekday` present → used; absent → `perTL` (seam).
    - `isDessertCategory("TATLILAR", null)` is true (fold); a chosen list overrides.
15. **Staff view.**
    - `staffView(...)` keys are exactly `level`, `reasons`, `desserts`, `closed`.
    - `JSON.stringify` contains no "₺" and no forecast amount (the test checks that `String(day.amount)` is absent).
    - Reasons have no "%".
16. **Accuracy.**
    - The miss is weighted (Σ|a−f| ÷ Σa).
    - A snapshot written at 13:00 TR is excluded.
    - Statuses `rapor-yok`, `kapali`, `kayit-yok`.
    - Bias sign.
    - `weekAhead` uses `madeOn = date − 6`.
    - Fewer than 7 days → `miss: null`.
    - `pastRatios` uses the same rules.
17. **Texts.**
    - `signedPct`: "+%20", "−%8".
    - `dayTitle` gives "Bugün · 22 Ekim Perşembe" and "Yarın · …".
    - Each `explainLines` base variant.
    - `digestLines` for normal, closed and no-yesterday.
    - `suggestedDays`: Anneler Günü 2027 = 9 May, Babalar Günü 2027 = 20 June; an already covered date is not
      suggested.
18. **Source and role checks** (`readFileSync` pattern):
    - `tahmin/page.tsx` calls `requireAdmin`.
    - Every exported action in `actions/forecast.ts` calls `requireAdmin`.
    - `canOpen("staff", "/panel/tahmin") === false`.
    - `mobileTitleFor("/panel/tahmin") === "Satış tahmini"`.
    - `server/forecast/weather.ts` contains `cache: "no-store"`, `User-Agent` and `AbortSignal.timeout`.
    - `job.ts` checks `canWriteSnapshots`.
    - `src/server/data/today.ts`: `loadForecastCard` only inside `adminFacts`, `loadStaffForecast` only inside
      `staffFacts`.

**Extended tests:**

- `tests/bugun.test.ts`: `cafeLines` with a `busy` view → the first lines are "Bugün yoğunluk: Yüksek · Cumhuriyet
  Bayramı" and the dessert line; no "₺".
- `tests/hatirlaticilar-digest.test.ts`: `renderDigest(rows, today, null, null, undefined, forecast)` → the html and
  text contain "Satış tahmini" and the lines; the subject is unchanged against the call without a forecast.
- `tests/gunluk-isler.test.ts`:
  - forecast `error` → run `partial`, message "Satış tahmini: …";
  - `noweather` / `nodata` → `ok`;
  - `stepTexts({ forecast: "ok" })` → "Tahmin kaydedildi".

Existing `kenar-cubugu`, `roller`, `yardim` and `mobile-nav` cover the new nav item automatically.

**Manual check:** `npm run dev` against the local DB.

- `/panel/tahmin` at 390 px and 1280 px shows quality `ay` from October, the 28/29 October chips, the Tatlı card from
  September, and accuracy "henüz 0 gün".
- Add a derbi on Saturday → +%15 and "Özel gün eklendi".
- "Güncelle" → the toast. Without network: "Hava durumu alınamadı…".
- Seed ~25 cash reports with SQL (Oct–Nov, one zero day, one derbi day) → `tam`, the trend line, and the Bugün card as
  admin and staff.
- With `RESEND_API_KEY` unset the digest is skipped. Check `renderDigest` through the test.

---

## 12. Docs

**`docs/SATIS-TAHMINI.md` (new):**

- Goal and target (Z, online excluded).
- The model in 6 steps with the worked example of §4.2.
- The data tiers and banners.
- The factor table (defaults; learned or fixed; weekday-only).
- The calendar table with sources, and **how to update**: add 2029 resmî/dini days from Diyanet; add MEB 2027–2028 when
  it is published (clear `estimated`); the coverage note dates.
- Özel günler (kinds, effects, past marking).
- Weather:
  - MET endpoint and coordinates;
  - the terms (User-Agent, Expires / If-Modified-Since, 4 decimals, CC BY 4.0 attribution);
  - free;
  - the optional `WEATHER_CONTACT`;
  - what happens on failure.
- Staffing and desserts formulas; the ModPOS seam (§8.6).
- Accuracy (same morning before 12:00, weighted miss, week-ahead).
- Tables and keys (`special_days`, `weather_days`, `forecast_snapshots`, `forecast.settings`, `forecast.weather`).
- Roles; files.

**`README.md`:**

- Screen table row: "Satış tahmini: önümüzdeki 7 gün beklenen satış (Z), kaç kişi, kaç tatlı; bayram, tatil, Ramazan,
  okul tatili, hava durumu (MET Norway) ve özel günler (derbi, AVM etkinliği, kampanya); her sabahki tahmin
  gerçekleşenle karşılaştırılır ([docs/SATIS-TAHMINI.md](docs/SATIS-TAHMINI.md)) | `/panel/tahmin` | — (yeni)".
- "Günlük işler" row: "…, satış tahmini (hava durumu ve günün tahmin kaydı)".
- `lib/` tree: `forecast/`.
- `db:reset` "Silmedikleri": "satış tahmini (özel günler, kayıtlı tahminler, hava durumu, ayarlar)".

**Other docs:**

- **`docs/BILDIRIMLER.md`:** the morning e-mail "Satış tahmini" box (only in an e-mail that is going anyway; the
  setting).
- **`docs/KASA-RAPORU.md`:** one line, "Kasa raporlarının Z toplamı satış tahminini besler; 0 girilen gün kapalı
  sayılır."
- **`docs/DEPLOY.md`:** the outbound request to `api.met.no` (no key, free); optional `WEATHER_CONTACT`; additive
  migration `satis_tahmini`.
- **`docs/BUGUN.md`** (today): the forecast card (admin) and the yoğunluk / tatlı lines (staff).
- **Yardım:** §5.6.

---

## 13. Owner decisions (defaults implemented; nothing blocks)

1. **Weekday shares for an AVM café until own data exists:** Pzt %85, Sal %85, Çar %90, Per %95, Cum %105, Cmt %125,
   Paz %115. *Default: these.*
2. **Calendar effects:**
   - hafta içi resmî tatil +%20;
   - hafta içi arife +%10;
   - Ramazan Bayramı +%15;
   - Kurban Bayramı %0;
   - Ramazan ayı −%8;
   - okul tatili (hafta içi) +%10;
   - yağmur / 35 °C üstü +%5.

   *Default: these, learned from the café's own days as they accumulate.* There is no edit screen for them in v1.
3. **Staff suggestion:** 10.000 ₺ per person per day, at least 2, at most 6. *Default: these* (editable).
4. **What staff see on Bugün:** the busy level, reason names and the dessert count; no amounts, no staff suggestion.
   *Default: on* (setting).
5. **Morning e-mail:** the forecast box only in an e-mail that is going out anyway. *Default: yes*; it never sends an
   e-mail by itself.
6. **Who enters özel günler:** the admin only. *Default: admin.* Staff entry could come later (`requireUser` and a
   tighter range).
7. **Target:** Z total (KDV dahil), laffogato.net online excluded. *Default: yes.*
8. **Dessert categories:** "Tatlılar" (names containing "tatlı"). *Default: yes* (editable).
9. **Calendar maintenance:** the developer adds MEB 2027–2028 when it is published (the screen warns from 1 August 2027)
   and 2029 in late 2028.

---

## 14. Risks and integration notes

- **Thin data at launch.** Expect wide ranges and default shares for about 3 weeks. Mitigated by the banner, the
  "Kaba tahmin" line on Bugün and the honest range. A ModPOS daily export with history (§8.6) would remove this at once.
- **Defaults are informed guesses.** Each factor shows its source, and learned values replace defaults as history
  accumulates. Owner decision 2 lets the owner veto any default before launch.
- **MET Norway:**
  - The terms were checked through MET's official pages via search; the ToS page itself could not be fetched from the
    planning sandbox (DNS). **The implementer opens https://api.met.no/doc/TermsOfService once** and confirms the UA
    and caching rules before shipping.
  - The service can block or change. Failure only removes the weather factor.
- **2028 Ramazan start** comes from secondary sites quoting Diyanet. Re-check it (test 1 pins whatever is committed).
- **Shared files:**
  - `schema.ts` and the migration (R2: generate at merge, one at a time; this merges after menu, so its number is
    about 0025);
  - `gunluk/route.ts` (ops also wraps it: rebase on ops, put `forecastP` inside ops' `try`);
  - `digest.ts` / `digest-template.ts` (the 6th argument; R5 untouched);
  - `job-health.ts` (one step);
  - `nav.ts` (one child, one ⌘K item; additive);
  - Bugün files (one card, one `cafeLines` parameter, two loader calls);
  - Yardım, README.
- **Plans and modules this depends on, with fallbacks:**
  - **today.md:** `loadToday` (`adminFacts` / `staffFacts`), `cafeLines`, `today-cafe.tsx`, `src/app/panel/bugun/page.tsx`.
    *Fallback:* the card goes on Genel bakış and staff get no line (§8.7).
  - **ops.md §3** (already in the working tree): `DailyStep` / `StepResult` / `dailyOutcome` / `STEP_LABELS` in
    `src/lib/job-health.ts`, `startJobRun` / `parasutSyncedToday` in `src/server/jobs/runs.ts`, and `renderDigest`'s
    5th `system` argument. *Fallback,* if it is reverted: the forecast status goes only in the cron JSON and
    `undefined` is passed as the 5th argument.
  - **kasa.md:**
    - `trHour` from today.md (`src/lib/cash-report.ts`). *Fallback:* a local `Intl` hour helper in `accuracy.ts`.
    - Nothing else; `cash_reports.z_total` is read directly.
    - kasa's `months` nullability (`discounts` / `off_revenue`) does not matter: only `open_days` / `pos_revenue` with
      `> 0` filters are read.
  - **adminstepup:** not needed (no admin-affecting action).
  - **insight:** none required. The cash-plan sales line can adopt `buildForecast` later.
- **Performance.**
  - `/panel/tahmin`: about 10 small queries plus a ≤ 400-day in-memory computation.
  - Bugün admin: about 8 queries; staff: about 7. All parallel.
  - The morning job adds one HTTP request and 7 inserts.

---

## 15. Sources (verified 2026-10-22 by web search; cite them in `calendar.ts` / `weather.ts` comments and the doc)

**Weather (MET Norway):**

- ToS (User-Agent, Expires, If-Modified-Since): https://api.met.no/doc/TermsOfService,
  https://api.met.no/doc/locationforecast/HowTO, https://api.met.no/doc/locationforecast/FAQ
- 4-decimal rule (403/400): https://docs.api.met.no/2020/06/12/locfc2.html, https://api.met.no/doc/GettingStarted
- JSON format: https://api.met.no/doc/ForecastJSON
- Licence (NLOD 2.0 + CC BY 4.0, "Data from MET Norway"): https://api.met.no/doc/License

**Location:** Tuzla, Opera AVM (Istanbul); Tuzla centre 40.8160, 29.3010 (CRITIQUE2 R19).

**2026 holidays and religious days:**

- https://www.cnnturk.com/guncel/2026da-hangi-gunler-resmi-tatil-liste-liste-resmi-tatil-gunleri-2026-2362840
- https://www.isbank.com.tr/blog/2026-resmi-tatiller-takvimi
- https://www.gazetevatan.com/galeri/bugun-ramazanin-kacinci-gunu-2026-ramazan-bayrami-ve-kurban-bayrami-ne-zaman-diyanet-takvimi-2353004
  (first fast 19 Feb 2026; 28 Ekim half day)

**2027:**

- https://www.cnnturk.com/turkiye/2027-resmi-tatiller-takvimi-dini-bayramlar-resmi-tatil-gunler-ne-zaman-2027-ramazan-ve-kurban-bayrami-tarihleri-3447415
- https://www.evrensel.net/haber/5997565/diyanet-2027-takvimini-duyurdu-ramazan-ne-zaman-basliyor
- https://www.milligazete.com.tr/2027-ramazan-ayi-hangi-gun-basliyor-ilk-sahura-ne-zaman-kalkilacak-diyanete-gore-ilk-oruc-kadir-gecesi-arefe-ve-bay
  (Ramazan 8 Feb – 8 Mar 2027)

**2028:**

- Diyanet 2028 dini günler: https://vakithesaplama.diyanet.gov.tr/icerik.php?icerik=185
- https://www.izintakvimi.com/2028/02/ramazan-bayrami-1-gun-20280226
- https://www.izintakvimi.com/2028/05/kurban-bayrami-1-gun-20280505
- https://bugunkandilmi.net/2028 (Ramazan from 28 Jan 2028, secondary)

**MEB:**

- 2026–2027: https://www.meb.gov.tr/2026-2027-egitim-ogretim-yili-takvimi-aciklandi/haber/41057/tr
- https://www.aa.com.tr/tr/gundem/meb-2026-2027-egitim-ogretim-yili-takvimini-belirledi/3966122
- 2025–2026 end (26 Jun 2026): https://www.tgrthaber.com/yasam/okullar-ne-zaman-kapanacak-kac-gun-kaldi-3339513

**Next.js docs relied on:**

- `node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/connection.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/fetch.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md`
- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`
