# Plan: Karaoke doluluk haritası ("Doluluk")

Group key: **doluluk**. Base: `claude/oneriler` = origin/main @ 71ac11f. Next.js 16.4 (cacheComponents), Drizzle, Turkish UI.
Follows CRITIQUE.md R1–R7: nothing is pushed before ops-policy is on main, the migration is generated at merge time, the
worktree uses its own database, and only additive edits are made to shared files.

---

## 1. Goal

The owner sees, for the café's karaoke room, which weekday and hour is full and which is empty. The page answers five
questions with numbers:

- **Doluluk:** how much of the open time the room was in use.
- **Saat başına gelir:** how much money one occupied room-hour brings.
- **Uzatma oranı:** how often groups extend.
- **Son dakika iptal:** how many bookings were cancelled within 24 hours of the start.
- **Kaç gün önceden:** how many days ahead people book.

The period can be the last 4 weeks, the last 12 weeks or a calendar month. The months are compared side by side, and
one or two plain-Turkish insights are shown ("En boş saatler: Salı–Perşembe 14–17 · %4 dolu").

The new admin-only screen is **Karaoke › Doluluk** (`/panel/karaoke/doluluk`). It reads the panel's existing
`karaoke_sessions` (site bookings plus walk-in timers). Two small facts the site already sends but the panel throws
away are now stored: when the booking was made, and when it was cancelled. A one-time **history import** pulls past
site bookings, because the karaoke link went live only on 21 Oct 2026 and the panel has almost no history. The
calculation lives in pure, tested modules. Staff never see this screen or any amount.

Schema: two nullable columns on `karaoke_sessions`. New dependency: none. New cron: none.

---

## 2. What the real data can and cannot tell (checked in code and in the local database)

| Need | Source today | Verdict |
|---|---|---|
| Sessions | `karaoke_sessions`: `source "site"` (copy of laffogato.net bookings, `externalId krk-…`) and `source "panel"` (walk-in quick timer, `startKaraokeTimer`). Columns used: `startsAt`, `endsAt` (booked end), `extraMinutes` (+15 / +30), `endedAt` ("Erken bitir" or "Haber verdim"), `guests`, `status`, `paymentStatus`, `totalMinor` | Enough for occupancy, extension and party size |
| History | Sync window is **yesterday → +90 days** (`syncKaraoke`). Past rows stay but are never re-read. Migration `0013_personel_yetkileri_karaoke` is dated 2026-10-21, so production has rows from about 20 Oct on. The local DB has **0 karaoke rows** | Month comparison needs a **history import** from the site (§5.4). Walk-in timers before 21 Oct do not exist anywhere per session |
| Room count | `docs/KARAOKE.md` › Çakışma uyarısı: "Oda tektir"; `overlap.ts` assumes one room; the site sends no room field | `KARAOKE_ROOMS = 1` constant. The pure code takes `rooms` as a parameter (tested with 2) |
| Opening hours | Nothing in `settings`, `fields.ts` or docs. The brief mentions MaviBahçe AVM, but `docs/PARASUT.md` §6a-1 and `docs/SITE-SATIS.md` say MaviBahçe AVM is the separate **karaoke box** business ("Karaoke box" category, kept out of the café). The panel's room is "köşkün kendi odası", and the café's rent goes to Opera AVM (local DB: `invoices` supplier "Opera AVM", category "Kira & AVM") | New small setting **Oda saatleri**, default every day 10:00–22:00 (typical AVM hours), editable on the page (§4.8). Owner question 1 |
| What counts as occupied | Site rows have **no "started" time**: the timer starts at `startsAt`. `endedAt` < end means an early finish (room freed). `endedAt` ≥ end means "Haber verdim" after the alarm | Occupied = `[startsAt, min(endsAt + extraMinutes, endedAt))` (§3.1) |
| Cancellations | Site sends `status: cancelled`; `paymentStatus` `expired` (unpaid checkout hold that lapsed, never a booking), `refunding` / `refunded`. **No cancellation time is stored**: only `lastEvent="cancelled"` + `lastEventAt` when the sync rang for it (not on the first sync, not for past bookings). `extUpdatedAt` holds the site's last `updatedAt`, which moves again on refund steps | New column `cancelled_at`, set by the sync on the transition (§5.3). Read-time fallback: `lastEventAt` when `lastEvent = "cancelled"` |
| No-shows | **The site sends none** (statuses are requested / confirmed / cancelled only). The bar screen has no "Gelmedi". If staff press "Erken bitir" at the start, `endedAt` ≈ `startsAt` | Occupancy handles it naturally: an early-ended session is occupied only until `endedAt`. A no-show count is not possible; a "Gelmedi" button is a follow-up (§11) |
| Lead time | The site sends `createdAt` (parsed in `src/lib/karaoke/site.ts`, in the test fixture `"2026-10-21T09:00:00.000Z"`), but `sync.ts` **does not store it**. The panel's `createdAt` is the first-seen time, which is wrong for first-sync rows | New column `booked_at` = site `createdAt` (§5.3). The history import fills it for the past |
| Party size | `guests` (site: 0 → null; timers: optional) | Average per month, and in the cell detail |
| Room fee | `totalMinor` (kuruş, KDV dahil), admin-only (`toSessionDTO`). `monthStats` already counts `paid` + `none` (pay at the counter) | Used per session (§3.5) |
| Walk-in and extension money | Paid at the counter: ModPOS "Karaoke Kişi başı" / "Karaoke Toplu" lines, `sales_lines.is_service`. Local DB, Sept 2026: 7 × 150 ₺ + 1 × 1.000 ₺ = 2.050 ₺. Per month only, not per session | Added to the money side only for **months** whose ModPOS sales are uploaded **and** whose days are fully covered by panel timers (§3.5). The future ModPOS daily export plugs into the same slot (seam, §5.6) |
| In-room orders | Site orders (`docs/SITE-SIPARIS.md`): fulfillment `table` / `pickup` / `delivery`, label "Masa 4". No karaoke-room destination. **No history is kept** (the last list is overwritten, by KVKK design). No amount is stored | **Cannot be linked today.** The page says so in one line; seam `RoomOrder[]` (§5.6) |
| Time zone | `TR_OFFSET_MS = 3h` fixed in `session.ts` (Türkiye has no DST since 2016); the business day ends 05:00 (`businessDate` in `cash-report.ts`) | Same rules: an hour boundary in TR is an hour boundary in UTC |

---

## 3. Decisions (made here so the implementer does not re-decide)

### 3.1 Occupied time

For each session `s`:

- **Not occupied (skipped):**
  - `status = "cancelled"`;
  - `paymentStatus` `expired`, `refunded` or `refunding`;
  - a hold (`isHold`: requested + pending).

  This is the same rule as `isPlayable` / `phase` for site rows. Panel timers are always occupied.
- **Start** = `startsAt`.
- **End** = `endsAt + extraMinutes`. If `endedAt` is earlier than that, end = `max(startsAt, endedAt)` (early finish:
  the room was freed).
- `endedAt` later than the end ("Haber verdim" after the alarm) does **not** extend occupancy. The minutes after the
  end were not sold, and the alarm keeps ringing until staff speak to the room.
- `requested` + `none` (pay at the counter, awaiting approval) counts as occupied. This matches `isLive` / `monthStats`
  (owner question 4).

### 3.2 Grid, business day, time zone

- **Rows:** business weekday, Monday first (Pzt … Paz). The business day runs 05:00 → 05:00 Türkiye time, as for kasa,
  so a 00:30 session on Saturday is in the **Friday** row.
- **Columns:** clock hours in business order (05 … 23, 00 … 04). Only the open hours are shown, plus any hour that had
  occupancy outside them.
- **Splitting:** each occupied interval is split at every hour boundary and at the 05:00 day boundary. Each piece goes
  to `(businessDay(pieceStart), clockHour(pieceStart))`. TR = UTC+3 exactly, so TR hour boundaries are UTC hour
  boundaries.
- **Several rooms / overlaps:** a sweep line computes the concurrency `c(t)`. The occupied room-minutes are
  Σ `min(c, rooms) × length`. Anything above `rooms` is reported as **çakışma** (with one room it is usually a walk-in
  timer opened for the booked group, "Yine de başlat").
- **Cell value:**
  - `ratio` = occupied room-minutes ÷ capacity;
  - capacity = (number of dates of that weekday in the period) × 60 × rooms, only for hours inside the opening hours;
  - outside the hours, capacity is 0, `ratio` is null, and the minutes are shown as "oda saatleri dışında".
- **Today is never counted:** periods end at the current business day (exclusive). A half-finished evening would make
  every comparison look worse.

### 3.3 Periods

`now` → `today = businessDate(now)` (05:00 rule).

| `?donem=` | Range of business dates `[from, to)` | Previous period (for the doluluk badge) |
|---|---|---|
| `4h` (default) | `[today − 28, today)` | `[from − 28, from)` |
| `12h` | `[today − 84, today)` | `[from − 84, from)` |
| `ay` + `?ay=YYYY-MM` (default: the month of `today`) | `[YYYY-MM-01, min(next month's 01, today))`; `partial` when the month is current | Previous calendar month, whole |

- The bounds are 05:00 TR on `from` and on `to`.
- An invalid `donem` gives `4h`. An invalid or future `ay` gives the current month.
- On the 1st of a month before 05:00 the current month has 0 days, and the page says so (§4.5).

### 3.4 KPIs: populations

All counts use sessions whose **start** is in the period. Minutes are clipped to the period.

| KPI | Formula |
|---|---|
| Doluluk | Σ occupied room-minutes inside the open hours ÷ Σ capacity |
| Uzatma oranı | Occupied sessions (site + walk-in) with `extraMinutes > 0` ÷ occupied sessions; also the average `extraMinutes` of the extended ones |
| Son dakika iptal | **Bookings** = site rows that are occupied or "cancelled bookings". A cancelled booking is `status cancelled` and not `expired`, or `paymentStatus` `refunded` / `refunding`. **Late** = a cancelled booking with `cancelledAt ≥ startsAt − 24 h` (`LATE_CANCEL_HOURS`). Rate = late ÷ bookings. A cancellation with no known time is counted in "zamanı bilinmiyor" and never as late |
| Kaç gün önceden | Occupied site bookings with `bookedAt`. Lead days = `daysBetween(trDate(bookedAt), businessDay(startsAt))`, clamped ≥ 0. A Saturday 00:30 session booked Friday 20:00 is 0 days ("aynı gün"). Shows the mean (1 decimal), the median and the same-day share. Rows without `bookedAt` are counted as `missing` |
| Ortalama kişi | Mean `guests` over occupied sessions that have it (month table and cell detail) |

### 3.5 Revenue per room-hour (one formula, two money bases)

Every amount is **KDV dahil** (incl. VAT), the same as `monthStats` and the site.

- **Basis "site"** (default):
  - money = Σ `totalMinor` of occupied site bookings with `paymentStatus` `paid` or `none`;
  - hours = the occupied hours **of those sessions only**. Walk-ins have no fee per session, so they are left out of
    both money and hours;
  - a session cut by the period edge counts its fee pro rata.
- **Basis "site+kasa"** is used only when **both** are true:
  - (a) counter (ModPOS) karaoke money exists for the period;
  - (b) the first panel timer is on or before `period.from`, so walk-in hours are fully counted.

  Then money = Σ `totalMinor` of occupied `paid` bookings + the counter karaoke money. `none` bookings are not added
  from the site, because they are paid at the counter and are already inside ModPOS. Hours = **all** occupied hours.
  - Today (a) exists only for whole **months** with an uploaded sales report (`sales_lines.is_service`). The future
    ModPOS daily export fills it for any period (§5.6).
  - Months before the timers (before 21 Oct 2026) never use it: the walk-in money would be divided by booking hours
    only.
- **Saat başına gelir** = money ÷ hours. Sub-line: **açık saat başına** = money ÷ (capacity ÷ 60). This second figure
  combines price and occupancy.
- **Room orders** (`RoomOrder[]`, null today): when a source exists, an order whose time falls inside an occupied
  interval adds its amount to the money of either basis (§5.6).

### 3.6 Insights (at most two lines)

Insights are computed only when the period has at least **14 days** and at least **8 occupied sessions**, and some
hour is open. Otherwise one muted reason line is shown.

1. **Emptiest block.** Search every rectangle of 1–4 consecutive weekdays (Mon→Sun, no wrap) × 2–4 consecutive open
   hours. All its cells must be open. Pick the lowest capacity-weighted ratio. Ties go to the larger area, then the
   earlier weekday, then the earlier hour.

   → `En boş saatler: Salı–Perşembe 14–17 · %4 dolu`
2. **Second line**, the first that applies:
   - **Late cancellations high** (rate ≥ 15 % and at least 3 late) →
     `Son 24 saatte iptal: 3 rezervasyon (%18)`
   - **Busiest block** (1–3 weekdays × 2–3 hours, highest ratio, shown only if ≥ 50 %) →
     `En dolu saatler: Cuma–Cumartesi 20–23 · %82 dolu`

Hour labels follow these rules:

- `14–17`;
- after midnight `23–01`;
- an end of exactly 24 is written `21–24`.

Weekday labels are `Salı` (one day) or `Salı–Perşembe` (a range). The texts avoid Turkish suffixes after numbers and
dates.

### 3.7 Things deliberately not done

- No new cron and no daily-job step. The history import is a button (and resumable).
- No bell, dashboard or digest entry (R5 untouched).
- No per-weekday opening hours.
- No "Gelmedi" button (follow-up).
- No forecast of future occupancy.
- Closed days (holidays) are not taken out of capacity. A future refinement could use the days without a kasa report.

---

## 4. User-facing behaviour (exact Turkish texts)

### 4.1 Navigation and access

| Where | What |
|---|---|
| URL | `/panel/karaoke/doluluk`, admin only. `src/lib/roles.ts` gets an admin-only carve-out under a staff path (§5.7): the proxy sends staff to `STAFF_HOME` before render, and `requireAdmin()` checks again |
| Section tabs | `SECTION_TABS.karaoke = [{ href: "/panel/karaoke", label: "Bar ekranı" }, { href: "/panel/karaoke/doluluk", label: "Doluluk" }]`. They are shown on both pages, **for the admin only** (Sayım ↔ Tutarlılık pattern) |
| Sidebar | No new item. The "Karaoke" leaf lights up on the sub-path by itself (`pathMatches` prefix) |
| ⌘K | New `NAV_GROUPS` › "Günlük" item `{ href: "/panel/karaoke/doluluk", label: "Karaoke doluluğu", icon: Grid3x3, roles: ["admin"], keywords: "karaoke doluluk ısı haritası boş saat dolu saat oda gelir saat başı uzatma iptal son dakika rezervasyon kaç gün önceden ay karşılaştırma" }` |
| Phone top bar title | `SHORT_TITLES["/panel/karaoke/doluluk"] = "Doluluk"` |
| Bottom nav | Unchanged; the screen lights "Menü" (admin), as for every drawer screen |
| Karaoke page (admin) | "Bu ay · {Ekim 2026}" card gets `actions`: `ButtonLink` (secondary, sm) **"Doluluk haritası"** → `/panel/karaoke/doluluk` |

### 4.2 Page header and period selector

- `metadata.title`: "Karaoke doluluğu".
- `PageHeader`:
  - eyebrow "Günlük", title "Karaoke doluluğu";
  - description: "Oda hangi gün ve saatte dolu, hangisinde boş; saat başına gelir, uzatma, son dakika iptali ve
    rezervasyonların kaç gün önceden yapıldığı. Yalnız yönetici görür.";
  - `tabs` = `SectionTabs karaoke`.
- `actions`: `SegmentedLinks` (label "Dönem") with these options:
  - "Son 4 hafta" (`?donem=4h`);
  - "Son 12 hafta" (`?donem=12h`);
  - "Ay" (`?donem=ay&ay={current month}`).

  When "Ay" is selected, `MonthPicker` (`param="ay"`) appears next to it (below it on phones). Its months run from
  the first month with data to the current month. On a phone the selector takes the full width.
- Under the header there is one muted 13px line (`text-ink-mute`):
  - 4h / 12h: `"{24 Eylül} – {21 Ekim} · 28 gün · oda saatleri {10:00–22:00} · bugün sayılmaz"`;
  - month, past: `"Eylül 2026 · 30 gün · oda saatleri 10:00–22:00"`;
  - month, current: `"Ekim 2026 · 1–21 Ekim · oda saatleri 10:00–22:00 · bugün sayılmaz"`.
- `Suspense` fallback: the same `PageHeader` without tabs and actions, plus `PageSkeleton rows={8}`.

### 4.3 Status banner (only when needed, above the KPIs)

- **History not imported and the link is configured** (info, `bg-info-soft`):

  "Geçmiş rezervasyonlar henüz siteden alınmadı; harita yalnız {21 Ekim 2026} ve sonrasını gösteriyor."

  Button **"Geçmişi siteden al"** (§4.9).
- **History partly imported:**

  "Geçmiş rezervasyonların {5} / {10} ayı alındı."

  Button **"Devam et"**.
- **Hours never saved** (gray, small):

  "Oda saatleri varsayılan: her gün 10:00–22:00. Doğru değilse değiştirin; doluluk bu saatlere göre hesaplanır."

  Button (ghost, sm) **"Değiştir"** opens §4.8.

### 4.4 KPI row

The grid is `grid grid-cols-2 gap-2 lg:grid-cols-5`. Every card is a `Stat compact`. The 5th card is
`col-span-2 lg:col-span-1` on phones.

| Label | Value | Sub (exact) | Info tip |
|---|---|---|---|
| **Doluluk** | `%38` | `"46 / 120 saat dolu"`. Badge `GrowthPill` vs the previous period: `"+6 puan"` / `"−4 puan"` / `"aynı"` (no badge when the previous capacity is 0) | "Odanın dolu olduğu süre ÷ oda saatlerindeki toplam süre. Rezervasyonlar (uzatma dahil) ve rezervasyonsuz sayaçlar sayılır; erken bitirilen oturum bittiği anda boşalır; iptal, süresi dolan ödeme ve iade sayılmaz. Bugün sayılmaz." |
| **Saat başına gelir** | `1.020 ₺` (or `–`) | Basis "site": `"Rezervasyon ücretleri · açık saat başına 390 ₺"`. Basis "site+kasa": `"Site + kasa (ModPOS) · açık saat başına 410 ₺"`. No fee-bearing session: `"Bu dönemde ücreti bilinen oturum yok"` | "Dolu bir oda-saatin getirdiği para (KDV dahil). Sitede ödenen ya da kasada ödenecek rezervasyon ücretleri, o rezervasyonların dolu saatlerine bölünür. Rezervasyonsuz oturumların ve uzatmaların parası kasada alınır, oturuma bağlı değildir: satış raporu yüklenmiş ve sayaçla tamamen kapsanan aylarda kasadaki karaoke de eklenir. Odadaki siparişler henüz bağlanamıyor." |
| **Uzatma** | `%25` | `"3 / 12 oturum uzatıldı · ortalama +25 dk"` (none: `"Uzatılan oturum yok"`) | "+15 / +30 dk ile süresi uzatılan oturumlar (rezervasyonlu ve rezervasyonsuz)." |
| **Son dakika iptal** | `%8` (tone `warn` when ≥ 15 %) | `"1 / 13 rezervasyon son 24 saatte · toplam 2 iptal"`; with unknown times, + `" · 1 iptalin zamanı bilinmiyor"`; no booking: `"Bu dönemde site rezervasyonu yok"` | "Başlangıçtan önceki 24 saat içinde (ya da sonra) iptal edilen rezervasyonlar ÷ bütün rezervasyonlar. Ödeme sayfasında bırakılıp süresi dolanlar rezervasyon sayılmaz." |
| **Kaç gün önceden** | `3,4 gün` | `"ortalama · yarısı en çok 2 gün önceden · %30 aynı gün"`; median 0: `"ortalama · yarısı aynı gün"`; + `" · 2 rezervasyonun tarihi yok"` when missing > 0; n = 0: value `–`, sub `"Bu dönemde site rezervasyonu yok"` | "Sitede rezervasyonun yapıldığı gün ile oturumun günü arasındaki fark (gece 05:00'e kadarki oturum önceki güne sayılır). Rezervasyonsuz oturumlar girmez." |

The texts use slash forms (`"3 / 12"`) on purpose. "12 oturumun 3'ü" would need a vowel-harmony suffix after a
number. The same rule applies everywhere on the page: no suffix after numbers or dates.

### 4.5 "Öne çıkanlar" card

- `Card` with `CardHeader`: icon `Lightbulb`, title "Öne çıkanlar".
- Body: `DotList` with the 1–2 lines from §3.6.
- If the insights are not computed, one muted line: `"Öne çıkanlar için en az 2 haftalık ve 8 oturumluk veri
  gerekiyor (bu dönemde 3 oturum)."`
- If the period has 0 days (the 1st of the month, current): `"Bu ayın tamamlanmış günü yok; geçen ayı seçin."`
- If it has 0 sessions: `"Bu dönemde oturum yok."`

### 4.6 "Gün ve saat" heatmap card (client component)

`CardHeader`:

- icon `Grid3x3`, title "Gün ve saat";
- description: "Her hücre: o gün ve saatte odanın dolu olduğu süre ÷ açık süre. Gece 05:00'e kadarki saatler önceki
  günün satırında (kasa günü gibi).";
- `meta`: the legend.

**Legend:** five swatches with labels `%0`, `%1–24`, `%25–49`, `%50–74`, `%75+`, plus a hatched swatch "Kapalı".

**Colour:**

- One hue, light → dark, on the panel's ink (TASARIM §1: colour only for meaning; Gauge also uses ink):
  `bg-ink/[.06]`, `bg-ink/20`, `bg-ink/40`, `bg-ink/65`, `bg-ink/90`.
- Text is `text-ink` on the first three and `text-white` on the last two (contrast ≥ 4.5:1 over `bg-panel`).
- Closed hours: `bg-surface` with a 45° `repeating-linear-gradient` hatch in `line-strong`.
- An outside-hours cell with occupancy is hatched and has a 6px ink dot.
- Colour never carries the value alone: the % number is in the cell (desktop) or in the detail line.

**Phone and tablet (< lg) layout: transposed.**

- Rows are hours, columns are the 7 weekdays.
- Grid: `grid-cols-[2.75rem_repeat(7,minmax(0,1fr))]`.
- The header row holds `Pzt Sal Çar Per Cum Cmt Paz`; the first column holds `10:00`, `11:00`, …, `01:00`.
- At 390 px each cell is about 44 × 44 px (`h-11`), and the number is shown in the cell (`text-[12px] tabular`,
  without "%").
- 12 open hours make a 530 px block. No horizontal scroll.

**Desktop (lg+) layout.**

- Rows are weekdays (full names), columns are hours.
- Grid: `grid-cols-[6rem_repeat(N,minmax(0,1fr))]`, cells `h-10`, number in the cell (`text-[12px]`).
- For N > 16 the numbers are hidden below `xl` (colour + detail line only).

**Interaction (dataviz rule: every cell has its own hover / focus).**

- Every cell is a `<button type="button">`. `aria-label` is one of:
  - `"Cuma 21:00, yüzde 75 dolu"`;
  - `"Salı 08:00, kapalı"`;
  - `"Cuma 01:00, oda saatleri dışında, 40 dakika dolu"`.
- Pointer move or focus (desktop) and tap (phone) set the selected cell.
- Below the grid there is one `aria-live="polite"` line:
  - nothing selected: "Bir hücre seçin: o gün ve saatin ayrıntısı burada görünür.";
  - selected:
    `"Cuma 21:00–22:00 · %75 dolu · kullanılan gün 3 / 4 · 6 rezervasyon, 2 rezervasyonsuz oturum · ortalama 4 kişi"`;
  - selected, outside the hours:
    `"Cuma 01:00–02:00 · oda saatleri dışında · 2 sa 10 dk dolu · kullanılan gün 2 / 4"`.

  "Kullanılan gün" = the dates of that weekday with any occupancy in that hour ÷ the dates of that weekday in the
  period.

**Footnotes (only when needed):**

- Outside the hours: `"Oda saatleri dışında 2 sa 10 dk dolu oturum var (00:00–02:00)."` Button (ghost, sm)
  **"Saatleri değiştir"** opens §4.8.
- Overlap: `"Aynı anda iki oturum: toplam 35 dk. Oda tek olduğu için bir kez sayıldı (çoğunlukla rezervasyonlu grup
  için ayrıca sayaç açılmıştır)."`

### 4.7 "Ay ay" month comparison card (server component)

`CardHeader`: icon `CalendarRange`, title "Ay ay", description "Son 6 ay; içinde bulunulan ay dünkü güne kadar."
Months run newest first, from the current month back, never before the first month with data. A month with 0
sessions shows `–`.

**Desktop (lg+):** `TableWrap` / `Table`.

| Ay | Doluluk | Dolu saat | Oturum | Saat başına | Uzatma | Son dakika iptal | Kaç gün önceden | Ort. kişi |
|---|---|---|---|---|---|---|---|---|
| Ekim 2026 (1–21) | %38 `+6 puan` | 46 | 17 (12 rez.) | 1.020 ₺ | %24 | %8 | 3,4 gün | 4,1 |

- Doluluk shows the delta vs the next-older row (`GrowthPill`).
- A thin inline ink bar sits under the doluluk value (width = ratio), so the column reads as a bar chart.

**Phone (< lg):** one `<details>` per month (summary ≥ 44 px).

- Summary: `"Ekim 2026"` + muted `"1–21 Ekim"` if partial, then on the right `"%38"` + `GrowthPill`.
- Body: `KeyValue` rows:
  - "Dolu saat";
  - "Oturum": `"12 rezervasyon · 5 rezervasyonsuz"`;
  - "Saat başına gelir";
  - "Uzatma";
  - "Son dakika iptal";
  - "Kaç gün önceden";
  - "Ortalama kişi".
- The newest month is open by default.

**Markers (both layouts):**

- `¹` after the month name when the month starts before the first panel timer. Footnote: "¹ Rezervasyonsuz
  oturumlar {21 Ekim 2026} itibarıyla sayılıyor; önceki aylarda yalnız site rezervasyonları var."
- `²` after "Saat başına" when the basis is "site+kasa". Footnote: "² Kasadaki karaoke (Satışlar'daki HİZMET
  satırları) dahil."

Both footnotes are shown only if used.

### 4.8 "Oda saatleri" dialog (client)

- Opened from the banner, the footnote or the data card.
- `Dialog`:
  - title "Oda saatleri";
  - description: "Doluluk bu saatlere göre hesaplanır; değişiklik geçmiş aylara da uygulanır. Gece yarısından sonra
    kapanıyorsa kapanışı ertesi günün saati olarak seçin (ör. 02:00).".
- Fields:
  - `Field` "Açılış": `Select` 05:00 … 23:00 (values 5…23).
  - `Field` "Kapanış": `Select` with values from `open + 1` to 29:
    - values < 24 are labelled "HH:00";
    - 24 is "00:00 (gece yarısı)";
    - 25…29 are "01:00 (ertesi gün)" … "05:00 (ertesi gün)".
- Footer: "Vazgeç", **"Kaydet"**.
- On save:
  - the dialog closes first;
  - then the action runs;
  - toast "Oda saatleri kaydedildi";
  - the server action calls `refresh()`.
- Error (from the server): "Kapanış açılıştan sonra olmalı".

### 4.9 History import (client button + server action)

- The button appears in the banner (§4.3) and in the data card (§4.10).
- Labels:
  - "Geçmişi siteden al" (never run);
  - "Devam et" (partial);
  - "Yeniden al" (complete; it re-reads, which picks up late refunds and cancellations).
- While running: disabled, label "Alınıyor…", with the help line "Site ay ay okunuyor; en çok bir dakika sürer."
- Toasts:
  - complete: `"Geçmiş alındı: 9 ay, 214 rezervasyon"`;
  - partial (deadline reached): `"4 / 10 ay alındı; kalanı için Devam et'e basın"`;
  - error: the `UserError` text (§5.4).
- KVKK line in the data card: "Geçmişten alınan rezervasyonlar ad ve not olmadan saklanır."
- If the link is not configured (`KARAOKE_SYNC_SECRET` empty): no button. Text: "laffogato.net bağlantısı kurulmadı;
  geçmiş alınamaz."

### 4.10 "Veri ve ayarlar" card (bottom)

`CardHeader`: icon `Settings2`, title "Veri ve ayarlar". It holds a `KeyValue` list:

| Label | Value |
|---|---|
| Oda saatleri | `"Her gün 10:00–22:00"` + `Badge gray "Varsayılan"` when never saved + Button (secondary, sm) "Değiştir" |
| Site rezervasyonları | `"Ocak 2026 ve sonrası · 22.10.2026 14:05'te alındı"` / `"21 Ekim 2026 ve sonrası"` + the §4.9 button; last error in `text-bad`: `"Son deneme: {error}"` |
| Rezervasyonsuz oturumlar | `"21 Ekim 2026 ve sonrası (bar ekranındaki hızlı sayaç)"`; no timer ever: `"Henüz yok (bar ekranındaki hızlı sayaçla sayılır)"` |
| Kasadaki karaoke | `"Satış raporu yüklenen ve sayaçla tamamen kapsanan aylarda saat başına gelire eklenir"` |
| Odadaki siparişler | `"Henüz bağlanamıyor"` + `InfoTip`: "Uygulama siparişleri bar ekranına “Masa” olarak gelir; odaya ait olduğu ayrılmıyor ve panel sipariş geçmişi tutmuyor. Site ya da ModPOS odayı ayıran bir kayıt verdiğinde buraya eklenecek." |
| Gelmeyenler | `"Personel “Erken bitir”e basarsa oda o andan boş sayılır; basılmazsa rezervasyonun süresi dolu sayılır."` |

### 4.11 Empty states

- **No session at all, link not configured:** `EmptyState`.
  - icon `MicVocal`, title "Henüz karaoke verisi yok";
  - description "laffogato.net bağlantısı kurulunca rezervasyonlar gelir; rezervasyonsuz gruplar bar ekranındaki
    hızlı sayaçla sayılır.";
  - action `ButtonLink` "Bar ekranı" → `/panel/karaoke`.
- **No session at all, link configured:** the same title. Description "Sitedeki geçmiş rezervasyonları alarak
  başlayın." The action is the §4.9 button.
- **Sessions exist but not in this period:** all sections render with zeros. The heatmap is all `%0` (light), and the
  insights line is "Bu dönemde oturum yok."

### 4.12 Karaoke page (`/panel/karaoke`) changes

- `PageHeader` moves inside `KaraokeContent`, after `requireUser()`, so that the admin gets
  `tabs={<SectionTabs section="karaoke" current="/panel/karaoke" />}`. The Suspense fallback keeps a tab-less header
  (the Analiz / Sayım pattern). Staff see exactly what they see today.
- "Bu ay" card: the "Doluluk haritası" button (§4.1).
- `monthStats` alignment:
  - "saat" uses the occupied interval (§3.1), so an early-ended session no longer counts its unused part. The card and
    the Doluluk page then agree;
  - "İptal" uses the same `isCancelledBooking`.
  - The shape of `MonthStats` and the UI texts are unchanged.

---

## 5. Data model and server logic

### 5.1 Schema (`src/server/db/schema.ts`; one drizzle-kit migration at merge time)

`npm run db:generate -- --name karaoke_doluluk` (R2; never hand-written, never hand-numbered).

```ts
// karaoke_sessions'a, extUpdatedAt'in altına
/** Sitede rezervasyonun yapıldığı an (sitenin createdAt'i); "kaç gün önceden" buradan. Rezervasyonsuz sayaçta boş */
bookedAt: timestamp("booked_at", { withTimezone: true }),
/** İptal anı: eşitleme iptale geçişte yazar (sitenin cancelledAt'i, yoksa updatedAt'i); yeniden açılınca boşalır */
cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
```

- Both columns are nullable with no default and no index (all queries filter on `starts_at`, which is indexed).
- They are additive, so Instant Rollback is safe: old code ignores them.
- Backups pick them up automatically (R6). `db:reset` does not touch `karaoke_sessions` (it is not in
  `SERIAL_TABLES`).

**`integration_state` keys (no migration):**

| Key | Value | Written by |
|---|---|---|
| `karaoke.hours` | `{ open: number, close: number, by: string, at: string }` | `saveKaraokeHours` |
| `karaoke_history` | `{ months: Record<"YYYY-MM", { count: number; at: string }>, lastRunAt: string \| null, lastError: string \| null }` | history import |

Both survive `db:reset` (only `parasut.%`, `payments.*` and `menu_sync` are deleted), and so does karaoke data.

### 5.2 Pure: `src/lib/karaoke/occupancy.ts` (new; no server imports; imports `./session` and `@/lib/reminders`)

```ts
export const KARAOKE_ROOMS = 1;            // Oda tek (docs/KARAOKE.md › Çakışma uyarısı)
export const LATE_CANCEL_HOURS = 24;
export const DAY_START_HOUR = 5;           // iş günü 05:00'te döner (kasa ile aynı)
export const INSIGHT_MIN_DAYS = 14;
export const INSIGHT_MIN_SESSIONS = 8;

/** İş günü ölçeğinde saat: 5 ≤ open < close ≤ 29 (25 = ertesi gün 01:00, 29 = 05:00) */
export interface RoomHours { open: number; close: number }
export const DEFAULT_ROOM_HOURS: RoomHours = { open: 10, close: 22 };
export function parseRoomHours(v: unknown): RoomHours | null;          // bozuk / sınır dışı → null

export interface OccSession {
  id: number;
  source: "site" | "panel";
  startsAt: number; endsAt: number;        // ms; endsAt uzatmasız
  extraMinutes: number;
  endedAt: number | null;
  guests: number | null;
  status: KaraokeStatus; paymentStatus: PaymentStatus;
  totalMinor: number | null;
  bookedAt: number | null;
  cancelledAt: number | null;              // rowToOcc: cancelled_at ?? (lastEvent = "cancelled" ? lastEventAt : null)
}
/** Veritabanı satırının hesaba giren kısmı (yükleyicinin select'i; Date alanlar) */
export interface OccRow {
  id: number; source: "site" | "panel"; startsAt: Date; endsAt: Date; extraMinutes: number; endedAt: Date | null;
  guests: number | null; status: string; paymentStatus: string; totalMinor: number | null;
  bookedAt: Date | null; cancelledAt: Date | null; lastEvent: string | null; lastEventAt: Date | null;
}
export function rowToOcc(r: OccRow): OccSession;                       // iptal anı yedeği burada (test edilir; yükleyici server-only)
export function occFromDTO(s: KaraokeSessionDTO): OccSession;           // Karaoke sayfasının "Bu ay" kartı için

export interface RoomOrder { at: number; amountMinor: number }          // seam (5.6)

export type PeriodKind = "4h" | "12h" | "ay";
export interface Period { kind: PeriodKind; month: string | null; from: string; to: string; days: number; partial: boolean }
export function resolvePeriod(kind: string | undefined, month: string | undefined, now: Date): Period;
export function monthPeriod(month: string, today: string): Period;
export function previousPeriod(p: Period): Period;
export function periodBounds(p: Period): { start: number; end: number };   // [from 05:00, to 05:00) TR

export function businessDay(ms: number): string;      // "YYYY-MM-DD", 05:00 kuralı, sabit +3
export function clockHour(ms: number): number;        // 0–23 TR
export function businessHour(clock: number): number;  // 0–4 → 24–28
export function weekdayIndex(date: string): number;   // Pzt 0 … Paz 6

export function occupiedInterval(s: OccSession): { start: number; end: number } | null;   // 3.1
export function isCancelledBooking(s: Pick<OccSession, "status" | "paymentStatus">): boolean;  // 3.4 (session.ts'e konur, aşağıya bakın)

export interface GridCell {
  weekday: number; hour: number;          // hour iş günü ölçeğinde 5–28
  open: boolean; days: number;
  capacityMin: number; occupiedMin: number; outsideMin: number;
  busyDays: number; site: number; panel: number; guestsAvg: number | null;
  ratio: number | null;                   // capacity 0 → null
}
export interface OccupancyGrid { hours: number[]; rows: GridCell[][] }   // rows[weekday][i], hours iş günü sırasıyla

export interface OccupancySummary {
  days: number;
  capacityMin: number; occupiedMin: number; outsideMin: number; overlapMin: number;
  outsideHours: number[];                 // dışarıda dolu kalan saatler (dipnot için)
  ratio: number | null;
  sessions: { site: number; panel: number };
  extension: { total: number; extended: number; rate: number | null; avgMinutes: number | null };
  cancellations: { bookings: number; cancelled: number; late: number; unknownTime: number; lateRate: number | null };
  lead: { n: number; missing: number; avgDays: number | null; medianDays: number | null; sameDayShare: number | null };
  guests: { n: number; avg: number | null };
  revenue: { basis: "site" | "site+kasa"; minor: number; ordersMinor: number | null; hours: number;
             perHour: number | null; perOpenHour: number | null };   // TL değil kuruş; ekranda ÷100
}
export interface OccupancyOptions {
  hours: RoomHours;
  rooms?: number;                         // varsayılan KARAOKE_ROOMS
  cashierMinor?: number | null;           // yalnız 3.5 (a)+(b) tutunca verilir; çağıran cashierAllowed ile karar verir
  roomOrders?: RoomOrder[] | null;
}
export function computeOccupancy(sessions: OccSession[], period: Period, opts: OccupancyOptions): { grid: OccupancyGrid; summary: OccupancySummary };

/** 3.5 (b): dönemin ilk günü ilk sayaç gününden önce değil */
export function cashierAllowed(period: Period, firstTimerDay: string | null): boolean;

/** Ay ay kartı: en yeni ay başta, en çok `max` ay, ilk veri ayından eskiye gitmez */
export function recentMonths(today: string, firstMonth: string | null, max?: number): string[];
export interface MonthRow { month: string; period: Period; summary: OccupancySummary; beforeTimers: boolean }
export function monthRows(
  sessions: OccSession[], months: string[], today: string,
  opts: OccupancyOptions & { cashierByMonth: Record<string, number>; firstTimerDay: string | null },
): MonthRow[];

export interface Block { d0: number; d1: number; h0: number; h1: number; ratio: number }   // gün dahil, saat h1 hariç
export function emptiestBlock(grid: OccupancyGrid): Block | null;
export function busiestBlock(grid: OccupancyGrid): Block | null;        // ratio < 0,5 → null

/** Geçmiş içe aktarma pencereleri: en yeni ay başta; son pencere bugün − 2'de biter (düzenli eşitleme dünden başlar) */
export function historyWindows(startMonth: string, today: string): { month: string; from: string; to: string }[];
export function historyProgress(done: Record<string, unknown>, windows: { month: string }[]): { done: number; total: number; complete: boolean; first: string | null; last: string | null };
```

**Implementation notes** (all in this file):

- **Sweep.**
  - Collect the occupied intervals clipped to `periodBounds`.
  - Build `(t, +1/-1)` events and sort them (−1 before +1 at the same t: end-to-end sessions do not overlap).
  - For each segment of constant `c > 0`, split it at hour boundaries
    (`Math.floor(t / 3_600_000 + 1) * 3_600_000`).
  - Each piece adds `min(c, rooms) × min` to the slot `(businessDay(t), businessHour(clockHour(t)))`, and
    `max(0, c − rooms) × min` to `overlapMin`.
- **Per-slot session counts.** A second pass over sessions adds `id` to a `Set` per `(weekday, hour)`, split by
  source, plus guests for the average.
- **`busyDays`.** Distinct dates with any occupied minute in that `(weekday, hour)`.
- **`days` per weekday.** Iterate `from … to` with `addDays` and count by `weekdayIndex`.
- **Columns** (`hours`): `open … close − 1`, plus every business hour with `outsideMin > 0`, in business order.
- **Revenue pro rata.** `fee × clippedOccupiedMin / fullOccupiedMin`. `ordersMinor`: Σ orders whose `at` lies in any
  occupied (clipped) interval; null when `roomOrders` is null.
- **Rounding.** Keep raw numbers. The UI rounds (`pct(x, 0)`, `num(h, 1)`, `tl(minor / 100)`).

`src/lib/karaoke/session.ts` gets one shared predicate, so the sync, the page and `monthStats` agree:

```ts
/** İptal edilmiş gerçek rezervasyon: iptal (süresi dolan ödeme tutması değil) ya da iade */
export const isCancelledBooking = (r: { status: KaraokeStatus; paymentStatus: PaymentStatus }) =>
  (r.status === "cancelled" && r.paymentStatus !== "expired") || r.paymentStatus === "refunded" || r.paymentStatus === "refunding";
```

### 5.3 Pure: `src/lib/karaoke/occupancy-text.ts` (new) and additions to `src/lib/karaoke/site.ts`

**`occupancy-text.ts`** holds the Turkish strings, so the math file stays language-free:

```ts
export const WEEKDAY_NAMES = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
export const WEEKDAY_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
export function hourLabel(h: number): string;                 // 10 → "10:00", 25 → "01:00", 24 → "00:00"
export function hourRangeLabel(h0: number, h1: number): string;   // (14,17) "14–17", (23,25) "23–01", (21,24) "21–24"
export function hoursText(h: RoomHours): string;              // "10:00–22:00", "12:00–02:00"
export function closeOptionLabel(h: number): string;          // 24 "00:00 (gece yarısı)", 26 "02:00 (ertesi gün)"
export function weekdayRange(d0: number, d1: number): string; // "Salı", "Salı–Perşembe"
export function periodLine(p: Period, hours: RoomHours): string;   // 4.2'deki satır
export function insightLines(grid: OccupancyGrid, s: OccupancySummary, p: Period): { lines: string[]; reason: string | null };  // 3.6, 4.5
export function cellLabel(c: GridCell): string;               // aria-label (4.6)
export function cellDetail(c: GridCell): string;              // ayrıntı satırı (4.6)
export function bucket(ratio: number | null): 0 | 1 | 2 | 3 | 4 | null;   // 0 | <0,25 | <0,5 | <0,75 | ≥0,75
export function pointsText(delta: number): string;            // "+6 puan", "−4 puan", "aynı" (|Δ| < 0,5 puan)
export function kpiTexts(s: OccupancySummary): Record<"occupancy" | "revenue" | "extension" | "cancel" | "lead", { value: string; sub: string }>;  // 4.4
export function minutesText(min: number): string;            // "2 sa 10 dk", "35 dk" (session.ts durationLabel'ı kullanır)
```

**`site.ts` additions** (used by both the sync and the history import):

```ts
// reservationSchema'ya isteğe bağlı alan (site eklerse kullanılır; şimdi göndermiyor):
cancelledAt: z.string().max(40).optional().catch(undefined),

/** Sitenin zaman metni → Date; boş ya da bozuksa null */
export function siteTime(v: string | null | undefined): Date | null;

/** Satırın rezervasyon sütunları (sync.ts'teki `values` buraya taşınır; sayaç alanları yok) */
export function reservationValues(r: SiteReservation): {
  externalId: string; source: "site"; date: string; startsAt: Date; endsAt: Date; guests: number | null;
  customerName: string | null; note: string | null; status: KaraokeStatus; paymentStatus: PaymentStatus;
  totalMinor: number; channel: string | null; extUpdatedAt: string | null; bookedAt: Date | null;
};

/**
 * İptal anı. Satır iptal edilmiş rezervasyon değilse null (yeniden açılan iptal de boşalır). Önceki satırda zaten
 * varsa o korunur. Yeni iptalde: sitenin cancelledAt'i; yoksa önceki satır canlıysa (iptale geçişi biz gördük)
 * sitenin updatedAt'i, o da yoksa `now`; ilk kez iptal hâlinde görülüyorsa (ilk eşitleme, geçmiş) yalnız ödeme
 * akışı yoksa (paymentStatus none/pending) updatedAt, iade adımları updatedAt'i sonradan oynattığı için
 * refunded/refunding'de null (zamanı bilinmiyor). Gelecekteki an `now`'a kırpılır.
 */
export function cancelledAtFor(
  prev: { cancelledAt: Date | null; status: KaraokeStatus; paymentStatus: PaymentStatus } | null,
  r: Pick<SiteReservation, "status" | "paymentStatus" | "updatedAt" | "cancelledAt">,
  now: Date,
): Date | null;
```

`SiteReservation` (in `session.ts`) gets `cancelledAt?: string`.

### 5.4 Sync and history (server)

**`src/server/karaoke/sync.ts`** (edited; small):

- `values` = `reservationValues(r)` plus `cancelledAt: cancelledAtFor(prev ?? null, r, now)`. The mapping moves to
  `site.ts` byte-for-byte, plus `bookedAt`.
- The `same` comparison adds `sameTime(prev.bookedAt, values.bookedAt)` and
  `sameTime(prev.cancelledAt, values.cancelledAt)`, where `sameTime` = both null, or equal `getTime()`.
  - The first sync after deploy therefore updates every row in the window once, filling `bookedAt`. That bumps the
    karaoke version once; open tabs refetch once.
- Nothing else changes: events, notifications, deletion of gone rows, `lastSiteNow` ordering, timer fields.

**`src/server/karaoke/history.ts`** (new, `import "server-only"`):

```ts
export const HISTORY_START = "2026-01";          // sitenin online satış kartıyla aynı başlangıç (docs/SITE-SATIS.md)
export interface HistoryState { months: Record<string, { count: number; at: string }>; lastRunAt: string | null; lastError: string | null }
export async function readHistoryState(): Promise<HistoryState>;
export type HistoryResult =
  | { status: "off" }
  | { status: "ok" | "partial"; read: string[]; remaining: string[]; reservations: number; created: number; updated: number }
  | { status: "error"; error: string; read: string[] };
export async function importKaraokeHistory(opts: { deadline: number }): Promise<HistoryResult>;
```

**Steps of the import:**

1. `karaokeSecret()`; if it is absent, return `off`.
2. `windows = historyWindows(HISTORY_START, todayTR())`, newest first. Each window is one calendar month
   (`from = YYYY-MM-01`, `to = min(last day, today − 2)`), so it is at most 31 days.
3. For each window, while `Date.now() < deadline − 9_000` (the 8 s site timeout plus a margin):
   - `GET /api/panel/karaoke?from&to` signed with `signedSiteFetch`, then `parseSiteResponse`.
   - `!res.ok` → error text:
     - 400 / 422: "Site geçmiş tarihleri vermiyor (laffogato.net'in panel ucu güncellenmeli)";
     - 401 / 503 / 404: the texts of `explain()` in `sync.ts`, exported for reuse;
     - timeout: "Site 8 saniyede yanıt vermedi".
   - `complete === false` → error "Site {Eylül 2026} için eksik yanıt verdi".
   - Write in one transaction with `pg_advisory_xact_lock(hashtext('karaoke-sync'))` (the same lock as the sync, so
     the two never interleave). Read the existing rows with `inArray(externalId, ids)`. For each reservation:
     - **New row:** insert `reservationValues(r)` with `customerName: null, note: null` (KVKK: past rows are kept
       only for statistics), plus `cancelledAt: cancelledAtFor(null, r, now)`. No `lastEvent`. Timer fields keep
       their defaults.
     - **Existing row:** update the reservation columns **except** `customerName` and `note` (a name stays as it was
       synced), plus `bookedAt` and `cancelledAt: cancelledAtFor(prev, r, now)`. Skip when nothing differs.
       `extraMinutes`, `endedAt`, `endedBy`, `createdBy`, `lastEvent` and `lastEventAt` are never touched.
     - **Rows are never deleted** (the regular sync owns deletion inside its own window).
   - Patch the state with `months[YYYY-MM] = { count, at }`.
4. After the loop:
   - `lastRunAt = now`, `lastError = error | null`;
   - `bumpKaraokeVersion()` if anything was created or updated;
   - return `partial` if any window remains.
5. No event, no push, and `karaoke_sync` (`lastSiteNow`, `count`) is not touched. `notify` is never computed here.

**Site assumption (verify before coding).** The site's `GET /api/panel/karaoke` returns bookings for any `from` / `to`
up to about 3 months long. The panel asks for 91 days today. The question is whether it accepts **past** dates.

- Read laffogato `src/app/api/panel/karaoke/route.ts` (or its `docs/PANEL-KARAOKE.md`) for the accepted window. This
  session could not open that repo.
- If past dates are refused, the button shows the 400 text above, and a one-line site change is needed: allow
  `from ≥ 2026-01-01` with a window ≤ 62 days. Ship the panel side anyway; it degrades to "Son deneme: …".

### 5.5 Loader and actions

**`src/server/karaoke/occupancy.ts`** (new, `import "server-only"`):

```ts
/** Yalnız hesap için gereken sütunlar (ad ve not okunmaz) */
export async function loadOccupancySessions(from: Date, to: Date): Promise<OccSession[]>;
export async function readKaraokeHours(): Promise<{ hours: RoomHours; saved: boolean }>;   // parseRoomHours ?? DEFAULT
export async function writeKaraokeHours(h: RoomHours, by: string): Promise<void>;
/** İlk site ve ilk sayaç günü (iş günü), ilk veri ayı */
export async function karaokeCoverage(): Promise<{ firstSiteDay: string | null; firstTimerDay: string | null; firstMonth: string | null }>;
/** Satışlar'daki HİZMET satırlarının aylık toplamı (KDV dahil, kuruş): yalnız istenen aylar */
export async function cashierKaraokeByMonth(months: string[]): Promise<Record<string, number>>;
/** Seam (5.6): bugün null */
export async function loadRoomOrders(from: Date, to: Date): Promise<RoomOrder[] | null>;
export async function loadCashierKaraokeDays(from: string, to: string): Promise<{ date: string; minor: number }[] | null>;
```

**Queries:**

- **Sessions.** `select id, source, starts_at, ends_at, extra_minutes, ended_at, guests, status, payment_status,
  total_minor, booked_at, cancelled_at, last_event, last_event_at from karaoke_sessions where starts_at < $end and
  ends_at + make_interval(mins => extra_minutes) > $start order by starts_at limit 20000`. Use the expression form
  from `board.ts` (ISO text on the left side).
  - `$start` = the earliest of the period start, the previous period start and the oldest month row (6 months).
  - About 10 sessions a day × 200 days ≈ 2 000 rows.
- **Coverage.** One aggregate:
  `select min(starts_at) filter (where source='site'), min(starts_at) filter (where source='panel') from
  karaoke_sessions`, then mapped with `businessDay`.
- **Counter karaoke.** `select month, sum(revenue) from sales_lines where is_service and month = any($1) group by
  month`, then ×100 rounded.

**`src/server/actions/karaoke-doluluk.ts`** (new, `"use server"`):

```ts
const hoursSchema = z.object({ open: z.number().int().min(5).max(23), close: z.number().int().min(6).max(29) })
  .refine((v) => v.close > v.open, "Kapanış açılıştan sonra olmalı");

export async function saveKaraokeHours(input: z.input<typeof hoursSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = hoursSchema.parse(input);
    const before = await readKaraokeHours();
    if (before.saved && before.hours.open === data.open && before.hours.close === data.close) return null;
    await writeKaraokeHours(data, me.name);
    await logActivity(me, "Karaoke oda saatleri", `${hoursText(before.hours)} → ${hoursText(data)}`);
    refresh();
    return null;
  });
}

export async function importKaraokeHistoryNow() {
  return attempt(async () => {
    const me = await requireAdmin();
    const r = await importKaraokeHistory({ deadline: Date.now() + 45_000 });
    if (r.status === "off") throw new UserError("laffogato.net bağlantısı kurulmamış (KARAOKE_SYNC_SECRET)");
    if (r.status === "error" && !r.read.length) throw new UserError(r.error);
    await logActivity(me, "Karaoke geçmişi siteden alındı", `${monthsRange(r.read)} · ${r.reservations} rezervasyon (${r.created} yeni, ${r.updated} güncellenen)`);
    refresh();
    return r;   // istemci 4.9'daki bildirimi buradan yazar; error + read>0 → kısmi bildirim + hata satırı
  });
}
```

- No password step-up. These actions do not affect admins or users, so the adminstepup rules do not apply.
- `monthsRange(["2026-09", …, "2026-01"])` → "Ocak–Eylül 2026". It is a small pure helper in `occupancy-text.ts`.

### 5.6 Seams (degrade gracefully today)

| Seam | Today | When it arrives |
|---|---|---|
| ModPOS daily product export (owner decision: coming, format unknown) | `loadCashierKaraokeDays` returns `null` | The import plan fills it with per-business-day karaoke totals (HİZMET lines). The page sums the period's days and passes `cashierMinor` **only** if every day of the period has data and `cashierAllowed(period, firstTimerDay)`. 4h / 12h periods then get the "site+kasa" basis too. No pure-code change |
| In-room orders | `loadRoomOrders` returns `null`; data card "Henüz bağlanamıyor" | Needs a source with time + amount + "room" marker (a site order label such as "Karaoke odası" kept as daily totals, or ModPOS tickets with a table). Return `RoomOrder[]`; `computeOccupancy` already attributes by time containment and adds "+ odadaki siparişler" to the revenue sub (`kpiTexts` checks `ordersMinor !== null`) |
| Site `cancelledAt` | Optional field in `reservationSchema`, absent today | Preferred automatically by `cancelledAtFor` |
| No-show | — | Follow-up "Gelmedi" (§11) |

### 5.7 Roles carve-out (`src/lib/roles.ts`, shared with today; additive)

```ts
/** Personel yolunun altında yalnız yöneticinin ekranı (tutar gösterir): proxy personeli buraya sokmaz */
export const ADMIN_ONLY_PATHS = ["/panel/karaoke/doluluk"] as const;

export function canOpen(role: Role, pathname: string): boolean {
  if (role === "admin" || !under(pathname, "/panel")) return true;
  if (ADMIN_ONLY_PATHS.some((p) => under(pathname, p))) return false;
  return STAFF_PATHS.some((p) => under(pathname, p));
}
```

The existing test "menüdeki her öğenin rolü erişim kuralıyla aynı" then passes for the new admin-only ⌘K item.

### 5.8 Page assembly (`src/app/panel/karaoke/doluluk/page.tsx`)

- The page component is synchronous: `PageHeader` fallback + `<Suspense>` + `async DolulukContent({ searchParams })`
  (TASARIM §7).
- `export const maxDuration = 60` (the history action runs on this page; precedent: `panel/parasut/page.tsx`).
- In `DolulukContent`:
  - `await requireAdmin()` comes **before** `new Date()` (request-time; the cacheComponents rule on synchronous IO);
  - then `await searchParams`;
  - then `Promise.all([readKaraokeHours(), karaokeCoverage(), readHistoryState()])`;
  - then `resolvePeriod`, `previousPeriod`, `recentMonths`;
  - then `Promise.all([loadOccupancySessions(min start, period end), cashierKaraokeByMonth(months),
    loadCashierKaraokeDays(…), loadRoomOrders(…)])`;
  - then the pure calls: `computeOccupancy` (period and previous period), `monthRows`, `insightLines`, `kpiTexts`.
- Client props are small:
  - the grid: ≤ 7 × 24 cells with numbers and precomputed strings (`label`, `detail`, `bucket`);
  - the history state;
  - the hours.

  Amounts reach only this admin page.
- `MonthPicker` months = `recentMonths(today, firstMonth, 24)` reversed (oldest → newest), as the component expects
  sorted months.

---

## 6. Files

### Add

| File | Content |
|---|---|
| `src/lib/karaoke/occupancy.ts` | §5.2 (pure) |
| `src/lib/karaoke/occupancy-text.ts` | §5.3 (pure, Turkish strings) |
| `src/server/karaoke/occupancy.ts` | §5.5 loader (server-only) |
| `src/server/karaoke/history.ts` | §5.4 import (server-only) |
| `src/server/actions/karaoke-doluluk.ts` | §5.5 actions |
| `src/app/panel/karaoke/doluluk/page.tsx` | §5.8; `metadata = { title: "Karaoke doluluğu" }` |
| `src/app/panel/karaoke/doluluk/heatmap.tsx` | `"use client"`: two layouts (§4.6), selected cell state, legend, footnote buttons that open the hours dialog |
| `src/app/panel/karaoke/doluluk/month-compare.tsx` | Server component: table (lg+) and `<details>` list (§4.7) |
| `src/app/panel/karaoke/doluluk/hours-dialog.tsx` | `"use client"`: `HoursButton` (any label / variant) + `Dialog` (§4.8) |
| `src/app/panel/karaoke/doluluk/history-button.tsx` | `"use client"`: `useTransition`, `importKaraokeHistoryNow`, toasts (§4.9) |
| `tests/karaoke-doluluk.test.ts` | §8 |

### Change

| File | Change |
|---|---|
| `src/server/db/schema.ts` *(shared)* | 2 columns (§5.1) |
| `drizzle/*` | Generated at merge time (R2) |
| `src/lib/karaoke/session.ts` | `isCancelledBooking`; `SiteReservation.cancelledAt?` |
| `src/lib/karaoke/site.ts` | `cancelledAt` optional in the schema; `siteTime`, `reservationValues`, `cancelledAtFor` |
| `src/server/karaoke/sync.ts` | `values` from `reservationValues` + `cancelledAt`; `same` + 2 comparisons; export `explain` |
| `src/app/panel/karaoke/page.tsx` | `PageHeader` inside content with admin tabs (§4.12); `monthStats` uses `occupiedInterval(occFromDTO(r))` and `isCancelledBooking` |
| `src/app/panel/karaoke/karaoke-admin.tsx` | "Bu ay" card `actions`: `ButtonLink` "Doluluk haritası" |
| `src/components/panel/nav.ts` *(shared)* | `NAV_GROUPS` "Günlük" item; `SECTION_TABS.karaoke`; `SHORT_TITLES` entry; import `Grid3x3`. Additive to today's / insight's / menu's edits |
| `src/lib/roles.ts` *(shared with today)* | `ADMIN_ONLY_PATHS` + `canOpen` line (§5.7) |
| `tests/roller.test.ts`, `tests/mobile-nav.test.ts`, `tests/yardim.test.ts`, `tests/karaoke.test.ts` | §8 |
| `docs/KARAOKE.md`, `README.md`, `docs/TASARIM.md`, `src/app/panel/yardim/page.tsx` | §9 |

Not touched: the bell (`notifications.ts`), the dashboard, the digest, the crons, `/api/canli`, `toSessionDTO`, the
staff UI of the bar screen, and `settings` / Ayarlar.

---

## 7. Edge cases and interactions

- **Session across midnight** (Fri 23:00 – Sat 01:30): Friday row, columns 23, 00 (as 24) and 01 (as 25).
  - Needs a closing hour after midnight to be inside the hours. Otherwise it is outside-hours minutes plus a footnote.
- **Session across 05:00** (04:00 – 06:00): Friday row column 04 (28), then Saturday row column 05.
- **A session crossing the period edge:** minutes are clipped; the counts use the start; the fee is pro rata.
- **Overlap with one room:** counted once, and reported as `overlapMin`. The most common cause is a walk-in timer
  started with "Yine de başlat" for the booked group.
- **Overtime and "Haber verdim":** not counted beyond the booked end + extensions.
- **Reopened session** (`reopenKaraokeSession`): `endedAt` becomes null, so it is occupied to the end again.
- **Site time change** (`changed` event): the sync resets the timer fields as today; `startsAt` / `endsAt` move.
  `cancelledAt` stays null.
- **Cancelled, then re-opened on the site:** `cancelledAtFor` returns null; the booking is live again.
- **Holds** (`requested + pending`) **and `expired`:** never bookings, never occupied, never cancellations.
- **`requested + none` in the past:** occupied (owner question 4).
- **Refunded without the `cancelled` status:** a cancelled booking (`isCancelledBooking`), not occupied. Its time is
  unknown unless the site sends `cancelledAt` or we saw the transition.
- **Imported history:** no names or notes; occupancy, fees, lead time and cancellations are all available. Walk-ins
  before 21 Oct 2026 do not exist; months before the first timer carry `¹` and never use the counter money.
- **Opening hours wrong:** the outside-hours footnote names the hours and offers "Saatleri değiştir". A change applies
  to all periods. Activity-logged.
- **Thin data** (first weeks): KPIs show; insights wait (§3.6); the month table shows what exists.
- **Time zone:** fixed +3 everywhere (`session.ts` `TR_OFFSET_MS`). Tests use one July and one December date to pin
  "no DST".
- **Staff:** the proxy refuses the URL (`ADMIN_ONLY_PATHS`), `requireAdmin` redirects, and staff do not see the
  Karaoke page tabs. Nothing new is added to `toSessionDTO` or `/api/canli`.
- **Performance:** about 6 small queries in parallel, plus 2 pure passes over ≤ 2 000 rows. No `loadModel()`.
- **Today plan:** its `karaokeToday` uses `KaraokeSessionDTO` (unchanged). `roles.ts` and `nav.ts` edits are additive;
  rebase carefully (today changes `STAFF_PATHS` / `STAFF_HOME` / `BOTTOM_NAV` / `NAV_TREE`, this plan adds
  `ADMIN_ONLY_PATHS` / `NAV_GROUPS` item / `SECTION_TABS` / `SHORT_TITLES`).
- **Ops plan:** the backup covers the new columns and keys automatically (R6). `job_runs` is not used (no cron step).
- **Instant Rollback:** safe (two nullable columns, no semantics changed for old code).

---

## 8. Tests (`npx tsx --test tests/karaoke-doluluk.test.ts` unless noted)

Fixtures use fixed instants. `T(date, "HH:MM")` = TR time → ms (`Date.parse(\`${date}T${hm}:00+03:00\`)`).
Weekdays: 2026-10-22 is a Thursday, 2026-10-23 a Friday, 2026-10-24 a Saturday.

1. **Hour splitting.** Fri 20:30–22:15 → cells Friday 20 = 30, 21 = 60, 22 = 15 (hours 10–24 open).
2. **Across midnight.** Fri 23:00 – Sat 01:30 with hours 10–26 → Friday row 23 = 60, 24 = 60, 25 = 30; Saturday row
   empty. With hours 10–22 → `outsideMin` 150, `outsideHours` [23, 24, 25], `ratio` excludes them.
3. **Across 05:00.** 2026-10-24 (Saturday calendar day) 04:00–06:00 with hours 5–29 → Friday row 28 = 60,
   Saturday row 5 = 60.
4. **Overlap, one room.** 20:00–22:00 and 21:00–23:00 same day → occupied 180, `overlapMin` 60. **Two rooms** → 240
   room-minutes, capacity doubled, ratio = 240 ÷ (2 × capacity).
5. **End rules.**
   - `endedAt` 21:00 on 20:00–22:00 → 60 min.
   - `endedAt` 22:20 ("Haber verdim") → 120 min.
   - `extraMinutes` 30 → 150 min.
   - Reopened (`endedAt` null) → full.
6. **Exclusions.**
   - Not occupied: cancelled; hold (requested + pending); expired; refunded; refunding.
   - Occupied: requested + none; panel timer.
7. **Business-day periods.**
   - now = 2026-10-22 14:00 → `4h` = [2026-09-24, 2026-10-22), 28 days, 4 per weekday.
   - now = 2026-10-22 03:00 → `to` = 2026-10-21.
   - `ay` 2026-10 at 22 Oct 10:00 → [10-01, 10-22), partial.
   - `ay` 2026-09 → 30 days.
   - 1 Nov 2026 04:00 → `ay` 2026-11 has 0 days and 2026-10 is whole.
   - An invalid `donem` → `4h`; a future `ay` → the current month.
   - `previousPeriod` for all three.
8. **Capacity.** Hours 10–22, `4h` → each open cell `days` 4, capacity 240, total 20 160 min; closed cells `ratio`
   null.
9. **Europe/Istanbul.** A session at 2026-12-18 20:00 TR and one at 2026-07-17 20:00 TR both land in Friday column
   20 (`clockHour` fixed +3, no DST).
10. **Late cancellations.**
    - `cancelledAt` = start − 20 h → late; − 30 h → not late; after start → late; null → `unknownTime`.
    - Expired holds are outside the population.
    - The fallback from `lastEvent = "cancelled"` / `lastEventAt` is applied by the pure `rowToOcc` (the loader only
      selects and calls it).
11. **Lead time.**
    - Leads 0, 2 and 10 days → avg 4, median 2, sameDay ⅓.
    - Sat 00:30 booked Fri 20:00 → 0.
    - `bookedAt` after start → 0.
    - `bookedAt` null → `missing` 1, excluded.
12. **Extension.** 4 occupied sessions, one +30 → rate 0,25, avg 30. Panel timers included.
13. **Revenue.**
    - Basis site: paid 2 000 ₺ / 2 h + none 1 000 ₺ / 1 h + a walk-in of 2 h → `perHour` = 300 000 kuruş ÷ 3 h.
    - Basis site+kasa with `cashierMinor` 205 000 → (200 000 + 205 000) ÷ 5 h; the `none` fee is not added.
    - `perOpenHour` = money ÷ capacity hours.
    - A clipped session's fee is pro rata.
    - `cashierAllowed` is false when `firstTimerDay` > `period.from`, and false for null.
14. **Room orders seam.** An order at 21:10 inside a session adds its amount; one at 23:30 (room empty) does not;
    `ordersMinor` null when the input is null.
15. **Insights.**
    - Grid with Tue–Thu 14–17 zero and the rest 50 % → `"En boş saatler: Salı–Perşembe 14–17 · %0 dolu"`.
    - Fri–Sat 20–23 at 82 % → `"En dolu saatler: Cuma–Cumartesi 20–23 · %82 dolu"`.
    - Late rate 18 % with 3 late → the second line is `"Son 24 saatte iptal: 3 rezervasyon (%18)"`.
    - 10 days or 5 sessions → `lines` empty and the reason text from §4.5.
    - Tie-break: larger area wins.
    - `hourRangeLabel(23, 25)` is `"23–01"` and `(21, 24)` is `"21–24"`.
16. **Text helpers.** `hoursText({open: 12, close: 26})` is `"12:00–02:00"`; `closeOptionLabel(24)`;
    `pointsText(0.06)` → `"+6 puan"`; `bucket` boundaries (0, 0.249, 0.25, 0.5, 0.75, 1); `cellDetail` strings of
    §4.6; `kpiTexts` slash forms of §4.4. No `₺` appears in any text when the summary has no fee-bearing sessions
    (value `–`).
17. **`recentMonths` / `monthRows`.**
    - From 2026-10-22 with `firstMonth` 2026-01 → 6 months newest first.
    - With `firstMonth` 2026-09 → 2 months.
    - `beforeTimers` is true for Sept when `firstTimerDay` = 2026-10-21.
    - The counter money is used only for months whose `cashierAllowed` holds.
18. **History windows.**
    - `historyWindows("2026-01", "2026-10-22")` → 10 windows, first `{month: "2026-10", from: "2026-10-01",
      to: "2026-10-20"}`, last 2026-01.
    - On 2026-11-01 the October window ends 10-31, and November is skipped (from > to).
    - `historyProgress` gives 4 / 10 and `complete` false.
19. **Site helpers** (in `tests/karaoke.test.ts`, extending the existing fixture `site()`).
    - `reservationValues` maps `createdAt` → `bookedAt`, an invalid `createdAt` → null, `guests` 0 → null.
    - `cancelledAtFor`:
      - live → cancelled with `updatedAt` → that time;
      - an `updatedAt` in the future → `now`;
      - already set → kept;
      - re-opened → null;
      - first seen cancelled with `paymentStatus` none → `updatedAt`, with refunded → null;
      - the site's `cancelledAt` is preferred when present.
    - `parseSiteResponse` accepts and ignores a missing `cancelledAt`.
20. **`parseRoomHours`.** Valid; `close ≤ open` → null; 30 → null; a string → null.
21. **Source checks** (`readFileSync`, the repo pattern).
    - `doluluk/page.tsx` uses `requireAdmin` and `maxDuration = 60`.
    - `src/server/karaoke/occupancy.ts` starts with `import "server-only"` and its session select does not mention
      `customerName` or `note`.
    - `history.ts` inserts `customerName: null, note: null` and never calls `.delete(`.
    - `karaoke-doluluk.ts` actions call `requireAdmin`.

**Existing tests updated:**

- `tests/roller.test.ts`:
  - `canOpen("staff", "/panel/karaoke/doluluk") === false`;
  - `canOpen("staff", "/panel/karaoke/doluluk/x") === false`;
  - `canOpen("staff", "/panel/karaoke") === true`;
  - `canOpen("admin", "/panel/karaoke/doluluk") === true`.
  - The menu-role test covers the new ⌘K item automatically.
- `tests/mobile-nav.test.ts`: `mobileTitleFor("/panel/karaoke/doluluk") === "Doluluk"`; `mobileTitleFor("/panel/karaoke")`
  stays `"Karaoke"`.
- `tests/yardim.test.ts`: `pathOf("/panel/karaoke/doluluk")` deep-equals `["Karaoke", "Doluluk"]` (via
  `SECTION_TABS`). The `<Path>` rule covers the new FAQ link.
- `tests/karaoke.test.ts`: existing sync / event tests must pass unchanged (the `values` mapping moved, not changed).

**Manual checks (worktree DB per R3):**

1. Seed about 40 sessions with a small script into `laffogato_doluluk`. Include site and panel rows, a cross-midnight
   one, an early end, a cancellation and an extension.
2. Check the page at 390 px and at 1280 px, as admin. As staff, the URL redirects and no tabs appear on Karaoke.
3. Change the hours and check the footnote.
4. Run the history import against a local fake (`LAFFOGATO_URL` pointing to a tiny local handler that returns the
   §5.4 shape), or against production in a preview *only after R1*.

Before merge: `npm run lint`, `npx tsc --noEmit`, `npm test`.

---

## 9. Docs and Yardım

- **`docs/KARAOKE.md`.**
  - New section **"Doluluk haritası (yönetici)"**:
    - what each KPI means (the §3.4 / §3.5 table in short);
    - the grid rules (05:00 business day, hours, one room, overlaps);
    - Oda saatleri;
    - the history import (what is fetched, no names or notes, re-run picks up late refunds);
    - what is not possible yet (no-shows, in-room orders, walk-in money before the ModPOS daily export);
    - files.
  - "Nasıl çalışır": one line, "eşitleme rezervasyonun yapıldığı ve iptal edildiği anı da yazar (`booked_at`,
    `cancelled_at`)".
  - "Güvenlik": "Siteden … tutar, kanal ve rezervasyonun yapıldığı an gelir; geçmişten alınanlar ad ve not olmadan
    saklanır."
  - "Dosyalar" table: the new files.
- **`README.md`.** Screens table, new row:
  "Karaoke doluluğu (yönetici): gün × saat ısı haritası, doluluk %, saat başına gelir, uzatma oranı, son dakika iptal,
  kaç gün önceden; son 4 / 12 hafta ya da ay; ay ay karşılaştırma ([docs/KARAOKE.md](docs/KARAOKE.md))" |
  `/panel/karaoke/doluluk` | — (yeni).
  - In the Karaoke row: "yöneticiye ay özeti, doluluk haritası ve bağlantı durumu".
  - Roles paragraph unchanged ("karaoke tutarları personele gösterilmez" still true).
- **`docs/TASARIM.md` §3.** Section tabs: "Karaoke → Bar ekranı, Doluluk (yalnız yönetici)". §4 gets one line: the
  heatmap scale (ink 5 steps, hatched closed hours, numbers in cells; colour never alone).
- **Yardım (`src/app/panel/yardim/page.tsx`).** Under "Bilinmesi gerekenler", new FAQ
  `q: "Karaoke odası ne zaman boş?"`:

  "<Path href="/panel/karaoke/doluluk" /> ekranı odanın hangi gün ve saatte dolu olduğunu gösterir (son 4 hafta, son
  12 hafta ya da bir ay). Hücreye dokununca o saatin ayrıntısı çıkar; üstte doluluk, saat başına gelir, uzatma, son
  dakika iptal ve rezervasyonların kaç gün önceden yapıldığı, altta ay ay karşılaştırma var. Doluluk oda saatlerine
  göre hesaplanır (ekranın altındaki Oda saatleri). İlk kullanımda Geçmişi siteden al ile laffogato.net'teki eski
  rezervasyonları alın; rezervasyonsuz gruplar yalnız bar ekranındaki hızlı sayaçla sayılır."

  The `<Path>` rule needs a line break handled (`{" "}`) if the line starts with `<Path`.

---

## 10. Owner decisions (defaults implemented; nothing blocks)

1. **Oda saatleri:** every day 10:00–22:00 (typical AVM hours; MaviBahçe AVM is the separate karaoke-box business, not
   this room). Does the kiosk room close later on weekends? *Default: one range for every day, editable on the page.*
2. **Son dakika:** within 24 hours of the start. *Default 24 h.*
3. **Geçmiş:** import site bookings since January 2026, without names and notes. *Default: yes, one button.*
4. **"Onay bekliyor / kasada ödenecek" bookings that passed** count as occupied (the site normally confirms or
   cancels). *Default: yes.*
5. **Saat başına gelir:** booking fees by default; counter (ModPOS) karaoke added only for whole months with uploaded
   sales that the timers fully cover. *Default as described.*
6. **"Gelmedi" button on the bar screen** (one tap, counted separately, room freed)? *Default: not in this round.*

---

## 11. Risks, merge order, follow-ups

**Risks:**

- **Site refuses past windows.** The history import errors with a clear text; the page still works from 21 Oct on.
  - *Mitigation:* verify the site route first (§5.4). If needed, a one-line site change.
- **Cancellation time for imported history** is a best guess (`updatedAt`). Refund steps move it, so those are
  "zamanı bilinmiyor" (§5.3). Late-cancel rates for old months are lower bounds.
  - *Mitigation:* ask the site to add `cancelledAt` (the panel already accepts it).
- **Walk-ins missing before 21 Oct 2026.** History months understate occupancy. Marked `¹`, and the counter money is
  kept out.
- **Opening hours** are a single assumed range. Mitigated by the outside-hours footnote and the editable setting.
- **Single-room assumption** is built into the site contract (no room field). `rooms` is a parameter if a second room
  ever exists, but the site would then have to send the room.
- **Merge interplay.** `nav.ts` / `roles.ts` are shared with today, insight and menu (additive). `sync.ts` is touched
  only by this plan in this round (pricing and 5 edit the Paraşüt `sync.ts`, a different file).

**Merge order (R2: migration branches are serialised).** This branch carries `karaoke_doluluk`. Merge it in any slot
after ops-policy and ops-jobs. Recommended: **after menu (#8)**, so the five planned migrations keep their order; or as
#10 after today. Steps: rebase → restore the journal → regenerate → `tests/migrations.test.ts`. It is not pushed
before R1.

**Follow-ups (separate tasks, not this plan):**

- **"Gelmedi" (no-show).** Bar screen button on a running site booking within 30 min of the start. New column
  `no_show_at` (+ `no_show_by`). Occupancy is ended at the tap; a KPI "Gelmeyen" is added; the site `changed` event
  resets it with the other timer fields.
- **Site:** `cancelledAt` in `GET /api/panel/karaoke`; past windows; and, for in-room orders, a "Karaoke odası"
  destination with daily totals.
- **ModPOS daily export import** fills `loadCashierKaraokeDays` (§5.6).
- **Per-weekday hours / closed days** (from days without a kasa report).

---

## 12. Next.js docs relied on (`node_modules/next/dist/docs/`)

- `01-app/03-api-reference/03-file-conventions/page.md`: `searchParams` is a Promise and a request-time API; read it
  inside the Suspense'd content.
- `01-app/02-guides/migrating-to-cache-components.md`: `new Date()` during prerender fails the build; call it after a
  request API (`requireAdmin` reads cookies) inside `<Suspense>`.
- `01-app/03-api-reference/04-functions/refresh.md`: `refresh()` only inside Server Actions (both new actions).
- `01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`: a page-level `maxDuration`
  sets the timeout of the Server Actions used on that page (history import, 45 s deadline under 60 s).
