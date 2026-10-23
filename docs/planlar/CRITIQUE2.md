# Critique of the second batch (kontrol, komisyon, fotograf, siparis, mcp, tahmin, doluluk, haftalik)

Base: `claude/kalan-isler` = main 099dc8a + `docs/planlar` (c23fe72). I read the eight plans in full, plus BRIEF2,
KALAN-ISLER, DIGER-OTURUM, CRITIQUE (R1–R7 stay in force), ekle and the batch-1 plans they build on (today, ops,
insight, kdv, kasa, menu, pricing, vkn), and checked their claims against the code, the ops-backup and vkn worktrees
and the local DB. Verified:

- `src/app/api/cron/gunluk/route.ts`: `maxDuration = 60` (:21). The Paraşüt retry runs first with
  `deadlineMs: 35_000` (:42). `extras()` (reminder push, karaoke, menu and sales syncs, 8 s site timeout each) runs
  **after** the digest, not beside it (:72, :76).
- `src/lib/job-health.ts:180, 209`: `DailyStep` is a closed union and `dailyOutcome` requires every key. Four plans
  each add a required key.
- `src/server/notify/resend.ts:55, 66`: three attempts, 15 s timeout, 2 s / 4 s back-off. A hanging Resend alone can
  take about 51 s.
- `renderDigest(rows, today, invoices?, prices?, system?)` (`digest-template.ts:107`); `esc`, `FONT` and
  `emailLayout` are module-private (:12, :20, :67).
- Bell groups are `sistem | hatirlatici | onay | kasa | odeme | fatura | uyari` (`notifications.ts:33`); the staff
  branch returns at :243. `STAFF_PATHS` (`src/lib/roles.ts:14`) has no admin-only carve-out under a staff path.
- ops-backup WIP: `TABLE_RULES` is in `src/lib/backup/format.ts:70`. The guard
  `SECRET_NAME = /password|secret|token|hash|totp|recovery|vapid|key|p256dh|^auth$/i` (`tests/yedek.test.ts:139`)
  fails on any matching column of a non-skipped table that is neither dropped nor in `NOT_SECRET`.
- vkn WIP: `supplierResolver(cards, refs).resolve(supplier, taxNumber?)` and
  `loadTermDays(): (supplier, taxNumber?) => …` are as R4 fixed them.
- `db:reset` truncates the Excel tables plus `expense_entries` with CASCADE (`scripts/seed.ts:79–80`) and deletes only
  the `parasut.%`, `payments.*` and `menu_sync` keys (:88–91). Pre-existing doc bug: `README.md:120` says monthly
  expense entries survive; they have not survived since 3bab390.
- Karaoke contract: `src/lib/karaoke/site.ts:11–27` carries `createdAt` and `updatedAt` but no `cancelledAt`; the
  panel asks for `from = yesterday`, `to = from + 90` (`sync.ts:87–88`). **Checked in the site repo (laffogato
  119c378, 22 Oct):** `GET /api/panel/karaoke` already serves past windows: `parsePanelRange` has no lower bound,
  defaults to yesterday → +90 and allows a span of up to 400 days (`PANEL_MAX_SPAN_DAYS`,
  `src/lib/panel/karaoke-sync-core.ts:194, 230`); `listReservationsForAdmin` filters by day only, and
  `toPanelReservation` maps every status, cancelled, refunded and expired included. The site's table has no
  cancellation-time column, so there is no `cancelledAt` to send.
- Site KVKK retention (laffogato #196): guest data of karaoke bookings (name, contact, note) is cleared after
  3 × 366 days, and bookings are deleted after 11 × 366 days. The panel's copy (`karaoke_sessions.customer_name`,
  `note`) must follow the first rule (doluluk, item 5 below).
- `src/app/panel/karaoke/page.tsx` holds the other session's `OrdersBoard` and `maxDuration = 30` (#9), and computes
  `monthStats` itself (:21, :41). The Paraşüt sync reads only `purchase_bills` and supplier contacts
  (`sync.ts:477, 717`).
- `next.config.ts`: `X-Frame-Options: DENY` everywhere (:9); `camera=()` on the panel (:21) governs `getUserMedia`,
  not `<input capture>`; non-API paths on `lafmaliyet.vercel.app` redirect to `ladmin` (:50). `safeNext` accepts
  `/panel…` only (`auth.ts:70`); `StepUpWhere` is `Hesabım | Kullanıcılar | Yedek` (`step-up.ts:22`).
- Local DB: 10 Komisyon invoices (Trendyol Go 7, Pluxee 1, Set Kart 1, Yemek Sepeti 1) and 0 bill lines; 0 cash
  reports and 0 karaoke rows; `sales_lines` only for 2026-09, `months` 2026-07…10. This matches komisyon and tahmin.
- Batch-1 modules that batch 2 reads are not on main yet: `bugun/*`, `price-loss.ts`, the cash plan, `cash-month.ts`,
  `prices.ts`, `supplier-prices.ts`.

**Verdict.** Every plan solves the owner's ask and follows the conventions (attempt/UserError, zod, refresh,
logActivity, pure logic plus tests, generated migrations, Suspense plus PageHeader). The data models do not collide:
seven additive migrations, and the only change to an existing table is two nullable karaoke columns. The risks are
integration and size:

1. **Three signatures change incompatibly:** `renderDigest` (kontrol and tahmin each want a 6th positional argument;
   komisyon extends `DigestInvoices`), `dailyOutcome` (tahmin, fotograf, siparis and haftalik each add a required
   step) and `sendEmail` (haftalik). → R8, R11, R15.
2. **The morning job is already over budget in its worst case** (a 35 s retry plus a hanging Resend exceeds 60 s), and
   tahmin, fotograf (a 15 s sweep), siparis, mcp and haftalik all add to it. → R15.
3. **The other session's code.** doluluk edits the karaoke sync, its parser and the shared karaoke page; komisyon and
   fotograf both edit the kasa form; doluluk's history import needs site behaviour that is not documented. → §3, §9.
4. **fotograf and kontrol disagree on the photo contract:** id type, access signature, size cap, retention, 403 vs
   404. → R9.
5. **Size.** The eight plans total about 9,700 lines, with extras the owner did not ask for: nightly per-card fields,
   invoice-text parsing, learned factors, event checklists, three extra MCP tools, a supplier-page card and a second
   photo entry point. → §7.
6. **Wrong place.** tahmin's weather point is MaviBahçe, İzmir; the café is in Tuzla, Opera AVM. → R19.

---

## 1. Rules for every group (R8–R19; R1–R7 unchanged)

### R8. One shared plumbing PR first (W2.0; no migration; the lead; about one day)
After batch 1 and ekle are merged, and before any batch-2 group merges, one PR lands the shared seams. Groups then
only append:

1. **`src/lib/job-health.ts`:** `CoreStep = "sync" | "digest" | "reminders" | "karaoke" | "menu" | "sales"`,
   `OptionalStep = "forecast" | "photos" | "count" | "weekly"`, `DailyStep = CoreStep | OptionalStep` and
   `dailyOutcome(steps: Record<CoreStep, StepResult> & Partial<Record<OptionalStep, StepResult>>)`. Order: digest,
   sync, reminders, karaoke, menu, sales, forecast, photos, count, weekly; a missing optional key writes nothing.
   `STEP_NAMES` / `STEP_LABELS` for the four new steps (R15).
2. **`src/server/jobs/capped.ts`:** `capped<T>(p: Promise<T>, ms: number, onTimeout: T)`, a race with a cleared timer.
3. **The gunluk route:** `jobStart = Date.now()` right after `rejectUnlessCron`; tail steps get
   `deadlineAt = jobStart + 55_000`, the digest `sendDeadlineAt = jobStart + 48_000`.
4. **`sendEmail(msg, opts?: { timeoutMs?: number; attempts?: number; deadlineAt?: number })`:** the failure result
   gains `uncertain?: true` (timeout, network or 409 on the last attempt). Without options it is byte-identical.
5. **`digest-template.ts`:** `DigestBox`, `DigestExtras`, the 6th parameter `extras?`, box rendering and the extended
   precedence (R11); it exports `emailLayout` (with an optional `footer`), `esc` and `FONT`.
6. **`src/server/notify/digest-extras.ts`:** `DIGEST_EXTRA_SOURCES` (empty) and `loadDigestExtras(today)`;
   `runReminderDigest` uses them for news, the idempotency seed and the log rows.
7. **`src/server/same-origin.ts`:** `sameOrigin(request)`, moved from `src/app/api/faturalar/[id]/belge/route.ts:60`
   (the belge route imports it).
8. **`src/server/data/daily-sales.ts`:** the ModPOS seam (R18).

Tests: `gunluk-isler` (optional steps), `hatirlaticilar-digest` (boxes, precedence, footer) and `capped`; existing
expectations stay unchanged.

### R9. Photos and `/api/foto/[id]` (owner: fotograf; kontrol reuses)
| Piece | Fixed contract |
|---|---|
| Storage (`src/server/storage/photos.ts`, server-only) | `savePhoto({ kind, bytes, contentType, userId, expiresAt? }) → { id: number }`, `getPhoto`, `readPhoto`, `keepPhoto(id, until, tx?)`, `releasePhoto(id, days?, tx?)`, `deletePhoto(id)` (a missing row is a no-op; a driver failure throws, so callers inside `after()` add `.catch`), `photoStorage()`, `cleanupPhotos({ limit, deadlineAt })` |
| Id and kind | `photos.id` is a **serial integer**, so kontrol's `photo_id` is `integer`, not `text`. `kind` is `"kasa-z" \| "kasa-pos" \| "fis" \| "kontrol"`, a text column with a TS enum: a new kind needs no migration |
| Checks (inside `savePhoto`, so routes do not repeat them) | `MAX_PHOTO_BYTES` = 2 MB (kontrol's 3 MB goes); `sniffMime` JPEG / PNG / WebP (PDF and HEIC refused); `imageSize` between 200 and 4096 px. Routes add `sameOrigin` (R8), `getCurrentUser` and 30 uploads per hour per user |
| Linking | Every upload starts unlinked and expires in 2 days. The record that uses the photo calls `keepPhoto(id, until, tx)` in its own transaction; kontrol uses `addDays(now, 60)` inside `writeAnswer`. `linkedAt` is therefore always set, and the uploader-only view rule ends |
| Retention (`keepUntil`) | kasa 180 d, fiş 400 d, kontrol 60 d (fotograf's test says 90: fix it), unlinked 2 d, released 7 d, deleted report 30 d. The sweep belongs to fotograf (R15) |
| Access (`src/server/storage/photo-access.ts`) | Static registry `PHOTO_RULES: Record<PhotoKind, { canView(me, photo: PhotoRow): Promise<boolean>; keepDays: number }>`. kontrol replaces the `kontrol` entry with its `photoAccess` rules. Admin always; staff per kind. Denied → **403** `Bu fotoğrafı görme yetkiniz yok.`: ids are serial and every caller is logged in, so the clearer text wins over hiding that the photo exists |
| Serving | Only `GET /api/foto/[id]`: auth, then the rule, then the bytes with `Cache-Control: private, max-age=3600`, `nosniff` and `CSP: default-src 'none'; sandbox`. It never redirects. A Blob URL never appears in a page, e-mail, toast, push or log |
| Drivers | `BLOB_READ_WRITE_TOKEN` → Blob with `access: "private"`, `addRandomSuffix: false`, `allowOverwrite: false`. Otherwise on Vercel → `none` (no photo UI anywhere). Otherwise → fs `.data/photos`. Tests → memory |
| Client | `compressImage(file, PHOTO_COMPRESS)` in `src/lib/photo-compress.ts` (lead decision at merge, 22 Oct: `{ maxEdge: 2576, maxPixels: 3_700_000, quality: 0.7, maxBytes: 1_800_000 }`, Claude's high-resolution limit, instead of the first `{ maxEdge: 1600, quality: 0.7 }`, because a long Z in one 1600 px photo left the roll ~270 px wide): a JPEG re-encode that drops EXIF / GPS and throws `PhotoCompressError`. Input: `<input type="file" accept="image/*" capture="environment">`. `camera=()` stays; check on Android Chrome and iPhone Safari before kontrol merges |
| Blob store | Private, fra1, **connected to Production only**: previews share the production DB, and unreviewed code must not write photos. Until the store is connected, the photo buttons stay hidden |

### R10. Claude client (owner: fotograf)
Files: `src/server/ai/claude.ts` (server-only), `run.ts` (no DB, tested) and `pricing.ts`.

- **Model:** `AI_MODEL = "claude-opus-5-5"`, $4 / $20 per MTok (cache read $0.20). A fallback run is priced at its own
  model (Opus 5, Opus 4.8: $5 / $25).
- **Request:**
  ```ts
  client.beta.messages.create({
    model, max_tokens: 6000,
    betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system, messages,
  })
  ```
- **Never sent:** a `thinking` key (Opus 5.5 is always adaptive; `disabled` is a 400), `temperature` / `top_p` /
  `top_k` (400), an assistant prefill (400). Opus 5.5 defaults to effort `medium`, so `low` is set explicitly.
- **Response:** `stop_reason === "refusal"` is checked before the content is read; `max_tokens` → `incomplete`; blocks
  are read by `type` (a `fallback` block can come first); cost and the fallback flag come from `usage.iterations`.
- **Timeouts** in ms: `{ timeout: 20_000, maxRetries: 1, signal: AbortSignal.timeout(45_000) }`.
- **No key** (local runs without it; every preview, since the key is Production-only): `aiStatus().state` is
  `"nokey"`; the photo is still saved and one calm line shows. Nothing crashes.
- **Gates:** `off` (the switch), `cap` (40 a day), 3 readings per photo.
- **Key and log:** a test keeps the key server-only; `ai_calls` logs tokens, cost, ms and the request id, never the
  image or the prompt.
- **Users in this batch:** only fotograf calls Claude. kontrol does not read its photos; mcp is the other direction.

### R11. Morning e-mail: one `extras` object
This replaces kontrol's and tahmin's 6th positional argument and komisyon's `DigestInvoices.commission`.
```ts
// src/server/notify/digest-template.ts (W2.0)
export interface DigestBox {
  title: string;                                       // "Komisyon ve hakediş"
  lines: { strong?: string; text: string; tone?: "bad" | "warn" | "muted" }[];
  href: string; link: string;                          // APP_URL'siz panel yolu ve bağlantı metni; foto/Blob adresi asla
  subjectPart: string | null;                          // konuya eklenen parça; null: konuya girmez
  headline: string | null;                             // e-postadaki tek haber buysa başlık
}
export interface DigestExtras { commission?: DigestBox | null; kontrol?: DigestBox | null; forecast?: DigestBox | null }
export function renderDigest(rows, today, invoices?, prices?, system?, extras?: DigestExtras | null)
```

**Who fills what.** `commission` komisyon, `kontrol` kontrol, `forecast` tahmin. Each group builds and tests its box in
its own pure module and appends one entry to `DIGEST_EXTRA_SOURCES`:
`{ key, news: boolean, load(today): Promise<{ box: DigestBox; logKeys: string[] } | null> }`. The runner runs the loads
in parallel, each `capped` at 4 s (a throw becomes `null`), ORs `news` into the "anything new" test, adds `logKeys` to
the idempotency seed and writes them to `notification_log` after a successful send. Keys: `komisyon:<alertKey>` and
`kontrol:<day>`; the forecast has no keys and `news: false`.

**Subject precedence** (R5 extended, implemented once in W2.0):
1. Payments → `Ödeme hatırlatması: …`, then the extras in this order: sistem uyarısı, new invoices, holds, zam,
   `commission.subjectPart`, `kontrol.subjectPart`.
2. Else system → `Sistem uyarısı: <first>`, plus the same extras.
3. Else a sync error without new invoices → `Paraşüt eşitlemesi başarısız`, plus the extras.
4. Else the first of new invoices, review, holds, commission, kontrol → `Sabah özeti: <its part>`, plus the rest.
5. Else zam, or `bugün yeni bir şey yok`.

The forecast box never enters the subject, the headline or the news test. **Body order:** system, payments, invoices,
review, holds, commission, kontrol, zam, forecast, button.

**Subject parts:** komisyon `Hakediş gecikti: Pluxee (Ekim)` (one) / `2 hakediş gecikti` / `komisyon uyarısı`;
kontrol `dünkü kapanış listesi eksik` / `dünkü 2 kontrol listesi eksik` / `kontrol listesinde aralık dışı değer` /
`kontrol listesinde sorun`. haftalik stays a separate e-mail (`renderWeekly` on the exported shell).

### R12. Bell
| Group | New / reuse | Who | Items |
|---|---|---|---|
| `kontrol` ("Kontrol listeleri", after `kasa`, icon `ListChecks`) | new | admin and staff | admin: gecikti / dünkü eksik / sorun; staff: bekliyor / gecikti. The batch's only addition to the staff branch: `[...cash, ...kontrol, ...mine, ...recipes]`; the loader joins the first (both-role) `Promise.all` |
| `fatura` | reuse | admin | komisyon: hakediş gecikti, oran, yasak (≤ 5); siparis: teslim farkı, gelmedi (≤ 5) |
| `kasa` | — | — | fotograf's `kasa-foto-…` item is cut (§6) |

tahmin, doluluk, mcp and haftalik add nothing. Admin loaders join the admin `Promise.all` with `.catch(() => [])`; no
`loadModel()`; at most three small queries per loader. komisyon's bell path uses a light `loadCommissionAlerts()`
(Komisyon invoices of the last 4 months, `commission_months` and the months' Z meal / online totals, name-prefix
matching); the VKN resolver, whose `loadSupplierRefs` reads every invoice, runs only on the page.

### R13. Nav, roles, ⌘K, Yardım, README (additive)
**`NAV_GROUPS`:** Günlük gains `Kontrol listeleri` (`/panel/kontrol`, `ListChecks`, admin and staff) after Kasa
raporu, `Satış tahmini` (`/panel/tahmin`, `TrendingUp`, admin) and `Karaoke doluluğu` (`/panel/karaoke/doluluk`,
`Grid3x3`, admin). Para gains `Komisyon & hakediş` (`/panel/komisyonlar`, `Percent`, admin) after Tedarikçiler. Stok
gains, after Stok sayımı, `Hızlı sayım` (`/panel/hizli-sayim`, **`ClipboardPen`**, admin and staff; `ListChecks` is
kontrol's) and `Mal siparişi` (`/panel/mal-siparisi`, `ShoppingBasket`, admin).

**`NAV_TREE`:** `kontrol` at the top level after the staff-only `kasa`; `para.children`: `tahmin` after
`kasa-raporlari`, `komisyonlar` after `tedarikciler`; `stok.children`: sayim, hizli-sayim, mal-siparisi, zayi,
tutarlilik.

**`SECTION_TABS`:** add `malSiparisi`: Sipariş listesi (`/panel/mal-siparisi`), Hızlı sayım (`/panel/hizli-sayim`),
Gönderilenler (`…/gonderilen`), Kalemler (`…/kalemler`). kontrol keeps its own `SegmentedLinks` (Bugün · Geçmiş ·
Listeler). Karaoke gets no tabs (§3).

**`SHORT_TITLES`:** `/panel/kontrol/gecmis` "Kontrol geçmişi", `/panel/kontrol/duzenle` "Listeleri düzenle",
`/panel/komisyonlar` "Komisyonlar", `/panel/mal-siparisi` "Mal siparişi", `…/gonderilen` "Gönderilenler",
`…/kalemler` "Sipariş kalemleri", `/panel/karaoke/doluluk` "Doluluk".

**`roles.ts`:** `STAFF_PATHS` gains `/panel/kontrol` (kontrol) and `/panel/hizli-sayim` (siparis); doluluk adds
`ADMIN_ONLY_PATHS = ["/panel/karaoke/doluluk"]`, checked first in `canOpen`; `BOTTOM_NAV` and `STAFF_HOME` stay.
mcp's `/baglan`, `/oauth/*`, `/.well-known/*` and `/api/mcp` stay outside the proxy matcher (`proxy.ts:43`).

**Yardım:** one FAQ per group (two for siparis); `<Path>` only for hrefs that `pathOf` resolves (`NAV_TREE` or
`SECTION_TABS`); doluluk's FAQ uses `links` only. **README:** each group adds its own screens row; the `db:reset` line
follows R17.

### R14. Bugün (today.md's loader): rows and cards
| Role | Row order (Şimdi / Sonra / Tamamlananlar keep it) |
|---|---|
| Admin | `isler`, `kasa-dun`, **`liste-dun`**, `odeme`, **`komisyon`**, `fatura`, `urun`, (ekle's optional `fiyat-yok` slot), `onay`, `fiyat-onay`, `zam`, `modpos`, `sayim-gecen`, **`liste-{templateId}`** (by `opensAt`), **`hizli-sayim`**, **`mal-siparisi`**, `kasa`, `sayim-son` |
| Staff | `kasa-dun`, `sayim-gecen`, **`liste-{templateId}`**, **`hizli-sayim`**, `zayi`, `kasa`, `sayim-son` |

At 08:30 staff get Açılış as "Sıradaki"; on a Monday the count comes after it.

**Facts:** `checklists?` (both roles) and `checklistsYesterday?` (admin) from kontrol; `commission?: { overdue: … } |
null` from komisyon (admin, `loadOverduePayouts()`); `reorder?` from siparis (staff call it without `model` and get
no prices); `TodayData.forecast: { admin; staff }` from tahmin. `DayTaskKey` gains `` `liste-${number}` ``,
`liste-dun`, `komisyon`, `hizli-sayim` and `mal-siparisi`; kontrol's `kayit-*` keys are cut.

**Cards:** tahmin's "Satış tahmini" (admin) goes in the right column after "Yaklaşan ödemeler" and before "Bugün
kafede"; staff `cafeLines` start with tahmin's `yogunluk` and `tatli` lines.

**Wiring:** `nextRefreshAt(now, extra?: number[])` (kontrol); every new loader goes through `safe()`; the source test
pins admin-only `loadOverduePayouts` and `loadForecastCard`, staff-only `loadStaffForecast`, and both-role
`loadChecklistDay` and `loadReorderDay`. No batch-2 group edits the dashboard (`src/app/panel/page.tsx`).

### R15. Morning job: time budget, steps, `job_runs` names
No Vercel cron is added (Hobby: daily only). Everything new fits into `/api/cron/gunluk`:

| Phase (in order) | Steps (new in bold) | Typical | Cap | Enforced by |
|---|---|---|---|---|
| 0 | `startJobRun` | 0.2 s | 1 s | — |
| 1 | Paraşüt retry (only when the 07:30 job did not sync) ∥ **forecast** (weather and 7 snapshot rows) | 0 s ∥ 1–2 s | 35 s ∥ 7 s | `deadlineMs: 35_000` ∥ `AbortSignal.timeout(6000)`. The forecast starts at `jobStart` and is awaited before the digest |
| 2 | Digest data, **commission / kontrol / forecast boxes**, send | 3–5 s | data 6 s (boxes in parallel, 4 s each); send until `jobStart + 48 s` | `capped`; `sendEmail({ deadlineAt })` |
| 3 | Tail, all in parallel: reminder push, karaoke, menu, sales, **photos** sweep, **count** push, **mcp** prune, **weekly** (Mon–Wed) | 8 s | 8.5 s; each new step ≤ 8 s and ≤ `jobStart + 55 s` | photos: `limit: 100`, `deadlineAt` (not 15 s); count: `capped(8 s)`; mcp: `capped(3 s)`; weekly: `jobStart + 52 s` (collect 4 s, send 4 s, one attempt) |
| 4 | `finishJobRun` | 0.2 s | 1 s | — |

**What the budget gives:** typical total about 15 s; after a 35 s retry with a healthy Resend about
1 + 36 + 6 + 2 + 8.5 + 1 = 54.5 s; with a hanging Resend the send is cut at 48 s and the run ends by about 57.5 s
(today's code can pass 60 s there).

**No added job time:** kontrol (its photos expire through `photos`); doluluk (its history import is a button: 45 s on
its own page); the komisyon and kontrol boxes run inside `digest`, where a failure drops the box and never fails the
e-mail; siparis's invoice matcher runs inside the 04:30 Paraşüt job, within that job's own deadline.

**Step names.** The `job_runs` steps `forecast`, `photos`, `count` and `weekly` are all optional; mcp's prune stays
body-only (`body.mcp`). Only `error` makes the run `partial`.

| Step | Codes and labels |
|---|---|
| `forecast` | `ok` "Tahmin kaydedildi", `noweather` "Tahmin kaydedildi, hava alınamadı", `nodata` "Tahmin: veri yok", `error` "Tahmin hata" |
| `photos` | `ok` "Eski fotoğraflar silindi", `none` "Silinecek fotoğraf yok", `off` "Fotoğraf deposu yok", `error` "Fotoğraf temizliği hata" |
| `count` | `sent` "Hızlı sayım bildirimi gitti", `error` "Hızlı sayım bildirimi hata"; written on count days only |
| `weekly` | haftalik §3.5 |

### R16. Backup `TABLE_RULES` (`src/lib/backup/format.ts`, ops-backup)
- **Skip all five MCP tables** (`mcp_clients`, `mcp_codes`, `mcp_grants`, `mcp_tokens`, `mcp_calls`) with
  `skip: "Claude bağlantıları; geri yüklemeden sonra Claude'da yeniden bağlanılır"`. Skipped tables are not scanned
  (so `code_hash` / `token_hash` need nothing), and skipping all five means no FK points at a skipped table.
- **`NOT_SECRET`** (`tests/yedek.test.ts`) gains `photos.storage_key` ("özel Blob deposundaki dosyanın yolu; okumak
  için BLOB_READ_WRITE_TOKEN gerekir") and `ai_calls.input_tokens`, `output_tokens`, `cache_read_tokens`,
  `cache_write_tokens` ("token sayısı"). No other planned column matches the guard.
- **Rename** siparis's `supplier_orders.token` to `request_id`: an idempotency UUID needs no exception.
- **No new `EXCLUDED_STATE_KEYS`:** `ai.settings`, `kontrol.seeded`, `komisyon.ayar`, `komisyon.since`,
  `reorder.settings`, `forecast.settings`, `forecast.weather`, `karaoke.hours`, `karaoke_history`,
  `haftalik.settings` and `haftalik.gecmis` hold no secret (the scan test checks).
- **Credentials** (`ANTHROPIC_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `MCP_*`) live only in env, never in the DB.
- **Personal data:** `karaoke_sessions.customer_name` stays in the file (the test pins it); doluluk's imported history
  rows carry no name or note.
- **Photo bytes** are not in the backup (YEDEK.md and FOTOGRAF.md say so); a restored row whose blob is gone reads
  `Fotoğraf bulunamadı`.
- **After the last batch-2 migration** (tahmin's), run `YEDEK_TEST_DATABASE_URL=… npm test` again.

### R17. `db:reset`
| Effect | Tables / keys |
|---|---|
| Truncated by cascade from `ingredients` / `invoices` (correct: their ids restart) | `reorder_items`, `quick_counts`, `supplier_orders` |
| Kept | `photos`, `ai_calls`, `cash_report_photos`, `cash_outs` (their expense lines go with `expense_entries`), `checklist_*`, `commission_months`, `mcp_*`, `special_days`, `weather_days`, `forecast_snapshots`, `karaoke_sessions` (with `booked_at`, `cancelled_at`), and the keys `ai.settings`, `kontrol.seeded`, `komisyon.*`, `reorder.settings`, `forecast.*`, `karaoke.hours`, `karaoke_history`, `haftalik.*` |
| Emptied, harmless | `notification_log`: a komisyon alert may be e-mailed once more. `haftalik.gecmis` still stops a same-week resend |

**R7 check.** No kept row or key points at ids of a truncated table: `cash_outs` → expense goes the other way (D11),
`forecast.settings` stores category names, and `haftalik.gecmis` keys with product ids only affect de-duplication of
plain items for up to 8 weeks.

**README line 120.** Fix the existing error (monthly expense entries *are* deleted; categories are not). Then the
**deleted** list gains "mal siparişi kalemleri, hızlı sayımlar ve gönderilen siparişler", and **"Silmedikleri"**
gains "kontrol listeleri ve kayıtları; fotoğraflar, kasadan çıkanlar ve okuma kayıtları; komisyon hakediş işaretleri
ve kanal ayarları; Claude bağlantıları; satış tahmini (özel günler, kayıtlı tahminler, hava durumu, ayarlar); karaoke
oda saatleri; mal siparişi ayarları; haftalık özetin ayarı ve geçmişi".

### R18. Names, the two "online"s, the ModPOS seam
- **"Sipariş"** means the app order (`/api/siparisler`, "Uygulama siparişleri"; the other session's). Our feature is
  **"Mal siparişi"** in the UI and `reorder` in code; routes `/panel/mal-siparisi`, `…/gonderilen`, `…/kalemler`;
  docs `MAL-SIPARISI.md`; Bugün key `mal-siparisi`.
- **"Online"**: the Z field is platform sales (Yemeksepeti, Getir, Trendyol); laffogato.net's sales never pass the
  till (`SITE-SATIS.md:116`). komisyon always says "Z'deki online (platformlar)", never a bare "online" (its "Kasa
  raporlarında online" line changes accordingly). kdv and insight already say "laffogato.net online"; tahmin's
  "Z toplamı · laffogato.net online hariç" stays.
- **ModPOS daily export: not built.** One seam, `loadDailyProductSales(from, to): Promise<DailyProductSale[] | null>`
  (W2.0), returns `null` today, and every reader falls back to monthly data (siparis usage; tahmin daily totals and
  the dessert mix; doluluk counter karaoke). Nobody implements `dailyUsage` or `byWeekday` now; mcp keeps
  `salesFor(model, month)`. When the sample file arrives, one import task fills the seam.

### R19. Location and hours: Tuzla, Opera AVM
- **The café** is in Tuzla, Opera AVM (`PROMPT-VE-PLAN.md:11`; rent to "Opera AVM"). MaviBahçe AVM (İzmir) is the
  separate karaoke-box business (`PARASUT.md` §6a-1, `SITE-SATIS.md:75`). doluluk already knew this; tahmin did not.
- **Weather point:** `TUZLA = { lat: 40.8160, lon: 29.3010 }`, Tuzla centre at 4 decimals (MET's rule). Opera AVM's
  own pin could not be confirmed from this session (a web search found no listing; the proxy blocks OSM). At MET's
  grid this changes nothing; replace it with the mall's map pin if that is more than about 5 km away.
- **Hours** (owner defaults; the business day turns at 05:00): Açılış list 08:00–11:00 and Kapanış 22:00–02:00
  (kontrol's seeds already use them); karaoke room every day 10:00–22:00 (doluluk's default already). Mall hours
  (10:00–22:00 assumed) explain these; no code reads them.

---

## 2. Shared-file collision map

| File | Groups | Note |
|---|---|---|
| W2.0 files (`job-health.ts`, gunluk route, `resend.ts`, `digest-template.ts`, `digest-extras.ts`, `same-origin.ts`, `daily-sales.ts`) | W2.0, then tahmin, fotograf, siparis, mcp, komisyon, kontrol, haftalik | Append one line each |
| `src/server/db/schema.ts`, `drizzle/*` | fotograf, mcp, kontrol, doluluk, siparis, komisyon, tahmin | Disjoint; R2; kontrol after fotograf (FK) |
| `notifications.ts`, `components/panel/notifications.tsx` | kontrol (group and staff branch), komisyon, siparis | R12 |
| `bugun/logic.ts`, `page.tsx`, `today-refresh.tsx`, `today-cafe.tsx`, `server/data/today.ts`, `tests/bugun.test.ts`, `docs/BUGUN.md` | kontrol, siparis, komisyon, tahmin | R14 |
| `nav.ts`, `roles.ts`, `tests/{roller,mobile-nav,yardim}.test.ts` | kontrol, doluluk, siparis, komisyon, tahmin | R13 |
| Kasa files (`kasa/page.tsx`, `cash-form.tsx`, `cash-history.tsx`, `cash-summary.tsx`, `actions/cash-report.ts`, `lib/cash-report.ts`, `cash-report-template.ts`) | fotograf only (komisyon's split is cut) | Rebase on kasa |
| `src/server/parasut/sync.ts`, `src/server/actions/parasut.ts` | siparis | A hook in a `try`, one `parts` entry |
| `src/server/karaoke/sync.ts`, `src/lib/karaoke/{site,session}.ts`, `karaoke/karaoke-admin.tsx` | doluluk | The other session: §3 |
| `step-up.ts`, `actions/auth.ts` (`safeNext`), `secret-box.ts` (`SealPurpose`), `panel/hesap/*` | mcp | One line each |
| `ayarlar/{page,sections,summaries}` | fotograf (`foto` between `site` and `yedek`) | `SiteLinksCard` (#9) untouched |
| `hatirlaticilar/{page,reminders-client,notifications-section}.tsx` | haftalik | insight edits `reminders-client` (batch 1) |
| `harcamalar/*`, `actions/expenses.ts` | fotograf (linked entries only) | — |
| `scripts/seed.ts` | kontrol (`ensureChecklistSeed`) | — |
| `src/lib/backup/format.ts`, `tests/yedek.test.ts` | mcp (skips), fotograf (`NOT_SECRET`) | R16 |
| Yardım, README, `BILDIRIMLER.md`, `DEPLOY.md`, `KASA-RAPORU.md`, `KARAOKE.md`, `PARASUT.md`, `TASARIM.md` | everyone | Own section; the Yardım `<Path>` rule |
| `src/app/panel/page.tsx`, `tedarikciler/[cari]/*`, `src/server/push/send.ts` | nobody in batch 2 | tahmin's dashboard fallback, komisyon's link and siparis's card are cut |

## 3. The other session (DIGER-OTURUM): every collision point, resolved

| Point | Resolution |
|---|---|
| doluluk × `src/server/karaoke/sync.ts`, `src/lib/karaoke/site.ts` | Additive only. `bookedAt = siteTime(r.createdAt)` and `cancelledAt = cancelledAtFor(prev, r, now)` go inline in sync's `values` and `same`; the mapping is **not** moved byte-for-byte into `site.ts`. `cancelledAt: z.string().max(40).optional().catch(undefined)` goes into `reservationSchema`. `version` and `signature.ts` are untouched. Both files are listed in the PR text |
| doluluk × karaoke page tabs (shared with `orders-board.tsx`) | `src/app/panel/karaoke/page.tsx` is **not edited**: no `SECTION_TABS`, no `PageHeader` move, `monthStats` unchanged (booked hours; the Doluluk page states its own definition). Entry points: "Doluluk haritası" on the admin "Bu ay" card (`karaoke-admin.tsx`), ⌘K and a back link |
| doluluk × past windows and `cancelledAt` | Past windows: **the site already serves them** (base list; up to 400 days per request), so "Geçmişi siteden al" works today with no site change. `cancelledAt`: the site does not store a cancellation time; the panel records the transition it sees (pings arrive within seconds), past cancellations count as "zamanı bilinmiyor". The optional site request is in §9. "Gelmedi" exists on neither side (follow-up) |
| Naming: "Sipariş"; two meanings of "online" | R18 |
| KVKK: fotograf, mcp, Blob | §5. No customer data reaches a new processor, so the site's customer KVKK texts need no line. Optional text for an employee notice is in §9 |
| Paraşüt (site invoices in the same company) | komisyon and siparis read only local rows that come from `purchase_bills` and supplier contacts. There is no new Paraşüt call, `client.ts` is untouched, and the site's sales invoices never reach `invoices`. **Correction (23 Oct audit, fixed in the para group):** returns of site-invoiced orders did reach `invoices` as negative supplier bills (Paraşüt books a refund against a sales invoice under Giderler); they are now recognised and skipped (docs/PARASUT.md §2a) |
| ModPOS daily export | R18: seam only |
| Shared files: Ayarlar | Only fotograf adds `foto`; `SiteLinksCard` is untouched |
| Shared files: gunluk route; nav and tests, README, `BILDIRIMLER.md`, Yardım | R15; R13 |
| Shared files: `push/send.ts` | Not edited. siparis calls `sendPush("reminders", …)` |
| today: "Teslime hazır" stays in the list (#9) | Batch-1 today counts open app orders as `stage !== "ready"`. No batch-2 plan reads site orders (haftalik and mcp exclude them) |
| menu, kdv / insight points | Batch 1 (CRITIQUE). Batch 2 touches neither `site-menu` nor `site-sales` |
| Backup: `site_orders` key | Already in `EXCLUDED_STATE_KEYS` in the ops-backup WIP |
| Process | `git fetch` and merge `origin/main` before each wave and each PR. Never push their branch or the laffogato repo. Site changes go to the owner (§9) |

## 4. Dependencies (exact pins, no `^`; lockfile committed)

| Package | Pin | Published | Why |
|---|---|---|---|
| `@anthropic-ai/sdk` | **`0.132.1`** | 2026-10-08 | The newest release at least 14 days old. Its published types already have `fallbacks: "default"`, `output_config.effort`, `format: json_schema`, `usage.iterations`, the `fallback` block and `stop_details` (checked in the tarball). It sends `anthropic-version: 2023-06-01`. 1.0.0 and 1.1.0 (2026-10-21, one day old) only move to `2026-10-21`: sampling parameters are removed, and the rules for documents and citations change. fotograf uses none of these, so no needed feature is 1.x-only. Move to 1.x in a one-line follow-up on or after 2026-11-04, then rerun `tests/ai-istemci.test.ts` and the opt-in eval (≈ $0.35). Drop fotograf's "0.137.0" note (two days old) |
| `@vercel/blob` | **`2.8.1`** | 2026-10-06 | Private `put` / `get` (stream), `del`, `BlobNotFoundError` / `BlobAccessError` / `BlobServiceRateLimited`; Node ≥ 20. 2.8.2 (2026-10-14) differs only in `BLOB_API_VERSION` 12 → 13 (diffed) |
| `@modelcontextprotocol/server` | **`2.3.1`** | 2026-10-05 | The v2 stable line: Web-standard `createMcpHandler(factory, { legacy: "stateless" }).fetch(request, { authInfo })`, `requireBearerAuth({ verifier, requiredScopes, resourceMetadataUrl, expectedResource })`, `bearerAuthChallengeResponse`, `OAuthError`, `McpServer`. It depends only on `@modelcontextprotocol/core@2.3.1` and `zod ^4.2.0` (the repo has 4.6.7), and fits Next route handlers directly. mcp.md chose correctly |
| `@modelcontextprotocol/sdk` | not installed | 1.32.1, 2026-10-05 | The v1 maintenance line (spec 2025-11-25, fixes for at least six months after 2026-07-27). It pulls express 5, hono, cors, ajv, express-rate-limit and cross-spawn. It stays the documented fallback only: `WebStandardStreamableHTTPServerTransport` with `sessionIdGenerator: undefined` |
| `@modelcontextprotocol/inspector` | `2.9.0` via `npx` (dev only) | 2026-09-30 | 2.12.0 is too new |

No other dependency: tahmin calls MET with `fetch`; the rest need nothing.

## 5. Security review

### mcp (OAuth, data leaving to the Claude app)
**Approve the design:** the panel is its own authorization server; CIMD limited to `claude.ai` / `claude.com`; DCR as a
fallback with the same redirect allowlist, 10 registrations an hour per IP and 50 pending per day; PKCE S256, exact
redirect matching and the `iss` parameter; 2-minute single-use codes (a replay revokes the grant); 1-hour access
tokens; 30-day refresh tokens that rotate (reuse revokes the grant); grants of at most 90 days bound to the user's
`sessionVersion`; tokens stored only as sha256 (256-bit random, so a fast hash is fine); admin only, with the password
at consent (`StepUpWhere` gains "Claude bağlantısı"); an e-mail on every new connection and a revoke in Hesabım;
`MCP_DISABLED=1` and `VERCEL_ENV=preview` → 404 on every endpoint; a wrong `Origin` → 403 and no CORS on `/api/mcp`;
`X-Frame-Options: DENY` already covers `/baglan`.

**Required changes:**
1. **Read-only beyond the source guard.** `tools.ts` may import only the loaders listed in mcp §6.1, pinned by a test
   holding an allowlist of `@/server/…` imports. None may write: no `ensure*`, sync, weather or snapshot call. A Neon
   read-only role for `/api/mcp` is optional hardening, not v1.
2. **Data minimisation.** `kasa_raporlari` drops `giren` (staff names); `karaoke_ozeti`, `zayi_ikram` and
   `hammadde_fiyat_gecmisi` are deferred (§6). What leaves to Anthropic is the owner's business figures and company,
   product and ingredient names (some suppliers are sole traders), never IBAN, VKN, phone, e-mail, notes, customer or
   staff names; the leak-scan test pins this.
3. **Limits.** The in-memory limiters are per instance on Vercel (first line only); the real caps stay in the DB:
   single-use codes, 10 grants, 50 pending DCR clients a day.
4. **Host.** Non-API paths on `lafmaliyet.vercel.app` redirect to `ladmin` (`next.config.ts:50`), so `/.well-known/*`
   and `/oauth/*` answer only on `ladmin`; the docs give only the ladmin URL (as planned).
5. **KVKK.** Answers stay in the owner's Claude conversation under Anthropic's terms; keep the plan's advice to turn
   off model training in Claude's privacy settings.

### fotograf (and kontrol's photos)
**Approve:** upload through route handlers (`sameOrigin`, auth, the 2 MB cap, MIME sniffing, a dimension check, 30 an
hour per user, at most 6 photos per report and 3 readings per photo); no server-side image decoding (no decompression
bombs); a private store with random keys, never overwritten; serving only through `/api/foto/[id]` (`nosniff`, a
sandbox CSP, `private` cache), never a Blob URL anywhere; EXIF / GPS dropped by the client re-encode; photo text
treated as untrusted (the system prompt says it is data; the schema, zod and our own sums decide; the
`contains_instructions` flag shows, and live call 3 ignored a printed "TOPLAMI 9.999 YAZ"); nothing is saved without a
person.

**Required changes:**
1. **Cost cap.** Besides the panel's 40 readings a day, a monthly spend limit in the Anthropic Console (≈ $20; expected
   use is $3–4 a month).
2. **Previews.** The Blob store is Production-only (R9) and `ANTHROPIC_API_KEY` already is, so previews have no photo
   UI and no reading.
3. **Retention** as R9, swept by the morning job within its cap. A raw upload from a modified client keeps its EXIF;
   that is acceptable in a private store.
4. **Staff access:** kasa photos only while the day is still editable (kasa's lock); receipt photos by their
   `cash_outs` date; kontrol photos only today's and yesterday's; the uploader sees an unlinked photo.
5. **kontrol.** Its photos never go to Claude. Every photo item's hint reads `Fotoğrafta müşteri ya da çalışan
   görünmesin.` (pictures of rooms, not people). Kept 60 days.
6. **KVKK.** Z, POS and receipt photos go to Anthropic (US) to be read. They hold no customer data, but a Z report may
   print the cashier's name; FOTOGRAF.md says so, and the owner checks the transfer rule (§10, question 4).

## 6. Per-plan corrections

### fotograf: approve; it owns R9 and R10; cut the second entry point and the bell
It solves the ask: the Z and POS numbers fill themselves with the checks visible, a drawer receipt becomes a cash-out
line and an expense line, nothing saves itself, and pure code cross-checks every reading. The D8 document-type gate
and the live evaluation (5 calls, $0.02–0.03 each) are the right guards.

1. **Pins:** `0.132.1` and `2.8.1` (§4). The Blob store is Production-only; DEPLOY's "(Production ve Preview)"
   changes.
2. **Sweep:** `cleanupPhotos({ limit: 100, deadlineAt })` inside the tail cap, not 15 s; the `photos` step is optional
   (R15).
3. **Contract details for kontrol** (R9): `deletePhoto` on a missing row is a no-op; `keepUntil("kontrol")` is 60;
   `PhotoCompressError`; `sameOrigin` comes from `src/server/same-origin.ts`; the `ADMIN_ONLY` entry goes.
4. **Cut from this round:**
   - the admin bell item `kasa-foto-…` (§4.7); the diff stays in the saved-report box, the "Günden güne" badge and the
     kasa e-mail / WhatsApp line;
   - in Aylık harcamalar, the "Fişten doldur" picker and the "Kasadan ödendi" checkbox (§4.5): a second entry point
     with its own linking rules. Linked entries still display (camera icon, `Kasadan` badge, read-only amount and
     date);
   - Ayarlar beyond the switch, the daily cap, `Bu ay: {n} okuma · {usd}`, `Bugün: {used} / {cap}` and the storage
     line: `readingAgreement`, "Son sorunlar", "Geçen ay" and the fallback count go.
5. **VAT fields.** `cash_outs.vat` and `expense_entries.vat` are information only; kdv's estimate must not deduct
   retail-receipt VAT (the accountant decides).
6. **Migration and order.** One migration (`fotograf_okuma`); it merges first in batch 2.

### kontrol: approve Phase 1; fix the photo contract; cut Phase 2
1. **Photo contract** (R9): `checklist_answers.photo_id` is `integer`; access goes through `PHOTO_RULES.kontrol`, built
   on the pure `photoAccess`, with `keepDays: 60` and 403 on denial.
2. **Upload route.** Keep `POST /api/kontrol/foto` (the answer is written in the same request, and Server Actions queue
   one at a time), but: it uses the R8 `sameOrigin`; size and type are checked only in `savePhoto` (2 MB);
   `keepPhoto(id, now + 60 d, tx)` runs inside `writeAnswer` instead of setting `expiresAt` at upload; the replaced
   photo is removed with `after(() => deletePhoto(prev).catch(log))`.
3. **Cut Phase 2:** the `kayit-*` rows, "Yeni kayıt", the two passive seeds and the editor's "Ne zaman" (keep the
   `schedule` / `seq` columns); also the 30-day stats row on Geçmiş.
4. **Surfaces:** the digest box `DigestExtras.kontrol` through the registry, key `kontrol:{day}` (R11); the new bell
   group `kontrol`, including the staff branch (R12); Bugün keys and order per R14, plus `nextRefreshAt(now, extra)`.
5. **Seeds.** The photo-item hint goes into the seeds (§5); the hours are the owner defaults (R19).
6. **Order.** Merge after fotograf (FK).

### komisyon: approve the core; cut the nightly per-card fields and the invoice-text parsing
**Keep:** the channel registry, applied to Komisyon-category invoices only; line classes with the raw line text
shown; the legal flags, worded "olabilir"; payout expected / due / mark, with `since` written only on write paths; the
once-only e-mail, the bell and the Bugün row; the "Kanallar" card (`payDays` only) and the 3-month platform rate.

**Change:**
1. **Cut the cash-report split:** no `cash_reports.channel_sales`, no fields on the Z card, no WhatsApp / e-mail /
   revision changes, no "Kasa raporunda ayrı yaz". Per-channel sales come from the channel's monthly statement typed
   in the Hakediş dialog (`elle`) or from the single-channel rule (`tek`). The meal-card aggregate rate always shows
   (if it is above 6 %, some card is). Why: nightly staff typing, an edit of the kasa form in the same batch as
   fotograf, and tiny volumes today (Pluxee 26,78 ₺ and Set Kart 39,28 ₺ in September). Owner question 6.
2. **Cut `parseStated` and the `fatura` sales source**, and the `taban-farki`, `oran-sicrama`, `baska-kategori` and
   `kalemsiz` flags. `coverMonth` keeps only "a meal invoice dated day 1–5 belongs to the previous month". Task 0 (the
   read-only production query) decides whether a follow-up adds invoice-text bases.
3. **Cut** the Tedarikçiler link (§3.9), the Nakit planı lines (§3.13) and the card-share change: kasa's
   `(card + mealCard) ÷ zTotal` stays (owner question 6).
4. **Bell and Bugün** use the light `loadCommissionAlerts()` / `loadOverduePayouts()` (R12); the VKN resolver runs only
   on the page.
5. **Wording and data:** the digest box is `DigestExtras.commission` with keys `komisyon:<alertKey>` (R11); labels
   follow R18; Paraşüt as planned (local purchase-bill rows only).

### siparis: approve; rename the routes; fix a division by zero; cut the supplier-page card
1. **Names (R18):** routes `/panel/mal-siparisi`, `…/gonderilen`, `…/kalemler`; Bugün keys `hizli-sayim` and
   `mal-siparisi`; the Hızlı sayım icon is `ClipboardPen`.
2. **Bug (with ekle).** Count items that staff add are ingredients with a package price of 0, so `expectedUnitPrice`
   is 0. Then `priceDiff = unitPrice / 0 − 1` flags every delivery as "fiyat farkı", the order never closes itself,
   and estimates read 0 ₺. Fix: when the reference price is ≤ 0, `expectedUnitPrice` is `null` (no price check, no `~`
   estimate), with a test.
3. **Backup:** `supplier_orders.token` becomes `request_id` (R16).
4. **Cut:** the Tedarikçi "Siparişler" card (§3.6; Gönderilenler `?tedarikci=` is the supplier view); the
   `dailyUsage` / `pickUsage` code (read the R18 seam, which returns `null`, then fall back to monthly); the
   Tutarlılık hint, the "Fiyat onayda" link and the manifest shortcut.
5. **Job time.** The count-day push is the optional `count` step, capped at 8 s (R15); the matcher stays inside the
   04:30 job's deadline and in a `try`. Both already hold in the plan.

### mcp: approve; v2 server package; seven tools; no staff names
1. **Package:** `@modelcontextprotocol/server@2.3.1`, exact (§4).
2. **Tools.** Ship `ay_ozeti`, `urun_karliligi`, `zam_etkisi`, `tedarikci_ozeti`, `odemeler`, `kasa_raporlari` and
   `ara`. Defer `karaoke_ozeti` (it reads data doluluk changes in this batch, and per-day bookings were not the ask),
   `zayi_ikram` and `hammadde_fiyat_gecmisi`.
3. **No staff names:** `kasa_raporlari` returns no `giren` (§5).
4. **With ekle:** `urun_karliligi` and `zam_etkisi` add an `uyarilar` line when a recipe uses a 0-priced ingredient:
   `{n} hammaddenin fiyatı girilmemiş; maliyet eksik`.
5. **Integration:** the tools' import allowlist (§5); `TABLE_RULES` skips (R16); `pruneMcp` body-only, capped at 3 s
   (R15); `StepUpWhere`, `SealPurpose` and `safeNext`: one additive line each.
6. **Outdated note.** "adminstepup merged as 488a389" is out of date: step-up is on main via #7 (e10fbb0). No fallback
   is needed.

### tahmin: approve with the Tuzla fix; cut the learning and the extras
1. **Location (R19):** the constant becomes `TUZLA`; the toggle hint reads
   `MET Norway'den (Norveç Meteoroloji Enstitüsü) ücretsiz, günde bir kez; Tuzla (Opera AVM) konumu için.`; the derbi
   example becomes `Fenerbahçe – Galatasaray maçı`; "İzmir'in Kurtuluşu" goes with the suggestions (item 3).
2. **Surfaces:** the digest gets `DigestExtras.forecast` (R11; never news, never in the subject); Bugün gets the admin
   card and the staff lines per R14; no dashboard fallback.
3. **Cut:** `learnFactors` / `realisedEffect` / `kindHistory` (with under three weeks of reports nothing can be learned
   for months, and labelled defaults are honest); the `weekAhead` accuracy, `suggestedDays` and the daily-data code
   paths (R18). "Takvim ve etkiler" shows the defaults table and the next 60 days.
4. **Job (R15):** `runForecastJob` starts with the Paraşüt retry, with the weather call capped at 6 s; snapshots are
   never written from previews; `forecast` is an optional step.
5. **Keep:** the 2026–2028 calendar (re-check the 2028 Ramazan start); MET's terms (User-Agent, `Expires`,
   `If-Modified-Since`, 4 decimals, the CC BY 4.0 credit); same-morning accuracy; the staffing and dessert
   suggestions.

### doluluk: approve the page; stay off the shared karaoke page; the history import works today
1. **Other session's files:** `karaoke/page.tsx` is not edited (§3); `sync.ts` and `site.ts` get inline, additive
   changes; `isCancelledBooking` goes into `session.ts`.
2. **Cut:** the "site + kasa" revenue basis, which needs ModPOS months fully covered by timers (R18), and the
   `RoomOrder` seam. Revenue per hour = booking fees ÷ their occupied hours.
3. **Keep:** the five KPIs, the heatmap, the month table and the two insights; the Oda saatleri dialog (default every
   day 10:00–22:00); the import button, which degrades as described in §3.
4. **Integration:** `ADMIN_ONLY_PATHS` (R13); the Yardım FAQ uses `links`. The history import reads the site's
   existing past windows (chunks of at most 62 days, well under the site's 400-day cap); no site change is needed.
5. **KVKK retention, same rule as the site (laffogato #196):** the daily job clears `customer_name` and `note` of
   `karaoke_sessions` whose `date` is older than 3 × 366 days (Istanbul day; both sources, since a panel timer's label
   can be a name). One `UPDATE … WHERE date < $cutoff AND (customer_name IS NOT NULL OR note IS NOT NULL)`, under 1 s,
   step `karaoke` (no new `job_runs` step). Rows stay for the statistics. One test for the cutoff; one line in
   `docs/KARAOKE.md` › KVKK.

### haftalik: approve; last; adjust to the cuts
1. **Its shared edits move into W2.0:** the `emailLayout` / `esc` / `FONT` exports with `footer`, the `sendEmail`
   options and `uncertain`, and the optional `weekly` step.
2. **Sources after the cuts.** Kept: komisyon alert kinds `gecikti`, `oran`, `yasak`; fotograf's
   `cashReportPhotoInfo` + `suspiciousDiffs`; kontrol's `loadHistoryDays` (daily lists only); doluluk's
   `computeOccupancy` / `emptiestBlock` / `insightLines`; tahmin's `loadForecastCore`. No siparis or mcp source (as
   planned).
3. **Timing.** It runs in the tail beside `extras()`, with its own `jobStart + 52 s`: collect 4 s, send 4 s, one
   attempt (R15).
4. **Reasoning and references.** D1's reason ("R4 forbids a 6th argument") is moot after R11, but a separate e-mail is
   still right: it answers a different question, for admins only. Fix the references: `saveNotificationSettings` is
   at `reminders.ts:417`, and fotograf's sweep is no longer 15 s.

## 7. Scope summary (cut or defer in this round)

| Plan | Cut / defer | Why |
|---|---|---|
| fotograf | Bell item; Aylık harcamalar "Fişten doldur" + "Kasadan ödendi"; Ayarlar stats beyond the basics | Second entry point; the diff already shows in the report, history and e-mail |
| kontrol | Phase 2 event lists; 30-day stats row | Not asked; the editor can add lists later |
| komisyon | Nightly per-card fields; invoice-text bases and four info flags; Tedarikçiler link; Nakit planı lines; card-share change | Staff burden, kasa-form collision, no real lines to tune, tiny volumes |
| siparis | Supplier-page card; `dailyUsage` code; Tutarlılık hint; "Fiyat onayda"; manifest shortcut | Supplier-page collision; no data yet; cosmetic |
| mcp | `karaoke_ozeti`, `zayi_ikram`, `hammadde_fiyat_gecmisi`; `giren` | Smaller leak surface; karaoke data changes in this batch |
| tahmin | Learned factors; week-ahead accuracy; day suggestions; daily-data paths | Needs months of data; not asked |
| doluluk | Karaoke page tabs / header / `monthStats`; site+kasa revenue; room-order seam | The other session's page; data missing |
| haftalik | — | — |

Follow-ups (only if the owner asks): komisyon's nightly split, fotograf's admin "Fişten doldur", kontrol's event
lists, tahmin's learning, the three deferred MCP tools, doluluk's "Gelmedi" and in-room orders, `@anthropic-ai/sdk`
1.x, a Neon read-only role for MCP.

## 8. Implementation order

**Preconditions:** batch 1 is merged (ops-backup, vkn core, pricing, kasa, insight + kdv, menu, today), and so is
ekle; R1–R3 hold; at most two implementers; before each wave and each PR, `git fetch` and merge `origin/main`.

**Waves:**
- **W2.0:** implementer 1 builds the plumbing PR (R8) while implementer 2 starts fotograf.
- **A: fotograf ∥ mcp.** Disjoint files: kasa and photos vs auth and OAuth.
- **B: kontrol ∥ doluluk.** They overlap only in nav and roles. kontrol merges after fotograf.
- **C: siparis ∥ komisyon.** They overlap in Bugün rows, the bell's `fatura` group and nav.
- **D: tahmin ∥ haftalik.** haftalik codes against merged modules (and tahmin's branch for one context line) and
  merges last.

| # | Branch | Migration | Why here |
|---|---|---|---|
| 0 | W2.0 plumbing | — | Every group appends to it |
| 1 | fotograf | `fotograf_okuma` | Owns the photo module and the Claude client; kontrol has an FK to `photos` |
| 2 | mcp | `claude_baglantisi` | Independent; the security review lands early |
| 3 | kontrol | `kontrol_listeleri` | After fotograf (FK) |
| 4 | doluluk | `karaoke_doluluk` | Small; the site request goes out now |
| 5 | siparis | `mal_siparisi` | `sync.ts` after vkn and pricing (batch 1) |
| 6 | komisyon | `komisyon_hakedis` | Digest and Bugün after kontrol and siparis |
| 7 | tahmin | `satis_tahmini` | Last migration → YEDEK restore test |
| 8 | haftalik | — | Consumes everything |

**Every merge:**
1. Rebase.
2. R2: restore the journal from main, delete the branch's SQL and snapshot, run
   `npm run db:generate -- --name <ad>`, migrate a fresh copy and run `tests/migrations.test.ts`.
3. Run `npx next typegen && npx tsc --noEmit`, `npx eslint . --ignore-pattern '.claude/**'` and `npm test`.
4. Check the touched screens at 390 and 1440 px.
5. Merge, then confirm `✓ Veritabanı şeması güncel (N migration)` in the production log.

**Milestones:** before fotograf goes live, the private Blob store and the Anthropic spend limit; after step 7,
`YEDEK_TEST_DATABASE_URL=… npm test` and the YEDEK drill; after step 8, on the first Monday, check that Ayarlar ›
Günlük işler shows `Haftalık özet gönderildi`, and pass over the bell and Bugün as admin and as staff at 390 px.

## 9. Site-side change requests (send to the owner / the other session as written)

Checked in the site repo (laffogato 119c378, 22 Oct): past windows are **already served** (no lower bound on `from`,
up to 400 days per request, every status), so nothing is needed for the history import. One request remains and it is
**optional** (the owner decides; doluluk works without it):

> **laffogato.net — `GET /api/panel/karaoke` (isteğe bağlı, acele yok)**
> 1. **İptal anı:** rezervasyon iptal edildiğinde an saklansın (yeni sütun) ve panele isteğe bağlı `cancelledAt`
>    olarak gitsin: ISO 8601; iptal değilse alan hiç olmasın ya da `null` olsun. Panel alanı isteğe bağlı okur:
>    eklemek sözleşmeyi bozmaz, `version` değişmez. Geçmiş iptaller için bilinmiyorsa boş kalır.
> 2. Sitedeki `docs/PANEL-KARAOKE.md` ile paneldeki `docs/KARAOKE.md` birlikte güncellensin.
>
> Şimdi istenmeyenler: "gelmedi" işareti; uygulama siparişinde "karaoke odası" teslim yeri.

> **KVKK metinleri:** Bu paket için sitenin müşteri KVKK metnine satır gerekmez. Müşteri verisi yeni bir işleyiciye
> gitmez:
> - fotoğraflar kafenin belgeleri (Z raporu, POS fişi, alışveriş fişi) ve mekânın kendisidir;
> - Claude bağlantısı müşteri ve personel adı göndermez;
> - karaoke geçmişi adsız alınır.
>
> Çalışanlar için bir aydınlatma metni tutuluyorsa şu iki satır eklenir:
> - "Vercel Inc. (Frankfurt veri merkezi): panel ve fotoğraf deposu";
> - "Anthropic PBC (ABD): kasa fişi, Z raporu ve POS fişi fotoğraflarındaki rakamların okunması; yöneticinin Claude
>   uygulamasından panele sorduğu soruların yanıtları".

## 10. Questions for the owner (defaults are implemented; nothing blocks)

1. **Site change (§9), optional.** The site already gives past bookings, so Doluluk shows history right away. Only the
   cancellation time is missing for past cancellations ("zamanı bilinmiyor"); asking the site to store it is
   optional. Default: not requested now.
2. **Photo storage.** The developer creates a private Vercel Blob store, `laffogato-foto`, in Frankfurt, connected
   to Production only; until then the photo buttons are hidden. Default: yes.
3. **Spending.** A monthly spend limit in the Anthropic Console (≈ $20), plus the panel's 40 readings a day; expected
   use is about $3–4 a month. Default: yes.
4. **KVKK.** Z, POS and receipt photos go to Anthropic (US) to be read. They hold no customer data, but a Z report
   may print the cashier's name. Ask your accountant or adviser whether the cross-border transfer rule needs a
   standard contract and notice. Default: reading on; it can be switched off in Ayarlar (photos are still kept).
5. **Photos.** The "fotoğraftan farklı" warning shows only in the kasa e-mail / WhatsApp, the saved report and the
   history (no bell item); retention is kasa 6 months, receipts 13 months, kontrol 60 days; a drawer receipt that
   staff photograph goes straight into Aylık harcamalar (purchase categories only; invoices are not added). Default:
   all yes.
6. **Komisyon.** Per-card rates come from the monthly statement you type in the Hakediş dialog (no extra fields on the
   nightly report; the meal-card total always shows); due date = invoice date + 30 days (meal cards at most 30); the
   bank-POS card share stays (card + meal card) ÷ Z. Do meal cards go through your bank POS with a commission?
   Default: as written.
7. **Mal siparişi.** The count day is Monday, only the admin opens WhatsApp, and an exact invoice match closes an
   order by itself. Default: yes.
8. **Kontrol listeleri.** Açılış 08:00–11:00 and Kapanış 22:00–02:00; nobody fills a past day; "her seferinde"
   lists come later. Default: yes.
9. **Satış tahmini.** Weather for Tuzla (Opera AVM); staff see the "yoğunluk" level and the dessert count, without
   amounts; learning from past days comes in a later round. Default: yes.
10. **Karaoke doluluk.** The room is open every day 10:00–22:00; history is imported without names. Default: yes.
11. **Claude bağlantısı.** Seven tools first (ay özeti, ürün kârlılığı, zam etkisi, tedarikçi, ödemeler, kasa
    raporları, ara); a connection lasts 90 days, the password is asked every time, and you get an e-mail on each new
    connection; never sent: IBAN, staff or customer names. Default: yes.
12. **Haftalık özet.** Monday 08:00, to admins only; a quiet week still gets one short e-mail. Default: yes.
