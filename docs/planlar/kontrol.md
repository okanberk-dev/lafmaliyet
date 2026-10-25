# Plan: Kontrol listeleri (fotoğraflı açılış / kapanış) — group `kontrol`

Owner's words: "Fotoğraflı açılış ve kapanış listeleri olsun; hepsi Bugün ekranında görünsün."
Base: `claude/oneriler` (= origin/main 71ac11f) plus the batch-1 plans (`today.md`, `ops.md`, … per CRITIQUE §5).
Hard dependency: the `fotograf` group's photo storage (planned in parallel; interface consumed as given, §11).
Next.js 16.4 (cacheComponents), Drizzle 0.45, Turkish UI.

---

## 0. Summary and scope

Staff (and the admin) fill an **Açılış** list in the morning and a **Kapanış** list at night on the phone: tick items,
type the fridge temperature (an out-of-range value asks for a note), take the photos the list asks for. Each answer is
saved the moment it is given. **Bugün** shows every list as a row (progress, overdue, done by whom) that opens the list.
The admin edits the lists (items, types, ranges, time window, weekdays), sees a per-day **history** (who, when, missing
items, out-of-range values, photos) and gets a **bell** item and a **morning e-mail line** when a list was not completed
or a value was out of range. Photos are kept **60 days**; the records themselves are kept.

Schema: 4 new tables (`checklist_templates`, `checklist_items`, `checklist_runs`, `checklist_answers`), one migration.
New dependencies: none (photo storage and `@vercel/blob` belong to `fotograf`).

**Phases inside this group**

- **Phase 1 (the ask):** daily lists with time windows, the phone flow with photos, Bugün rows, admin editor, history,
  bell, e-mail line, seeds "Açılış" and "Kapanış".
- **Phase 2 (cuttable, §3.9):** "Her seferinde" lists (one record per event: karaoke room reset after a session, goods
  receiving). Seeded **passive**. The Phase 1 schema already carries `schedule` and `seq`, so cutting Phase 2 needs no
  later migration. If cut: do not seed the two event templates and hide the "Ne zaman" choice in the editor.

Deferred (follow-ups, not in this group): monthly Excel export of the records for an inspector, push notifications,
a "kafe kapalıydı" day marker, a link from the karaoke "Bitir" button to the room-reset list.

---

## 1. Goal

A small café + karaoke box must be able to show an inspector (Gıda Hijyeni Yönetmeliği expects HACCP-based records
proportionate to the business) that the fridge was within range, the place was cleaned, the microphones were cleaned,
and who did it when, with photos for the visible states. Today nothing is recorded. After this change:

- the records are created as a side effect of the normal opening / closing routine, on the phone, in about two minutes;
- the owner sees on Bugün and in the bell whether today's lists are done, late, or have a problem;
- a missed list or a bad temperature reaches the owner the next morning by e-mail even if nobody opens the panel;
- the owner can change the lists without a developer.

(The seed items are a sensible starting point, not legal advice; §13 asks the owner to have them reviewed.)

---

## 2. Decisions (made here so the implementer does not re-decide)

1. **Template → run → answer.** A *template* (Açılış) has *items*. The first answer of the day creates the day's *run*
   and copies the template's active items into it (`checklist_runs.items`, a jsonb snapshot with label, type, range,
   required…). Progress, missing items and range checks always use the run's snapshot. Editing a template never changes
   a run that has started; it applies from the next run. HACCP records stay exactly as they were filled.
2. **Business day = cash report day.** The day turns at 05:00 Türkiye time (`businessDate()` in
   `src/lib/cash-report.ts`). A list's run belongs to `businessDate(now)`. The closing list filled at 01:30 belongs to
   the previous calendar day, like the cash report.
3. **Time window per daily list.** `opensAt` and `dueAt` are clock times (`"08:00"`, `"02:00"`). They are compared in
   *business minutes* (minutes since 05:00), so `22:00 → 02:00` is a valid window and `04:00 → 06:00` is not
   (it would cross the day boundary). The window drives status only: a list can be filled at any time of its business
   day. Before `opensAt` it is "Sonra"; from `opensAt` it is "Yapılacak"; after `dueAt` it is "Gecikti" (still
   fillable); after 05:00 it is "Yapılmadı" (history).
4. **No back-filling.** Nobody (admin included) can answer a past business day's list. Grace: a run that already
   exists can still be answered until 05:30 (`ANSWER_GRACE_MIN = 30`), so a closing list finished at 05:01 is not lost.
   Answers can be changed or undone until the day closes; a changed value keeps the earlier value in the answer's
   `history` (the first out-of-range reading is never lost).
5. **Who may fill.** Every active list can be filled by the admin. A template flag `staffAllowed` (default on,
   "Personel doldurabilir") lets staff fill it; off = admin-only list, hidden from staff everywhere. Several people may
   fill the same list at the same time; each answer records who and when. "Done by whom" = the people who answered.
6. **Completion is automatic.** A run is complete when every *required* item of its snapshot has an answer. No "Bitir"
   button. `completedAt` / `completedByName` are written when the last required answer arrives (and cleared if a
   required answer is undone).
7. **Item types.** `check` (Tamam, or "Sorun var" with a mandatory note), `photo` (one photo; retake replaces it),
   `number` (value + unit, optional `min` / `max`; outside the range the status is `issue` and a note is mandatory),
   `text` (short note, ≤ 300 chars). Any item can be optional (`required = false`); optional items never block
   completion.
8. **Photos through a Route Handler, answers through Server Actions.** Next.js dispatches Server Actions one at a time
   per client (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`, "Sequential dispatch"). A 300 KB
   upload on a slow connection would make every tick wait behind it. So the photo goes to `POST /api/kontrol/foto`
   (parallel, `fetch`), which stores it with `fotograf`'s `savePhoto` and records the answer in the same request.
   Ticks, numbers and notes use the Server Action `answerChecklistItem`.
9. **Camera capture uses `<input type="file" accept="image/*" capture="environment">`**, not `getUserMedia`. The panel's
   `Permissions-Policy: camera=()` (next.config.ts) governs `getUserMedia`, not the OS camera opened by a file input,
   so the header stays as it is (verify on a real phone, §14). The image is compressed on the phone with
   `compressImage(file, { maxEdge: 1600, quality: 0.7 })` before upload.
10. **Photo retention 60 days** (`KONTROL_PHOTO_DAYS = 60`), set as `expiresAt` at upload; `fotograf`'s daily sweep
    deletes expired photos. The answer keeps `photoAt`, so history says "Fotoğraf çekildi · 60 günden eski olduğu için
    silindi". Answers, runs and notes are kept (tiny).
11. **Alerts are minimal.** Bell: admin gets late lists (today), incomplete lists (yesterday) and problems (today and
    yesterday); staff get "bekliyor / gecikti" for lists in their window. Morning e-mail: one section for yesterday's
    missing lists and problems, deduplicated per day. No push, no separate e-mail.
12. **A template applies to a day** only if the day's weekday is selected and the template was active when that day's
    window opened (`activeFrom` / `inactiveFrom` timestamps). Seeding or activating a list at 14:00 therefore does not
    raise "Açılış gecikti" the same day.
13. **Staff never see costs** — the feature has no money at all. Staff see only lists with `staffAllowed`, only today's
    business day, and only photos of today's and yesterday's runs. Staff never see the history or the editor.
    *Note (24 Oct 2026, wave 10 §2.5, `docs/planlar/personel-yetki.md`):* staff now see a read-only history of the last
    7 days (`/panel/kontrol/gecmis`) of the lists they can fill, from the day a list was opened to staff
    (`staff_since`), and the photos of those runs; the editor stays admin-only (`ADMIN_ONLY_PATHS`).
14. **Routes.** `/panel/kontrol` (today's lists, both roles), `/panel/kontrol/[id]` (fill one list, both roles),
    `/panel/kontrol/gecmis` and `/panel/kontrol/duzenle[/id]` (admin; `requireAdmin()` in the page). `STAFF_PATHS`
    gains `/panel/kontrol`, so the proxy lets staff reach the admin sub-URLs, and the pages redirect them — the same
    split the Kasa page already uses for its admin views.

---

## 3. User-facing behaviour (Turkish texts are exact)

Notation: `{list}` = `listTitle(name)` ("Açılış" → "Açılış listesi"; a name that already contains "liste" stays as
it is). `{list·}` = the same with a lower-case first letter ("açılış listesi"). `{n}` = required items in the snapshot
(or the template when there is no run), `{a}` = answered required items, `{p}` = required photo items, `{k}` = photos
still missing. Times are `HH:MM` Türkiye time. `{who}` = `whoText(contributors)`: "Ayşe", "Ayşe ve Mehmet",
"Ayşe, Mehmet ve Can", "Ayşe, Mehmet ve 2 kişi".

### 3.1 Navigation

| Where | Change |
|---|---|
| `NAV_GROUPS` › "Günlük" | after Kasa raporu: `{ href: "/panel/kontrol", label: "Kontrol listeleri", icon: ListChecks, roles: ["admin","staff"], keywords: "açılış kapanış kontrol listesi checklist temizlik hijyen buzdolabı sıcaklık derece haccp denetim fotoğraf mikrofon oda sıfırlama mal kabul" }` |
| `NAV_TREE` | top level, right after the staff-only `kasa` node: `{ id: "kontrol", label: "Kontrol listeleri", icon: ListChecks, href: "/panel/kontrol", roles: ["admin","staff"] }` |
| `SHORT_TITLES` | `"/panel/kontrol/gecmis": "Kontrol geçmişi"`, `"/panel/kontrol/duzenle": "Listeleri düzenle"` (`/panel/kontrol` and `/panel/kontrol/3` take the menu label "Kontrol listeleri") |
| `STAFF_PATHS` (`src/lib/roles.ts`) | add `"/panel/kontrol"` |
| Bottom bars | unchanged (staff reach the lists from Bugün rows, the bell and the drawer) |
| Admin tabs on the three admin-visible kontrol pages | `SegmentedLinks` (label "Kontrol listeleri sekmeleri"): **Bugün** `/panel/kontrol` · **Geçmiş** `/panel/kontrol/gecmis` · **Listeler** `/panel/kontrol/duzenle`. Not added to `SECTION_TABS` (the Yardım test requires every tab to resolve to a two-level menu path; this item is top level) |

### 3.2 Bugün (new source in `today.md`'s style)

New facts, rows and tests are added to `src/app/panel/bugun/logic.ts`, `src/server/data/today.ts` and
`tests/bugun.test.ts` exactly like the batch-1 integration rows (CRITIQUE "today" §1).

**Row keys:** `liste-{templateId}` (daily list, both roles), `liste-dun` (admin), `kayit-{templateId}` (Phase 2).
`DayTaskKey` gains `` `liste-${number}` | `kayit-${number}` | "liste-dun" ``.

**Order** (the screen still splits rows into Şimdi / Sonra / Tamamlananlar and keeps this order inside each):

- Admin: `isler`, `kasa-dun`, **`liste-dun`**, `odeme`, `fatura`, `urun`, `onay`, `fiyat-onay`, `zam`, `modpos`,
  `sayim-gecen`, **`liste-*` (by window opening)**, `kasa`, `sayim-son`, **`kayit-*`**.
- Personel: `kasa-dun`, `sayim-gecen`, **`liste-*` (by window opening)**, `zayi`, `kasa`, `sayim-son`, **`kayit-*`**.

At 08:30 the staff's "Sıradaki" is the Açılış list; at 23:00 it is the Kapanış list, before "Zayi / ikram" and the
cash report.

**`liste-{id}` (daily list; admin and staff).** Title `{list}`, href `/panel/kontrol/{id}`.

| State | Status | Badge | Detail | Action |
|---|---|---|---|---|
| Not started, before `opensAt` | `later` | `{opensAt}–{dueAt}` | `{n} madde, {p} fotoğraflı · {opensAt} – {dueAt} arası.` (", {p} fotoğraflı" only when p > 0) | `Listeyi aç` |
| Not started, window open | `todo` | — (Yapılacak) | `{n} madde, {p} fotoğraflı · son saat {dueAt}.` | `Listeyi aç` |
| Started (any answer, even before the window), not complete, before `dueAt` | `todo` | `{a} / {n}` | `{a} / {n} madde · {who} · son saat {dueAt}.` + ` {k} fotoğraf kaldı.` when k > 0 | `Devam et` |
| Not complete, after `dueAt` | `warn` | `Gecikti` | started: `{a} / {n} madde · son saat {dueAt} idi.`; not started: `Henüz başlanmadı · son saat {dueAt} idi.` Staff: + ` Gün 05:00'te kapanır.` | `Devam et` / `Listeyi aç` |
| Complete, no open problem | `done` | `Tamam` | `{who} · {completedAt}` + ` · geç` when completed after `dueAt` + ` · {photos} fotoğraf` when > 0 | `Listeye bak` |
| Complete, open problems — admin | `warn` | `{m} sorun` | `{who} · {completedAt} · {issue1}; {issue2}` (≤ 140 chars, `clip`) | `Listeye bak` |
| Complete, open problems — staff | `done` | `Tamam` | `{who} · {completedAt} · {m} sorun bildirildi` | `Listeye bak` |

Issue text: number → `{label}: {value} ({range})` ("Bar buzdolabı sıcaklığı: 6 °C (0–4 °C)"); check → `{label}: {note}`.
An open problem = an answer whose current status is `issue`. A corrected reading (6 °C → 3,5 °C) is not "open"; it
shows in history and the e-mail.

**`liste-dun` (admin only; yesterday's daily lists).** Only when at least one of yesterday's lists was not completed
or has a problem (corrected readings count here). `warn`, title `Dünkü kontrol listeleri`, badge `{x} eksik` (or
`{y} sorun` when nothing is missing), detail parts joined with ` · `:
`Kapanış: 3 madde yapılmadı` / `Açılış: hiç açılmadı` / `Bar buzdolabı sıcaklığı 6 °C (0–4 °C)` /
`Bar buzdolabı sıcaklığı 6 °C → 3,5 °C`. When yesterday has no cash report either, append
` · Kasa raporu da yok; kafe kapalıysa önemsemeyin.` Href `/panel/kontrol/gecmis?gun={yesterday}`, action
`Geçmişe bak`.

**Read failure.** `checklists === null` → one `later` row `liste`, title `Kontrol listeleri`, badge `Okunamadı`,
`Kontrol listeleri şu an okunamadı.`, href `/panel/kontrol`, action `Kontrol listeleri` (same pattern as kasa / ödemeler).

**Auto refresh.** Bugün's `nextRefreshAt(now)` gains `extra: number[] = []` (TR minutes of day). The page passes every
`opensAt` / `dueAt` of today's lists (`checklistBoundaries(facts)`), so a row turns "Yapılacak" at 08:00 and "Gecikti"
at 11:00 without a manual reload. `TodayRefresh` gets the list as a prop.

### 3.3 `/panel/kontrol` — today's lists (both roles)

`PageHeader`: eyebrow `Günlük`, title `Kontrol listeleri`, description `Açılışta ve kapanışta maddeleri tek tek
işaretleyin; sıcaklığı yazın, istenen yerde fotoğraf çekin. Her madde dokunduğunuz an kaydedilir.` Admin: the tabs
(§3.1) under the header. Suspense fallback `PageSkeleton rows={4}`.

One `Card` per list that applies today (daily lists by `opensAt`, then event lists). Staff see only `staffAllowed`.

- `CardHeader`: icon `ListChecks`, title `{list}`, `meta` = status `Badge` (green `Tamam`, amber `Gecikti` / `{m} sorun`,
  gray `Sonra`, blue `{a} / {n}`).
- Line 1: `{opensAt} – {dueAt} · {n} madde, {p} fotoğraflı`.
- `Progress` (`tone` green when complete, amber when late, ink otherwise) with `{a} / {n}`.
- Line 2 (when started): `{who} · ilk {firstAt}, son {lastAt}`; when complete `Tamamlandı {completedAt}`.
- `ButtonLink` (primary when it is the next thing to do, else secondary; `h-12` on phone): `Listeyi aç` / `Devam et` /
  `Listeye bak` → `/panel/kontrol/{id}`.
- Admin only, under the cards: muted line `Bugün olmayan listeler: Haftalık derin temizlik (Pzt) · Mal kabul (pasif)`.
- Empty: `EmptyState` title `Bugün için kontrol listesi yok`, description admin `Listeleri düzenle ekranından açılış ve
  kapanış listelerini açın.` + `ButtonLink` `Listeleri düzenle`; staff `Yönetici bir liste açınca burada görünür.`

### 3.4 `/panel/kontrol/[id]` — filling a list on the phone (both roles)

`PageHeader`: eyebrow `Kontrol listesi`, title `{list}`, description `{longDateTR(day)} · {opensAt} – {dueAt}`. The
template description, when set, is a muted paragraph under the header. `metadata.title = "Kontrol listesi"`.

Refusals (rendered instead of the form, `EmptyState`): inactive list `Bu liste kapalı.`; staff and `!staffAllowed` →
`redirect("/panel/kontrol")`; not scheduled today `Bu liste bugün yok.` (+ admin hint `Günleri Listeleri düzenle'den
değiştirebilirsiniz.`); no items `Bu listede madde yok.`

**Sticky progress bar** (pattern of the Sayım form: `sticky top-(--mobile-top-h) z-20 … backdrop-blur-md`):
`{a} / {n} madde` + ` · {k} fotoğraf kaldı` + `Progress`. When complete: `CircleCheck` + `Liste tamam`.
`role="status"`, `aria-live="polite"`.

**Completed banner** (top, green well, shown while complete): `Liste tamam · {completedAt} · {who}` and
`ButtonLink` `Bugün'e dön` → `/panel/bugun`. Items stay editable until the day closes. On the transition to complete
the client shows `toast.success("{list} tamam. Teşekkürler!")`.

**Items**, grouped under their `section` (`<h2>` small caps, e.g. "Bar", "Salon", "Karaoke odası"; items without a
section first). Each item is a `Card`-like row (`rounded-2xl ring-1 ring-line p-4`, min touch target 44 px, 48 px
buttons on phone). Optional items carry a small `isteğe bağlı` label. `hint` is a muted line under the label. An
answered item shows a meta line `{answeredByName} · {HH:MM}`.

- **check**
  - Unanswered: full-width outline button `Tamam` (icon `Check`) and a text button `Sorun var`.
  - `Sorun var` opens an inline `Textarea` (label `Ne sorun var?`, placeholder `ör. buz makinesi su kaçırıyor`, max 300)
    with `Kaydet` / `Vazgeç`. Saving with an empty note → field error `Sorunu kısaca yazın`.
  - Answered ok: green filled `Tamam` + meta + text button `Geri al` (undo = clear).
  - Answered issue: amber pill `Sorun: {note}` + meta + text button `Düzelt` (reopens the note; can also switch to `Tamam`).
  - Ticks are optimistic (`useOptimistic`); on error the row reverts and the error toasts.
- **number**
  - `Field` label = item label, hint `İzin verilen: {range}` (e.g. `İzin verilen: 0–4 °C`) or the item hint.
  - `NumberInput` (`inputMode="decimal"`) with the unit as a suffix, and `Kaydet` (Enter also saves).
  - **Negative ranges (freezer).** iOS's decimal keypad has no minus key. When `max ≤ 0` the input shows a fixed `−`
    prefix and the typed number is stored negative (`18` → −18). When `min < 0 < max` a small `±` toggle button sits
    next to the input. Parsing uses `parseNumberTR` after mapping `−` to `-`.
  - Out of range while typing (before save): warn box under the field (`rounded-xl bg-warn-soft text-warn text-[13px]`):
    `{value} izin verilen aralığın dışında ({range}). Ne yaptınız?` + a `Textarea` (required) + when the unit is `°C`
    quick chips that append text: `Kapı kapatıldı`, `Termostat ayarlandı`, `Ürünler başka dolaba alındı`,
    `Servis arandı`. Under it: `Yarım saat sonra yeniden ölçüp yeni değeri yazın; ilk ölçüm de kayıtta kalır.`
  - Saved: pill green `{value}` or red `{value} · aralık dışı` + the note + meta. Text button `Değiştir`.
  - When the answer has earlier versions: muted line `Önceki ölçüm: 6 °C · 09:12` (latest earlier version only).
- **photo**
  - No photo: secondary button `Fotoğraf çek` (icon `Camera`, full width on phone, `h-12`). It clicks a hidden
    `<input type="file" accept="image/*" capture="environment">`.
  - After the pick: `Hazırlanıyor…` while `compressImage` runs; then the preview (`URL.createObjectURL(blob)`, 128×96,
    `object-cover rounded-xl`, 60 % opacity) with `Yükleniyor…` and a spinner (`aria-live="polite"`).
  - Success: the thumbnail switches to `/api/foto/{photoId}` (full opacity), meta, buttons `Yeniden çek`
    (icon `RotateCcw`) and, tapping the thumbnail, a `Dialog` titled with the item label showing the large image,
    footer link `Yeni sekmede aç` (→ `/api/foto/{id}`) and `Kapat`.
  - Failure: red line `Yüklenemedi: {error}` + `Tekrar dene` (re-sends the same compressed blob kept in state) +
    `Yeniden çek`. The blob is dropped on success, on retake and on unmount; object URLs are revoked.
  - `compressImage` throws → `toast.error("Fotoğraf okunamadı; yeniden çekin.")`.
  - Optional photo note: text button `Not ekle` → inline input (max 300) saved with the answer action (`op: "note"`).
  - The file input's value is reset after every pick, so the same photo can be chosen again.
- **text**
  - `Input` (placeholder = hint or `Kısa not`, max 300) + `Kaydet`; answered: the text + meta + `Değiştir`.

**Bottom:** `ButtonLink` ghost `Bugün'e dön` (`/panel/bugun`).

**Client state rules (Activity keeps hidden pages mounted,**
`node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md`**):**

- The client component is keyed by `${templateId}:${day}:${seq}` only, **not** by a data version. Server answers
  arrive as props; local state holds only overlays (pending upload per item, optimistic tick, open note editor).
  Displayed = overlay ?? server answer. An overlay is dropped when the server answer for that item has a newer
  `answeredAt`. A `router.refresh()` from one finished upload therefore never wipes another upload in flight.
- When the tab becomes visible after more than 30 s hidden, `router.refresh()` (someone else may have answered).
- A save refused with `Bu günün listesi kapandı…` (the day rolled at 05:00) → toast with that text and
  `router.refresh()`; the page then shows the new day's list.

### 3.5 `/panel/kontrol/gecmis` — admin history

`requireAdmin()`. `PageHeader`: eyebrow `Kontrol listeleri`, title `Geçmiş`, description `Hangi gün hangi liste, kim,
ne zaman doldurdu; eksik maddeler, aralık dışı değerler ve fotoğraflar. Fotoğraflar 60 gün saklanır, kayıtlar
silinmez.` Tabs (§3.1).

**Without `?gun`** (day list):

- Three compact `Stat`s for the last 30 business days: `Tamamlanan` → `52 / 60 liste`; `Aralık dışı değer` → `3`
  (tone bad when > 0); `Eksik ya da yapılmayan` → `4` (tone warn when > 0).
- `Card` `Günler` (icon `History`): the last 14 business days, newest first, never before the first day any template
  applied. Each row is a `Link` to `?gun=YYYY-MM-DD`:
  - left: `22 Ekim Çarşamba`;
  - chips per daily template that applied that day: green `Açılış 09:42`, amber `Kapanış 3 eksik`, red
    `Açılış yapılmadı`, amber `Kapanış geç 03:10`; event lists blue `Mal kabul 2`;
  - right: red badge `{x} aralık dışı`, amber badge `{y} sorun` (when > 0).
- Footer: `ButtonLink` ghost `Daha eski günler` → `?bitis={oldest − 1}`.

**With `?gun=YYYY-MM-DD`** (day detail; future dates and malformed values fall back to the list):

- Row of `ButtonLink`s: `Günler` (ArrowLeft, → `/panel/kontrol/gecmis`), `Önceki gün`, `Sonraki gün` (hidden after today).
- One `Card` per run (and per template that applied but has no run):
  - header: `{list}` (event: `{list} · kayıt {seq}`), badge (`Tamamlandı`, `{x} eksik`, `Yapılmadı`), description
    `{opensAt} – {dueAt} · {who with times}` e.g. `Ayşe 08:51–09:12, Mehmet 09:40`;
  - flags (amber `Badge`s): `Erken dolduruldu ({firstAt})` when the first answer was more than 60 min before
    `opensAt`; `Geç tamamlandı ({completedAt})` when completed after `dueAt`;
  - no run: `Bu gün hiç açılmadı.` and the template's current item count (`{n} madde`).
  - items grouped by section. Each row: type icon (`CircleCheck` / `Camera` / `Thermometer` / `Type`), label, answer,
    `{answeredByName} · {HH:MM}`:
    - check ok `Tamam`; issue amber `Sorun: {note}`;
    - number `3,5 °C`; out of range: red pill `6 °C` + `aralık {range}` + `Not: {note}`;
    - earlier versions under it, muted, oldest first: `Önce: 6 °C · 09:12 Ayşe · Not: kapı açık kalmış`;
    - text: the text;
    - photo: lazy thumbnail button (`aria-label="{label} fotoğrafını büyüt"`, `loading="lazy"`, `decoding="async"`)
      → the same image `Dialog` as §3.4; photo gone: muted `Fotoğraf çekildi · 60 günden eski olduğu için silindi`
      (or `Fotoğraf bulunamadı` when `photoAt` is recent but the image is missing);
    - required item without an answer: red `Yapılmadı`; optional without answer: muted `—`.

### 3.6 `/panel/kontrol/duzenle` and `/panel/kontrol/duzenle/[id]` — admin editor

**List page.** `PageHeader`: eyebrow `Kontrol listeleri`, title `Listeleri düzenle`, description `Açılış, kapanış ve
istediğiniz başka listeler. Maddeleri, saat aralığını ve fotoğraf isteyen maddeleri buradan değiştirin. Değişiklik,
o gün başlamış bir listeye değil sonrakilere uygulanır.` Tabs.

- One row per template (`ul` in a `Card`): name; badges `Pasif` (gray), `Yalnız yönetici` (violet); line
  `Her gün · 08:00 – 11:00` or `Pzt, Çar, Cum · 22:00 – 02:00` or (Phase 2) `Her seferinde`; line
  `{n} madde · {p} fotoğraf · {t} ölçüm`; a `Switch` `Etkin` (`aria-label="{name} etkin"`) and `ButtonLink` `Düzenle`.
- `Button` `Yeni liste` → `Dialog` `Yeni kontrol listesi`:
  - `Ad` (placeholder `ör. Haftalık derin temizlik`, max 60);
  - Phase 2: `Ne zaman` choice `Her gün (saat aralığıyla)` / `Her seferinde (mal kabul, oda sıfırlama)`;
  - `Başlangıç` and `Son saat` (`type="time"`), hint `Gün 05:00'te döner: gece 02:00'yi son saat olarak
    yazabilirsiniz.`;
  - `Günler`: seven toggle chips `Pzt Sal Çar Per Cum Cmt Paz` (all on);
  - `Switch` `Personel doldurabilir` (on);
  - footer `Oluştur`. On success the dialog closes first, then `router.push("/panel/kontrol/duzenle/{id}")`
    (repo rule: close dialogs before navigating).

**Template page** (`[id]`; `notFound()` for unknown ids). `PageHeader` eyebrow `Listeleri düzenle`, title = name.

- `Card` `Liste`: the fields above + `Açıklama` (`Textarea`, max 300, hint `Listenin başında görünür.`) + `Etkin`
  switch + `Kaydet`. Danger row: when the list has no runs `Listeyi sil` (ConfirmDialog `"{name}" silinsin mi?` /
  `Maddeleriyle birlikte silinir.`); otherwise muted `Kayıtları olduğu için silinemez; kullanılmayacaksa pasife alın.`
- `Card` `Maddeler` (`{n} madde`), grouped by section. Each row: type icon, label, sub (`0–4 °C · zorunlu`,
  `fotoğraf · zorunlu`, `isteğe bağlı`), `IconButton`s `Yukarı taşı` / `Aşağı taşı` / `Düzenle` (Pencil) /
  `Kaldır` (Trash2). Kaldır → ConfirmDialog `Madde kaldırılsın mı?` / `Geçmiş kayıtlarda görünmeye devam eder.`
  Removed items (archived) are listed in a closed `<details>` `Kaldırılan maddeler ({x})`, each with `Geri ekle`.
- `Button` `Madde ekle` / row `Düzenle` → `Dialog` `Madde ekle` / `Maddeyi düzenle`:
  - `Tür`: 2×2 choice buttons `Tamam işareti` · `Fotoğraf` · `Sayı / sıcaklık` · `Kısa not`;
  - `Madde` (max 120) with a placeholder per type: `ör. Tezgâh dezenfekte edildi` / `ör. Bar tezgâhı hazır` /
    `ör. Bar buzdolabı sıcaklığı` / `ör. Eksik malzeme`;
  - `Bölüm` (`Input` + `datalist` of the template's sections), placeholder `ör. Bar, Salon, Karaoke odası`;
  - `Açıklama` (max 200) hint `Personele küçük bir ipucu (ör. termometreyi orta rafta okuyun).`;
  - number only: `Birim` (default `°C`, max 10), `En az`, `En çok` (both optional; minus allowed), hint
    `Aralık dışındaki değerde not istenir ve size bildirilir.`;
  - `Switch` `Zorunlu` (on), hint `Kapalıysa liste bu madde boş da olsa tamam sayılır.`;
  - footer `Kaydet`.
- Validation errors (server, shown in the dialog): `Madde adı gerekli`, `En az, en çoktan büyük olamaz`,
  `Bir listede en çok 60 madde olabilir`, `Bir listede en çok 10 fotoğraflı madde olabilir`; template:
  `Liste adı gerekli`, `Bu adda bir liste var`, `Son saat başlangıçtan sonra olmalı (gün 05:00'te döner)`,
  `Aralık en az 15 dakika olmalı`, `En az bir gün seçin`.

### 3.7 Bell (`src/server/actions/notifications.ts`, group `kontrol`, label `Kontrol listeleri`)

`PanelNotification.group` gains `"kontrol"`; `notifications.tsx` adds the group right after `kasa`, icon `ListChecks`
(danger keeps the alert icon). One loader `checklistNotifications(user)` joins the first `Promise.all` of
`loadPanelNotifications` with `.catch(() => [])` (it serves both roles). Returned after `cash` in both branches:
staff `[...cash, ...kontrol, ...mine, ...recipes]`; admin
`[...system, ...mine, ...recipes, ...cash, ...kontrol, ...payments, ...invoices, ...priceNote, ...warnings]` (the
ops-jobs return line as it stands on the branch, with `...kontrol` inserted after `...cash`).

Admin:

| id | kind | title | body | time | href |
|---|---|---|---|---|---|
| `kontrol-gecikti-{tid}-{day}` (today, after `dueAt`, not complete) | warning | `{list} gecikti` | `Son saat {dueAt} · {a} / {n} madde` or `Son saat {dueAt} · başlanmadı` | `Bugün` | `/panel/kontrol/{tid}` |
| `kontrol-eksik-{tid}-{day}` (yesterday, not complete) | warning | `Dünkü {list·} eksik` | `{longDateTR(day)} · {a} / {n} madde` or `{longDateTR(day)} · hiç açılmadı` | `Dün` | `/panel/kontrol/gecmis?gun={day}` |
| `kontrol-sorun-{answerId}-v{versions}` (today and yesterday, current status `issue`; newest 5) | number: danger, check: warning | `{label}: {value}` / `{label}: sorun` | `{list} · {by} {HH:MM}` + ` · Not: {note}` (clip 120) | `Bugün` / `Dün` | `/panel/kontrol/gecmis?gun={day}` |

Staff (only `staffAllowed` lists, only today):

| id | kind | title | body | unread | href |
|---|---|---|---|---|---|
| `kontrol-bekliyor-{tid}-{day}` (window open or late, not complete) | late: warning, open: info | late: `{list} gecikti`, open: `{list} bekliyor` | `Son saat {dueAt} · {a} / {n} madde` | late only | `/panel/kontrol/{tid}` |

All `unread: true` for admin items. Ids change with the version count, so a new reading re-raises the item.

### 3.8 Morning e-mail (one section, minimal)

In `runReminderDigest` (ops owns the digest; this is additive): the section covers **yesterday's business day**
(`addDays(businessDate(now), -1)`; at 08:00 that is the previous day). It is included once per day: after a successful
send a `notification_log` row `kontrol:{day}` is written, and a day with that key is skipped. A non-empty section
counts as news (an e-mail goes out even when nothing else is new).

Content (`renderDigest(…, kontrol)`, HTML table like the other boxes; text version mirrors it):

- Heading `Kontrol listeleri · {longDateTR(day)}`.
- One line per daily list not completed: `{list} — {a} / {n} madde; yapılmayan: {first three labels}` + ` ve {r} madde
  daha`, or `{list} — hiç açılmadı`.
- One red line per problem (current issue or corrected reading): `{label}: 6 °C (0–4 °C) · {by}: {note}` /
  `{label}: 6 °C → 3,5 °C (düzeltildi)` / `{label}: sorun · {by}: {note}`. At most 5, then `ve {r} kayıt daha`.
- When yesterday had no cash report: muted `Dün kasa raporu da girilmedi; kafe kapalıysa bu bölümü önemsemeyin.`
- Link button `Kontrol geçmişi` → `${APP_URL}/panel/kontrol/gecmis?gun={day}`. Never a photo or Blob URL.
- All user text (labels, notes, names) through the template's `esc()`.
- Placement: after the invoices box (and pricing's holds box), before the zam box. Ops' "Sistem uyarıları" stays first.

Subject (R5 precedence is ops'; this only adds a part): `kontrolPart` = one list missing →
`dünkü {list·} eksik`; several → `dünkü {x} kontrol listesi eksik`; only problems → `kontrol listesinde aralık dışı
değer` (any out-of-range) or `kontrol listesinde sorun`. In steps 1–3 it is appended to the extras
(`… · dünkü kapanış listesi eksik`); in step 4 it joins the "first of" list after invoices / review / holds
(`Sabah özeti: dünkü kapanış listesi eksik`). Headline when there are no payments, system items or invoices:
`Dünkü kontrol listelerinde eksik var` (or `Dünkü kontrol listelerinde sorun var`).

### 3.9 Phase 2 (cuttable): "Her seferinde" lists

- `schedule = "event"`: no window, weekdays ignored, any number of records per business day (`seq` 1, 2, 3…).
- `/panel/kontrol/{id}` for an event list shows today's records (`Kayıt {seq} · {firstAt} · {who}` + status) and a
  primary button `Yeni kayıt` → Server Action `startChecklistRecord(templateId)` → `router.push("?kayit={seq}")`.
  `/panel/kontrol/{id}?kayit={seq}` is the §3.4 form for that record (unknown seq → back to the records list).
- Bugün `kayit-{id}`: no records → `later`, badge `Gerektiğinde`, `Her seferinde doldurulur · {n} madde.`, action
  `Yeni kayıt`; a record with missing required items → `todo`, badge `{x} eksik`, `{firstAt} kaydında {m} madde eksik.`,
  action `Devam et` (→ `?kayit=`); otherwise `done`, badge `{c} kayıt`, `Son kayıt {lastAt} · {who}` (admin with open
  problems → `warn`, `{m} sorun`).
- No "gecikti" / "eksik" alerts for event lists; problems alert like daily lists. History lists each record.
- Seeds "Oda sıfırlama" and "Mal kabul" (§5.4) are inserted **passive**.

---

## 4. Data model (`src/server/db/schema.ts`, one generated migration)

Generated at merge time (R2): `npm run db:generate -- --name kontrol_listeleri`. It must be generated **after**
`fotograf`'s migration (FK to `photos`). Never hand-write it.

```ts
// ---------------------------------------------------------------- Kontrol listeleri
/** Madde türü: tamam işareti, fotoğraf, sayı (sıcaklık gibi; aralık dışı not ister), kısa not */
export type ChecklistItemType = "check" | "photo" | "number" | "text";
/** Listenin o günkü maddeleri: liste ilk yanıtla açılırken şablondan kopyalanır, şablon sonradan değişse de kayıt aynı kalır */
export type ChecklistItemSnap = {
  id: number; label: string; type: ChecklistItemType; section: string | null; hint: string | null;
  required: boolean; unit: string | null; min: number | null; max: number | null;
};
/** Yanıtın değiştirilen önceki hâli (ilk aralık dışı ölçüm kaybolmasın) */
export type ChecklistAnswerVersion = {
  status: "ok" | "issue"; value: number | null; textValue: string | null; note: string | null;
  photo: boolean; by: string; at: string; // ISO
};

/**
 * Kontrol listesi şablonu (Açılış, Kapanış …). daily: seçili günlerde bir kez, saat aralığıyla (iş günü 05:00'te
 * döner, 22:00–02:00 geçerli); event: her seferinde (oda sıfırlama, mal kabul). activeFrom / inactiveFrom: bir günün
 * listesi o günün aralığı açılırken etkinse beklenir (bugün eklenen liste bugün "gecikti" demez). Ayrıntı:
 * docs/KONTROL-LISTELERI.md.
 */
export const checklistTemplates = pgTable(
  "checklist_templates",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description"),
    schedule: text("schedule", { enum: ["daily", "event"] }).notNull().default("daily"),
    /** "HH:MM" Türkiye saati; event'te boş */
    opensAt: text("opens_at"),
    dueAt: text("due_at"),
    /** İş gününün haftanın günü: 1 = Pazartesi … 7 = Pazar */
    weekdays: jsonb("weekdays").$type<number[]>().notNull().default([1, 2, 3, 4, 5, 6, 7]),
    /** Personel doldurabilir (kapalı: yalnız yönetici görür ve doldurur) */
    staffAllowed: boolean("staff_allowed").notNull().default(true),
    active: boolean("active").notNull().default(true),
    activeFrom: timestamp("active_from", { withTimezone: true }).notNull().defaultNow(),
    inactiveFrom: timestamp("inactive_from", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("checklist_templates_window_ck", sql`${t.schedule} = 'event' or (${t.opensAt} is not null and ${t.dueAt} is not null)`)],
);

/** Şablonun maddeleri; kaldırılan madde silinmez, active = false (geçmiş kayıtlar kendi kopyasını taşır) */
export const checklistItems = pgTable(
  "checklist_items",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id").notNull().references(() => checklistTemplates.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    type: text("type", { enum: ["check", "photo", "number", "text"] }).notNull().default("check"),
    section: text("section"),
    hint: text("hint"),
    required: boolean("required").notNull().default(true),
    unit: text("unit"),
    min: doublePrecision("min"),
    max: doublePrecision("max"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("checklist_items_template_idx").on(t.templateId, t.sortOrder)],
);

/** Bir listenin bir iş günündeki kaydı (event listede aynı gün birden çok: seq). İlk yanıtta açılır. */
export const checklistRuns = pgTable(
  "checklist_runs",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id").notNull().references(() => checklistTemplates.id, { onDelete: "restrict" }),
    /** İş günü (YYYY-MM-DD, 05:00'te döner) */
    date: text("date").notNull(),
    seq: integer("seq").notNull().default(1),
    /** Açıldığı andaki ad, aralık ve maddeler */
    name: text("name").notNull(),
    opensAt: text("opens_at"),
    dueAt: text("due_at"),
    items: jsonb("items").$type<ChecklistItemSnap[]>().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: integer("completed_by").references(() => users.id, { onDelete: "set null" }),
    completedByName: text("completed_by_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("checklist_runs_template_day_uq").on(t.templateId, t.date, t.seq), index("checklist_runs_date_idx").on(t.date)],
);

/** Maddenin yanıtı (run başına madde başına bir satır); değişince önceki hâli history'ye geçer */
export const checklistAnswers = pgTable(
  "checklist_answers",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").notNull().references(() => checklistRuns.id, { onDelete: "cascade" }),
    /** runs.items içindeki madde kimliği (madde şablondan kaldırılsa da okunur; FK yok) */
    itemId: integer("item_id").notNull(),
    /** ok: yapıldı / değer aralıkta; issue: sorun bildirildi ya da değer aralık dışında (not zorunlu) */
    status: text("status", { enum: ["ok", "issue"] }).notNull().default("ok"),
    value: doublePrecision("value"),
    textValue: text("text_value"),
    note: text("note"),
    /** Fotoğraf (fotograf grubunun photos tablosu); saklama süresi dolup silinince boşalır */
    photoId: text("photo_id").references(() => photos.id, { onDelete: "set null" }),
    /** Fotoğrafın yüklendiği an: fotoğraf silinse de "çekildi" bilgisi kalır */
    photoAt: timestamp("photo_at", { withTimezone: true }),
    history: jsonb("history").$type<ChecklistAnswerVersion[]>().notNull().default([]),
    answeredBy: integer("answered_by").references(() => users.id, { onDelete: "set null" }),
    answeredByName: text("answered_by_name").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("checklist_answers_run_item_uq").on(t.runId, t.itemId), index("checklist_answers_photo_idx").on(t.photoId)],
);
```

Notes:

- `photoId`'s column type follows `photos.id` (assumed `text`; if `fotograf` uses `serial`, use `integer`). If
  `fotograf` soft-deletes photo rows instead of deleting them, drop the FK and treat `readPhoto(id) === null` as gone
  (§11).
- `history` is capped at 10 versions (oldest dropped) by the writer.
- Volumes: ~2 runs and ~30 answers a day (~11k answers a year). No retention for rows.
- Seed marker (no schema): `integration_state` key `kontrol.seeded` = `{ at, version: 1 }`.
- Backup: ops discovers tables at runtime (R6), so the four tables are covered with no code. Photo bytes live in Blob
  and are not in the backup (by design; they expire anyway).
- `db:reset` does not truncate these tables (like `cash_reports`); README's "Silmedikleri" list gains
  `kontrol listeleri ve kayıtları`.

---

## 5. Pure logic

### 5.1 `src/lib/checklists.ts` (new; no server imports; tests `tests/kontrol-listeleri.test.ts`)

```ts
export const DAY_START_MIN = 5 * 60;       // businessDate ile aynı sınır (05:00)
export const KONTROL_PHOTO_DAYS = 60;
export const ANSWER_GRACE_MIN = 30;        // başlamış liste 05:30'a kadar bitirilebilir
export const EARLY_SLACK_MIN = 60;         // aralıktan 60 dk önce başlayan "erken"
export const MAX_ITEMS = 60, MAX_PHOTO_ITEMS = 10, MAX_HISTORY = 10;

export type ListState = "before" | "open" | "overdue" | "done" | "missed";
export interface AnswerLite { id: number; itemId: number; status: "ok" | "issue"; value: number | null; textValue: string | null; note: string | null;
  photoId: string | null; photoAt: string | null; by: string; at: string; history: ChecklistAnswerVersion[] }
export interface IssueLite { answerId: number; label: string; text: string; note: string | null; by: string; at: string; open: boolean; versions: number; kind: "range" | "issue" }
export interface RunLite { seq: number; required: number; done: number; photosLeft: number; photos: number; missing: string[];
  issues: IssueLite[]; contributors: string[]; firstAt: string | null; lastAt: string | null; completedAt: string | null }
export interface ChecklistLite { templateId: number; name: string; schedule: "daily" | "event"; opensAt: string | null; dueAt: string | null;
  required: number; photos: number; staffAllowed: boolean; runs: RunLite[] }

// Saat
export function parseClock(v: string): number | null;              // "08:00" → 480; geçersiz → null
export function businessMinuteOfClock(min: number): number;        // (min − 300 + 1440) % 1440
export function nowBusinessMinute(now: Date): number;              // Intl (Europe/Istanbul) saat+dakika → iş dakikası
export function checklistDay(now: Date): string;                   // = businessDate(now) (testte eşitlik)
export function windowError(opensAt: string, dueAt: string): string | null;   // §3.6 metinleri
export function windowOpenInstant(day: string, opensAt: string): Date;        // gün + saat (05:00 öncesi ertesi takvim günü), UTC+3
export function weekdayOf(day: string): number;                    // 1 = Pazartesi … 7 = Pazar
export function weekdaysText(days: number[]): string;              // "Her gün" | "Hafta içi" | "Pzt, Çar, Cum"
export function appliesOn(t: { schedule; weekdays: number[]; opensAt: string | null; activeFrom: string; inactiveFrom: string | null }, day: string): boolean;

// Madde ve yanıt
export function rangeText(i: Pick<ChecklistItemSnap, "min" | "max" | "unit">): string;   // "0–4 °C", "-30 – -18 °C", "en az 0 °C", ""
export function valueText(i: Pick<ChecklistItemSnap, "unit">, v: number): string;        // "3,5 °C" (num(v, 1))
export function inRange(i: Pick<ChecklistItemSnap, "min" | "max">, v: number): boolean;
export function parseReading(raw: string, negative: boolean): number | null;             // "−" → "-", parseNumberTR, negative öneki
export function nextVersions(prev: AnswerLite | null, now: { by: string; at: string }): ChecklistAnswerVersion[];  // değiştiyse ekler, MAX_HISTORY
export function runSummary(items: ChecklistItemSnap[], answers: AnswerLite[]): RunLite;   // zorunlu, eksik, sorunlar, katkı verenler
export function listState(l: ChecklistLite, nowBm: number, isPastDay: boolean): ListState;
export function earlyStart(run: { opensAt: string | null; firstAt: string | null }): boolean;
export function lateFinish(run: { dueAt: string | null; completedAt: string | null; date: string }): boolean;

// Metin
export function listTitle(name: string): string;                  // "Açılış" → "Açılış listesi"
export function lowerFirst(s: string): string;                    // tr: "İ" → "i"
export function whoText(names: string[]): string;
export function issueText(i: IssueLite): string;
export function clip(text: string, max: number): string;          // Bugün'deki clip ile aynı davranış (bugün yoksa burada)

// Yetki
export function canAnswerDay(date: string, now: Date, runExists: boolean): boolean;   // §2.4
export function photoAccess(i: { role: "admin" | "staff"; userId: number; createdBy: number | null; runDate: string | null; now: Date }): boolean;
// admin: true; personel: runDate ≥ dün (iş günü) ya da (runDate yok ve createdBy = userId)

// Uyarılar
export interface BellLite { id: string; kind: "danger" | "warning" | "info"; title: string; body: string; timeLabel: string; unread: boolean; href: string }
export function checklistBell(i: { role: "admin" | "staff"; now: Date; today: ChecklistLite[]; yesterday?: ChecklistLite[] }): BellLite[];
export interface DigestKontrol { day: string; lines: { list: string; text: string }[]; problems: { text: string; danger: boolean }[]; more: number; cashMissing: boolean }
export function digestKontrol(day: string, lists: ChecklistLite[], cashMissing: boolean): DigestKontrol | null;
export function kontrolSubjectPart(k: DigestKontrol): string;
export function kontrolHeadline(k: DigestKontrol): string;
export function checklistBoundaries(lists: ChecklistLite[]): number[];   // Bugün yenileme saatleri (TR dakika)
```

Rules worth spelling out:

- `listState`: complete → `done`; past day → `missed`; any answer → `nowBm ≥ due ? overdue : open`; else
  `nowBm < opens ? before : nowBm < due ? open : overdue`. A run's own `opensAt` / `dueAt` win over the template's.
- `runSummary.missing` = labels of required snapshot items without an answer, in snapshot order.
  `photosLeft` = required photo items without a photo. `contributors` = distinct `by` ordered by first answer.
  `issues` = answers whose status is `issue` (`open: true`) plus answers whose `history` holds an `issue` version and
  whose current status is `ok` (`open: false`, text `6 °C → 3,5 °C`).
- `appliesOn`: event → active window only; daily → weekday matches and `activeFrom < windowOpenInstant(day)` and
  (`inactiveFrom` null or `inactiveFrom > windowOpenInstant(day)`).
- Every function takes `now` / `day` as arguments; nothing reads the clock (tests use fixed dates).

### 5.2 Bugün rows (`src/app/panel/bugun/logic.ts`, today's file)

```ts
// DayFacts'e
checklists?: { day: string; lists: ChecklistLite[] } | null;            // iki rol; null: okunamadı
checklistsYesterday?: { day: string; lists: ChecklistLite[] } | null;   // yalnız yönetici
// dayTasks dizisine
function checklistRows(f: DayFacts): DayTask[]     // liste-{id}, kayit-{id}; §3.2 tablosu
function checklistYesterday(f: DayFacts): DayTask[] // liste-dun; f.role !== "admin" ise []
```

Uses the helpers of §5.1 only. `liste-dun` uses `f.cash?.yesterday === null` for the "kasa raporu da yok" remark.

### 5.3 Validation schemas (in the action file, zod)

- Template: `name` `zText("Liste adı", 60)`; `description` `zOptText(300)`; `schedule`; `opensAt` / `dueAt`
  `/^([01]\d|2[0-3]):[0-5]\d$/` + `windowError`; `weekdays` `z.array(z.number().int().min(1).max(7)).min(1, "En az
  bir gün seçin")` (deduplicated, sorted); `staffAllowed`, `active` booleans.
- Item: `label` `zText("Madde adı", 120)`; `type`; `section` `zOptText(40)`; `hint` `zOptText(200)`; `required`;
  `unit` `zOptText(10)` (number only; default `°C`); `min` / `max` `z.number().finite().min(-100).max(1000).nullable()`
  with `min ≤ max`.
- Answer (discriminated by `op`): `templateId`, `date` (`zDate`), `seq` (1–50, default 1), `itemId`, plus
  - `ok` (`note` optional),
  - `issue` (`note` `zText("Not", 300)` → message `Sorunu kısaca yazın`),
  - `value` (`value` finite −100…1000; `note` optional, required when out of range),
  - `text` (`text` `zText("Not", 300)`),
  - `note` (photo item: set / clear the optional note),
  - `clear`.

### 5.4 Seed data (`src/lib/checklist-seed.ts`, pure)

```ts
export interface SeedItem { label: string; type: ChecklistItemType; section?: string; hint?: string; required?: boolean; unit?: string; min?: number; max?: number }
export interface SeedTemplate { name: string; description: string; schedule: "daily" | "event"; opensAt?: string; dueAt?: string; active: boolean; items: SeedItem[] }
export const DEFAULT_CHECKLISTS: SeedTemplate[];
```

**Açılış** — daily `08:00`–`11:00`, active. Description `Kafeyi açarken. Sıcaklıkları ölçün; fotoğrafları tezgâh ve
salon hazır olunca çekin.`

| Bölüm | Madde | Tür | Not |
|---|---|---|---|
| Bar | Espresso makinesi açıldı, gruplardan su geçirildi | check | hint `İlk kahveden önce her gruptan birkaç saniye su akıtın.` |
| Bar | Bar buzdolabı sıcaklığı | number °C 0…4 | hint `Termometreyi dolabın orta rafında okuyun.` |
| Bar | Derin dondurucu sıcaklığı | number °C −30…−18, optional | hint `Dondurucu yoksa boş bırakın.` |
| Bar | Süt ve sütlü ürünlerin tarihlerine bakıldı; açılan kutuya tarih yazıldı | check | |
| Bar | Buz makinesi çalışıyor, haznesi temiz | check | |
| Bar | Tezgâh, kesme tahtaları ve bar ekipmanı dezenfekte edildi | check | |
| Bar | Bar tezgâhı hazır | photo | hint `Tezgâhın tamamı görünsün.` |
| Salon | Masalar, sandalyeler ve menüler silindi | check | |
| Salon | Lavabo: sabun, kâğıt havlu ve tuvalet kâğıdı tam; çöp boş | check | |
| Salon | Salon hazır | photo | |
| Karaoke odası | Oda havalandırıldı; ses sistemi ve ekran denendi | check | |
| Karaoke odası | Mikrofonlar şarjlı, yedek pil ve mikrofon kılıfı yeterli | check | |
| Not | Eksik malzeme ya da arıza | text, optional | hint `Yoksa boş bırakın.` |

**Kapanış** — daily `22:00`–`02:00`, active. Description `Son misafir çıkınca, kasa raporundan önce. Fotoğrafları
temizlik bitince çekin.`

| Bölüm | Madde | Tür | Not |
|---|---|---|---|
| Karaoke odası | Mikrofonlar alkollü mendille silindi, kullanılan kılıflar atıldı | check | hint `Tutma yeri ve ızgara dahil; mikrofonu ıslatmayın.` |
| Karaoke odası | Koltuklar, masa ve kumanda / şarkı tableti silindi; çöp toplandı | check | |
| Karaoke odası | Unutulan eşya kontrol edildi | check | hint `Bulunanı kasaya kaldırıp nota yazın.` |
| Karaoke odası | Ses sistemi ve ekran kapatıldı | check | |
| Karaoke odası | Karaoke odası toparlandı | photo | |
| Bar | Espresso makinesi: gruplar fırçalandı, kör filtreyle deterjanlı yıkama yapıldı | check | |
| Bar | Buhar çubuğu temizlendi; sürahi ve potlar yıkandı | check | |
| Bar | Açık süt, krema ve soslar dolaba kaldırıldı, üzerlerine tarih yazıldı | check | |
| Bar | Bar buzdolabı sıcaklığı | number °C 0…4 | |
| Bar | Bar ve tezgâh temiz | photo | |
| Salon ve genel | Yerler süpürüldü ve silindi | check | |
| Salon ve genel | Lavabo temizlendi | check | |
| Salon ve genel | Çöpler çıkarıldı, kovalara yeni poşet takıldı | check | |
| Salon ve genel | Salon kapanış hâli | photo | |
| Salon ve genel | Işıklar, klima ve cihazlar kapandı; kapılar kilitlendi | check | |
| Not | Arıza, eksik ya da bulunan eşya | text, optional | |

**Oda sıfırlama** (Phase 2) — event, **passive**. Description `Her karaoke oturumundan sonra, sıradaki misafir
gelmeden.` Items (section `Karaoke odası`): `Mikrofonlar silindi, kılıflar değiştirildi` (check); `Masa silindi;
bardak, tabak ve çöp toplandı` (check); `Kumanda / şarkı tableti silindi` (check); `Unutulan eşya kontrol edildi`
(check); `Ses seviyesi ve ekran sıradaki oturuma hazır` (check); `Oda hazır` (photo, optional).

**Mal kabul** (Phase 2) — event, **passive**. Description `Tedarikçiden mal gelince, ürünleri dolaba kaldırmadan önce.`
Items: `Tedarikçi` (text); `Soğuk ürün sıcaklığı` (number °C 0…4, optional, hint `Süt, krema gibi soğuk ürün geldiyse
ürünlerin arasından ölçün.`); `Dondurulmuş ürün sıcaklığı` (number °C −30…−18, optional); `Ambalajlar sağlam, son
kullanma tarihleri uygun` (check); `Ürünler hemen dolaba ya da depoya kaldırıldı` (check); `Gelen ürünler` (photo,
optional).

`scripts/seed.ts` gains `ensureChecklistSeed(db)`, called on both paths (next to `ensureAdmin`): when the
`integration_state` key `kontrol.seeded` is absent, insert `DEFAULT_CHECKLISTS` (templates with `sortOrder` 1…4, items
in order, passive ones with `active = false, inactiveFrom = now`) and the key in one transaction. Deleting the seeded
lists later never brings them back. Production gets them on the first deploy after merge (predeploy runs the seed;
previews skip it).

---

## 6. Server

### 6.1 Data layer: `src/server/data/checklists.ts` (`import "server-only"`)

```ts
export class ChecklistError extends Error { constructor(message: string, readonly status = 400) }
export interface TemplateDTO { id; name; description; schedule; opensAt; dueAt; weekdays; staffAllowed; active; activeFrom: string; inactiveFrom: string | null; sortOrder; items: ItemDTO[]; archived: ItemDTO[]; hasRuns: boolean }
export interface AnswerDTO extends AnswerLite {}         // §5.1 AnswerLite (ISO strings)
export interface RunViewData { template: TemplateDTO; day: string; seq: number; run: { id: number; completedAt: string | null; completedByName: string | null } | null;
  items: ChecklistItemSnap[]; answers: AnswerDTO[]; editable: boolean; readOnlyReason: string | null }

export async function loadTemplates(opts?: { includeInactive?: boolean }): Promise<TemplateDTO[]>;
export async function loadTemplate(id: number): Promise<TemplateDTO | null>;
export async function loadChecklistDay(day: string, role: "admin" | "staff"): Promise<ChecklistLite[]>;   // 3 sorgu: şablon+madde, run, yanıt
export async function loadRunView(templateId: number, day: string, seq: number, role: "admin" | "staff", now: Date): Promise<RunViewData | null>;
export async function loadHistoryDays(from: string, to: string): Promise<{ day: string; lists: ChecklistLite[] }[]>;
export async function loadHistoryDay(day: string): Promise<{ template: TemplateDTO; run: …; items; answers }[]>;
export async function loadHistoryStats(days = 30): Promise<{ done: number; expected: number; outOfRange: number; missing: number }>;
export async function firstChecklistDay(): Promise<string | null>;

/** Yanıt yazımının ortak yolu (eylem ve fotoğraf yolu): yetki, run'ı açma (snapshot), yanıtı yazma, tamamlanma */
export async function writeAnswer(me: CurrentUser, input: AnswerInput, now: Date):
  Promise<{ answer: AnswerDTO | null; previousPhotoId: string | null; completedNow: boolean; reopened: boolean; run: { id; name; date }; progress: RunLite }>;
export async function checkAnswerTarget(me: CurrentUser, t: { templateId: number; date: string; seq: number; itemId: number; type?: ChecklistItemType }, now: Date): Promise<void>;  // fotoğraf yüklemeden önce
export async function kontrolPhotoAccess(user: CurrentUser, photo: { id: string; createdBy: number | null }): Promise<boolean>;  // fotograf'ın kayıt defterine
export async function loadDigestKontrol(day: string): Promise<DigestKontrol | null>;
```

`writeAnswer` (one transaction):

1. Template by id (`FOR SHARE`). Inactive → `Bu liste kapalı.`; staff and `!staffAllowed` → `Bu listeyi yalnız yönetici
   doldurur.`
2. Run: `SELECT … FOR UPDATE` on `(templateId, date, seq)`.
   - Day rule: `canAnswerDay(date, now, Boolean(run))` else `Bu günün listesi kapandı; geçmiş günler sonradan
     doldurulamaz.`
   - Daily and no run: `appliesOn(template, date)` else `Bu liste bugün yok.`; then
     `INSERT … ON CONFLICT (template_id, date, seq) DO NOTHING` with the snapshot (active items by `sortOrder`, none →
     `Bu listede madde yok.`), then re-select `FOR UPDATE` (handles two phones racing).
   - Event and no run → `Kayıt bulunamadı; Yeni kayıt ile başlayın.`
3. Item = `run.items.find(id)` else `Liste değişti; sayfayı yenileyin.` Op vs type mismatch → `Bu madde bu şekilde
   işaretlenemez.` (photo items accept only `note` / `clear` here; photos come from the route).
4. Status: `value` → `inRange` ? `ok` : `issue`; issue without note → `Değer aralık dışında ({range}): ne yapıldığını
   nota yazın.`
5. Upsert on `(runId, itemId)`: existing row → `history = nextVersions(prev)`; set fields, `answeredBy/Name/At`.
   `clear` → delete the row and return its `photoId` as `previousPhotoId`.
6. Re-read the run's answers → `runSummary`. Complete and `completedAt` null → set `completedAt/By/Name`
   (`completedNow`). Not complete and `completedAt` set → clear them (`reopened`).

Activity log (after the transaction, via `logActivity`):

- completedNow → `Kontrol listesi tamamlandı`, `{name} · {longDateTR(date)} · {who}` + ` · {m} sorun`;
- new or changed out-of-range value → `Kontrol: aralık dışı`, `{name} · {label} {value} ({range}) · Not: {note}`;
- check issue → `Kontrol: sorun bildirildi`, `{name} · {label} · Not: {note}`;
- a number changed → `Kontrol değeri değişti`, `{name} · {label}: {old} → {new}`.

Plain ticks and photos are not logged (too noisy; the answer row itself records who and when).

`loadChecklistDay(day, role)`: active-or-ran templates (staff: `staffAllowed` only) that `appliesOn(day)`, plus any
template with a run that day; items for the not-started ones; runs for the day; answers for those runs →
`ChecklistLite[]`. Small, no model load.

`kontrolPhotoAccess`: `SELECT r.date FROM checklist_answers a JOIN checklist_runs r … WHERE a.photo_id = $id` →
`photoAccess({ role, userId, createdBy: photo.createdBy, runDate, now: new Date() })`.

`loadDigestKontrol(day)`: `loadChecklistDay(day, "admin")` daily lists + problems of event records +
`cashReportsBetween(day, day)` → `digestKontrol(…)`.

### 6.2 Server Actions: `src/server/actions/checklists.ts` (`"use server"`)

All return `attempt(...)`, validate with zod, call `refresh()` after a write.

| Action | Auth | Does |
|---|---|---|
| `answerChecklistItem(input)` | `requireUser` | `writeAnswer`; `after(() => deletePhoto(previousPhotoId))` when a photo answer was cleared; returns `{ answer, progress, completedNow }` |
| `startChecklistRecord(templateId)` (Phase 2) | `requireUser` | event template, active, staff rule; inserts run `seq = max + 1` for `businessDate()` with the snapshot; returns `{ seq }` |
| `createChecklistTemplate(input)` | `requireAdmin` | insert (sortOrder = max + 1, `activeFrom = now`); log `Kontrol listesi eklendi` |
| `updateChecklistTemplate(id, input)` | `requireAdmin` | update; log `Kontrol listesi düzenlendi` with changed parts (`saat 08:00 – 11:00 → 07:30 – 10:30`, `günler`, `personel`) |
| `setChecklistTemplateActive(id, active)` | `requireAdmin` | `active`, `activeFrom = now` on activate, `inactiveFrom = now` / null; log `Kontrol listesi etkinleştirildi` / `pasife alındı` |
| `deleteChecklistTemplate(id)` | `requireAdmin` | only when no runs, else `Bu listenin kayıtları var; silmek yerine pasife alın.`; log `Kontrol listesi silindi` |
| `saveChecklistItem(templateId, input, id?)` | `requireAdmin` | create / update; limits (§3.6); log `Kontrol maddesi eklendi` / `düzenlendi`, `{list} › {label}` |
| `moveChecklistItem(id, dir)` | `requireAdmin` | swap `sortOrder` with the neighbour among active items |
| `setChecklistItemActive(id, active)` | `requireAdmin` | archive / restore (never hard-deletes); log `Kontrol maddesi kaldırıldı` / `geri eklendi` |

No step-up password (these actions do not create or affect an admin; adminstepup's rule).

### 6.3 Route Handler: `src/app/api/kontrol/foto/route.ts`

`POST` only, `export const maxDuration = 30`.
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`: `request.formData()`;
`.../04-functions/connection.md`.)

1. `await connection()`. `sameOrigin(request)` else 403 `Geçersiz istek` (Route Handlers do not get the Server Action
   origin check; same reason as `/api/faturalar/[id]/belge`).
2. `getCurrentUser()` else 401 `Giriş gerekli` (the proxy matcher does not cover `/api/kontrol`).
3. `request.formData()` (catch → 400 `Fotoğraf okunamadı; yeniden çekin.`). Fields `templateId`, `date`, `seq`,
   `itemId` (zod; 400 with the zod message), file `foto`.
4. Empty → 400 `Fotoğraf seçin`; `> 3 MB` → 413 `Fotoğraf çok büyük; yeniden çekin.`;
   `sniffMime(bytes)` ∉ jpeg / png / webp → 415 `Yalnız fotoğraf (JPG, PNG, WebP) yüklenebilir.`
5. `checkAnswerTarget(me, {…, type: "photo"}, now)`. A `ChecklistError` → its status and message.
6. `const { id } = await savePhoto({ kind: "kontrol", bytes, contentType: mime, userId: me.id, expiresAt: now + 60 days })`.
7. `writeAnswer(me, { op: "photo", photoId: id, photoAt: now, … }, now)` (an internal op, not accepted by the Server
   Action schema). On error: `await deletePhoto(id).catch(log)` and return the error (`ChecklistError` → its status,
   else 500 `Fotoğraf kaydedilemedi; tekrar deneyin.`).
8. `after(() => previousPhotoId && deletePhoto(previousPhotoId))` (retake;
   `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`).
9. `200 { ok: true, answer, progress, completedNow }`.

The client then calls `router.refresh()` — `refresh()` only works inside Server Actions
(`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md`).

`sameOrigin`: use `fotograf`'s shared helper if it exports one (§11), else move the 10-line function from
`src/app/api/faturalar/[id]/belge/route.ts` to `src/server/same-origin.ts` and import it in both routes.

### 6.4 Pages (server components; `<Suspense>` + async content, `requireUser()` / `requireAdmin()` first, `new Date()` after it)

(`node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md`, "Fix synchronous IO": read the time
only after the request-time read.)

- `src/app/panel/kontrol/page.tsx`: `loadChecklistDay(businessDate(now), role)` → cards (§3.3). Admin also
  `loadTemplates({ includeInactive: true })` for the "Bugün olmayan listeler" line.
- `src/app/panel/kontrol/[id]/page.tsx`: id check (`notFound()`), `?kayit` (Phase 2), `loadRunView(...)`, refusals
  (§3.4), `<RunForm>`.
- `src/app/panel/kontrol/gecmis/page.tsx`: `requireAdmin`; list or day view (§3.5).
- `src/app/panel/kontrol/duzenle/page.tsx`, `duzenle/[id]/page.tsx`: `requireAdmin` (§3.6).

### 6.5 Bell, digest, Bugün wiring

- `src/server/actions/notifications.ts`: `checklistNotifications(user)` = `loadChecklistDay(today, role)` (+ admin
  `loadChecklistDay(yesterday, "admin")`) → `checklistBell(...)` → `PanelNotification` with `group: "kontrol"`.
- `src/server/notify/digest.ts` › `runReminderDigest`: `day = addDays(businessDate(), -1)`; skip when the
  `kontrol:{day}` key exists; `kontrol = await loadDigestKontrol(day).catch(e => (console.error(...), null))`;
  `kontrolNews = Boolean(kontrol)` joins the "anything new" test and the skipped reason
  (`… ödeme, yeni fatura, zam ya da kontrol eksiği yok.`); `keySeed` gains `kontrol:{day}`; after a successful send
  insert `{ key: "kontrol:{day}", subject, recipients, ok: true }`; the `"sent"` result gains `kontrol: lines + problems`.
- `src/server/notify/digest-template.ts`: export `DigestKontrol` (re-exported type from `src/lib/checklists.ts`),
  `renderDigest(..., kontrol?: DigestKontrol | null)` as the **last optional positional argument** (after ops'
  `system`), `kontrolSection(k)` (HTML + text), subject and headline parts (§3.8).
- `src/server/data/today.ts` (today's loader): `staffFacts` and `adminFacts` both add
  `checklists: safe(loadChecklistDay(day, role)).then(l => l && { day, lists: l })`; `adminFacts` adds
  `checklistsYesterday` for `yesterday`.
- `src/app/panel/bugun/page.tsx`: pass `checklistBoundaries(facts.checklists?.lists ?? [])` to `TodayRefresh`.

### 6.6 Photo access registration

Register `kontrolPhotoAccess` for kind `"kontrol"` in `fotograf`'s registry (a static map entry is preferred, e.g.
`src/server/storage/photo-access.ts` → `kontrol: kontrolPhotoAccess`). Rules (pure `photoAccess`, tested):

- admin → yes;
- staff → the photo belongs to an answer of a run dated today or yesterday (business day);
- staff → a photo not (yet / any more) attached to an answer: only its uploader (`createdBy`).

---

## 7. Files

### Add

| File | Content |
|---|---|
| `src/lib/checklists.ts` | §5.1 |
| `src/lib/checklist-seed.ts` | §5.4 |
| `src/server/data/checklists.ts` | §6.1 |
| `src/server/actions/checklists.ts` | §6.2 |
| `src/app/api/kontrol/foto/route.ts` | §6.3 |
| `src/server/same-origin.ts` | shared `sameOrigin` (only if `fotograf` does not provide one) |
| `src/app/panel/kontrol/page.tsx` | §3.3 |
| `src/app/panel/kontrol/tabs.tsx` | admin `SegmentedLinks` (server component) |
| `src/app/panel/kontrol/list-card.tsx` | today's list card (shared by index and Phase 2 records list) |
| `src/app/panel/kontrol/[id]/page.tsx` | §3.4 server part |
| `src/app/panel/kontrol/[id]/run-form.tsx` | `"use client"`: sticky progress, sections, check / number / text items, optimistic ticks, overlays, focus refresh |
| `src/app/panel/kontrol/[id]/photo-item.tsx` | `"use client"`: capture, `compressImage`, upload with `fetch` + `AbortController` (60 s), retry, retake, preview, viewer |
| `src/app/panel/kontrol/photo-viewer.tsx` | `"use client"`: thumbnail button + `Dialog` (used by the form and the history) |
| `src/app/panel/kontrol/run-view.tsx` | read-only run (history day view) |
| `src/app/panel/kontrol/gecmis/page.tsx` | §3.5 |
| `src/app/panel/kontrol/duzenle/page.tsx`, `duzenle/templates-client.tsx` | §3.6 list + "Yeni liste" dialog |
| `src/app/panel/kontrol/duzenle/[id]/page.tsx`, `duzenle/[id]/template-editor.tsx` | §3.6 template page |
| `tests/kontrol-listeleri.test.ts` | §9 |
| `docs/KONTROL-LISTELERI.md` | §10 |
| `drizzle/00NN_kontrol_listeleri.sql` + `drizzle/meta/*` | generated at merge time |

### Change

| File | Change |
|---|---|
| `src/server/db/schema.ts` *(shared)* | §4 (after `fotograf`'s `photos`) |
| `scripts/seed.ts` | `ensureChecklistSeed(db)` on both paths |
| `src/lib/roles.ts` *(shared)* | `STAFF_PATHS` + `"/panel/kontrol"`; comment ("açılış / kapanış kontrol listelerini doldurur") |
| `src/components/panel/nav.ts` *(shared)* | `ListChecks` import; NAV_GROUPS item; NAV_TREE node; SHORT_TITLES (§3.1) |
| `src/server/actions/notifications.ts` *(shared)* | group `"kontrol"`, `checklistNotifications`, placement (§3.7) |
| `src/components/panel/notifications.tsx` *(shared)* | group entry after `kasa`, `ListChecks` icon; header comment mentions kontrol |
| `src/server/notify/digest.ts`, `digest-template.ts` *(shared)* | §6.5 |
| `src/app/panel/bugun/logic.ts`, `src/server/data/today.ts`, `src/app/panel/bugun/page.tsx`, `src/app/panel/bugun/today-refresh.tsx` *(today's files)* | §5.2, §6.5, refresh boundaries |
| `src/app/api/faturalar/[id]/belge/route.ts` | import the shared `sameOrigin` (only if moved) |
| `src/server/storage/photo-access.ts` (or `fotograf`'s registry) | one entry (§6.6) |
| `src/app/panel/yardim/page.tsx`, `README.md`, `docs/BILDIRIMLER.md`, `docs/BUGUN.md`, `docs/TASARIM.md` | §10 |
| `tests/bugun.test.ts`, `tests/hatirlaticilar-digest.test.ts`, `tests/roller.test.ts`, `tests/mobile-nav.test.ts` | §9 |

`next.config.ts` is **not** changed (camera policy, §2.9; body size is irrelevant to a Route Handler upload of ≤ 3 MB).
`src/app/panel/page.tsx` (Genel bakış) is not touched.

---

## 8. Edge cases and interactions

- **Midnight and 05:00.** Kapanış 22:00–02:00: at 01:00 it is open, at 03:00 late, at 05:00 it belongs to yesterday
  (history "Yapılmadı" / "{x} eksik"). A run started before 05:00 can be finished until 05:30. The fill page open
  across 05:00 refreshes itself on the first refused save.
- **Early filling.** Filling Kapanış at 10:00 is allowed (no lock), Bugün shows it as started, history flags
  `Erken dolduruldu (10:12)`.
- **Template edited during the day.** A started run keeps its snapshot; items added later apply from the next day.
  Editing before anyone answered applies today. The editor's description says so.
- **Template activated / created mid-day** (and the first deploy): `activeFrom` is after today's window opening → not
  expected today → no "gecikti", no bell, no e-mail. A list whose window opens later today applies today.
- **Weekday change.** Applies to future days; history uses the current weekdays for days without runs (documented
  approximation, like the "kafe kapalı" case).
- **Closed day.** No marker (same decision as today.md §9.5). Bugün and the e-mail say "kasa raporu da yok; kafe
  kapalıysa önemsemeyin" when there is no cash report either.
- **Two phones, same list.** Each item is an independent upsert on `(run_id, item_id)`; the run row is locked
  `FOR UPDATE` so completion is written once. The last writer of an item wins; the earlier version goes to `history`.
- **Retake.** The new photo is saved first, the answer points to it, the old photo is deleted after the response.
  A failed DB write deletes the new photo. Orphans can only come from a crash between the two steps; they expire after
  60 days with every other kontrol photo.
- **Photo expired.** `photoId` becomes null (FK `SET NULL`), `photoAt` stays → "60 günden eski olduğu için silindi".
- **Upload fails / no signal.** The compressed blob stays in memory; `Tekrar dene` resends it. Leaving the page drops
  it (acceptable; the item stays unanswered and the list stays incomplete).
- **Server Action queue.** Ticks queue behind each other (fine, they are tiny); photos never block them (Route Handler).
- **iPhone / Android.** iOS gives a JPEG for `accept="image/*"` captures; Android captures JPEG. Re-encoding through a
  canvas strips EXIF (location) — `fotograf`'s helper must keep the orientation (§11).
- **Desktop admin.** `capture` is ignored; the file chooser opens. Allowed.
- **Shared staff account.** Attribution is per account; if staff share one login, "kim" is that account (same limit
  as the cash report today).
- **Activity (hidden routes).** See §3.4 client state rules; Bugün refreshes itself at list boundaries.
- **Previews share the production DB** and skip migrations (R1), so a preview of this branch before merge has no
  tables: `/panel/kontrol` would error, while Bugün (`safe()`), the bell (`.catch`) and the digest (`.catch`) degrade
  silently. Expected; same as every migration branch.
- **Local dev without Blob.** Works through `fotograf`'s filesystem / DB driver.
- **Photos never leave the panel.** Only `/api/foto/{id}` URLs in pages; none in e-mails, toasts, logs or push.

---

## 9. Tests (`npx tsx --test`)

**`tests/kontrol-listeleri.test.ts`** (new). Fixed instants, e.g. `new Date("2026-10-22T11:00:00Z")` = 14:00 TR.

1. `parseClock`, `businessMinuteOfClock`, `nowBusinessMinute`: 05:00 → 0, 04:59 → 1439, 22:00 → 1020, 02:00 → 1260.
   `checklistDay(now) === businessDate(now)` for 04:59, 05:00, 12:00, 23:59 TR.
2. `windowError`: `08:00–11:00` ok; `22:00–02:00` ok; `11:00–08:00`, `04:00–06:00` → `Son saat başlangıçtan sonra
   olmalı (gün 05:00'te döner)`; `08:00–08:10` → `Aralık en az 15 dakika olmalı`; bad format.
3. `listState` across a day for Açılış (07:00 before, 09:00 open, 12:00 overdue, complete → done) and Kapanış (21:00
   before, 23:30 open, 01:00 open, 03:00 overdue, next day → missed); an early answer turns `before` into `open`.
4. `appliesOn`: weekday filter on the *business* day (Saturday 01:30 → Saturday's Kapanış); created at 14:00 → Açılış
   not today, Kapanış today; deactivated yesterday → not today; event lists ignore weekdays.
5. `inRange` / `rangeText` / `valueText`: 0–4 inclusive (4 ok, 4,1 issue, −0,5 issue); freezer −30…−18
   (`-30 – -18 °C`); min only, max only, none (always ok). `parseReading("18", true) === -18`, `"−18"` and `"-18,5"`.
6. `runSummary`: optional items do not block completion; `missing` order; `photosLeft`; contributors in first-answer
   order; open vs corrected issues (`6 °C → 3,5 °C`).
7. `nextVersions`: unchanged answer adds nothing; a change adds the previous version; cap 10.
8. `canAnswerDay`: today yes; yesterday at 05:20 with a run yes, without a run no; yesterday at 05:40 no; tomorrow no.
9. `photoAccess`: admin any; staff today / yesterday yes, 2 days ago no; unattached photo only for its uploader.
10. `listTitle` ("Açılış" → "Açılış listesi", "Haftalık liste" unchanged), `lowerFirst("İçecek")` → `içecek`,
    `whoText` (1, 2, 3, 5 names), `clip`.
11. `checklistBell`: staff gets only `staffAllowed` lists, only today, `info` when open and `warning` + unread when
    late, nothing before the window or after completion; admin gets `gecikti` (today), `eksik` (yesterday,
    "hiç açılmadı" text), `sorun` (danger for range, warning for check; max 5; id changes with the version count).
    No item text contains `₺`, `/api/foto` or `blob`.
12. `digestKontrol` / `kontrolSubjectPart` / `kontrolHeadline`: complete day → null; one list missing → `dünkü kapanış
    listesi eksik`; two → `dünkü 2 kontrol listesi eksik`; only a range problem → `kontrol listesinde aralık dışı
    değer`; more than 5 problems → `more`; `cashMissing` flag; event lists contribute problems only.
13. `checklistBoundaries`: Açılış + Kapanış → `[480, 660, 1320, 120]` (TR minutes), deduplicated.
14. Seeds (`DEFAULT_CHECKLISTS`): names unique; every daily template passes `windowError`; labels unique within a
    template and ≤ 120 chars; every number item has `min ≤ max` and a unit; each active template has ≥ 1 photo item and
    ≤ `MAX_PHOTO_ITEMS`; Phase 2 templates are `active: false`; the Kapanış list mentions microphones
    (`/mikrofon/i`).
15. Source checks (`readFileSync`, repo pattern):
    - `src/app/api/kontrol/foto/route.ts` contains `sameOrigin(` and `getCurrentUser(` and `savePhoto(`;
    - `src/app/panel/kontrol/gecmis/page.tsx` and `duzenle/**/page.tsx` call `requireAdmin(`;
    - no file under `src/app/panel/kontrol/` imports `loadModel`, `@/lib/calc` or calls `tl(` / `money(`;
    - `src/server/actions/checklists.ts`: every admin action name appears after a `requireAdmin()` in its body
      (simple regex per exported function), `answerChecklistItem` uses `requireUser`.

**`tests/bugun.test.ts`** (extend; today's file):

- staff 09:00: `liste-{Açılış}` `todo`, is `next`; `liste-{Kapanış}` `later` with badge `22:00–02:00`;
- staff 12:00 Açılış not started → `warn` `Gecikti`, detail ends with `Gün 05:00'te kapanır.`;
- started 3 / 12 with 1 photo missing → badge `3 / 12`, detail `… 1 fotoğraf kaldı.`;
- complete with an out-of-range value: admin `warn` `1 sorun`, staff `done` `… 1 sorun bildirildi`;
- `liste-dun` only for admin, only with problems, the "kasa raporu da yok" suffix when `cash.yesterday` is null;
- `checklists: null` → `liste` `later` `Okunamadı`;
- order: staff at 23:00 → `next` is Kapanış (before `zayi` and `kasa`);
- `nextRefreshAt(now, [660])` at 10:00 → 11:00.

**`tests/hatirlaticilar-digest.test.ts`** (extend): `renderDigest([], today, null, null, null, kontrol)` →
subject `Sabah özeti: dünkü kapanış listesi eksik`; with payment rows the subject ends with
`· dünkü kapanış listesi eksik`; the HTML contains `Kontrol listeleri · 21 Ekim Salı`, the link
`/panel/kontrol/gecmis?gun=2026-10-21`, an escaped note (`<b>` → `&lt;b&gt;`), and no `/api/foto`.

**`tests/roller.test.ts`**: `canOpen("staff","/panel/kontrol")` and `"/panel/kontrol/3"`; the existing "menu role =
access rule" and "every staff screen is in the staff menu" tests cover the new item.

**`tests/mobile-nav.test.ts`**: `mobileTitleFor("/panel/kontrol") === "Kontrol listeleri"`,
`"/panel/kontrol/7" → "Kontrol listeleri"`, `"/panel/kontrol/gecmis" → "Kontrol geçmişi"`,
`"/panel/kontrol/duzenle/2" → "Listeleri düzenle"`. Bottom bars unchanged.

**Existing tests that must keep passing unchanged:** `yardim` (`<Path href="/panel/kontrol" />` resolves to
`["Kontrol listeleri"]`; no kontrol tab in `SECTION_TABS`), `kenar-cubugu` (each href once), `kasa-raporu`.

**Manual (390 px and 1280 px, admin and staff, local DB with the seed):** fill Açılış on a phone (real camera on
Android Chrome and iPhone Safari with the current `camera=()` header), an out-of-range freezer value with the `−` prefix,
retake, a failed upload (offline mode) and retry, two browsers on the same list, Bugün rows before / during / after
the window (inject `now` or change the system clock), the bell for both roles, history with expired photo (set
`expires_at` in the past and run `fotograf`'s sweep), the editor (add, move, archive, restore, window crossing
midnight), and `POST /api/cron/gunluk` locally with `CRON_SECRET` to see the e-mail section (Resend test mode).
Then `npm run lint`, `npx tsc --noEmit`, `npm test`.

---

## 10. Docs and help

- **`docs/KONTROL-LISTELERI.md` (new):** what the lists are for (records for inspections); templates, item types,
  required / optional; time window and the 05:00 day; who can fill; no back-filling (+ 05:30 grace); snapshot rule;
  photos (camera, compression, 60 days, who can see them); Bugün rows; bell items; e-mail section; history; editor;
  Phase 2 lists; files (`src/lib/checklists.ts`, `checklist-seed.ts`, `src/server/data/checklists.ts`,
  `src/server/actions/checklists.ts`, `src/app/api/kontrol/foto/route.ts`, `tests/kontrol-listeleri.test.ts`).
- **README.md:** screen table row `Kontrol listeleri: fotoğraflı açılış ve kapanış listeleri (tamam, fotoğraf,
  sıcaklık aralığı, not), Bugün'de satır olarak; yöneticiye geçmiş (kim, ne zaman, eksik, aralık dışı, fotoğraf) ve
  liste düzenleme ([docs/KONTROL-LISTELERI.md](docs/KONTROL-LISTELERI.md))` | `/panel/kontrol`,
  `/panel/kontrol/[id]`, `/panel/kontrol/gecmis`, `/panel/kontrol/duzenle` | — (yeni). API row gains
  `/api/kontrol/foto`. Staff paragraph: `Kontrol listeleri`. `db:reset` "Silmedikleri": `kontrol listeleri ve kayıtları`.
  `lib/` tree: `checklists.ts`, `checklist-seed.ts`.
- **docs/BILDIRIMLER.md:** "Ne listelenir" gains the Kontrol listeleri group (admin and staff items); "E-posta" gains
  the kontrol section and its once-per-day key `kontrol:{gün}`.
- **docs/BUGUN.md (today's):** rows `liste-{id}`, `liste-dun`, `kayit-{id}` with their rules; refresh boundaries.
- **docs/TASARIM.md §3:** NAV_TREE gains "Kontrol listeleri".
- **Yardım (`src/app/panel/yardim/page.tsx`):** FAQ item in "Gider, ödeme ve ekip":
  `id: "kontrol"`, `q: "Açılış ve kapanış listeleri"`, icon `ListChecks`, answer:
  `Personel sabah açılışta ve gece kapanışta <Path href="/panel/kontrol" /> listesini telefondan doldurur: maddeyi
  işaretler, buzdolabı sıcaklığını yazar, istenen yerde fotoğraf çeker. Sıcaklık aralık dışındaysa not ister ve size
  bildirilir. Listeler Bugün ekranında görünür; yapılmayan liste ertesi sabah e-postada çıkar. Maddeleri ve saatleri
  Kontrol listeleri › Listeler'den, geçmişi Kontrol listeleri › Geçmiş'ten görürsünüz. Fotoğraflar 60 gün saklanır.`
  links `[{ href: "/panel/kontrol", label: "Kontrol listeleri" }]`. The "Bildirim zili" FAQ adds
  `Kontrol listeleri` (geciken ve eksik listeler, aralık dışı değerler) to its list of groups.

---

## 11. Needs from `fotograf`

Consumed as given: `savePhoto({ kind, bytes, contentType, userId, expiresAt }) → { id }`, `readPhoto(id)`,
`deletePhoto(id)`, kind `"kontrol"`, table `photos`, `GET /api/foto/[id]` with a per-kind checker,
`compressImage(file, { maxEdge: 1600, quality: 0.7 }) → Blob`. Additions / confirmations needed:

1. **`photos.id` type.** Needed for `checklist_answers.photo_id` (assumed `text`).
2. **Hard delete.** Expiry and `deletePhoto` delete the `photos` row (so `ON DELETE SET NULL` clears answers). If rows
   are soft-deleted, say so; kontrol then drops the FK and treats `readPhoto(id) === null` as gone.
3. **Daily expiry sweep owned by `fotograf`** (inside `/api/cron/gunluk`), deleting both the Blob object and the row
   for every kind. Kontrol only sets `expiresAt = now + 60 days`.
4. **Checker registry form and signature.** Proposed: a static map in a server-only file
   (`kontrol: kontrolPhotoAccess`), signature `(user: CurrentUser, photo: { id; kind; createdBy: number | null;
   createdAt: Date }) => Promise<boolean>`. A `false` answer → 404 (do not reveal existence).
5. **`deletePhoto` is idempotent** (no throw when already gone) and safe inside `after()`.
6. **`compressImage`** applies EXIF orientation, strips EXIF (location) by re-encoding, returns `image/jpeg`, and throws
   a recognisable error (e.g. `PhotoCompressError`) for unreadable files.
7. **`savePhoto` derives `width` / `height`** from the bytes, or accepts optional `{ width, height }` (kontrol can send
   them from the client after compression).
8. **`GET /api/foto/[id]`** sends `Cache-Control: private` and `X-Content-Type-Options: nosniff`; works for `<img>`
   with the session cookie. *Nice to have, not required:* a `?w=400` thumbnail variant for the history grid.
9. **Shared `sameOrigin(request)`** exported from a server module (kontrol's upload route and `fotograf`'s own upload
   routes need the same check). If not, kontrol adds `src/server/same-origin.ts` (§6.3).
10. **Local driver** (no `BLOB_READ_WRITE_TOKEN`) works for `savePhoto` called from a Route Handler on `npm run dev`.

---

## 12. Dependencies on other plans (and fallbacks)

| Plan / module | Used for | If absent |
|---|---|---|
| **fotograf** (`src/server/storage/photos.ts`, `photos` table, `/api/foto/[id]`, `src/lib/photo-compress.ts`) | photo items | Hard dependency: merge after `fotograf`. Without it, ship nothing of the photo type (no partial feature) |
| **today** (`src/app/panel/bugun/logic.ts` `DayFacts`/`dayTasks`/`nextRefreshAt`, `src/server/data/today.ts` `staffFacts`/`adminFacts`, `TodayRefresh`) | Bugün rows | Skip §5.2 / §6.5 Bugün parts; `/panel/kontrol` is the day view; the "Bugün'e dön" links point to `/panel/kontrol`. Add the rows when today lands |
| **ops-jobs** (`renderDigest` 5th arg `system`, R5 subject precedence, `job_runs`) | digest placement | Append `kontrol` as the 5th optional argument instead of the 6th and put `kontrolPart` into today's subject chain at the "Sabah özeti" step |
| **R4 `renderDigest` "nobody else changes the signature"** | — | This plan appends one optional positional argument (deviation). If another batch-2 group also needs a digest part, the lead folds them into one `more?: { kontrol?, … }` argument at merge; `kontrolSection` is self-contained, so the move is mechanical |
| **kasa** | — | No coupling (Bugün's `cash.yesterday` is today's fact) |
| **adminstepup** | — | Not used (no admin-affecting action) |
| **ops-backup** | — | Tables covered automatically (R6) |

Merge order: after `fotograf` (FK, R2: one migration at a time, generated at merge), and after `today` if possible.

---

## 13. Owner decisions (defaults implemented; nothing blocks)

1. **Saatler:** Açılış 08:00–11:00, Kapanış 22:00–02:00. Kafenin gerçek açılış / kapanış saatine göre değiştirin
   (Listeler ekranından da değişir).
2. **Geçmiş gün doldurulamaz** (yönetici dahil); başlamış liste 05:30'a kadar bitirilebilir. Kayıtların güvenilir
   olması için. *Seçenek:* yönetici için dün açık kalsın.
3. **Fotoğraflar 60 gün** saklanır; kayıtlar (işaretler, sıcaklıklar, notlar) silinmez.
4. **Aralık dışı sıcaklık** not ister, size zilde ve ertesi sabah e-postada bildirilir; yeniden ölçülen değer ilk
   ölçümü silmez.
5. **Personel zili:** aralık açılınca "bekliyor" (sessiz), son saat geçince "gecikti" (okunmamış).
6. **Sabah e-postası:** dünkü eksik listeler ve sorunlar tek bölümde; o gün kasa raporu da yoksa "kafe kapalıysa
   önemsemeyin" notu. Kapalı gün işareti yok.
7. **Yalnız kamera:** telefonda galeriden eski fotoğraf seçilmesin diye doğrudan kamera açılır. *Seçenek:* galeri de.
8. **Örnek maddeler** (Açılış 13, Kapanış 16 madde; mikrofon temizliği kapanışta) bir başlangıç; gıda güvenliği
   danışmanınızla gözden geçirip Listeler ekranından değiştirin.
9. **"Her seferinde" listeler** (Oda sıfırlama, Mal kabul) hazır ama pasif gelir; isterseniz tek dokunuşla açılır.

---

## 14. Risks and integration notes

- **Camera and `Permissions-Policy: camera=()`.** Expected not to affect `<input capture>` (it opens the OS camera, not
  `getUserMedia`). Verify on Android Chrome and iPhone Safari before merge. If a browser blocks it, change only the
  `/panel` rule in `next.config.ts` to `camera=(self)` (one word; note it in the PR).
- **iOS minus key.** Handled by the `−` prefix / `±` toggle; test on an iPhone.
- **Shared files** (additive edits, rebase carefully): `schema.ts` + migration (R2), `notifications.ts` and
  `notifications.tsx` (new group), `digest.ts` / `digest-template.ts` / digest test (R5 subject chain, new argument),
  `nav.ts` / `roles.ts` / nav tests, today's `logic.ts` / `today.ts` / `page.tsx` / `today-refresh.tsx` /
  `bugun.test.ts` / `BUGUN.md`, `scripts/seed.ts`, Yardım, README, BILDIRIMLER.md, TASARIM.md.
- **Contract with parallel group `fotograf`:** §11 items 1, 2 and 4 must be settled before coding the schema and the
  route.
- **Migration order:** the FK to `photos` makes this migration depend on `fotograf`'s. Generating it after a rebase
  onto a main that has `photos` is enough (R2).
- **Bell cost:** +2 small queries per shell open (3 for admin). Bugün: +3 queries. No `loadModel`.
- **Time zone** assumed UTC+3 with no DST, same as the rest of the code (`trClock`, `businessDate`).
- **Records are only as honest as the people filling them** (early filling, shared logins). History shows times and
  flags early / late filling; it does not prevent them.
- **Scope cut line:** if time is short, cut Phase 2 (§3.9) first, then the history stats row (§3.5); keep Bugün rows,
  bell and e-mail (the owner's ask and the alert requirement).

## 15. Next.js docs relied on

- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` — sequential dispatch (photos via Route Handler),
  1 MB default body limit, auth inside every action.
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` — Route Handler, `params` as a
  Promise, `request.formData()`.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/connection.md` — request-time Route Handler.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` — delete the replaced photo after the
  response.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md` — `refresh()` only in Server Actions
  (client `router.refresh()` after the upload).
- `node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md` — "Fix synchronous IO": read
  `new Date()` after the request-time read inside Suspense.
- `node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md` — Activity keeps the fill page mounted; key and
  overlay strategy of §3.4.
