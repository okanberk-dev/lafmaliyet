# Plan: Haftalık yönetici özeti (pazartesi e-postası) — group `haftalik`

Base: `claude/kalan-isler` (= origin/main 099dc8a + docs/planlar) **plus every batch-1 plan** (adminstepup, ops, vkn,
pricing, kasa, insight + kdv, menu, today) **and every batch-2 plan** (kontrol, komisyon, fotograf, siparis, mcp, tahmin,
doluluk) as merged per CRITIQUE §5 / CRITIQUE2. haftalik is the **last** group of the second batch: it only reads what
the others built. Next.js 16.4 (cacheComponents), Drizzle 0.45, Turkish UI. Rules R1–R7 (CRITIQUE.md) apply; this group
has **no migration**, so R2 is trivial.

Next.js docs this plan relies on (read before coding, AGENTS.md):
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` § "With Cache Components": GET route
  handlers run at request time; the cron reads the request headers (`rejectUnlessCron`) before it reads the clock.
- `node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md` § "Fix synchronous IO": in the panel
  page and actions, `new Date()` only after `requireAdmin()`.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md`: `refresh()` only inside Server Actions,
  never in the cron path.
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`: a
  page-level `maxDuration` also covers the Server Actions used on that page (preview / sample send).
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`: `after()` runs inside the same
  `maxDuration`, so it buys no time for the cron; **not used**.
- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` ("Sequential dispatch"): the preview action blocks
  other actions on the page for its 1–4 s; acceptable, the button shows a pending state.

---

## 0. Summary

Every Monday, inside the existing daily job (`/api/cron/gunluk`, 05:00 UTC = 08:00 Istanbul; the café is in Tuzla,
Opera AVM, UTC+3), the panel e-mails the admins one **short** summary: **at most 5 items**, sorted by their lira impact,
each one a single line plus one detail line and a link that opens the right panel screen. The items come from up to nine
sources (price rises, cash plan, kasa shortages, commissions, stale ModPOS prices, waste, stock difference, karaoke
occupancy, checklists). Every source is optional: a source that is absent, slow, failing or without data drops only its
own item. Two context lines (last week's kasa revenue, next 7 days' forecast) sit above the items. The e-mail is sent at
most once per ISO week; if Monday's run could not send it, Tuesday and then Wednesday retry; an uncertain send is never
retried. The owner switches it on/off, previews it and sends a sample to themselves in **Ödemeler & hatırlatıcılar ›
E-posta bildirimleri › Haftalık özet**.

Schema: **none** (two `integration_state` keys, `notification_log` rows). New dependency: **none**. New cron: **none**.
New screen: **none**.

---

## 1. Goal

The owner asked for: "her pazartesi kısa bir e-posta; lira etkisine göre sıralı 3–5 madde; her biri tek dokunuşla ilgili
ekrana; ör. 'Süt zammı Latte'de ayda 4.800 ₺ kâr kaybı', 'Salı 15–18 karaoke %12 dolu'" and "basit, anlaşılır, aşırı
detaylı değil". The morning e-mail is operational (today's payments, new invoices, holds, system problems). The weekly
summary answers a different question once a week: **"Neye bakarsam en çok para kurtarırım?"** It never lists payments
or invoices; it gives one line per topic with the money at stake, and the screen where the owner can act.

---

## 2. Decisions (made here; the implementer does not re-decide)

| # | Decision | Why |
|---|---|---|
| D1 | **Separate e-mail with its own template** (`renderWeekly` in `src/server/notify/weekly-template.ts`). `renderDigest` is not touched (stays positional, R4); subject precedence (R5) is not affected | The owner wants it short; merging into the Monday digest would make the longest e-mail of the week longer and would need a 6th positional argument (R4 forbids it). |
| D2 | **Runs inside `/api/cron/gunluk` on Monday**, after the digest, **in parallel with `extras()`**. Eligible days: Monday, then Tuesday and Wednesday as retries (ISO weekday ≤ 3) | Vercel Hobby crons are daily and no new cron may be added (DIGER-OTURUM). Running beside the site syncs adds ~0 s of wall time on a normal day. |
| D3 | **Ranking = money at stake this month.** Recurring losses count with their **monthly** amount (₺/ay), one-off facts with their **amount** (₺). Items without a lira value come last | One sentence the owner understands: "kasanıza etkisine göre". A monthly loss and a one-off amount are both "this month's money". |
| D4 | **"Ayda" comes only from insight's basis.** Price-rise loss is insight's `priceLoss` (which uses `salesBasis`); the stale-ModPOS-price loss uses `salesBasis(model, month)`'s **month and scale** applied to the POS quantity (`model.soldByProduct(month)`). No other "per month" formula | CRITIQUE R4: `salesBasis` is the one place that turns a sales month into a standard month. |
| D5 | **At most 5 items; at most 2 without a lira value; one place is kept for them when any exist** (4 + 1). No padding: 1–2 items are sent as they are | Short, ₺ first, but the owner's own example (karaoke) must be able to appear. |
| D6 | **0 items → the e-mail is still sent** with one calm line ("Paneldeki kontrollerde bu hafta öne çıkan bir şey yok."). If **every** source failed, nothing is sent and the step reports an error (retry next day) | "Her pazartesi" is a ritual; silence would be ambiguous. A summary built from nothing would be a false "all clear". |
| D7 | **One item per source** (its biggest). The detail line may give the source's total ("Zamlar toplam ayda ≈ 7.850 ₺") | Keeps the list short and varied. |
| D8 | **Recipients = active admin users** (`users.role = 'admin'`, `active`, invite accepted), their login e-mails. The notification address list (`notification_recipients`, which may hold an accountant) does **not** get it. Gönderen = `resolveFrom(loadNotifySettings().from)` | The e-mail carries profit and cash figures; staff never see costs (roles.ts). Reuses the existing sender setting. |
| D9 | **Own on/off switch**, `integration_state` `haftalik.settings`, default **on**. The "Hatırlatma e-postaları" switch does not affect it | `saveNotificationSettings` overwrites the whole `notify.settings` value with its 4 zod fields (`src/server/actions/reminders.ts:404-426`), so a weekly field there would be dropped on the next save. |
| D10 | **Idempotency:** claim row `notification_log` key `haftalik:{2026-W44}` written **just before** the send (unique index = atomic claim), Resend `Idempotency-Key: haftalik-2026-W44`, and the week stored in `integration_state` `haftalik.gecmis` after success. A **definite** failure (Resend answered with an error) is retried the next eligible day; an **uncertain** one (timeout, network, 409) is not | "At most once per week, never twice." `db:reset` truncates `notification_log` (`scripts/seed.ts:79-80`) but keeps other state keys, so `haftalik.gecmis` stops a same-week resend after a reset. |
| D11 | **Time:** hard deadline `jobStart + 52 s` (maxDuration 60). The step starts only if ≥ 9 s remain; collectors ≤ 4 s each in parallel (model-based ones share one `loadModel()`), send ≤ 4 s, one attempt | Paraşüt retry may take 35 s and the site syncs 8 s each (DIGER-OTURUM); the step must never push the job past 60 s. Too late on Monday → Tuesday. |
| D12 | **No duplicate with the Monday morning e-mail:** scopes differ (§8), and an item whose facts were **first e-mailed today** by the digest (komisyon / kontrol keys in `notification_log`) is dropped | The digest is "today's news", the weekly is "the week's money". |
| D13 | **Repeat rules:** a valued item repeats every week while it is true (an unresolved loss); an item without a lira value is not shown two weeks in a row with the same key; a "once" item (monthly stock difference) is shown once | Nudges for money, no nagging for facts the owner cannot change quickly (karaoke). |
| D14 | **Automatic send only in production** (`isProductionRuntime()`, `src/server/jobs/alerts.ts`). Preview never sends; "Örneği bana gönder" sends only to the clicking admin, never claims the week | Previews share the production DB; a preview claim would block the real e-mail. |
| D15 | **No names of people in the e-mail** (no customer, no staff). Company, product, ingredient, channel names and the owner's own reminder titles only | KVKK; Resend is an existing processor (digest, kasa e-mail), so no new KVKK text is needed (DIGER-OTURUM "Kişisel veri"). |
| D16 | **Settings live in Ödemeler › E-posta bildirimleri** (a new row under "Hatırlatma e-postaları"), not in Ayarlar | All e-mail settings, previews and "Son gönderimler" are already there (`notifications-section.tsx`). |

---

## 3. What the owner sees

### 3.1 The e-mail

Example: Monday 26 October 2026 (ISO week 2026-W44; "geçen hafta" = 19–25 Ekim).

```
Konu: Haftalık özet: 1 Kasım Pazar para yetmeyebilir: tahmini −12.400 ₺ · +4 madde

L'Affogato · Haftalık özet · 19–25 Ekim
Bu hafta bakmanız gereken 5 konu
Geçen hafta kasa cirosu 68.900 ₺ · önceki 4 haftaya göre %12 az
Önümüzdeki 7 gün beklenen satış ≈ 72.000 ₺ · en yoğun gün Cumartesi

1. 1 Kasım Pazar para yetmeyebilir: tahmini −12.400 ₺
   O gün: Kira 160.000 ₺, Maaşlar (Ekim, tahmini) 60.000 ₺
   Nakit planını aç: https://ladmin.laffogato.net/panel/hatirlaticilar/nakit
2. Latte: Süt %2,5 zammı ayda ≈ 4.800 ₺ kâr kaybı
   Zamlar toplam ayda ≈ 7.850 ₺ · 6 ürünün fiyatına bakın · Eylül 2026 satışlarıyla
   Fiyatlara bak: https://ladmin.laffogato.net/panel/urunler#zamlar
3. Hakediş gecikti: Trendyol Go (Eylül) · ≈ 3.200 ₺
   Son gün 15 Ekim Perşembe · geldiyse Komisyon & hakediş'te işaretleyin
   Komisyon & hakedişe bak: https://ladmin.laffogato.net/panel/komisyonlar?ay=2026-09#trendyol
4. Kasa geçen hafta 2 gün eksik: toplam 640 ₺
   En çok 23 Ekim Cuma: 340 ₺ · 1 gün açılış devirle tutmuyor
   Kasa raporlarına bak: https://ladmin.laffogato.net/panel/kasa?ay=2026-10
5. Salı–Perşembe 14–17 karaoke %12 dolu
   Son 4 haftanın en boş saatleri · genel doluluk %38
   Doluluğa bak: https://ladmin.laffogato.net/panel/karaoke/doluluk

Maddeler kasanıza etkisine göre sıralandı; ≈ işaretli tutarlar tahmindir.
Paneli aç: https://ladmin.laffogato.net/panel
```

Quiet week (0 items):

```
Konu: Haftalık özet: bu hafta dikkat isteyen bir şey yok
Bu hafta dikkat isteyen bir şey yok
Paneldeki kontrollerde bu hafta öne çıkan bir şey yok.
Geçen hafta kasa cirosu 71.300 ₺ · önceki 4 haftayla aynı
```

**HTML** (the digest's shell, `emailLayout`, now exported; inline styles and tables only, light scheme, 560 px max,
single column on the phone):
- brand sub `Haftalık özet`; top-right date = `longDateTR(today)` (shell default);
- eyebrow (13 px, `#71717a`): `Haftalık özet · {19–25 Ekim}`; sample: `Örnek · Haftalık özet · {19–25 Ekim}`;
- `<h1>` (22 px): `Bu hafta bakmanız gereken {n} konu` / `Bu hafta dikkat isteyen bir şey yok`;
- sample only, under the headline: `Bu bir örnektir; asıl özet pazartesi sabahı gider.`;
- 0 items only: `Paneldeki kontrollerde bu hafta öne çıkan bir şey yok.`;
- context lines (13 px, `#3f3f46`), each optional (§3.3);
- items: one table, one row per item, `border-top:1px solid #e4e4e7`, padding 12 px 0 (≥ 44 px tap height). Left
  cell 28 px: the number in a 22 px circle (`#f4f4f5` on `#3f3f46`). Right cell: **title** (15/20 px, 600, `#171717`) as
  an `<a>` to `APP_URL + href`; **detail** (13/18 px, `#71717a`); **action** `{action} →` (13 px, 600, `#171717`,
  underline) as an `<a>` to the same URL. Title and action are both links, so one tap opens the screen in every client
  (Outlook ignores block links, so no `display:block` wrapper is relied on);
- footnote (12 px, `#a1a1aa`): `Maddeler kasanıza etkisine göre sıralandı; ≈ işaretli tutarlar tahmindir.` + when a
  source failed ` Bu hafta okunamadı: {nakit planı, karaoke doluluğu}.`;
- black full-width button `Paneli aç` → `{APP_URL}/panel`;
- shell footer (new optional `footer` argument): `Bu özet her pazartesi panel yöneticilerine gider. Kapatmak için:
  Ödemeler & hatırlatıcılar › E-posta bildirimleri › Haftalık özet.`

**Subject:** `Haftalık özet: {item 1 title}` + (n > 1 ? ` · +{n−1} madde` : ``); 0 items:
`Haftalık özet: bu hafta dikkat isteyen bir şey yok`; sample: prefix `Örnek · `. Cut to 150 characters with `…`.
**Preheader:** `{19–25 Ekim} · {n} konu` / `{19–25 Ekim} · dikkat isteyen bir şey yok`.
**Plain text:** as in the example: header `L'Affogato · Haftalık özet · {range}`, subject, context lines, numbered items
(title, indented detail, `{action}: {url}`), footnote, `Paneli aç: {url}`.

All user-sourced text (product, ingredient, channel, reminder titles) goes through the shell's `esc()`.

### 3.2 Items (sources, rules, exact texts, links)

Constants: `MIN_TL = 100`. "₺" amounts are `tl()` (whole lira, NBSP before ₺, `src/lib/format.ts:29`); "≈ " marks
estimates. Dates: `longDateTR` ("23 Ekim Cuma"); months: `MONTH_NAMES` ("Eylül") or `monthLabel` ("Eylül 2026").
No Turkish case suffix is ever attached to a variable name, number or date (doluluk §3.6 rule): "Latte: …" instead of
"Latte'de".

| Key / source | Lira value (ranking) | Shown when | Title (exact) | Detail (exact) | Link · action |
|---|---|---|---|---|---|
| `zam:{minProductId}:{ingredientId}` · insight | ₺/ay: the biggest (product name, ingredient) pair among **actionable** products (needs a price, not "böyle kalsın"), sizes summed | pair ≥ `MIN_TL` | `{Latte}: {Süt %2,5} zammı ayda ≈ {4.800 ₺} kâr kaybı` | `Zamlar toplam ayda ≈ {7.850 ₺} · {6} ürünün fiyatına bakın · {Eylül 2026} satışlarıyla` (when the total equals the pair: drop the first part) | `/panel/urunler#zamlar` · `Fiyatlara bak` |
| `zam:fiyat` · insight (no sales month) | none | `loss.basis === null` and ≥ 1 actionable | `Hammadde zammı: {3} ürünün fiyatına bakın` (= `priceAlert().title`) | `Ayda kaç lira tuttuğunu görmek için Satışlar'a ürün satış raporunu yükleyin.` | same |
| `nakit:{date}` · insight (+kdv inside the plan) | ₺: shortfall `−firstNegative.balance` | balance entered, `staleDays ≤ 7`, first negative day ≤ today + 13 | `{1 Kasım Pazar} para yetmeyebilir: tahmini −{12.400 ₺}` (U+2212) | `O gün: {Kira 160.000 ₺}, {Maaşlar (Ekim, tahmini) 60.000 ₺}` + (staleDays > 3: ` · bakiye {5} gün önce girildi`) | `/panel/hatirlaticilar/nakit` · `Nakit planını aç` |
| `kasa:eksik:{week}` · existing + kasa + fotograf | ₺: Σ shortages of last week (reports with `cashDiff ≤ −CASH_TOLERANCE`) | Σ ≥ `MIN_TL` | n = 1: `{20 Ekim Salı} kasası {640 ₺} eksik`; n ≥ 2: `Kasa geçen hafta {2} gün eksik: toplam {640 ₺}` | parts joined ` · `: (n ≥ 2) `en çok {23 Ekim Cuma}: {340 ₺}`; `{1} gün fazla: {50 ₺}`; `{1} gün açılış devirle tutmuyor`; `{1} rapor ertesi gün düzeltildi`; `{1} raporda tutar fotoğraftan farklı` (first letter upper-cased) | `/panel/kasa?ay={month of the worst day}` · `Kasa raporlarına bak` |
| `kasa:uyari:{week}` · kasa + fotograf | none | no valued kasa item, ≥ 1 flag | `Geçen hafta kasa: {first flag}` (e.g. `Geçen hafta kasa: 2 gün açılış devirle tutmuyor`) | the other flags | same |
| `komisyon:{alertKey}` · komisyon | ₺: late payout `expected − (received ?? 0)`; meal over-limit `feesTotal − MEAL_LIMIT × sales`; banned fee `fees.yasak` (the biggest) | ≥ `MIN_TL` (a late payout with unknown expected is shown without a value) | late: `Hakediş gecikti: {Pluxee} ({Ekim}) · ≈ {8.605 ₺}` (no value: without ` · ≈ …`); over-limit: `{Pluxee} {Ekim}: kesinti %{6,4} · sınırın üstünde {240 ₺}`; banned: `{Multinet} {Ekim}: komisyon dışı ücret olabilir · {150 ₺}` | late: `Son gün {15 Ekim Perşembe} · geldiyse Komisyon & hakediş'te işaretleyin`; over-limit: `Yemek kartında yasal üst sınır %6.`; banned: `“{POS Cihaz Kira Bedeli}” {150 ₺}`; + (more alerts) ` · {2} konu daha` | `/panel/komisyonlar?ay={month}#{channel}` · `Komisyon & hakedişe bak` |
| `kasa-fiyat` · menu + insight basis | ₺/ay: Σ over pending rows with panel price > POS price: `(price − posPrice) ÷ (1 + kdv) × posQty × scale` | ≥ `MIN_TL` | `ModPOS'ta {5} ürün eski fiyatla: ayda ≈ {1.900 ₺} kâr kaybı` | `En çok {Latte M}: kasada {185 ₺}, menüde {195 ₺} · {6} gündür bekliyor` | `/panel/urunler/fiyatlar?sekme=kasa` · `Kasadaki fiyatlara bak` |
| `kasa-fiyat` (no value) · menu | none | value < `MIN_TL` or no basis, and the oldest pending ≥ 3 days | `ModPOS'ta {5} fiyat değişecek` | `Kasada elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin.` | same |
| `zayi:{week}` · existing | ₺: last week's zayi + ikram material cost (engine rule) | last ≥ max(3 × `MIN_TL`, 1,5 × average of the 4 previous weeks) | `Geçen hafta zayi ve ikram {900 ₺}` | `Malzeme maliyeti · önceki 4 haftada ortalama {400 ₺}` (avg 0: `Malzeme maliyeti · önceki 4 haftada kayıt yok`) + ` · en çok {Latte M}: {180 ₺}` | `/panel/zayi?ay={month of last Sunday}` · `Zayi kayıtlarına bak` |
| `stok:{month}` · existing (once) | ₺: `consistency(model, prevMonth).totalUnexplained` | `hasStockComparison` and ≥ 500 ₺ | `{Ekim} sayımında {6.200 ₺} açıklanamayan stok farkı` | `En çok {Süt %2,5}: {1.900 ₺} · kayıtlı zayi ve ikram düşüldü` | `/panel/tutarlilik?ay={month}` · `Tutarlılığa bak` |
| `karaoke:bos:{d0}-{d1}:{h0}-{h1}` · doluluk | none | insights computed (≥ 14 days, ≥ 8 sessions) and block ratio < 0,25 | `{Salı–Perşembe} {14–17} karaoke %{12} dolu` | `Son 4 haftanın en boş saatleri · genel doluluk %{38}` | `/panel/karaoke/doluluk` · `Doluluğa bak` |
| `kontrol:{week}` · kontrol | none | ≥ 1 missed daily list or ≥ 1 problem on a day **with** a kasa report | missed, one list name: `Geçen hafta {2} {kapanış listesi} yapılmadı`; mixed: `Geçen hafta {3} kontrol listesi yapılmadı`; problems only: `Geçen hafta kontrol listelerinde {2} sorun` | with both: `Ayrıca {2} sorunlu kayıt (ör. {Buzdolabı}: {6 °C})`; problems only: `ör. {Buzdolabı}: {6 °C}`; + ` · kasa raporu olmayan {1} gün sayılmadı` | `/panel/kontrol/gecmis` · `Kontrol geçmişine bak` |

Ordering:
- valued items by ₺ descending; ties by `VALUED_ORDER = ["nakit","zam","kasa","komisyon","kasa-fiyat","stok","zayi"]`;
- items without a value by `PLAIN_ORDER = ["kasa","karaoke","kontrol","zam","kasa-fiyat","komisyon"]`.

### 3.3 Context lines (not items, not ranked)

- **Kasa cirosu** (existing `cash_reports`, Z total, KDV dahil; laffogato.net online is not in it):
  - last week with ≥ 6 reports and ≥ 2 of the 4 previous weeks with ≥ 6 reports:
    `Geçen hafta kasa cirosu {68.900 ₺} · önceki 4 haftaya göre %{12} {az|fazla}`; |Δ| < %2:
    `Geçen hafta kasa cirosu {71.300 ₺} · önceki 4 haftayla aynı` (average over the qualifying weeks);
  - otherwise, when last week has ≥ 1 report: `Geçen hafta kasa cirosu {54.200 ₺} ({5} gün raporlu)` (no
    "gün raporlu" part when 7);
  - no report: no line.
- **Satış tahmini** (tahmin), only when `forecast.quality` is `tam`, `karma` or `ortalama`:
  `Önümüzdeki 7 gün beklenen satış ≈ {72.000 ₺} · en yoğun gün {Cumartesi}` (closed days excluded from the sum).
  "Önümüzdeki 7 gün" (not "bu hafta") stays true on a Tuesday retry.

### 3.4 Panel: Ödemeler & hatırlatıcılar › E-posta bildirimleri › **Haftalık özet**

A new row inside the existing collapsible section (`notifications-section.tsx`), right under the "Hatırlatma
e-postaları" switch row, same look (`rounded-2xl bg-surface px-4 py-3 ring-1 ring-line`):

- Title `Haftalık özet`; text (xs, `text-ink-mute`): `Her pazartesi sabahı kısa bir e-posta: liraya etkisine göre sıralı
  en çok 5 madde, her biri ilgili ekranı açar. Yöneticilere gider: {Okan, Ayşe}.` (no active admin: `Etkin yönetici
  yok.`).
- `Switch` (label `Haftalık özet`, `showText`, `onText="Açık"`, `offText="Kapalı"`, `pointer-coarse:h-11`). Toasts
  `Haftalık özet açıldı` / `Haftalık özet kapatıldı`. Optimistic like the existing switch.
- Status line (xs, `text-ink-soft`), from the pure `weeklyStatusText` (§5.3):
  - off: `Kapalı: pazartesi e-postası gitmez.`
  - sent this week: `Bu hafta gönderildi · {26.10.2026 08:04}` (`dateTimeTR`)
  - definite failure, retry ahead (weekday < 3): `Bu hafta gönderilemedi; yarın sabah yeniden denenecek.`
  - definite failure on the last day: `Bu hafta gönderilemedi.`
  - uncertain or cut off: `Bu haftaki gönderim yarıda kaldı; e-posta gelmediyse “Örneği bana gönder” ile alabilirsiniz.`
  - nothing this week yet: `Son gönderim {19.10.2026 08:03} · sıradaki pazartesi sabahı` / `Henüz gönderilmedi · ilk
    özet pazartesi sabahı gider`
- Buttons (`grid gap-2 @lg:flex`, `max-sm:h-12 max-sm:justify-start`, secondary):
  - `Haftalık özeti önizle` (icon `Eye`) → `previewWeekly()` → `Sheet` (size `lg`, same as the digest preview):
    title `Haftalık özet önizlemesi`; description `Pazartesi giden e-posta böyle görünür; gönderilmez. {4} madde.` (0
    items: `Bu hafta dikkat isteyen bir şey yok; e-posta tek satırla gider. Gönderilmez.`) + when sources failed
    ` Okunamadı: {nakit planı}.`; body `Konu: {subject}` + `<iframe sandbox="" srcDoc=…>`; footer `Kapat`.
  - `Örneği bana gönder` (icon `Send`), disabled when Resend is not configured → `sendWeeklySample()`. Toast
    `Örnek {okan@…} adresine gönderildi` with description `{4} madde` / `Bu hafta dikkat isteyen bir şey yok`.
  - When Resend is not configured, one line under the buttons: `Örnek gönderimi Resend anahtarı girilince açılır;
    önizleme her zaman çalışır.`
  - While pending, the clicked button reads `Hazırlanıyor…` and both are disabled.
- Phone (390 px): one column, 48 px buttons, no horizontal scroll; the collapsed section header is unchanged.
- The weekly e-mail and samples appear in the existing "Son gönderimler" list (their `notification_log` rows).

### 3.5 Ayarlar › Günlük işler

The gunluk run gets an optional step `weekly` (only on days it acted). Step words (`STEP_LABELS.weekly`):
`sent` `Haftalık özet gönderildi` · `off` `Haftalık özet kapalı` (Mondays only) · `nokey` `Haftalık özet: Resend
kurulmadı` (Mondays only) · `late` `Haftalık özet: süre yetmedi, yarın denenecek` · `error` `Haftalık özet gönderilemedi`
(message prefix `Haftalık özet: …`, the run becomes `partial`, so the bell and tomorrow's e-mail tell the owner).

---

## 4. Data model (no schema change, no migration)

`integration_state` (no migration; R6 backup covers it automatically; `db:reset` does not delete these keys, it deletes
only `parasut.%`, `payments.*`, `menu_sync` — `scripts/seed.ts:88-91`):

```ts
// "haftalik.settings" — yazan: saveWeeklyEnabled
interface WeeklySettings { enabled: boolean; by?: string; at?: string }      // yoksa { enabled: true }
// "haftalik.gecmis" — yazan: yalnız sabah işi, başarılı gönderimden sonra; en çok 8 hafta
interface WeeklyHistory { weeks: Record<string /* "2026-W44" */, { at: string; subject: string; keys: string[] }> }
```

`notification_log` rows (existing table, unique `key`):
- `haftalik:{2026-W44}`: the week's claim and result (`ok`, `error`, `subject`, `recipients`, `sent_at`). `error` uses
  three markers: `Gönderiliyor` (claimed, in flight), `Yeniden denenecek: {Resend message}` (definite failure),
  `Gönderim belirsiz: {message}` (timeout / network / 409).
- `haftalik-ornek:{ms}`: one row per sample send.

Item keys stored in `haftalik.gecmis` use ids, never names (`zam:12:4`, `stok:2026-10`, `karaoke:bos:1-3:14-17`).
`WeeklySettings` and `WeeklyHistory` are exported from `src/lib/weekly/core.ts`; the parse functions
(`parseWeeklySettings`, `parseWeeklyHistory`) turn a missing or broken value into the defaults (tested).

---

## 5. Server logic

### 5.1 Pure core — `src/lib/weekly/core.ts` (no server imports; `import type` only)

```ts
export type WeeklySource = "zam" | "nakit" | "kasa" | "komisyon" | "kasa-fiyat" | "zayi" | "stok" | "karaoke" | "kontrol";
export interface WeeklyItem {
  key: string;                 // kararlı kimlik (adsız): "zam:12:4", "kasa:eksik:2026-W44"
  source: WeeklySource;
  title: string;               // tutar başlıkta
  detail: string | null;
  tl: number | null;           // sıralama tutarı (₺, "bu ay"); null = lira değeri yok
  href: string;                // APP_URL'siz panel yolu
  action: string;              // "Fiyatlara bak"
  once?: boolean;              // bir kez gösterilir (stok farkı)
  newsKeys?: string[];         // sabah e-postasının aynı olgu için notification_log anahtarları
}
export interface WeekInfo { day: string; weekday: number; id: string; prevId: string; monday: string; lastFrom: string; lastTo: string }
export interface WeeklySummary { week: WeekInfo; items: WeeklyItem[]; lines: string[]; failed: WeeklySource[] }

export const WEEKLY_MAX_ITEMS = 5;
export const WEEKLY_MAX_PLAIN = 2;
export const WEEKLY_MIN_TL = 100;
export const WEEKLY_STOCK_MIN_TL = 500;
export const WEEKLY_WASTE_FACTOR = 1.5;
export const WEEKLY_LAST_WEEKDAY = 3;            // pazartesi gidemezse en geç çarşamba
export const WEEKLY_DEADLINE_MS = 52_000;        // iş başından; maxDuration 60
export const WEEKLY_MIN_WINDOW_MS = 9_000;       // başlamak için kalan en az süre
export const WEEKLY_COLLECT_MS = 4_000;          // kaynak başına üst sınır (paralel)
export const WEEKLY_SEND_MS = 4_000;             // Resend, tek deneme
export const WEEKLY_HISTORY_WEEKS = 8;
export const WEEKLY_CASH_DAYS = 14;              // ilk eksi gün en çok bugün + 13
export const WEEKLY_BALANCE_MAX_AGE = 7;
export const WEEKLY_KARAOKE_EMPTY = 0.25;
export const WEEKLY_POS_MIN_DAYS = 3;
export const WEEKLY_SALES_FULL_DAYS = 6;
export const WEEKLY_SETTINGS_KEY = "haftalik.settings";
export const WEEKLY_HISTORY_KEY = "haftalik.gecmis";
export const VALUED_ORDER: WeeklySource[];       // §3.2
export const PLAIN_ORDER: WeeklySource[];        // §3.2

/** İş günü (businessDate) → ISO haftası (Pzt–Paz), geçen haftanın aralığı. "2026-12-28" → "2026-W53" */
export function weekInfo(day: string): WeekInfo;
export function isoWeekId(monday: string): string;

/** §2 D5, D12, D13 */
export function selectItems(cands: WeeklyItem[], o: { sentToday: ReadonlySet<string>; seenBefore: ReadonlySet<string>; lastWeek: ReadonlySet<string> }): WeeklyItem[];

export type ClaimState = "free" | "sent" | "retry" | "busy" | "unknown";
/** notification_log satırına göre: yok → free; ok → sent; "Yeniden denenecek: …" → retry; "Gönderiliyor" ve < 5 dk → busy; diğer → unknown */
export function claimStateOf(row: { ok: boolean; error: string | null; sentAt: string } | null, now: number): ClaimState;

export type WeeklyRunStatus = "sent" | "off" | "nokey" | "skip" | "late" | "retry" | "uncertain" | "norecipient" | "error";
export interface WeeklyRunResult { status: WeeklyRunStatus; weekday: number; error?: string; items?: number }
/** Gönderime başlamadan: üretim değil / gün uygun değil / hafta gitti → skip; kapalı → off; Resend yok → nokey; süre yok → late */
export function weeklyDecision(i: { now: number; deadlineAt: number; production: boolean; week: WeekInfo; enabled: boolean;
  emailConfigured: boolean; weekSent: boolean }): { run: true } | { run: false; result: WeeklyRunResult };
/** Günlük işin adımı (src/lib/job-health.ts StepResult); undefined = adım yazılmaz */
export function weeklyStep(r: WeeklyRunResult): StepResult | undefined;
export function pruneHistory(h: WeeklyHistory, keepFrom: string): WeeklyHistory;
```

`selectItems` (in this order):
1. drop valued items below their floor (guard; builders already apply them);
2. drop items with `newsKeys` that are **all** in `sentToday`;
3. drop `once` items whose key is in `seenBefore`; drop items with `tl === null` whose key is in `lastWeek`;
4. keep one item per source (the highest `tl`, then the first);
5. `valued` = `tl !== null`, sorted by `tl` desc then `VALUED_ORDER`; `plain` = sorted by `PLAIN_ORDER`;
6. `plainTake = min(plain.length, WEEKLY_MAX_PLAIN, max(1, WEEKLY_MAX_ITEMS − valued.length))` (0 when no plain);
   `valuedTake = min(valued.length, WEEKLY_MAX_ITEMS − plainTake)`; result = `valued[0..valuedTake) ++ plain[0..plainTake)`.

Examples (tested): 7 valued + 3 plain → 4 + 1; 3 + 3 → 3 + 2; 0 + 4 → 0 + 2; 5 + 0 → 5; 1 + 1 → 1 + 1.

`weekInfo(day)`: `weekday` 1 = Pazartesi … 7 = Pazar (`Date.UTC`, no time zone); `monday = day − (weekday − 1)`;
`lastFrom = monday − 7`, `lastTo = monday − 1`; `id`/`prevId` ISO year-week (`2026-W44`, `2026-W43`; 2026 has 53 weeks,
`2027-01-04` → `2027-W01`).

`weeklyStep`: `sent` → `{code:"sent"}`; `off`/`nokey` → the same code on Monday, otherwise undefined; `skip` →
undefined; `late` → weekday < 3 ? `{code:"late"}` : `{code:"error", error:"süre yetmedi; bu haftanın özeti
gönderilemedi"}`; `retry` → `{code:"error", error: "{msg}; yarın yeniden denenecek"}` (weekday 3: `"{msg}; bu hafta
gönderilemedi"`); `uncertain` → `{code:"error", error:"gönderim belirsiz ({msg}); e-posta gelmediyse Ödemeler'den
örneği alın"}`; `norecipient` → `{code:"error", error:"etkin yönetici e-postası yok"}`; `error` → `{code:"error", error}`.

### 5.2 Pure builders — `src/lib/weekly/items.ts`

Each builder takes **narrow plain inputs** (the server collector maps the other plans' objects into them), so a type
change in another plan touches one mapping, not the pure logic or its fixtures. Each returns `WeeklyItem | null` (lines:
`string | null`). Rules and texts are §3.2 / §3.3.

```ts
export interface ZamIn { basisMonth: string | null; actionable: number; title: string /* priceAlert().title */;
  products: { productId: number; name: string; monthly: number; drivers: { ingredientId: number; name: string; monthly: number }[] }[] }
export function zamItem(i: ZamIn): WeeklyItem | null;
// gruplar ürün adına göre (boylar toplanır); çift = (ad, hammadde) Σ driver.monthly; en büyüğü; toplam = Σ products.monthly

export interface CashIn { today: string; opening: { staleDays: number } | null;
  firstNegative: { date: string; balance: number; top: { title: string; amount: number }[] } | null }
export function cashItem(i: CashIn): WeeklyItem | null;

export interface KasaIn { week: WeekInfo; reports: { date: string; zTotal: number; cashDiff: number }[];   // son 5 hafta
  carryMismatch: number | null; lateEdits: number | null; photoDiffs: number | null }                 // null = bilinmiyor
export function kasaItem(i: KasaIn): WeeklyItem | null;
export function salesLine(i: Pick<KasaIn, "week" | "reports">): string | null;

export interface KomisyonCand { alertKey: string; kind: "gecikti" | "oran" | "yasak"; channel: string /* key */; label: string;
  month: string; tl: number | null; due: string | null; rate: number | null; lines: string[]; more: number }
export function commissionItem(cands: KomisyonCand[]): WeeklyItem | null;   // en büyük tl; key ve newsKeys "komisyon:{alertKey}"

export interface PosPriceIn { today: string; kdv: number;
  rows: { label: string; price: number; posPrice: number; since: string; perMonth: number | null }[] }
export function posPriceItem(i: PosPriceIn): WeeklyItem | null;

export interface WasteIn { week: WeekInfo; entries: { date: string; name: string; cost: number }[] }   // son 5 hafta
export function wasteItem(i: WasteIn): WeeklyItem | null;
/** Engine'in wasteSummary kuralı (src/lib/calc/engine.ts:890-900): ürün → reçete malzeme toplamı × adet; hammadde → birim maliyet × adet × çarpan */
export function wasteCost(model: Pick<Model, "productById" | "computeProduct" | "unitCost">, e: WasteEntry): number;

export interface StockIn { month: string; comparable: boolean; unexplained: number; top: { name: string; amount: number } | null }
export function stockItem(i: StockIn): WeeklyItem | null;                     // once: true

export interface KaraokeIn { ready: boolean; overall: number | null; block: { key: string; where: string; ratio: number } | null }
export function karaokeItem(i: KaraokeIn): WeeklyItem | null;                 // where = "Salı–Perşembe 14–17" (doluluk metni)

export interface ChecklistIn { week: WeekInfo;
  days: { day: string; open: boolean /* kasa raporu var */; missed: string[] /* liste adı */; issues: { label: string; text: string }[] }[] }
export function checklistItem(i: ChecklistIn): WeeklyItem | null;              // newsKeys: "kontrol:{gün}" (katkı veren günler)

export function forecastLine(i: { quality: string; days: { date: string; amount: number; closed: boolean }[] }): string | null;
```

No builder input carries a person's name; `kasaItem` never sees `submittedByName`/`countedByName`, `checklistItem` never
sees `by`, `note` or `contributors`.

### 5.3 Texts — `src/lib/weekly/text.ts`

```ts
export const SOURCE_LABELS: Record<WeeklySource, string> = { zam: "zam etkisi", nakit: "nakit planı", kasa: "kasa raporları",
  komisyon: "komisyon ve hakediş", "kasa-fiyat": "ModPOS fiyatları", zayi: "zayi ve ikram", stok: "stok sayımı",
  karaoke: "karaoke doluluğu", kontrol: "kontrol listeleri" };
export function weekRangeText(from: string, to: string): string;   // "19–25 Ekim", "26 Ekim – 1 Kasım", "28 Aralık 2026 – 3 Ocak 2027"
export function trendText(last: number, avg: number): string;      // "önceki 4 haftaya göre %12 az" | "… %8 fazla" | "önceki 4 haftayla aynı"
export function subjectOf(s: WeeklySummary, sample?: boolean): string;
export function headlineOf(s: WeeklySummary): string;
export function failedText(failed: WeeklySource[]): string | null; // "Bu hafta okunamadı: nakit planı, karaoke doluluğu."
export function weeklyStatusText(i: { enabled: boolean; week: WeekInfo; row: { ok: boolean; error: string | null; sentAt: string } | null;
  lastSentAt: string | null; now: number }): string;              // §3.4
export function recipientsText(names: string[]): string;          // "Yöneticilere gider: Okan, Ayşe." | "Etkin yönetici yok."
```

### 5.4 Template — `src/server/notify/weekly-template.ts` (pure, **no** `server-only`, like `digest-template.ts`)

```ts
export function renderWeekly(s: WeeklySummary, o: { today: string; sample?: boolean }): { subject: string; html: string; text: string };
```

Uses `APP_URL`, `emailLayout`, `esc`, `FONT` from `./digest-template` (exported there, §5.9). Layout and texts: §3.1.

### 5.5 Collectors — `src/server/weekly/collect.ts` (`import "server-only"`)

```ts
interface WeeklyCtx {
  now: Date; today: string; week: WeekInfo;
  model(): Promise<Model>;                           // tek loadModel(), paylaşılan söz
  cashWeeks(): Promise<CashReportDTO[]>;             // cashReportsBetween(week.lastFrom − 28, week.lastTo), paylaşılan
}
interface Collector { source: WeeklySource | "satir"; timeoutMs: number; run(ctx: WeeklyCtx): Promise<{ items?: WeeklyItem[]; lines?: string[] }> }
export const COLLECTORS: Collector[];
export async function collectWeekly(now: Date, o: { budgetMs: number }): Promise<{ week: WeekInfo; items: WeeklyItem[]; lines: string[]; failed: WeeklySource[]; ran: number }>;
export async function buildWeekly(now: Date, o: { budgetMs: number }): Promise<{ summary: WeeklySummary; allFailed: boolean }>;
```

- `collectWeekly` runs every collector **in parallel**, each in `Promise.race([run(ctx), timeout(min(c.timeoutMs,
  o.budgetMs))])`, each wrapped in `.catch`. A timed-out or failed item collector adds its source to `failed`
  (`console.error("[haftalik]", source, e)`); a failed line collector only drops its line. Late promises are ignored
  (DB queries cannot be cancelled; they finish in the background harmlessly).
- `buildWeekly` then reads, in parallel: `haftalik.gecmis` (→ `seenBefore` = all stored keys, `lastWeek` = keys of
  `week.prevId`) and `notification_log` keys `= ANY(all newsKeys)` with `ok` and `sent_at ≥ today 00:00 Istanbul`
  (→ `sentToday`), then `selectItems`. `allFailed` = every item collector failed.
- The clock: `now` is passed in; `today = businessDate(now)` (at 08:00 equal to `todayTR()`).

Collectors (module → mapping):

| Collector | Timeout | Calls (exact) | Maps to |
|---|---|---|---|
| zam | 4 s | `model()`, `loadPriceAlerts(model)` (`src/server/data/price-alerts.ts`, insight adds `loss`), `priceAlert(changes, actionable)` (`src/lib/calc/price-impact.ts`) | `actionableIds = new Set(actionable.map(p => p.productId))`; `products = loss.products.filter(p => actionableIds.has(p.productId) && p.monthly > 0)`; `basisMonth = loss.basis?.month ?? null` → `zamItem` |
| nakit | 4 s | `model()`, `loadCashPlan(model)` (`src/server/data/cash-plan.ts`, insight; KDV rows from kdv are already in the plan) | `plan.opening`, `plan.firstNegative` (`top` → `{title, amount}`) → `cashItem` |
| kasa (+ ciro line) | 3 s | `cashWeeks()`; kasa: `carryChecks(reportsAsc, null)` (`src/lib/cash-report.ts`), `cashRevisionsFor(ids)` + `historyOf(report, revisions)` (`src/server/data/cash-reports.ts`); fotograf: `cashReportPhotoInfo(ids)` (`src/server/data/cash-photos.ts`) + `suspiciousDiffs(readings, saved)` (`src/lib/photo-read/kasa.ts`) | last week's checks with a mismatch; revisions `late && changes.some(c => c.sensitive)`; reports with non-empty `suspiciousDiffs`; each sub-read in its own `.catch(() => null)` → `kasaItem`, `salesLine` |
| komisyon | 3 s | `loadCommissionReport({ months: 4 })` (`src/server/data/commission.ts`), `commissionAlerts(report, today)`, `MEAL_LIMIT` (`src/lib/commission/report.ts`), `channelDef(key).label` (`src/lib/commission/channels.ts`) | for each alert (keys `gecikti:{ch}:{m}`, `oran:…`, `yasak:…`) find the `ChannelMonth` row and compute `tl` (§3.2); read only (never `ensureCommissionSince`) → `commissionItem` |
| kasa-fiyat | 4 s | `model()`, `loadPosChecklist()` (`src/server/data/prices.ts`, menu), `latestSalesMonth(model)` (`src/lib/calc/insights.ts`), `salesBasis(model, month)` (`src/lib/calc/price-loss.ts`, insight) | `perMonth = model.soldByProduct(month).get(id) × basis.scale` (POS only: online orders already pay the site price); `label = productLabel(p)` (`src/lib/waste.ts`) → `posPriceItem` |
| zayi | 4 s | `model()` (`ds.wasteEntries`, `computeProduct`, `unitCost`, `productById`) | entries of the last 5 weeks with `wasteCost` → `wasteItem` |
| stok | 4 s | `model()`, `consistency(model, shiftMonth(today.slice(0,7), −1))` (`src/lib/calc/insights.ts`) | `hasStockComparison`, `totalUnexplained`, top `complete` row by `unexplainedAmount` → `stockItem` |
| karaoke | 3 s | doluluk: `readKaraokeHours()`, `loadOccupancySessions(start, end)` (`src/server/karaoke/occupancy.ts`), `resolvePeriod("4h", undefined, now)`, `periodBounds`, `computeOccupancy`, `emptiestBlock` (`src/lib/karaoke/occupancy.ts`), `insightLines`, `weekdayRange`, `hourRangeLabel` (`src/lib/karaoke/occupancy-text.ts`) | `ready = insightLines(...).reason === null`; `block.where = weekdayRange(d0,d1) + " " + hourRangeLabel(h0,h1)`; `overall = summary.ratio` → `karaokeItem` (the loader selects no names) |
| kontrol | 3 s | `loadHistoryDays(week.lastFrom, week.lastTo)` (`src/server/data/checklists.ts`), `listTitle`, `lowerFirst` (`src/lib/checklists.ts`), `cashWeeks()` (open days) | daily lists only; missed = no run or no `completedAt`; issues `{label, text}` only → `checklistItem` |
| tahmin (line) | 3 s | `loadForecastCore(now)` (`src/server/forecast/load.ts`) | `forecast.quality`, `forecast.days` → `forecastLine` |

When a plan was cut or not merged, its collector file entry is left out of `COLLECTORS` (compile-time optional; one
line). Inside a collector, an optional sub-feature (kasa flags from kasa/fotograf) degrades to `null` (not shown).

### 5.6 Run and send — `src/server/weekly/send.ts` (`import "server-only"`)

```ts
export async function loadWeeklySettings(): Promise<WeeklySettings>;            // bozuk/eksik → { enabled: true }
export async function saveWeeklySettings(v: WeeklySettings): Promise<void>;
export async function weeklyRecipients(): Promise<{ name: string; email: string }[]>;
//  select name, email, password_hash from users where role = 'admin' and active → !isPendingInvite(hash) (src/server/auth/tokens.ts)
export async function runWeeklyStep(now: Date, o: { deadlineAt: number }): Promise<WeeklyRunResult>;
export async function sendWeeklySampleTo(me: CurrentUser, now: Date): Promise<{ to: string; items: number }>;
export async function loadWeeklyPanel(now: Date): Promise<{ enabled: boolean; recipients: string[]; status: string }>;
```

`runWeeklyStep(now, { deadlineAt })`:
1. `week = weekInfo(businessDate(now))`. Not production, or `week.weekday > WEEKLY_LAST_WEEKDAY` → `skip` before any
   read. Otherwise read `settings` and `haftalik.gecmis` (week sent?) in parallel.
2. `weeklyDecision({ now: Date.now(), deadlineAt, production: isProductionRuntime(), week, enabled, emailConfigured:
   isEmailConfigured(), weekSent })` → return its result when `run: false`.
3. Claim state: read `notification_log` row `haftalik:{week.id}` → `claimStateOf`. `sent`/`busy`/`unknown` → `skip`.
4. `buildWeekly(now, { budgetMs: min(WEEKLY_COLLECT_MS, deadlineAt − Date.now() − WEEKLY_SEND_MS − 500) })`.
   `allFailed` → `{ status: "error", error: "hiçbir bilgi okunamadı; yarın yeniden denenecek" }` (nothing claimed).
5. `recipients = weeklyRecipients()`; none → `norecipient`. `{ subject, html, text } = renderWeekly(summary, { today })`.
6. Claim: state `free` → `INSERT … (key, subject, recipients, ok=false, error='Gönderiliyor') ON CONFLICT (key) DO
   NOTHING RETURNING id`; state `retry` → `UPDATE … SET error='Gönderiliyor', sent_at=now() WHERE key=$1 AND ok=false
   AND error LIKE 'Yeniden denenecek:%' RETURNING id`. No row returned → `skip` (another run won).
7. `sendEmail({ from: resolveFrom(notify.from), to, subject, html, text, idempotencyKey: "haftalik-" + week.id },
   { timeoutMs: min(WEEKLY_SEND_MS, deadlineAt − Date.now() − 300), attempts: 1 })`.
8. Result:
   - ok → `UPDATE … SET ok=true, error=null, sent_at=now()`; upsert `haftalik.gecmis` (add the week with the item keys,
     `pruneHistory` to 8 weeks); `logActivity(null, "Haftalık özet (otomatik)", "{subject} → {n} adres")`; `sent`.
   - failure with `uncertain` → `error='Gönderim belirsiz: {msg}'`; `uncertain`.
   - other failure → `error='Yeniden denenecek: {msg}'`; `retry`.
   A failing log write after a successful send leaves `Gönderiliyor` → next day `unknown` → no resend (at most once).

`sendWeeklySampleTo(me, now)`: `buildWeekly(now, { budgetMs: 6_000 })` (`allFailed` → `UserError("Özet hazırlanamadı:
hiçbir bilgi okunamadı. Biraz sonra yeniden deneyin.")`), `renderWeekly(summary, { today, sample: true })`, send to
`[me.email]` only with `idempotencyKey: "haftalik-ornek-" + Date.now()` and `{ timeoutMs: 10_000, attempts: 1 }`, insert
`notification_log` `haftalik-ornek:{ms}` (ok / error), never touches the claim or `haftalik.gecmis`.

`loadWeeklyPanel(now)`: settings, admin names (from `weeklyRecipients`), the week's row and the last `ok` row
(`key LIKE 'haftalik:%'`) → `weeklyStatusText`.

### 5.7 Server actions — `src/server/actions/weekly.ts` (`"use server"`)

All use `attempt`, `requireAdmin`, zod; reads of the clock come after `requireAdmin()`.

- `saveWeeklyEnabled(enabled: boolean)`: `z.boolean()`; `saveWeeklySettings({ enabled, by: me.name, at: ISO })`;
  `logActivity(me, "Haftalık özet", enabled ? "açık" : "kapalı")`; `refresh()`; returns `null`. No step-up (it affects
  no admin; adminstepup rules).
- `previewWeekly()`: `buildWeekly(new Date(), { budgetMs: 6_000 })` → `renderWeekly(…)` → `{ subject, html, items,
  failed: failed.map(s => SOURCE_LABELS[s]), empty }`. Writes nothing, no `refresh()`.
- `sendWeeklySample()`: `isEmailConfigured()` else `UserError("E-posta kurulmamış (RESEND_API_KEY); önizleme yine
  çalışır.")`; `sendWeeklySampleTo(me, new Date())`; send failure → `UserError(res.error)`; `logActivity(me, "Haftalık
  özet örneği", "{n} madde → {email}")`; `refresh()` (the row appears in "Son gönderimler"); returns `{ to, items }`.

### 5.8 Cron route — `src/app/api/cron/gunluk/route.ts` (shared; additive)

```ts
export async function GET(request: NextRequest) {
  const denied = await rejectUnlessCron(request);
  if (denied) return denied;
  const jobStart = Date.now();                       // başlıklar okunduktan sonra (Cache Components)
  const runId = await startJobRun("gunluk");
  …                                                  // sync ve extras() aynen
  const weekly = () =>
    runWeeklyStep(new Date(), { deadlineAt: jobStart + WEEKLY_DEADLINE_MS })
      .catch((e: Error): WeeklyRunResult => ({ status: "error", weekday: 0, error: e.message }));
  try {
    const result = await runReminderDigest("cron", { syncedToday: … });
    const [ex, wk] = await Promise.all([extras(), weekly()]);
    outcome = dailyOutcome({ sync: syncStep, digest: digestStep(result), ...ex.steps, weekly: weeklyStep(wk) });
    return NextResponse.json({ ...result, sync, ...ex.body, weekly: wk.status }, { status: result.status === "error" ? 500 : 200 });
  } catch (e) {
    const [ex, wk] = await Promise.all([extras(), weekly()]);
    outcome = dailyOutcome({ sync: syncStep, digest: { code: "error", error: (e as Error).message }, ...ex.steps, weekly: weeklyStep(wk) });
    …
  }
}
```

The weekly step runs after the digest (so `sentToday` sees the digest's keys, §8) and beside `extras()`. Header comment
gains: "Pazartesi (gönderilemezse salı, çarşamba) yöneticilere haftalık özet (docs/HAFTALIK-OZET.md)."

### 5.9 Shared additive edits

- **`src/server/notify/resend.ts`**: `sendEmail(msg, opts: { timeoutMs?: number; attempts?: number } = {})`, defaults
  15 000 / 3 (today's behaviour, `src/server/notify/resend.ts:50-86`). The failure result gains `uncertain?: true` when the last attempt
  threw (timeout, network) or got HTTP 409.
- **`src/server/notify/digest-template.ts`**: `export function emailLayout(o: { …; footer?: string })` (default = today's
  footer text, byte-identical), `export const esc`, `export const FONT`. `renderDigest` and `renderSystemAlert` unchanged.
- **`src/lib/job-health.ts`**: `DailyStep` += `"weekly"`; `dailyOutcome(steps: Record<Exclude<DailyStep, "weekly">,
  StepResult> & { weekly?: StepResult })`; `order` appends `"weekly"` and skips missing keys when building `steps`;
  `STEP_NAMES.weekly = "Haftalık özet"`; `STEP_LABELS.weekly` (§3.5). `stepFailed` unchanged (only `error` fails).
  CRITIQUE2 should make every second-batch step (`forecast`, `photos`, `count`, `weekly`) optional the same way.

---

## 6. Time budget (inside `maxDuration = 60`)

| Phase | Typical | Worst | Note |
|---|---|---|---|
| `startJobRun` | 0,2 s | 1 s | |
| Paraşüt retry ∥ tahmin weather | 0 s (07:00 job synced) | 35 s | `deadlineMs: 35_000` |
| Morning digest (incl. Resend) | 2–4 s | ~8 s | `loadModel` + small queries |
| `extras()` ∥ **weekly** | 8 s | 15 s (fotograf sweep `deadlineMs: 15_000`) | weekly ≤ 4 s collect + ≤ 4 s send, inside |
| `finishJobRun` | 0,2 s | 1 s | |

- Weekly hard deadline `jobStart + 52 s`; it starts only if `deadlineAt − now ≥ 9 s` (latest start 43 s). Collect
  budget `min(4 s, remaining − 4,5 s)`; send timeout `min(4 s, remaining − 0,3 s)`, one attempt.
- Normal Monday: digest done at ~4 s, weekly done at ~6–7 s, extras at ~12 s → job ~13 s, the weekly adds ~0 s.
- Monday with a 35 s Paraşüt retry: weekly would start at ~40 s → ≥ 9 s left → runs; at ~44 s or later → `late` →
  Tuesday.
- Nothing is precomputed: the heaviest read is one `loadModel()` (~20 small parallel queries, < 1,5 s), shared by the
  five model-based collectors; `priceLoss`, `buildCashPlan`, `consistency`, `computeOccupancy` are pure and take
  milliseconds; the forecast is read from tahmin's loader (its snapshot is written earlier by the same job). Pool size
  (`DB_POOL_MAX` 5) queues ~50 small queries in well under a second.

---

## 7. Idempotency, retries and the panel state

| Situation | What happens |
|---|---|
| Monday 08:0x, nothing sent | claim → send → `ok`; `haftalik.gecmis` gets the week |
| Double cron delivery / two runs | the second `INSERT … ON CONFLICT DO NOTHING` returns nothing → skip |
| Resend answers 4xx/5xx (not 409) | `Yeniden denenecek: …` → Tuesday re-claims with `UPDATE … WHERE error LIKE 'Yeniden denenecek:%'`, same `Idempotency-Key` |
| Timeout, network error, 409 | `Gönderim belirsiz: …` → never retried; panel says "yarıda kaldı"; the owner can send themselves a sample |
| Function killed mid-send | row stays `Gönderiliyor` → after 5 min `unknown` → not retried |
| Too late on Monday | `late` (no claim) → Tuesday, then Wednesday; Wednesday `late` → step error, week skipped |
| Job did not run Monday | Tuesday finds no row → sends (the job-health alerts already reported Monday) |
| `db:reset` on Monday after the send | `notification_log` emptied, `haftalik.gecmis` kept → `weekSent` → skip |
| Switch turned on Thursday | next Monday (eligible days are Mon–Wed) |

---

## 8. Relation to the morning e-mail (no duplicate content on Monday)

- Both e-mails go on Monday; they have different recipient lists (digest: notification addresses; weekly: admins) and
  different scopes:
  - **morning e-mail:** today's rows (payments due, new invoices, review count, price holds, new price rises with their
    ₺/ay, system problems, yesterday's checklists, new commission alerts, today's forecast);
  - **weekly:** one line per topic with the money at stake over the week/month, never a payment or invoice list,
    never system or hold items, never "today's" facts.
- Exact duplicates are removed by `newsKeys`: an item whose facts were all first e-mailed **today** by the digest is
  dropped (`komisyon:{alertKey}`; `kontrol:{day}` when every contributing day is in today's digest). Example: a payout
  that became late this morning is told by the digest, not repeated by the weekly; the next Monday it is in the weekly
  if still open.
- A price rise announced in today's digest can also feed the weekly `zam` line: the digest lists the rise and its ₺/ay
  per ingredient; the weekly gives the single biggest product loss among unresolved prices. These are different facts
  (news vs. still-unpriced burden) and the weekly line exists only while the product still needs a new price.
- `renderDigest`, its subject precedence (R5) and the bell groups are untouched.

---

## 9. Previews, local dev, KVKK, security

- **Vercel previews:** crons run only on production; `CRON_SECRET`, `resend_api_key`, `AUTH_SECRET` are Production only
  (ops §0.1) → no cron call, no login, no action. `runWeeklyStep` also requires `isProductionRuntime()`, so even a
  manual call cannot claim a week in the shared production DB.
- **Local dev:** the automatic step is skipped (not production). "Haftalık özeti önizle" works on local data without
  Resend. "Örneği bana gönder" works only with a local `RESEND_API_KEY` and goes only to the logged-in admin's address
  (the local admin comes from `.env.local` `ADMIN_EMAIL`). To exercise the cron path once, the implementer runs `npm run
  dev` with `VERCEL_ENV=production CRON_SECRET=…` on a Monday against the worktree DB (`laffogato_haftalik`, R3), as
  ops' manual checks do; otherwise the decision logic is covered by unit tests with fixed clocks.
- **KVKK:** no customer data (karaoke works on aggregates; site orders are never read), no staff names (builders never
  receive them), recipients are admins only, no attachments, no Blob/photo URLs. Resend already processes the morning
  and kasa e-mails, so there is no new processor.
- **Security:** actions are admin-only; the preview HTML is rendered on the server from escaped text and shown in an
  `iframe sandbox=""`; e-mail links point only to `APP_URL` panel paths, which still require login (`src/proxy.ts`).

---

## 10. Sources: modules and fallbacks

| Source (plan) | Module / function used | If absent or failing |
|---|---|---|
| insight (batch 1) | `loadPriceAlerts(model)` → `loss: PriceLoss`, `actionable`; `salesBasis(model, month)`; `loadCashPlan(model)` → `plan.opening`, `plan.firstNegative`; `priceAlert` | no `loss` → `zam:fiyat` plain item; no cash plan → no `nakit` item; no `salesBasis` → `kasa-fiyat` plain only |
| kdv (batch 1, in insight's branch) | KDV rows inside `loadCashPlan` | plan without KDV; nothing else changes |
| kasa (batch 1) | `carryChecks`, `cashRevisionsFor`, `historyOf` | kasa item shows only shortages |
| menu (batch 1) | `loadPosChecklist()` (`posPendingSummary()` for the count) | no `kasa-fiyat` item |
| ops (live) | `isProductionRuntime()`, job-health step plumbing | — (on main) |
| pricing, today, vkn, adminstepup | not used (holds and Bugün rows are daily surfaces; vkn only improves grouping that komisyon already uses; step-up not needed) | — |
| komisyon | `loadCommissionReport({ months: 4 })`, `commissionAlerts`, `MEAL_LIMIT`, `channelDef` | no `komisyon` item |
| fotograf | `cashReportPhotoInfo`, `suspiciousDiffs` | no "fotoğraftan farklı" flag |
| doluluk | `readKaraokeHours`, `loadOccupancySessions`, `resolvePeriod`, `periodBounds`, `computeOccupancy`, `emptiestBlock`, `insightLines`, `weekdayRange`, `hourRangeLabel` | no `karaoke` item |
| kontrol | `loadHistoryDays`, `listTitle`, `lowerFirst` | no `kontrol` item |
| tahmin | `loadForecastCore(now)` | no forecast line |
| siparis | **not used in v1**: delivery price differences duplicate the `zam` signal and open deliveries stay on Bugün and the bell until closed | follow-up: `teslim` item from `loadOrders` + `deliveryDayFacts` |
| mcp | consumer only | follow-up: an MCP tool could return `buildWeekly().summary` |
| existing code | `cashReportsBetween`, `CASH_TOLERANCE`, `businessDate`, `loadModel`, `consistency`, `latestSalesMonth`, engine `wasteSummary` rule, `productLabel`, `loadNotifySettings`, `sendEmail`, `isPendingInvite` | — |
| supplier debts (`loadSupplierLedger`) | **not used**: an overdue payable is not a loss, its amount would dominate the ranking, and the Ödemeler badge and the digest already show it | — |
| site online sales (`src/lib/site-sales/*`, other session) | **not used**: monthly records only, no weekly figure | — |
| ModPOS daily product export (seam) | nothing to do: when insight's basis or tahmin start using daily data, the zam, kasa-fiyat and forecast lines follow | — |

---

## 11. Files

**New**

| File | Content |
|---|---|
| `src/lib/weekly/core.ts` | §5.1 |
| `src/lib/weekly/items.ts` | §5.2 |
| `src/lib/weekly/text.ts` | §5.3 |
| `src/server/notify/weekly-template.ts` | §5.4 (pure) |
| `src/server/weekly/collect.ts` | §5.5 (server-only) |
| `src/server/weekly/send.ts` | §5.6 (server-only) |
| `src/server/actions/weekly.ts` | §5.7 |
| `src/app/panel/hatirlaticilar/weekly-row.tsx` | `"use client"`: §3.4 row, preview `Sheet` (from `./sheet`), toasts |
| `tests/haftalik-ozet.test.ts` | §13 |
| `docs/HAFTALIK-OZET.md` | §12 |

**Changed**

| File | Change | Shared with |
|---|---|---|
| `src/app/api/cron/gunluk/route.ts` | §5.8 | ops, tahmin, fotograf, siparis, mcp |
| `src/lib/job-health.ts` | §5.9 | ops, tahmin, fotograf, siparis |
| `src/server/notify/resend.ts` | §5.9 | everyone who e-mails |
| `src/server/notify/digest-template.ts` | export `emailLayout` (+ `footer`), `esc`, `FONT` | ops, pricing, insight, komisyon, kontrol, tahmin |
| `src/app/panel/hatirlaticilar/page.tsx` | `loadWeeklyPanel(now).catch(() => null)` in the `Promise.all` (clock after `requireAdmin()`); prop `weekly`; `export const maxDuration = 30` with comment "Haftalık özet önizlemesi ve örnek gönderimi (en çok ~16 sn)" | — |
| `src/app/panel/hatirlaticilar/reminders-client.tsx` | prop `weekly`, passes `<WeeklyRow …/>` to `NotificationsSection` | insight ("Nakit planı" button) |
| `src/app/panel/hatirlaticilar/notifications-section.tsx` | optional `weekly?: ReactNode`, rendered after the "Hatırlatma e-postaları" row | — |
| `src/components/panel/nav.ts` *(optional)* | `NAV_GROUPS` "Ödemeler & hatırlatıcılar" keywords += ` haftalık özet` | today, insight, menu, … |
| `src/app/panel/yardim/page.tsx`, `README.md`, `docs/BILDIRIMLER.md` | §12 | everyone |
| `tests/gunluk-isler.test.ts`, `tests/hatirlaticilar-digest.test.ts` | §13 | ops |

Not touched: `src/server/db/schema.ts`, `drizzle/*`, `vercel.json`, `renderDigest`, `src/server/actions/notifications.ts`
(bell), `src/app/panel/page.tsx`, Bugün, `roles.ts`, other plans' modules.

---

## 12. Docs and Yardım

- **`docs/HAFTALIK-OZET.md` (new):** what and when (Monday 08:00–09:00 Istanbul, retries Tue/Wed); recipients; the
  item table of §3.2 (source, rule, ₺, link); ranking and limits (5, 2 plain, 1 kept); context lines; repeat rules;
  relation to the morning e-mail; idempotency (`haftalik:{week}`, markers, `haftalik.gecmis`); time budget; settings,
  preview, sample; previews/local; KVKK; "yeni kaynak eklemek: bir builder + bir collector + testler".
- **`docs/BILDIRIMLER.md`:** new section `## Haftalık özet (pazartesi)` (five lines + link to HAFTALIK-OZET.md); in the
  Günlük işler / Sistem uyarıları part, the `weekly` step and its words.
- **`README.md`:**
  - Ödemeler row: `Ödemeler & hatırlatıcılar (Son ödenenler: 30 gün içinde geri alma; e-posta bildirimleri ve pazartesi
    haftalık özet)`.
  - Günlük işler row: add `pazartesi yöneticilere haftalık özet (docs/HAFTALIK-OZET.md)`.
  - Source tree: `lib/weekly/ haftalık özet: hafta, sıralama, maddeler (saf, testli)`; `server/weekly/ haftalık özet:
    kaynaklar ve gönderim`; `notify/` line: `sabah e-postası, haftalık özet ve Resend gönderimi`.
  - `db:reset` "Silmedikleri": `…, haftalık özetin ayarı ve geçmişi`.
- **Yardım** (`src/app/panel/yardim/page.tsx`), group "Bilinmesi gerekenler", after `gunluk-isler`:

  ```tsx
  {
    id: "haftalik-ozet",
    q: "Pazartesi gelen haftalık özet nedir?",
    a: (
      <>
        Her pazartesi sabah 08:00–09:00 arasında yöneticilere kısa bir e-posta gider: geçen haftanın ve bekleyen işlerin en
        önemli en çok 5 maddesi, kasanıza etkisine göre sıralı (zam, nakit planı, kasa farkı, komisyon, ModPOS fiyatları,
        zayi, stok farkı; karaoke doluluğu ve kontrol listeleri sonda). Her madde ilgili ekranı açar. Bir bilgi okunamazsa o
        madde atlanır, e-posta yine gider. Açıp kapatmak, önizlemek ve kendinize örnek göndermek için{" "}
        <Path href="/panel/hatirlaticilar" /> › E-posta bildirimleri › Haftalık özet.
      </>
    ),
    icon: Newspaper,
    links: [{ href: "/panel/hatirlaticilar", label: "E-posta bildirimleri" }],
  },
  ```

  (`tests/yardim.test.ts`: `<Path>` is a nav-tree screen and the previous line ends with `{" "}`.)

---

## 13. Tests

**`tests/haftalik-ozet.test.ts`** (new; `npx tsx --test tests/haftalik-ozet.test.ts`; fixed dates, no DB):

1. `weekInfo`: `2026-10-26` → weekday 1, `2026-W44`, last `2026-10-19…2026-10-25`, prev `2026-W43`; `2026-10-28` →
   weekday 3; `2026-12-28` → `2026-W53`; `2027-01-04` → `2027-W01`, last `2026-12-28…2027-01-03`. With `businessDate`,
   `2026-10-26T01:30:00Z` (04:30 Istanbul) is still Sunday → W43.
2. `weekRangeText`: `19–25 Ekim`, `26 Ekim – 1 Kasım`, `28 Aralık 2026 – 3 Ocak 2027`.
3. `selectItems`: the five examples of §5.1; ties by `VALUED_ORDER`; one per source; a 99 ₺ valued item dropped;
   `newsKeys` all sent today → dropped, some → kept; `once` seen → dropped; plain seen last week → dropped, two weeks
   ago → kept; valued seen last week → kept.
4. `claimStateOf`: null → free; ok → sent; `Yeniden denenecek: x` → retry; `Gönderiliyor` 2 min → busy, 10 min →
   unknown; `Gönderim belirsiz: x` → unknown.
5. `weeklyDecision`: not production → skip; Thursday → skip; disabled Monday → off; no Resend → nokey; week sent → skip;
   `now = deadlineAt − 8 s` → late; enough time → run.
6. `weeklyStep`: sent; off on Monday vs. Tuesday (undefined); late Monday → `late`, Wednesday → error text; retry and
   uncertain texts; skip → undefined.
7. Builders:
   - `zamItem`: Latte M + Latte L summed; Süt pair beats Kahve; title `Latte: Süt %2,5 zammı ayda ≈ 4.800 ₺ kâr kaybı`
     (NBSP before ₺); total/product count/basis month in the detail; a non-actionable product is not in the input;
     pair 80 ₺ → null; `basisMonth` null with 3 actionable → plain `Hammadde zammı: 3 ürünün fiyatına bakın`.
   - `cashItem`: no opening → null; `staleDays` 9 → null; negative day at +14 → null, at +6 → title with U+2212, top 2
     outflows, ` · bakiye 5 gün önce girildi` at 5 days, not at 2.
   - `kasaItem`: −300 (Mon), −340 (Fri), +50 (Sat), −0,5 (tolerance) → `Kasa geçen hafta 2 gün eksik: toplam 640 ₺` and
     `En çok 23 Ekim Cuma: 340 ₺ · 1 gün fazla: 50 ₺`; one day → `20 Ekim Salı kasası 640 ₺ eksik`; flags only →
     `Geçen hafta kasa: 2 gün açılış devirle tutmuyor`; flags `null` → no flag text; link month of the worst day.
   - `salesLine`: 7 reports 68.900 vs. previous full weeks averaging 78.300 → `… · önceki 4 haftaya göre %12 az`; 5
     reports → `(5 gün raporlu)`, no comparison; one previous full week → no comparison; |Δ| 1 % → `önceki 4 haftayla
     aynı`; no reports → null.
   - `commissionItem`: late payout 8.605,20 ₺ → `Hakediş gecikti: Pluxee (Ekim) · ≈ 8.605 ₺`, href
     `/panel/komisyonlar?ay=2026-10#pluxee`, `newsKeys` `["komisyon:gecikti:pluxee:2026-10"]`; over-limit 26 ₺ → null;
     unknown expected → plain; the biggest of three wins and the detail says ` · 2 konu daha`.
   - `posPriceItem`: Latte M panel 195, POS 185, 310 adet/ay, kdv 0,10 → `ayda ≈ 2.818 ₺`; a decrease counts in n only;
     no `perMonth` and oldest 4 days → plain; 2 days → null.
   - `wasteItem`: 900 vs. average 400 → item; 500 vs. 400 → null; 250 → null; no history → `önceki 4 haftada kayıt yok`.
     `wasteCost` over a whole month equals `model.wasteSummary(month)` zayi + ikram cost (Excel fixture as in
     `tests/price-impact.test.ts`).
   - `stockItem`: 6.200 → `Ekim sayımında 6.200 ₺ açıklanamayan stok farkı`, `once`; 400 → null; not comparable → null.
   - `karaokeItem`: block `Salı–Perşembe 14–17` 0,12 → `Salı–Perşembe 14–17 karaoke %12 dolu`; 0,30 → null; not ready →
     null.
   - `checklistItem`: 2 missed "Kapanış" → `Geçen hafta 2 kapanış listesi yapılmadı`; mixed → `Geçen hafta 3 kontrol
     listesi yapılmadı`; issues only → `Geçen hafta kontrol listelerinde 2 sorun`; a day without a kasa report is skipped
     and named in the detail; the fixture's person names never appear; `newsKeys` = contributing days.
   - `forecastLine`: `tam` → `Önümüzdeki 7 gün beklenen satış ≈ 72.000 ₺ · en yoğun gün Cumartesi`; `ay` → null.
8. `renderWeekly`: subject with 5 items ends ` · +4 madde`, with 1 item has no suffix, with 0 items is `Haftalık özet:
   bu hafta dikkat isteyen bir şey yok`, sample starts `Örnek · `; HTML has `{APP_URL}{href}` twice per item (title and
   action), escapes `<`, has the custom footer; text version numbers the items with URLs; failed sources produce
   `Bu hafta okunamadı: nakit planı, karaoke doluluğu.`; 0 items → the calm line.
9. `weeklyStatusText`: every branch of §3.4.
10. Source checks (`readFileSync`): `src/server/weekly/*.ts` start with `import "server-only"`; `weekly-template.ts`
    does not; `weeklyRecipients` filters `role` admin and calls `isPendingInvite`; all three actions call
    `requireAdmin`; the cron route calls `runWeeklyStep` inside a `Promise.all` with `extras()` and passes `deadlineAt`;
    no file under `src/lib/weekly/` imports from `@/server`.

**`tests/gunluk-isler.test.ts`** (extend): `weekly: {code:"error", error:"…"}` → run `partial`, message `Haftalık özet:
…`; `weekly` undefined → `steps` has no `weekly` key and the existing expectations stay identical; `late` → `ok`;
`stepTexts({ weekly: "sent" })` → `Haftalık özet gönderildi`.

**`tests/hatirlaticilar-digest.test.ts`** (extend): `emailLayout` without `footer` renders today's footer text; with
`footer` renders the given one; every existing `renderDigest` test passes unchanged.

Before merging: `npx next typegen && npx tsc --noEmit`, `npx eslint . --ignore-pattern '.claude/**'`, `npm test`, empty
DB `npm run db:migrate && npm run db:seed`. Manual, on `laffogato_haftalik` (R3): raise an ingredient price in
Hammaddeler (Excel September sales give a basis), enter a week of kasa reports with two shortages as admin, add zayi
entries; open Ödemeler › E-posta bildirimleri at 390 px and 1440 px; preview; toggle; sample (with a test Resend key if
available). After the first production Monday: Ayarlar › Günlük işler shows `Haftalık özet gönderildi`; the e-mail on
a phone: every link opens its screen (logged in, and after the login redirect).

---

## 14. Edge cases

- **New café, little data:** sources without data return nothing; 0–2 items are sent as they are; the quiet e-mail
  still has the kasa line when reports exist.
- **Café closed days:** kasa shortages count only reported days; kontrol skips days without a kasa report and says so.
- **Price raised in the panel but not yet in ModPOS:** that is exactly the `kasa-fiyat` item; once marked "Kasaya işle"
  it disappears.
- **Owner answered "Şimdilik böyle kalsın" for a product:** not actionable → excluded from `zam`.
- **Stale reference sales month** (sales report not uploaded for months): the zam detail names the month ("Eylül 2026
  satışlarıyla").
- **Cash plan balance old:** > 7 days → no `nakit` item (the projection is not trusted); 4–7 days → item with the age.
- **Month boundary in the week** (e.g. 26 Ekim – 1 Kasım): kasa link goes to the worst day's month; zayi link to the
  month of last Sunday.
- **Stock difference** is shown once (key `stok:{month}`); a later recount of the same month does not repeat it.
- **Same karaoke empty block every week:** shown every other week (plain items never two weeks in a row).
- **Two admins:** one e-mail with both addresses (as the digest does with its list).
- **Admin with an invalid e-mail:** Resend 422 → `retry` Tuesday and Wednesday, each day the run is `partial` and the
  bell tells the owner.
- **Login redirect drops `#zamlar`/`#pluxee`:** `src/proxy.ts` keeps `pathname + search` only; the page still opens,
  without scrolling to the card. Query parameters (`?ay=`, `?sekme=`) survive.
- **Preview on Thursday:** shows what the Monday rules would pick for the current week (history relative to the
  previous week).

---

## 15. Risks and integration notes (for CRITIQUE2)

- **Cron route is the busiest shared file** (ops, tahmin, fotograf, siparis, mcp, haftalik). All additions are additive
  and `.catch`ed. CRITIQUE2 should (a) make every new `DailyStep` optional in `dailyOutcome` (this plan does it for
  `weekly`), (b) re-check the whole timeline: fotograf's 15 s sweep makes `extras()` up to 15 s; the weekly's own
  deadline (`jobStart + 52 s`) protects it regardless.
- **Other plans' exact shapes may move** (insight `PriceLoss.products[].drivers[].monthly`, menu `loadPosChecklist` row
  fields, kasa `historyOf` location, komisyon alert keys, kontrol `ChecklistLite.runs`, doluluk helpers). The narrow
  builder inputs (§5.2) confine each change to one mapping in `collect.ts`. CRITIQUE2 pins the names.
- **Digest keys used for de-duplication:** `komisyon:{alertKey}` (komisyon §6.5) and `kontrol:{day}` (kontrol §3.8). If
  either plan changes its key format, update `newsKeys` in the collector (tests pin the format).
- **`salesBasis` POS-only quantity:** if insight exports a POS-only per-product map, use it instead of
  `soldByProduct(month) × scale`; the result is the same rule.
- **insight owner decision 7** ("para yetmeyecekse e-posta uyarısı yok, v1"): the weekly includes the cash shortfall only
  with a balance entered in the last 7 days and a negative day within 14 days (owner question 2).
- **Uncertain sends lose a week** (rare, Resend p99 ≪ 4 s); the panel row and Günlük işler show it, and the owner can
  send themselves a sample.
- **Repetition fatigue:** valued items repeat while unresolved by design; if the owner finds it noisy, the plain-item
  rule can be extended to valued ones (one constant).
- **Shared UI files:** `reminders-client.tsx` (insight adds a header button) — rebase carefully; the weekly change is one
  prop pass-through. `notifications-section.tsx` gets only an optional slot.

---

## 16. Owner decisions (defaults implemented; nothing blocks)

1. **Recipients:** only admin users (their login e-mails); the notification address list does not get it. *Default:
   yes.*
2. **Cash warning in the weekly:** include "para yetmeyebilir" when the balance was entered in the last 7 days and the
   first negative day is within 14 days. *Default: yes.*
3. **Quiet weeks:** still send one short e-mail ("bu hafta dikkat isteyen bir şey yok"). *Default: yes.*
4. **Size:** at most 5 items, items without a lira value at most 2 and at the end. *Default: this.*
5. **Retry:** Tuesday, then Wednesday; after that the week is skipped. *Default: this.*
6. **Forecast line** ("Önümüzdeki 7 gün beklenen satış"): *Default: shown when the forecast has its own data.*
7. **Default on** right after deploy. *Default: on.*

---

## 17. Implementation order

1. `src/lib/weekly/core.ts`, `text.ts` + tests (week math, selection, claims, decision, step mapping, status text).
2. `src/lib/weekly/items.ts` + tests (one builder at a time, fixtures from §13).
3. Shared additive edits: `resend.ts` options, `digest-template.ts` exports, `job-health.ts` step + their tests.
4. `weekly-template.ts` + tests.
5. `src/server/weekly/collect.ts`, `send.ts`; `src/server/actions/weekly.ts`.
6. Cron route integration.
7. Panel row (`weekly-row.tsx`, slot, page data, `maxDuration`).
8. Docs, Yardım, README; optional ⌘K keyword.
9. Full verification (§13), then merge as the last group of the second batch.
