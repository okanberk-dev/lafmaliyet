# Plan: Kasa raporundan ay bilgisi (6) + kasa bütünlüğü (10)

Group: suggestions **6** (fill month info from the daily Z / cash reports) and **10** (cash-drawer integrity).
Base: `main` = `claude/oneriler` @ 981692e. Next.js 16 (cacheComponents), Drizzle, Turkish UI.

---

## 1. Goal

The owner should no longer type the month's open days, POS revenue (ciro), discounts, comps (ödenmez / ikram) or card share
by hand when staff already enter a Z / cash report every night. These five month values are **derived live** from the
`cash_reports` rows. A value the owner has typed **always wins** and is never overwritten. The owner can see where each
number comes from and can switch a field back to "Kasadan" with one tap. Nothing is copied into `months`, so a later
report or a correction changes the derived number automatically. For the drawer, every report shows three checks:
whether the opening amount matches the previous report's carry-over, every change made after submission (with who,
when and what), and who counted the drawer. Suspicious cases (opening ≠ carry-over, a cash count changed on the next
day) are highlighted on the Kasa page and in the e-mail / WhatsApp text, and they ring the admin bell.

---

## 2. Key decisions (made here, so the implementer does not re-decide)

### 2.1 What can be derived from the cash reports

| Month field (`months`) | Derived from `cash_reports` of that month (date = business day `YYYY-MM-DD`) | Applies when |
|---|---|---|
| `openDays` | count of reports with `zTotal > 0` | month has ≥1 report **and** the reports cover the whole month from day 1 (see `partialFrom`) |
| `posRevenue` (KDV dahil, after discounts, without comps) | Σ `zTotal` (Z "Toplam satış" = Σ payment types = money taken, already net of discounts, comps excluded; same meaning as Patron › Ciro) | same as above |
| `discounts` | Σ `discounts` (a **new optional** Z field "İndirim") over the days where it was entered | same, and ≥1 day has `discounts` entered |
| `offRevenue` | Σ `offRevenue` (already on the report: "Ödenmez / ikram") over the days where it was entered | same, and ≥1 day has it entered |
| `cardShare` (**new month column**) | (Σ `card` + Σ `mealCard`) ÷ Σ `zTotal` (same definition as the Ayarlar hint "Kredi kartı + yemek kartı ÷ ciro"; ModPOS "Online" (Yemeksepeti…) and "Diğer" carry no bank POS commission) | month has reports with Σ zTotal > 0 (a ratio is valid even for a partial month) |

`partialFrom`: if the **first cash report ever** falls inside this month and after day 1 (the feature started
mid-month, e.g. October 2026), the *sums* (open days, ciro, discounts, comps) are **not applied** because they would
silently cover only part of the month. Only `cardShare` is applied. The UI says so.

Not derived (out of scope): POS sales lines (product list, `sales_lines`) — the Z report has no per-product data.

### 2.2 How typed and derived values coexist (the rule)

Per field: **typed (non-null in `months`) → typed; else derived (if it applies) → "Kasadan"; else today's default**
(`openDays`/`posRevenue`/`cardShare` = null, `discounts`/`offRevenue` = 0, card share falls back to Ayarlar `kartOrani`).

- Nothing is ever written to `months` from the cash reports. Derived values are computed when the model loads, so
  they follow every new report, edit or delete.
- "Back to kasa" = store `null` for that field (same idea as Gelir-gider's "boşaltınca hesaplanana döner").
- To tell "not typed" from "typed 0", `months.discounts` and `months.off_revenue` become **nullable** (no default).
  Existing rows keep their values (the 0s of July–October 2026 stay as typed 0). New rows created by `ensureMonth`,
  `setMonthField`, `setMonthNote` and the stock screen get `null` = follow kasa.
- Existing data: July–October 2026 have typed open days and ciro, so nothing changes for them. October 2026 in
  production started its reports mid-month (`partialFrom`), so only its card share becomes derived (see Risks).

### 2.3 Where the merge happens

In the **server loader** (`loadDataset`): the raw `months` rows and a light read of all `cash_reports` are merged by a
pure function. `ds.months` then holds the *effective* `Month` values. Every consumer (engine P&L, dashboard forecast,
zayi page, analysis, Excel export, Ayarlar impact preview, `closedDataMonths`) works unchanged. Each `Month` also
carries `sources` (manual / kasa / none per field) and `kasa` (the derived values and coverage), so the screens can show
the source and the typed value (`manualOf(info, field)`). A month that has cash reports but no `months` row appears as a
synthesised `Month`, so it shows up in month pickers and in Gelir-gider.

### 2.4 Drawer integrity checks (computed when read, never stored)

- **Opening ≠ carry-over:** for a report, `prev` = the last report before its date (`previousCarryOver`, already
  used to pre-fill the form). If |opening − prev.carryOver| ≥ 1 ₺ (`CASH_TOLERANCE`), it is a mismatch. Because this is
  computed when read, it also catches the reverse case: an earlier day edited after the next day already used its
  carry-over.
- **Changes after submit:** a new table `cash_report_revisions` keeps a snapshot of each version that a resubmit
  replaced. The changes are worked out by comparing consecutive versions. A **late edit** is a revision whose submit
  moment, converted to a business day, is after the report date (i.e. after 05:00 of the next day) **and** that
  changed a cash-relevant field (opening, cash sales, cash out, counted, handed over).
- **Who counted:** new `cash_reports.counted_by` (user FK) + `counted_by_name` (name snapshot). The form has a select
  that defaults to the submitter. Old reports have null, so the submitter is shown.

---

## 3. User-facing behaviour (Turkish texts)

### 3.1 Kasa raporu form (staff and admin, `/panel/kasa`, phone first)

**Z raporu card** – new optional field after "Ödenmez / ikram":
- `İndirim` – hint `Z raporundaki indirim toplamı (isteğe bağlı)`; empty = not entered (null), not 0.

**Kasa (nakit) card**
- `Açılış (dünden devir)`: when there is a previous report and the value equals its carry-over, the hint stays as today:
  `Önceki rapordan (21 Ekim Salı): 1.200 ₺`. If the gap is more than one day, append ` · arada rapor girilmemiş 1 gün var`.
- When the typed opening differs from that carry-over by ≥1 ₺, a warn box appears under the field (`rounded-xl bg-warn-soft text-warn text-[13px]`):
  `Önceki raporun devri 1.200 ₺ (21 Ekim); yazdığınız 120 ₺ az. Kasaya para kondu ya da alındıysa nedenini nota yazın.`
  ("fazla" if higher) + small secondary button `Devri yaz` (sets the field to the carry amount).
- New select `Kasayı sayan` (`Select`, full width on phone, one column on `sm:`), options = active users by name,
  default = current user (or the report's `countedBy` when editing; an inactive saved counter is shown as
  `Ayşe (pasif)`). Hint: `Çekmeceyi kim saydı? Siz değilseniz seçin.`

**Sonuç card**
- If the opening does not match: an extra line under "Ertesi güne devir": `Açılış devirden 120 ₺ az` (warn).
- Not field: when the opening does not match and the note is empty, the label is warn-coloured (existing pattern) and
  the hint is `Açılış devirle tutmuyor: nedenini yazın (zorunlu)`.
- Submit with a mismatch and an empty note → client toast error
  `Açılış önceki günün devrinden farklı: nedenini nota yazın`, focus the note. The server enforces the same rule
  (§5.4). The rule applies only when the report is new or its opening changed, so an unrelated edit of an old
  report is not blocked.

**Saved report view (read mode in `CashForm`)**
- CardHeader description: `Sayan Ayşe · gönderen Mehmet · 23:10 · 2. sürüm`. When the same person counted and
  submitted: `Ayşe · 23:10 · güncellendi`. Old rows without `countedBy`: as today.
- `CashBreakdown`:
  - "Açılış (devir)" line gets sub `Önceki rapor (21 Ekim) devri 1.200 ₺ · 120 ₺ az` and the warn tone when it does not match.
  - "Ertesi güne devir" line gets sub `22 Ekim açılışı 1.080 ₺ · 120 ₺ farklı` (warn) when the next report exists and does not match.
  - New "İndirim" line in the Z section when `discounts > 0`.
- New section `Değişiklikler` (component `CashRevisions`, shown only if revisions exist), newest first:
  - each item: `22 Ekim 10:05 · Mehmet` + badge `Ertesi gün` (amber) when late; lines like
    `Sayılan nakit: 2.880 ₺ → 2.980 ₺`, `Açılış: 1.080 ₺ → 1.200 ₺`, `Not değişti`, `Sayan: Ayşe → Mehmet`;
  - last line: `İlk gönderim: 21 Ekim 23:10 · Ayşe`.
- The `Düzenle` button for **staff** is hidden when a later day's report exists (§5.4). A one-line note is shown instead:
  `Ertesi günün raporu girildi; düzeltme için yöneticiye yazın.`

### 3.2 Admin "Günden güne" (`CashHistory`)

- Row sub line: `Sayan Ayşe · gönderen Mehmet` (or just the name), `· 2 kez düzeltildi` instead of `· güncellendi`.
- New badges (amber, before the diff badge): `Açılış ≠ devir` and `Ertesi gün düzeltildi`.
- The "Rapor girilen gün" stat gets a sub line when there is something to flag:
  `2 gün açılış ≠ devir · 1 sonradan düzeltme` (tone warn).
- Detail dialog: `CashBreakdown` with the carry and next-day lines, plus `CashRevisions`; the WhatsApp link text
  includes the same warnings (§3.5).

### 3.3 Admin Kasa page: new card "Ay bilgisine gider" (right column, under "Bugün", above "Rapor alıcıları")

Shown when the selected month has reports. `CardHeader` icon `CalendarDays`, title `Ay bilgisine gider`, description
`Kasım 2026 · Satışlar ve Gelir-gider bunları kullanır`. Rows (label left, value right, status sub):

| Label | Value | Sub |
|---|---|---|
| Açık gün | `18 gün` | `kullanılıyor` (good) / `elle girilen geçerli: 20 gün` (mute) / `ay ortasında başladı, kullanılmıyor` |
| POS ciro (Z toplamı) | `245.300 ₺` | same |
| İndirim | `3.200 ₺` | `12 / 18 günde girildi` + status |
| Ödenmez / ikram | `4.100 ₺` | `15 / 18 günde girildi` + status |
| Kartlı satış oranı | `%83,2` | status; when not applied: `Ayarlar: %85,6` |

Footer notes:
- Missing days (warn): `3 gün rapor yok: 5, 12, 20 Kasım. O günler açıksanız ciro ve açık gün eksik kalır.` (list at
  most 5 dates, then `ve 2 gün daha`).
- `partialFrom` (info): `Kasa raporları 20 Ekim'de başladı; bu ayın ciro, açık gün, indirim ve ödenmezi elle girilir. Kartlı oran kasadan.`
- `ButtonLink` secondary `Ay bilgilerini aç` → `/panel/satislar?ay=YYYY-MM#m-days`.

### 3.4 Satışlar › "{Ay} bilgileri" (`MonthInfoForm`)

- Card description: `Patron > Raporlar > Ciro ekranından ya da kasa raporlarından. Gelir-gider tablosu bu ciroyu kullanır.`
- Status strip at the top of the card content (only if the month has reports; `role="status"`, `rounded-2xl px-3 py-2.5 text-xs`):
  - complete: info tone `Kasa raporları: 18 gün raporlu (son: 21 Kasım). Boş bıraktığınız alanlar her raporla kendiliğinden dolar.`
  - missing days: warn tone, the same missing-days sentence as §3.3, + link `Kasa raporuna git` → `/panel/kasa?ay=YYYY-MM`.
  - partialFrom: warn tone, the partialFrom sentence of §3.3.
- Each of the five fields gets a **mode** when kasa applies to it (`kasaValues[field] !== null`):
  - A small chip right of the label: `Kasadan` (info) or `Elle` (gray).
  - **Kasadan mode:** the input shows the derived value, is `readOnly` and has the info background. Tapping or focusing
    it switches to Elle mode with the value filled in and selected, so typing replaces it. Hint:
    `Kasa raporlarından (18 gün). Değiştirmek için dokunun.` For discounts and comps: `… (12 / 18 günde girildi)`.
  - **Elle mode:** a normal input. Hint `Elle girildi · kasada 245.300 ₺` + text button `Kasadakini kullan` (back to Kasadan mode).
  - If kasa does not apply, there is no chip and the field behaves as today. Empty = not typed.
- New 5th field `Kartlı satış oranı (%)` (id `m-card`), percent input (`83,2`). Validation 0–100.
  Tip: `Kredi kartı + yemek kartı ÷ Z toplamı. POS komisyonu = ciro × komisyon × bu oran.`
  Placeholder when nothing applies: `Ayarlar: 85,6`.
- Save: Kasadan-mode fields and empty Elle-mode fields send `null`. The dirty snapshot includes the modes.
- The existing "Tutarlı / Kontrol edin" check (sales list − discounts vs POS) uses the **effective** POS and discounts.
- The existing "Panelde kayıtlı ikram … Bunu yaz" hint stays; "Bunu yaz" switches comps to Elle with that value.
- Phone (390px): single column, 48px fields as today; chips stay on the label line (`flex justify-between`).

### 3.5 Gelir-gider (grid and phone month view)

- "AYLIK CİRO (KDV dahil – POS)" and "Açık gün sayısı" behave like auto cells when kasa applies:
  - following kasa → normal style;
  - typed over kasa → blue "overridden" style and dot (existing);
  - tooltip `Elle girildi. Kasa raporlarından: 245.300,00`.
  - Clearing the cell (empty + Enter) returns it to kasa. Toast: `Aylık ciro kasa raporlarına döndü` /
    `Açık gün kasa raporlarına döndü`.
- Without kasa: unchanged.
- Row hint additions:
  - revenue: `… Boşsa kasa raporlarının Z toplamı kullanılır.`
  - open days InfoTip: `Kasa raporu girilen aylarda boşsa rapor girilen (satış olan) gün sayılır.`

### 3.6 Genel bakış (dashboard)

- Task "Açık gün ve POS cirosu" (`dashboard-tasks.tsx`):
  - source kasa, closed month, no gaps: `Kasa raporlarından: 30 / 30 gün açık · POS 512.400 ₺.`
  - running month: `Kasa raporlarından: bugüne kadar 18 gün · POS 245.300 ₺. Her akşamki raporla güncellenir.`
  - closed month, source kasa, missing days → status `warn`:
    `3 günün kasa raporu yok (5, 12, 20 Kasım); açık gün ve ciro eksik olabilir.`, action `Kasaya bak`,
    href `/panel/kasa?ay=YYYY-MM`.
  - The other branches are unchanged.
- POS ciro stat sub: `18 günde · kasa raporlarından` when the source is kasa (one-line change in `page.tsx`).
- Commission sub texts ("Ciro × %2,5 × kartlı oran %85,6") use the **month's** rate.

### 3.7 Bell (admin, group "kasa")

- `kasa-acilis-{date}-r{rev}` (warning): title `Kasa açılışı devirle tutmuyor`, body
  `22 Ekim Çarşamba · açılış 1.080 ₺, önceki devir 1.200 ₺ (120 ₺ az) · {note}`. Only for reports of today and
  yesterday (business days).
- `kasa-duzeltme-{date}-r{rev}` (warning): title `Kasa raporu ertesi gün değişti`, body
  `21 Ekim Salı · Mehmet · Sayılan nakit 2.880 ₺ → 2.980 ₺`. For late revisions with cash-field changes in the last 7 days.
- Staff bell unchanged.

### 3.8 E-mail and WhatsApp text

- Head line: `{date} · {by}`, plus ` · sayan {counter}` when the counter is a different person.
- If revision > 1 and there are changes: `*Değişen:* Sayılan nakit 2.880 ₺ → 2.980 ₺; Not değişti` (e-mail: an orange warning box above the sections).
- Z: `• İndirim: 3.200 ₺` when > 0.
- Kasa: after the opening line, `⚠️ Önceki devir 1.200 ₺ (21 Ekim): açılış 120 ₺ az`. When a correction leaves the
  next day's opening not matching: `⚠️ 22 Ekim açılışı (1.200 ₺) bu devirle tutmuyor`. In the e-mail both go in the
  Kasa section's warning box.
- The subject is unchanged.

### 3.9 Ayarlar and Yardım

- `ayarlar/fields.ts` kartOrani hint:
  `Kredi kartı + yemek kartı ÷ ciro. Kasa raporu olan aylarda o ayın gerçek oranı kullanılır; bu değer ürün fiyat hesabında ve raporu olmayan aylarda geçer.`
- `yardim/page.tsx` line ~94:
  `… yazın. Kasa raporu girilen aylarda boş bıraktığınız alanlar kasa raporlarından kendiliğinden dolar; elle yazdığınız her zaman geçerlidir.`

---

## 4. Data model changes (`src/server/db/schema.ts`, one drizzle-kit migration)

Run `npm run db:generate -- --name kasa_ay_bilgisi_butunluk`. Never hand-write the migration.

1. `months`
   - `discounts`: `doublePrecision("discounts")` (drop `.notNull().default(0)`). Null = not typed (follow kasa).
   - `offRevenue`: `doublePrecision("off_revenue")` (same).
   - **new** `cardShare: doublePrecision("card_share")` nullable, 0–1. Typed card share for the month.
   - Turkish comment: why nullable ("boş = kasa raporlarından; 0 elle yazılmış sıfırdır").
2. `cash_reports`
   - **new** `discounts: doublePrecision("discounts")` nullable. Z discount total (not entered = null).
   - **new** `countedBy: integer("counted_by").references(() => users.id, { onDelete: "set null" })`.
   - **new** `countedByName: text("counted_by_name")` (name snapshot, like `submittedByName`).
3. **new table** `cash_report_revisions`. It holds superseded versions of a report, one row per resubmit:
   ```ts
   export const cashReportRevisions = pgTable("cash_report_revisions", {
     id: serial("id").primaryKey(),
     reportId: integer("report_id").notNull().references(() => cashReports.id, { onDelete: "cascade" }),
     date: text("date").notNull(),            // raporun iş günü (okuma kolaylığı)
     revision: integer("revision").notNull(), // değiştirilen sürümün numarası
     data: jsonb("data").$type<CashRevisionData>().notNull(), // o sürümün alanları + cashDiff + countedByName
     submittedBy: integer("submitted_by").references(() => users.id, { onDelete: "set null" }),
     submittedByName: text("submitted_by_name").notNull(),
     submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(), // o sürümün gönderildiği an (eski updatedAt)
     createdAt: createdAt(),                  // yerine yenisinin geldiği an
   }, (t) => [index("cash_report_revisions_report_idx").on(t.reportId)]);
   ```
   Why jsonb: it is an archive of a whole form; it is not queried by field; it stays valid when fields are added.
   Deleting a report deletes its history (cascade); the delete itself goes to `activity_log` with the values (§5.4).

Volumes: about one report per day, so the full `cash_reports` scan in the loader is cheap.

---

## 5. Server logic

### 5.1 Pure: `src/lib/cash-month.ts` (new; no server imports)

Types (put the shared types in `src/lib/calc/types.ts` to avoid a cycle; `cash-month.ts` imports them):

```ts
// types.ts
export type MonthField = "openDays" | "posRevenue" | "discounts" | "offRevenue" | "cardShare";
export type FieldSource = "manual" | "kasa" | "none";
export interface TillMonth {
  month: string;            // YYYY-MM
  from: string; to: string; // kapsanan aralık: max(ay başı, ilk rapor), min(ay sonu, through)
  reported: number;         // rapor girilen gün
  openDays: number;         // zTotal > 0 olan gün
  posRevenue: number;       // Σ zTotal (2 ondalık)
  discounts: number | null; discountDays: number;
  offRevenue: number | null; offDays: number;
  cardShare: number | null; // (Σkart + Σyemek kartı) ÷ Σ zTotal (4 ondalık), Σ zTotal = 0 → null
  missing: string[];        // [from, to] içinde raporu olmayan günler
  partialFrom: string | null; // ilk rapor ayın 1'inden sonraysa o gün (toplamlar uygulanmaz)
  lastDate: string;
}
export interface Month {
  ...existing,            // discounts: number; offRevenue: number stay non-null (effective)
  cardShare?: number | null;                        // effective (optional so fixtures need no change)
  sources?: Record<MonthField, FieldSource>;        // only the server loader fills it
  kasa?: { values: Record<MonthField, number | null>; till: TillMonth } | null;
}
```

Functions:
- `tillMonths(rows: TillRow[], through: string): TillMonth[]`. `TillRow = { date; zTotal; card; mealCard; discounts; offRevenue }`.
  Groups rows by `date.slice(0,7)`. `firstEver` = min date over all rows. Rounds with `r2`.
- `kasaValues(t: TillMonth): Record<MonthField, number | null>`. Applies the §2.1 table: sums are null when
  `partialFrom` is set or `openDays === 0`; `discounts` / `offRevenue` are null when no day entered them;
  `cardShare` is not null whenever the ratio exists.
- `resolveMonth(month: string, entry: MonthEntry | undefined, till: TillMonth | undefined): Month`. Implements the
  §2.2 rule and returns `sources` and `kasa`. `MonthEntry` = raw DB row shape (nullable discounts / offRevenue / cardShare).
- `resolveMonths(entries: MonthEntry[], tills: TillMonth[]): Month[]`. Union of months, sorted.
- `manualOf(info: Month | undefined, f: MonthField): number | null`. The typed value: `sources[f] === "manual"`
  gives the value; with no `sources` (tests and seed), non-null `openDays` / `posRevenue` / `cardShare` and non-zero
  `discounts` / `offRevenue`.
- `missingText(days: string[], max = 5): string`. Returns `5, 12, 20 Kasım` / `… ve 2 gün daha` (uses `longDateTR` pieces).

### 5.2 Pure additions: `src/lib/cash-report.ts`

- `CashReportFields` gains `discounts: number | null`.
- `paymentLines` is unchanged. Add `• İndirim` to `whatsappText` (and to the e-mail) when > 0.
- `export interface CarryCheck { prevDate: string; carry: number; opening: number; diff: number; gapDays: number }`.
  `diff = opening − carry`; `gapDays` = days strictly between `prevDate` and `date`.
- `carryCheck(date, openingCash, prev: { date; amount } | null): CarryCheck | null`. Null when there is no previous
  report or |diff| < `CASH_TOLERANCE`.
- `carryChecks(reportsAsc, before): Map<string, CarryCheck>`. Chains `carryOver` of each report to the next one, for
  the history list.
- `openingNeedsNote({ check, openingCash, prevOpening, note }): boolean`. True when `check` is set, the note is empty
  and (`prevOpening === null` or the opening changed by ≥ 0,005).
- `type CashRevisionData = CashReportFields & { cashDiff: number; countedByName: string | null }`.
- `FIELD_LABELS` (Turkish): zTotal "Toplam satış", cash "Nakit satış", card "Kart", mealCard "Yemek kartı",
  online "Online", other "Diğer", discounts "İndirim", offRevenue "Ödenmez / ikram", openingCash "Açılış",
  cashOut "Gün içinde çıkan", countedCash "Sayılan nakit", handedOver "Teslim edilen", bankPos "Banka POS",
  zNo "Z no", receipts "Fiş sayısı", cashOutNote "Neye çıktı", note "Not", countedByName "Sayan".
- `SENSITIVE: (keyof CashReportFields)[] = ["openingCash","cash","cashOut","countedCash","handedOver"]`.
- `revisionChanges(before: CashRevisionData, after: CashRevisionData): FieldChange[]`, where
  `FieldChange = { key; label; from: string; to: string; sensitive: boolean }`. Money is formatted with `money()`,
  null as `—`. A text field change is shown as `Not değişti`, with no content.
- `changesText(changes): string`. Gives `Sayılan nakit 2.880 ₺ → 2.980 ₺; Not değişti`.
- `isLateEdit(date: string, submittedAt: Date): boolean`. True when `businessDate(submittedAt) > date`.
- `whatsappText(f, meta)` meta gains `countedBy?: string | null; carry?: CarryCheck | null; next?: CarryCheck | null; changes?: FieldChange[] | null`.
  `next` is the check of the next report's opening against this report's carry.

### 5.3 Data layer

`src/server/data/cash-reports.ts`
- `CashReportDTO` / `toCashDTO`: add `discounts`, `countedBy`, `countedByName`.
- `tillRows(): Promise<TillRow[]>`. Selects only the 6 columns from all of `cash_reports`.
- `cashRevisionsFor(ids: number[]): Promise<CashRevisionDTO[]>`. Ordered by `reportId`, `revision`.
  `CashRevisionDTO = { reportId; revision; data; submittedByName; submittedAt: string; createdAt: string }`.
- `nextReportAfter(date): Promise<{ date: string; openingCash: number } | null>`.
- `cashCounters(): Promise<{ id: number; name: string }[]>`. Active users, ordered by name.
- `historyOf(report: CashReportDTO, revisions: CashRevisionDTO[])`. Pure helper (or in lib), builds
  `{ at, by, late, changes }[]` by diffing snapshot[i] → snapshot[i+1] → current.

`src/server/data/dataset.ts` (**shared**)
- Add `tillRows()` to the `Promise.all`.
- After the reads (same place as `currentMonthTR()`, because of cacheComponents: read the time only after the
  dynamic reads): `const through = addDays(businessDate(), -1)`.
- `months: resolveMonths(monthsRaw.map(toEntry), tillMonths(tillRows, through))`.

### 5.4 Actions

`src/server/actions/cash-report.ts`
- `reportSchema`: `discounts: zAmount.nullable()`, `countedBy: z.number().int().positive()`.
- In the transaction (`for("update")` on the day's row as today):
  1. **Staff lock:** if `me.role !== "admin"` and `prev` exists and a report with `date > data.date` exists →
     `UserError("Ertesi günün raporu girildi; bu raporu artık yalnız yönetici düzeltebilir")`.
  2. Counter: must be an active user, or equal to `prev.countedBy` (keeps an inactive one). Otherwise
     `UserError("Sayan kişi bulunamadı; listeden seçin")`. Store `countedByName` from the users row.
  3. Carry: read the previous report (date < data.date, desc, limit 1) with `tx`, then
     `check = carryCheck(...)`. If `openingNeedsNote({ check, openingCash, prevOpening: prev?.openingCash ?? null, note })` →
     `UserError("Açılış önceki günün devrinden farklı (… ₺ …): nedenini nota yazın")`.
  4. If `prev`: insert a `cash_report_revisions` snapshot of `prev` (fields + cashDiff + countedByName,
     `submittedAt = prev.updatedAt`), then update as today.
- After the save:
  - `logActivity` detail: `21 Ekim Salı: 120 ₺ eksik · Sayılan nakit 2.880 ₺ → 2.980 ₺` (changes only on revisions).
  - Return `{ …, next: CarryCheck | null }`. When a correction breaks the next day's chain, the client toast adds
    `22 Ekim açılışı bu devirle artık tutmuyor`.
- `emailReport(reportId, site)`: also loads the last snapshot (for the changes), `previousCarryOver(date)`,
  `nextReportAfter(date)` and passes `countedBy`, `carry`, `next` and `changes` to `renderCashReport`. Keep the
  idempotency key `cash-{date}-r{rev}`.
- `deleteCashReport`: the log detail includes the deleted values:
  `21 Ekim Salı · Z 12.450 ₺ · sayılan 3.430 ₺ · 120 ₺ eksik · Ayşe`.
- `sendCashTestEmail` sample: `discounts: null`.

`src/server/actions/sales.ts` (**shared with satislar**)
- `monthInfoSchema`: `discounts` / `offRevenue` become `.nullable()`; `cardShare: z.number().finite().min(0).max(1, "Oran en fazla %100").nullable()`.
- The upsert sets `cardShare`.
- Log: `Kasım 2026: ciro kasadan, açık gün kasadan` / the current text for typed values.
- `dropEmptyMonth`: add `row.cardShare === null`. Keep `!row.discounts && !row.offRevenue` (0 or null = empty) so
  that old 0-only trial rows are still removed.
- `clearMonthSales(withInfo)`: set `discounts: null, offRevenue: null, cardShare: null` (instead of 0).

`src/server/actions/pnl.ts` `setMonthField`: no logic change (null = back to kasa). The log text for null becomes
`boş (kasa raporu varsa oradan)`.

`src/server/actions/stock.ts` `dropEmptyStockMonth`: add `row.cardShare !== null` to the "not empty" check.

`src/server/actions/costs.ts` `dataMonths` (**important, avoids a regression**): a month whose open days come from
kasa is a data month (salary and fixed-cost versions must not rewrite it retroactively). Replace the
`gt(s.months.openDays, 0)` query with: read `months` rows (month, openDays, …) and `tillRows()` inside `tx`, run
`resolveMonths(…)`, filter `openDays > 0` (and `< before` when given). Union with the `pnl_entries` months as today.
`giderler/history-text.ts` `closedDataMonths` already uses `ds.months` (effective), so it stays consistent with no change.

`src/server/actions/notifications.ts` (**shared**) `cashNotifications` admin branch: after `reports` (the last 7
days, already loaded):
- `previousCarryOver(oldest.date)` + `carryChecks` → the opening-mismatch item for the reports of today and yesterday;
- `cashRevisionsFor(ids)` → the late-revision item (§3.7) for each report whose latest revision is late and has a
  sensitive change.

### 5.5 Engine (`src/lib/calc/engine.ts`, **shared**)

- `const rateOf = (month: string) => monthInfo.get(month)?.cardShare ?? st.kartOrani;`
  - `monthSales`: `commission = line.revenue * st.komisyon * rateOf(month)`.
  - `pnlMonth`: `auto("commission:pos", (revenue ?? 0) * st.komisyon * rateOf(month))`.
  - The product-level commission (line ~152, pricing) **stays** on `st.kartOrani`.
- Expose `cardShareOf(month): { rate: number; source: "manual" | "kasa" | "ayar" }` on the model.
- `pnlValue(pm, "revenue")`: `{ value: pm.revenue, computed: pm.info?.kasa?.values.posRevenue ?? null, overridden: pm.info?.sources ? pm.info.sources.posRevenue === "manual" : pm.revenue !== null }`.
- Revenue row hint text (line ~1437): append `Boşsa kasa raporlarının Z toplamı kullanılır.`

---

## 6. Files to add or change

### Add
- `src/lib/cash-month.ts`: the pure kasa → month resolution (§5.1).
- `src/app/panel/kasa/cash-month-card.tsx`: the "Ay bilgisine gider" card (server component or a plain component
  taking `info: Month`).
- `src/app/panel/kasa/cash-revisions.tsx`: `CashRevisions` list (client-safe, pure props).
- `tests/kasa-ay-bilgisi.test.ts`.
- `drizzle/00NN_kasa_ay_bilgisi_butunluk.sql` + `drizzle/meta/*` (generated).

### Change
- `src/server/db/schema.ts` (**shared**): §4.
- `src/lib/calc/types.ts` (**shared**): `Month` additions, `MonthField`, `FieldSource`, `TillMonth`.
- `src/lib/calc/engine.ts` (**shared**): §5.5.
- `src/lib/cash-report.ts`: §5.2.
- `src/server/data/cash-reports.ts`, `src/server/data/dataset.ts` (**shared**): §5.3.
- `src/server/actions/cash-report.ts`, `sales.ts`, `pnl.ts`, `stock.ts`, `costs.ts`, `notifications.ts` (**shared**): §5.4.
- `src/server/notify/cash-report-template.ts`: meta `countedBy`, `carry`, `next`, `changes`; discount row; warnings.
- `src/app/panel/kasa/page.tsx`:
  - load `cashCounters()`;
  - for the form: `previousCarryOver` (already loaded), `nextReportAfter(date)`, `cashRevisionsFor([report.id])`,
    and `laterExists` (from `nextReportAfter`) → `canEdit = admin || (staffCanReport(date) && !(report && laterExists))`;
  - for the admin month: `previousCarryOver(monthStart)`, `carryChecks`, `cashRevisionsFor(monthIds)`, the raw
    `months` row of the month + `firstCashReportDate()` → `resolveMonth` (pure) → `CashMonthCard`.
- `src/app/panel/kasa/cash-form.tsx`: discounts field, opening warning + `Devri yaz`, `Kasayı sayan` select, note
  rule, saved-view lines, `CashRevisions`.
- `src/app/panel/kasa/cash-summary.tsx`: `CashBreakdown` props `carry?`, `next?`; discount line.
- `src/app/panel/kasa/cash-history.tsx`: badges, sub line, stat sub, dialog revisions; props
  `carry: Record<string, CarryCheck>`, `revisions: Record<number, CashRevisionDTO[]>`.
- `src/app/panel/satislar/page.tsx`: `infoValues` = manual values via `manualOf`, plus `kasa` and `sources` props.
  `hasInfo` = any manual value (clear-with-info only clears typed values). Commission text with the month rate.
- `src/app/panel/satislar/sales-client.tsx` (`MonthInfoForm`): §3.4.
- `src/app/panel/satislar/sales-logic.ts`: pure helpers `cardShareProblem(text)`, `kasaHint(field, kasa)`, `initialModes(sources, kasa)`.
- `src/app/panel/satislar/breakdowns.ts`: commission sub uses the rate passed in (`salesBreakdowns(sales, settings, month, rate)`).
- `src/app/panel/gelir-gider/page.tsx`: `openDaysAuto[]`, `openDaysManual[]` arrays to the grid and the month view.
- `src/app/panel/gelir-gider/pnl-grid.tsx`:
  - `EditableCell` gets an optional `computedLabel` prop ("Kasa raporlarından");
  - revenue row: `kind={def.key === "revenue" && c.computed !== null ? "auto" : def.kind}`;
  - open-days row: `computed` / `overridden` / `kind` from the new arrays;
  - InfoTip text.
- `src/app/panel/gelir-gider/month-view.tsx`: the same for the phone open-days and revenue targets.
- `src/app/panel/gelir-gider/cell-rules.ts`: `planCellEdit` for `revenue` / `openDays`:
  - empty → `none` when `!overridden`;
  - else `clear` with message `… kasa raporlarına döndü` when `computed !== null`, otherwise `… boşaltıldı`;
  - `planCellRestore` returns null when `!overridden` (never freeze a kasa value).
- `src/app/panel/dashboard-tasks.tsx` (**shared**): `MonthTaskFacts.info` gets
  `source: { openDays: FieldSource; posRevenue: FieldSource }` and
  `till: { missing: string[]; partialFrom: string | null } | null`; §3.6 texts.
- `src/app/panel/page.tsx` (**shared**, dashboard): POS stat sub; commission sub with `model.cardShareOf(month).rate`.
- `src/app/panel/dashboard-breakdowns.ts` (**shared**): commission sub with the month rate.
- `src/app/api/export/workbook.ts` (**shared with backup group**): "Ay Bilgileri" sheet gets columns
  `Kartlı satış oranı` (PCT) and `Kasa raporundan` (comma list of the fields with source kasa, e.g.
  `açık gün, ciro, kartlı oran`). Values exported = effective. Update the sheet description at line ~461.
- `src/app/panel/ayarlar/fields.ts`, `src/app/panel/yardim/page.tsx`: texts (§3.9).
- Docs: `docs/KASA-RAPORU.md`, `README.md` (§9).

---

## 7. Edge cases and interactions

- **No cash reports in a month (Jul–Sep 2026, and every month locally):** `sources` are manual or none, `kasa` is
  null, and every screen and number is identical to today. The golden and Excel tests are untouched (no `cardShare`
  → fallback to `st.kartOrani`).
- **October 2026 (production, reports started mid-month):** `partialFrom` is set, so the sums are not applied (the
  typed open days and ciro stay anyway). Card share becomes derived → the POS commission for October changes slightly
  (intended; listed in Risks and owner decisions).
- **Running month:**
  - missing days run up to yesterday (`through = businessDate − 1`), and today's report counts once it is entered;
  - the dashboard forecast (`posRevenue ÷ openDays × dim`) works on the derived values with no change, and is
    better than a stale typed number.
- **Missing reports in a closed month:** the derived open days and ciro are too low. There is no silent fix; the
  missing days are listed on the Kasa card, the Satışlar strip and the dashboard task (warn). The owner enters the
  missing reports or types the values.
- **A day with a report and zTotal = 0** counts as reported but not open.
- **A month only in kasa** (no `months` row): it is synthesised, so it appears in pickers and in Gelir-gider.
  - Saving month info upserts the row.
  - `importSales` → `ensureMonth` inserts `{month}` with nulls, so kasa still applies.
  - `dropEmptyMonth` may delete an empty row while kasa data keeps the month visible. Correct.
- **Typed 0** for discounts or comps = a typed value (wins over kasa). Old rows' 0s stay typed; "Kasadakini kullan"
  frees them.
- **Report edit or delete** changes the derived month values on the next model load (`refresh()` is already called
  after the submit and delete actions).
- **Salary / fixed-expense versions:** `dataMonths` now includes kasa-derived open-day months, so a change cannot
  silently rewrite a closed month with kasa data (§5.4).
- **Ayarlar impact preview:** months with a card share keep their own rate, so the preview reflects only months
  without one (correct).
- **Carry chain across a gap:** the "previous report" is the last earlier one (same as the form pre-fill today);
  `gapDays` is shown.
- **The first report ever** has no previous report → no carry check.
- **Report deleted:**
  - the next day's carry check now compares with the report before it; the badge may appear or disappear (correct);
  - its revisions cascade, and the activity log keeps the values.
- **Old reports** (before this change) have no revisions; their history starts at the next edit. `countedByName` is
  null → the submitter is shown.
- **Concurrency:** the revision snapshot is written in the same transaction that has the `FOR UPDATE` lock, so two
  resubmits cannot lose a snapshot.
- **Staff lock** only blocks *editing* an existing report when a later report exists. Entering a missing yesterday is
  still allowed. Admins are unaffected.
- **Opening note rule** applies to admins too, but only when the report is new or the opening changed, so fixing a Z
  typo on an old mismatched report is not blocked.
- **E-mail idempotency** is unchanged (`cash-{date}-r{rev}`). The resend still shows the changes (the snapshot is read again).
- **Online (laffogato.net) row** stays out of every kasa and month number, as today.
- **Dialogs:** the history dialog's `Düzenle` is an existing `ButtonLink`; no new dialog → navigation path is added.
  The new Kasa card link is outside dialogs.
- **cacheComponents:** `businessDate()` / `new Date()` in `loadDataset` must run after the awaited DB reads (same as
  the `currentMonthTR()` comment there).

---

## 8. Tests (`npx tsx --test`)

`tests/kasa-ay-bilgisi.test.ts` (new):
- `tillMonths`:
  - open days count only zTotal > 0;
  - ciro sum; card share = (card + meal) ÷ zTotal, rounded;
  - discounts and comps are null when no day entered them, a sum + day count otherwise;
  - missing days within [from, to];
  - `through` limits the running month;
  - `partialFrom` when the first report is after the 1st.
- `kasaValues` / `resolveMonth`:
  - typed wins (including a typed 0 for discounts);
  - null → kasa;
  - no kasa → today's defaults;
  - partial month → sums not applied, card share applied;
  - a kasa-only month is synthesised;
  - `sources` are correct.
- `manualOf`: with and without `sources`.
- Engine:
  - `pnlMonth(m).sections.komisyon` and `monthSales(m).commission` use the month's `cardShare`, with fallback to `kartOrani`;
  - `pnlValue(..., "revenue")` returns `computed` = kasa and `overridden` only when typed;
  - `cardShareOf` source.
- `closedDataMonths` with an effective kasa month includes it.

`tests/kasa-raporu.test.ts` (extend; add `discounts: null` to the `day` fixture):
- `carryCheck`: tolerance (0,99 ₺ → null), sign ("az" / "fazla"), `gapDays`.
- `carryChecks` chain over 3 reports + `before`; the reverse case (an earlier report edited).
- `openingNeedsNote`: new report / opening changed / unchanged opening / note present.
- `revisionChanges` / `changesText`: money labels, null handling, `Not değişti`, the sensitive flag; unchanged → [].
- `isLateEdit`: 23:59 same day → false; 04:59 next day → false (business day); 05:01 next day → true.
- `whatsappText` / `renderCashReport`: sayan line, `Değişen:` block, carry warning, next-day warning, İndirim line;
  the note stays escaped.

`tests/gelir-gider-cells.test.ts` (extend):
- `planCellEdit` revenue / openDays with `computed`: clearing a typed value gives the "kasa raporlarına döndü"
  message; clearing a kasa value gives `none`.
- `planCellRestore` never freezes a non-overridden value.

`tests/dashboard-tasks.test.ts` (extend): month task with a kasa source (done text), and a closed month with missing
days (warn, href to `/panel/kasa?ay=`).

`tests/satislar.test.ts` (extend): `cardShareProblem`, `initialModes`, `kasaHint`.

Run also: `npm run lint`, `tsc` (type check), and the full `npm test`. Manual check: local Postgres with ~25 seeded
cash reports for Nov 2026 (two missing days, one opening mismatch, one late revision). Check `/panel/kasa`,
`/panel/satislar?ay=2026-11`, `/panel/gelir-gider` and `/panel` at 390px and desktop.

---

## 9. Docs

- `docs/KASA-RAPORU.md`:
  - new "İndirim" row in the "Personel ne girer" table, and "Kasayı sayan" in the Kasa row;
  - new section **"Açılış ve devir"** (the check, the note rule, `Devri yaz`, the gap);
  - new section **"Düzeltmeler"** (history table, late edit = after 05:00 of the next day, staff lock, bell);
  - new section **"Ay bilgisine aktarım"** (the field table of §2.1, the typed-wins rule, `partialFrom`, missing days,
    where it shows);
  - updated "Gönderince" (e-mail / WhatsApp additions) and "Zil" (2 new admin items);
  - the Files line adds `src/lib/cash-month.ts` and `tests/kasa-ay-bilgisi.test.ts`.
- `README.md`:
  - feature table row for Kasa: `…; ay bilgisini (açık gün, ciro, indirim, ödenmez, kartlı oran) kendiliğinden doldurur; açılış ↔ devir ve düzeltme geçmişi`;
  - the `lib/` tree line for `cash-month.ts`.
- `docs/DEPLOY.md`: no change. The backup group should list `cash_report_revisions` (see §11).

---

## 10. Owner decisions (with the defaults this plan implements)

1. **Opening ≠ previous carry-over: should a note be required?** Default: **yes**. The submit is blocked until the
   note has one line, and only when the report is new or its opening changed. Alternative: warn only.
2. **May staff still edit a report after the next day's report was submitted?** Default: **no**; only the admin can.
   Entering a missing day stays allowed. Alternative: keep today's "today and yesterday" editing and rely on the
   history and the bell.
3. **Should the monthly card share from kasa replace the Ayarlar card share for that month's POS commission
   automatically?** Default: **yes**. Ayarlar stays for product pricing and months without reports. October 2026's
   commission will move slightly.
4. **"İndirim" on the cash report: optional or required?** Default: **optional**. The month discount uses only the
   days where it was entered, and the coverage is shown.
5. **Old months with typed values (incl. October 2026's typed 0 discount / comps): leave them typed?** Default:
   **leave them**. The owner can tap "Kasadakini kullan" per field.
6. **Closed days:** should staff mark "Kapalıydık" so that missing days are not reported? Default: **no marker**.
   Missing days are listed and the owner judges; it can be added later.
7. **"Kasayı sayan": from user accounts only, or also free text?** Default: **user accounts only**.
8. **"Late edit" threshold:** Default: **after the business day closes (05:00 next day)**. Same-night corrections
   are normal and not flagged.

---

## 11. Risks and integration notes

- **Shared files** other groups may touch:
  - `schema.ts` + the drizzle migration number (regenerate after a rebase; never hand-merge `drizzle/meta`);
  - `src/lib/calc/types.ts`, `engine.ts`, `src/server/data/dataset.ts`;
  - `src/server/actions/notifications.ts` (bell; group 4 silent failures and group 13 "Bugün" also add items);
  - `src/app/panel/page.tsx`, `dashboard-tasks.tsx`, `dashboard-breakdowns.ts` (dashboard; groups 4, 9, 13);
  - `src/app/api/export/workbook.ts` (group 3 backup);
  - `src/app/panel/kasa/*` (group 13 may link Kasa into the bottom nav and the "Bugün" view; group 9 cash-flow
    forecast may read cash reports).
- **Backup (group 3):** a full backup and restore must include `cash_report_revisions` and the new columns
  (`months.card_share`, `cash_reports.discounts/counted_by/counted_by_name`). Restore must keep `discounts` /
  `off_revenue` null versus 0.
- **Cash-flow (group 9)** may want `tillMonths` for the daily cash take. Reuse `src/lib/cash-month.ts`.
- **"Bugün" (group 13)** can reuse `carryCheck` and the "today's report missing" rule from `notifications.ts`.
- Behaviour change on deploy:
  - October 2026 POS commission uses the kasa card share (if reports exist in production);
  - November 2026 onward fills itself from kasa. Tell the owner in the PR text.
- Making `months.discounts/off_revenue` nullable: every raw-row reader must handle null. Covered: `sales.ts`,
  `stock.ts`, the seed; `ds.months` is effective (numbers). `tsc` will flag the rest.
- Missing-day bias in closed months, if the owner ignores the warnings (mitigated by 3 visible warnings).
- One extra light query per `loadModel` (all cash reports, 6 columns; ~365 rows per year). Negligible.
- Client payload: `Month.kasa.till.missing` arrays go to the Ayarlar impact preview. Small.
