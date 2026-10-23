# Critique of the 8 plans (suggestions 1–13) and the integration order

Base: `claude/oneriler` = main @ 981692e. I read every plan in full and checked the claims they depend on against the code
and the local DB. Verified: `drizzle-orm/pg-core/dialect.js` skips migrations older than the newest applied one; the
journal `when` values are strictly increasing today (0000…0019); `scripts/predeploy.ts` migrates and seeds on every
Vercel build; `confirmPassword` / `reauthFails` live in the `"use server"` file `src/server/actions/auth.ts`;
`saveUser` still has its `insert(s.users)` create branch; `tests/roller.test.ts:63` pins the `expireUserTokens` line;
`applyProductLinks` (sync.ts:1087) writes every price that moves ≥ 0.5 %; `applyPlan` / `applyPushed` in
`src/server/site-menu/*` behave as the menu plan says; `loadTermDays()` / `loadPaidOnDelivery()` are name-only;
`loadModel()` has no per-request cache; Resend sends time out at 15 s; `db:reset` truncates `fixed_expenses` with
`RESTART IDENTITY`.

**Verdict.** Each plan solves the owner's problem. Each follows the codebase conventions (attempt/UserError, zod,
refresh, logActivity, pure logic plus tests, drizzle-kit migrations, Suspense plus PageHeader, close dialogs before
navigating). There are no contradictory data models: the five migrations touch disjoint tables and columns. The real
risks are about integration, not design:

1. A branch pushed before the preview guard is on main migrates the production database. This is the 21 Oct incident
   happening again, from up to 8 branches at once.
2. Five migrations generated in parallel get silently skipped in production if they are merged out of generation order.
3. Two or three API contracts disagree between plans:
   - the step-up module path, name and `where` type;
   - the `loadTermDays` / `PaidOnDelivery` signature;
   - the `renderDigest` subject rules;
   - the "per month" sales basis.
4. Six files take edits from four to six groups each (bell, dashboard, digest, schema, nav, Yardım/README).

Several plans also carry extras worth deferring (listed per plan).

---

## 1. Rules for every group (apply before any code is pushed)

### R1. Preview guard first: nothing is pushed until ops §1 is on main
A Vercel preview build runs the **branch's own** `scripts/predeploy.ts`. Any group branch cut from today's main and
pushed to GitHub would migrate and seed production with that branch's half-finished migration. Order:

- ops §1 (`dbPrepareDecision`, migration verification, journal test) is built alone.
- The one-time production check is done (§6, question 1).
- ops §1 is merged and deployed.
- Only then does every other worktree branch from (or rebase onto) that main, and only then may it be pushed.

Until then, worktrees commit locally only.

### R2. Migration protocol: generate at merge time, merge one migration at a time
Migrations come from ops-jobs (`gunluk_isler`), 5 (`fatura_vergi_no`), pricing (`fiyat_onayi`), kasa
(`kasa_ay_bilgisi_butunluk`) and menu (`fiyat_gecmisi`). A journal `when` is the generation time, so a branch generated
early and merged late is skipped forever in production. At merge time, each migration branch:

1. Rebases onto main.
2. Restores `drizzle/meta/_journal.json` from main, then deletes its own `drizzle/00NN_*.sql` and
   `drizzle/meta/00NN_snapshot.json`.
3. Runs `npm run db:generate -- --name <name>`, reviews the SQL, and runs `npm run db:migrate` on a fresh copy of the
   local DB.
4. Runs `tests/migrations.test.ts` (ops). It fails if `when` does not strictly increase.

Merges of migration-carrying branches are serialised: never two in flight. Never hand-edit generated SQL, with one
exception: an `IF NOT EXISTS` repair like 0018 is fine only if a reviewer asks for it.

### R3. One local database per worktree
Branches with different migrations cannot share `laffogato`: its `__drizzle_migrations` would hold the other branch's
rows, and ops' verification would flag them as orphans. Each worktree uses
`DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_<key>`, created as a copy of `laffogato`.

### R4. Contracts fixed now (so the parallel groups code against the same names)
| Contract | Owner | Decision |
|---|---|---|
| Password re-check module | adminstepup | `src/server/auth/step-up.ts` (`server-only`) exports `confirmPassword(me, pw, where, what?)`, `requirePassword(me, pw, where, what?)`, `requireStepUp(me, confirm, what)`. `where` is `"Hesabım" \| "Kullanıcılar" \| "Yedek"`. Ops' `src/server/auth/reauth.ts` name is dropped. |
| Password dialog | adminstepup | `src/components/panel/confirm-password-dialog.tsx` (moved with `git mv`). `description: ReactNode`, plus a new optional `children?: ReactNode` rendered above the field. The `children` slot is added by adminstepup, so ops does not edit the file. |
| Supplier term / peşin lookups | 5 | `loadTermDays()` returns `(supplier: string, taxNumber?: string \| null) => number \| null`. `PaidOnDelivery = (supplier: string, taxNumber?: string \| null) => …`. **Optional**, so name-only callers (insight's cash plan) compile and behave as today. |
| `renderDigest` | ops-jobs | Stays positional. ops appends the 5th argument `system?: DigestSystem \| null`. Pricing extends `DigestInvoices` (`priceHolds?`) and insight extends `DigestPrices` (`monthly?`, `monthlyTotal?`, `basisMonth?`). Nobody else changes the signature. Subject precedence is in R5. |
| Monthly sales basis ("ayda …") | insight | `salesBasis(model, month)` in `src/lib/calc/price-loss.ts` is the one place that turns a sales month into "units per standard month". Menu's "Aylık brüt kâr / Aylık etki" uses it (menu merges after insight). Pricing drops its own monthly figure (see pricing). |
| Job health for other screens | ops-jobs | `loadSystemAlerts()` in `src/server/jobs/alerts.ts`. Bugün and the bell read it; nobody re-queries `parasut_sync_runs` for "did the morning job run". |
| Counts for Bugün | pricing, menu, kasa | Pricing: `pendingHoldSummary()`. Menu: `posPendingSummary()`. Kasa: `carryChecks` plus `cashRevisionsFor`. All are cheap and server-only. |

### R5. Shared notification surfaces: additive edits only
**Bell** (`src/server/actions/notifications.ts`):
- Every new admin loader joins the existing admin `Promise.all` with `.catch(() => [])`, uses count-style queries,
  and returns items already in their group.
- New items:
  - ops `sistem` (new group, rendered first);
  - pricing in `onay`;
  - kasa in `kasa`;
  - menu in `uyari`;
  - insight only changes the `priceAlert(...)` argument.
- The staff branch stays untouched, apart from today's optional `isCashEvening` one-liner.

**Dashboard** (`src/app/panel/page.tsx`), fixed insertion points:
- ops: `<Suspense fallback={null}><SystemBanner/></Suspense>` as the first child of `space-y-4`;
- pricing: `holdAlert` prepended to `alertItems`;
- insight:
  - `priceAlert(..., loss.totalLoss)`;
  - `loadPayments` returns the full `loadUpcoming()` result;
  - `DashboardCashPlan` under `DashboardPayments`;
- kasa: the POS stat sub, the commission sub and `dashboard-tasks.tsx`.

**Digest subject precedence** (ops implements it once; the others only supply their parts):
1. Payment rows: `Ödeme hatırlatması: … ` plus extras (`sistem uyarısı`, new invoices, holds, zam).
2. Otherwise system items: `Sistem uyarısı: <first title>` plus extras.
3. Otherwise a sync error with no new invoices: `Paraşüt eşitlemesi başarısız` plus extras.
4. Otherwise new invoices, review or holds: `Sabah özeti: <first of them>` plus the rest.
5. Otherwise zam, or `bugün yeni bir şey yok`.

Ops' "Sistem uyarıları" section stays at the top of the body; pricing's holds box goes after the review box.

### R6. Backup coverage is automatic: drop the "group 3 must include X" tasks
Ops discovers tables at runtime (`information_schema`) and guards secret-looking columns with a schema-driven test.
`ingredient_price_holds`, `product_prices`, `cash_report_revisions`, `job_runs` and the new columns are covered with
no code. Null and 0 stay distinct in `row_to_json`.

What remains:
- re-run `YEDEK_TEST_DATABASE_URL=… npm test` after the **last** migration merge (menu);
- note there that `cash_report_revisions.data` is a NOT NULL jsonb column (the `COALESCE` rule in ops covers it).

### R7. `db:reset` interplay
- Cascades already empty `ingredient_price_holds` and `product_prices`.
- `parasut.taxBackfill` and the price-applied map go with `parasut.%`.
- `cash_report_revisions` survives because `cash_reports` is not truncated. That is correct.
- **Bug in insight:** `cashflow.plan.excluded` holds `fixed:<id>` keys. Reset restarts `fixed_expenses` ids, so the
  exclusions would point at different items. Fix: `db:reset` deletes the `cashflow.plan` key (the balance is short-lived
  anyway), and the README "Silmedikleri" line is not added.

---

## 2. Shared-file collision map

| File | Groups | Note |
|---|---|---|
| `src/server/db/schema.ts`, `drizzle/*` | ops-jobs, 5, pricing, kasa, menu | Disjoint tables and columns; R2 |
| `src/server/actions/notifications.ts` | ops-jobs, pricing, kasa, menu, insight, (today) | R5 |
| `src/app/panel/page.tsx` | ops-jobs, pricing, kasa, insight | R5 insertion points |
| `src/server/notify/digest.ts`, `digest-template.ts`, `tests/hatirlaticilar-digest.test.ts` | ops-jobs, 5 (`loadUpcoming` term days), pricing, insight | R4/R5 |
| `src/server/parasut/sync.ts` | 5 (loadCtx, applyDraft, applyEInvoice, backfill hook, state keys), pricing (`applyProductLinks`, summary `parts`) | Different functions. Both append to `parts`; trivial conflict |
| `src/server/data/suppliers.ts` | 5 (changes); pricing and insight (callers) | R4 optional param |
| `src/components/panel/nav.ts`, `tests/mobile-nav.test.ts` | today (BOTTOM_NAV, NAV_TREE, NAV_GROUPS), insight and menu (hidden NAV_GROUPS item, SHORT_TITLES) | Additive |
| `src/lib/roles.ts` | today | — |
| `src/lib/cash-report.ts` | kasa (fields, carry checks, revisions), today (`trHour`, `isCashEvening`) | Additive |
| `src/app/panel/urunler/page.tsx`, `price-impact-panel.tsx`, `[id]/page.tsx`, `[id]/recipe-editor.tsx` | insight, menu | Insight first, menu rebases |
| `src/lib/calc/engine.ts`, `types.ts`, `src/server/data/dataset.ts` | kasa | Insight and menu read the effective values; no edits |
| `src/app/panel/ayarlar/page.tsx`, `sections.ts` | ops (jobs card, backup card) | `fields.ts` hint: kasa |
| `src/server/actions/auth.ts`, `src/app/panel/hesap/*` | adminstepup | Ops must not touch them |
| `src/app/panel/yardim/page.tsx`, `README.md`, `docs/BILDIRIMLER.md`, `docs/PARASUT.md`, `docs/DEPLOY.md`, `docs/KASA-RAPORU.md` | almost everyone | Append to your own section; `tests/yardim.test.ts` `<Path>` rule |

---

## 3. Per-plan corrections

### adminstepup (1): approve, with two contract additions
Solves the problem: an open admin session can no longer create or take over an admin, and the dead `saveUser` create
branch (a real bypass) is closed. The rule lives in one pure function and is re-checked by the server from DB state.

1. Make `where` `"Hesabım" | "Kullanıcılar" | "Yedek"`, and add `children?: ReactNode` to the moved
   `ConfirmPasswordDialog` now (R4). Ops-backup then reuses both without touching them.
2. Keep the `expireUserTokens` line byte-identical (the plan says so). Also add one test that
   `src/app/panel/hesap/confirm-password.tsx` no longer exists and that nothing imports it, to catch a stale import
   from a parallel branch.
3. No scope cuts. Owner decision 3 (2FA code in the dialog) correctly stays out.

### ops (2, 3, 4): split into three PRs; fix five details
Solves all three. The migration verification closes a silent-skip hole that is real and confirmed in the code.

**Split:**
- **ops-policy** (§1): wave 0, alone (R1).
- **ops-jobs** (§3): wave 1, first migration to merge.
- **ops-backup** (§2): starts against the R4 contract and merges right after adminstepup.

The owner can then take a first backup **before** the kasa and menu migrations reach production.

**Corrections:**
1. **Step-up names:**
   - use `src/server/auth/step-up.ts` and `requirePassword(me, pw, "Yedek")`;
   - use `src/components/panel/confirm-password-dialog.tsx` with its `children` slot;
   - delete the "if group 1 hasn't landed, do the move here" fallback. Sequencing replaces it.
2. **No writes in read paths.** `readWatchSince()` must not upsert from the bell, dashboard or health reads. Write
   `jobs.watchSince` with `ON CONFLICT DO NOTHING` in two places:
   - in `scripts/predeploy.ts` on the production branch (which already writes to the DB);
   - in `startJobRun`.

   Reads are then pure. This still covers "the cron never runs at all", because the first production deploy sets the
   marker.
3. **Watchdog timing in the Paraşüt cron.**
   - `sendWatchdogAlert()` runs before a 45 s sync, and Resend can take up to 15 s. That can exceed `maxDuration = 60`,
     leaving both the job run and the sync run "running", which tomorrow raises a false "yarıda kesildi".
   - Fix: measure the elapsed time, and pass `deadlineMs: Math.max(20_000, 45_000 - elapsed)` to `syncParasut`. Also
     cap the watchdog with its own 8 s `Promise.race`.
4. **Panel documents cap.** Start `PANEL_DOCUMENTS_MAX_BYTES` at **4 MB**. Raise it to 25 MB only after a > 4.5 MB
   streamed download has been verified on production. Larger sets still use the CLI.
5. **`ReadableStream.from`.** If `tsc` (with `@types/node` ^20) or the runtime lacks it, build the stream with
   `new ReadableStream({ pull })` over the async generator. Do not add a dependency.
6. **Optional trims:**
   - the 7-day dot strip on the "Günlük işler" card. The badge plus the last-run line is enough; the dots are
     follow-up material.
   - Keep `/api/health?isler=1` (small, and the only alarm when both crons die).
7. **Rollback rule.** The DEPLOY §7 rule ("migrations must be additive or backward-compatible because of Instant
   Rollback") is new. State that kasa's migration is the one known exception and say what to do (§3 kasa 2).

### 5 (VKN matching): approve the core; defer the merge feature and the sync extras
Solves the problem. The union-find name↔VKN bridge is necessary and not over-engineering. Without it, an Excel "Kaldi"
row and a Paraşüt "Kaldi" row carrying a VKN would split, which is a regression from today's name grouping. The "no VKN
→ identical output" invariant and the determinism tests are the right guards.

1. **Make the tax-number parameter optional** in `loadTermDays()`'s function and in `PaidOnDelivery` (R4). Insight's cash
   plan calls them with the name only, for estimated future invoices from `model.ds.invoices`, which has no tax number.
2. **Ship in two PRs:**
   - (a) plan steps 1–3 and 6: column, capture, backfill, resolver, every caller switched, UI notes, card-dialog
     prefill and preview, docs;
   - (b) a follow-up for step 4 (`mergeSuppliers` / `unmergeSuppliers` / `tax-notice.tsx` Birleştir with undo) and
     step 5 (§5.5 category history by VKN, alias guard moved to `mapping.ts`).

   Until (b), the shared-VKN banner is informational: "… aynı vergi nosunu taşıyor; aynı firmaysa birini Düzenle'den
   silip adını diğerinin ‘Diğer adlar’ına ekleyin." Reason: (b) roughly doubles the action surface and adds more
   `sync.ts` edits, the same file pricing edits in the same wave. The owner gets the grouping, which is what was asked,
   in (a).
3. **Cost note.** `loadUpcoming()` runs on every bell open and now also runs `loadSupplierRefs()` plus the resolver.
   That is fine at this scale. Keep it to one grouped query (as planned) and do not call `loadSupplierLedger()` there.
4. **The backfill** runs only in sync's leftover time. Its progress text goes in the sync summary, and ops' `job_runs`
   step text for the Paraşüt job comes from `parasutOutcome`, so the two do not collide. No change needed; listed so
   the implementer does not add a third status channel.

### pricing (7, 12): approve; cut one coupling, tighten one rule
Solves both.
- Holds are evaluated against the current price, with clear supersede rules, a partial unique index and pure, tested
  decisions.
- The comparison reuses `loadSupplierLedger()`, so it inherits VKN grouping with no code change.

1. **Drop `monthlyDelta` and the "ayda ~X fark" text** from `holdImpact` and the hold card. An approve/reject decision
   only needs the %, the affected products and the top cost change. A second "per month" formula (raw sales month)
   would disagree with insight's scaled one (R4). Keep `products` and `top`.
2. **The approve path that marks a hold superseded "outside the rolled-back transaction" is awkward inside
   `attempt()`.** Do the link check first, outside the transaction: if the link has changed, update the hold to
   `superseded`, `refresh()`, and throw the UserError. Only then open the approve transaction.
3. **Delete §10's "Group 3 must include the table" note** (R6).
4. **Digest:** supply the holds fragment only. Subject precedence is ops' (R5).
5. **Insight interaction is already right:** holds write no `ingredient_prices` row, so no zam or lira-loss appears until
   approval. Keep `src/lib/calc/price-impact.ts` untouched, as planned.

### kasa (6, 10): approve; one PR, (10) first then (6); trim one surface; document a rollback caveat
Solves both. Live derivation (nothing copied into `months`) with "typed always wins" is the right model. Fixing
`costs.ts dataMonths` and `planCellRestore` (never freeze a kasa value) shows the regressions were thought through.

1. **Build order inside the group:**
   - (10) drawer integrity first: `cash_reports` columns, `cash_report_revisions`, form, history, bell, e-mail;
   - then (6) month derivation: `months` columns, `cash-month.ts`, dataset, engine, Satışlar, Gelir-gider, dashboard;
   - **one** migration generated at merge time (R2).
2. **Rollback caveat.** Making `months.discounts` / `off_revenue` nullable without a default is not Instant-Rollback-safe:
   old code would read `null` where it expects a number. Keep the design; it is the simplest correct semantics. Add one
   line to DEPLOY §7 and to the PR text: "bu sürümden geriye Instant Rollback yapmayın; düzeltmeyi ileri yayınlayın". Also
   make sure that every insert of a `months` row in the new code goes through code that `tsc` checks (seed,
   `ensureMonth`, stock, sales).
3. **Trim:** drop the Kasa-page "Ay bilgisine gider" card (§3.3). The same facts already show in three places: the
   Satışlar month-info strip and modes (where the values are edited), the dashboard month task (missing days, source)
   and Gelir-gider. For the Kasa page, a one-line link in the month view is enough: "Bu ayın açık gün ve cirosu kasa
   raporlarından → Satışlar". Keep the `cell-rules.ts` change (it is correctness). The `pnl-grid` styling can be minimal
   (tooltip text only).
4. **Card share and POS commission** changes closed months (October). Keep the default, and put it in the owner
   questions (§6).
5. **Downstream effect to note:** insight's price-loss scale is `acikGun ÷ openDays` of the reference sales month. If
   that month's open days come from kasa with missing reports, the scale is too high. Insight's basis line should name
   the open-day source ("kasa raporlarından, 3 gün eksik") using `Month.sources` / `kasa.till.missing` when present.
   That is optional fields only, so there is no hard dependency.
6. **Naming:** the Kasa page already has a right-column card titled "Bugün". With the new "Bugün" screen, rename that
   card to "Bugünün raporu". This is a one-word change, made by the kasa group since it owns `kasa/page.tsx`.

### insight (8, 9): approve both pure modules; cut two extras; fix the reset bug
Solves both.
- (8) puts lira per month exactly where the owner already looks (Ürünler zam card, product card, dashboard alert, bell,
  e-mail), from one loader.
- (9) builds a 42-day plan from firm data (invoices, reminders) and labelled estimates, and states every assumption.

1. **Cut the Analiz "Zam etkisi" third tab** (`price-loss-view.tsx`, `?donem`, the tables) from this round. It is a
   second, longer-window view of the same numbers, it adds a client view, and it was not asked for. Keep its pure
   function: `priceLoss(model, changes, month)` already supports any window. Remove the "Zam etkisinin tamamı →" link
   and the Yardım FAQ link to `?gorunum=zam`.
2. **Cut `?ekle=sabit` and `ReminderSheet.initialStep`.** The "Gününü girmek için Ödemeler'e ekle →" link simply goes
   to `/panel/hatirlaticilar`. This avoids touching `reminders-client.tsx` and `reminder-sheet.tsx` for a convenience.
3. **Fix the `db:reset` bug** (R7): reset deletes the `cashflow.plan` key.
4. **Name-only term lookups for future goods** are fine with 5's optional parameter (R4). Firm invoices already get
   VKN-aware due days through `loadUpcoming`.
5. **Export `salesBasis`** for menu (R4). Keep the `priceAlert` third argument optional, so the existing text and tests
   stay identical when it is not passed.
6. **Dashboard card:** `loadCashPlan(...).catch(() => null)` must never throw into `DashboardContent`. It shares the
   `model` and `upcoming` already loaded (as planned); with no extra `loadModel()`, latency is about four small queries.

### menu (11): approve; align the monthly effect; keep the site safeguards
Solves the problem.
- Bulk changes go through the existing per-item site write, grouped by `siteMenuId` so M and L never race.
- There is a circuit breaker and a 40 s deadline.
- A self-correcting ModPOS state lives on `products`, and append-only history is recorded in every write path,
  including `applyPlan` for site pulls and sibling updates.
- Locking is consistent with main: linked flows take `lockMenu` first, then row locks, so there is no deadlock with
  ping pulls.

1. **"Aylık brüt kâr" / "Aylık etki":** use insight's `salesBasis(model, month).perMonth` (scaled to a standard month),
   with the same basis line wording. Menu merges after insight. If it must merge first, show the raw month quantity and
   label it "Eylül adetleriyle" (as planned), then switch at rebase.
2. **`recordPriceChange` inside `applyPlan`:** record only when `c.set.price !== undefined` **and** the `.returning()`
   row exists (as planned). Add a test with a visibility-only change (`active` / `showOnMenu`), which must write no
   history.
3. **The migration name `0020_fiyat_gecmisi` in the plan is only a placeholder;** R2 decides the number (it will be
   about 0024).
4. **Delete the "Group 3 must include" note** (R6).
5. **No scope cut.** The three tabs are what the owner asked for. The clipboard text and "Hepsini işaretle" are cheap and
   useful for the ModPOS chore.

### today (13): approve; build in parallel, merge last, and add the four integration rows instead of "extension points"
Solves the problem. It is a role-split loader (staff never load admin data, pinned by a source test), a pure `dayTasks`
with fixed-clock tests, no schema, and Kasa in both bottom bars.

1. **Merge last, and include the rows directly** (each is one fact, one function and one test in `tests/bugun.test.ts`):
   - `isler` (admin, first): danger items from ops' `loadSystemAlerts()`, as `warn`, linking to `/panel/ayarlar#isler`.
     This also replaces today's own `parasutFacts()` query for the sync-error part of the `fatura` row (R4).
   - `fiyat-onay` (admin, before `zam`): `pendingHoldSummary().count > 0`, as `todo`, linking to
     `/panel/hammaddeler#fiyat-onayi`.
   - kasa flags (admin `kasa-dun` and `kasa`): an opening ≠ carry-over or a late revision makes the row `warn` and adds
     "Açılış devirle tutmuyor" / "Ertesi gün düzeltildi" to the description (kasa's `carryChecks` /
     `cashRevisionsFor`).
   - `modpos` (admin): `posPendingSummary().count > 0`, as `todo`, "Kasada değişecek {n} fiyat", linking to
     `/panel/urunler/fiyatlar?sekme=kasa`.
2. **`zam` row:** call `priceAlert(changes, actionable, loss.totalLoss)` so the text matches the dashboard and the bell.
3. **Keep the optional `isCashEvening` change to the staff branch of `cashNotifications`** as a one-liner. Kasa edits the
   admin branch of the same function; rebase carefully.
4. **Bottom bars and `STAFF_HOME` stay as planned** (owner question 2). The admin `homeFor` stays `/panel`.

---

## 4. Scope summary (what to cut or defer from this round)
| Plan | Defer | Why |
|---|---|---|
| 5 | Birleştir and undo (`mergeSuppliers`, `unmergeSuppliers`, `tax-notice.tsx` dialog); §5.5 sync extras | Not needed for grouping; reduces `sync.ts` overlap with pricing; separate follow-up PR |
| insight | Analiz "Zam etkisi" tab; `?ekle=sabit` and `initialStep` | Second view of the same numbers; convenience edits in two shared Ödemeler files |
| kasa | Kasa-page "Ay bilgisine gider" card (and heavy Gelir-gider styling) | Duplicates the Satışlar strip and the dashboard task |
| pricing | `monthlyDelta` in hold cards | Conflicting "per month" formula; not needed to decide |
| ops | 25 MB panel document cap (start at 4 MB); 7-day dots | Unverified Vercel limit; cosmetic |

Nothing is missing from the owner's 13 points after these corrections. One point is not a gap but should be said: the
e-mail alarm cannot fire when **both** crons are dead. Ops' optional external monitor on `/api/health?isler=1` is the
only cover, so keep it in the owner questions.

---

## 5. Implementation order

**Wave 0 (alone; merge and deploy before any other branch is pushed):** ops-policy (§1 of ops). This includes the
one-time read-only production check of `drizzle.__drizzle_migrations` (owner question 1).

**Wave 1 (parallel worktrees, each branched from main after wave 0, each with its own DB per R3):**
- adminstepup
- ops-jobs
- 5-core
- pricing
- kasa
- insight
- menu
- today-core (rows for the existing sources only)

**Wave 2 (needs adminstepup's API; can start coding in wave 1 against R4 and rebase):** ops-backup.

**Follow-ups (after the main sequence):** 5-merge and 5-sync-extras, the insight Analiz tab, and the ops 7-day dots,
if the owner wants them.

**Merge order (serialised; every merge runs: rebase → R2 regeneration if it has a migration → `npm test`,
`npm run lint`, `npx tsc --noEmit` → 390 px and desktop check of the touched screens → merge → production build shows
`✓ Veritabanı şeması güncel (N migration)`):**

| # | Branch | Migration | Why here |
|---|---|---|---|
| 0 | ops-policy | — | R1 |
| 1 | adminstepup | — | Fixes the step-up module and dialog paths others use |
| 2 | ops-jobs | `gunluk_isler` | Sets the bell `sistem` group and the digest 5th argument and subject rules that later branches build on |
| 3 | ops-backup | — | Owner takes the first real backup **before** the bigger migrations land; restore test written here |
| 4 | 5-core | `fatura_vergi_no` | `loadTermDays` / `PaidOnDelivery` optional signature, used by insight; backfill starts filling early |
| 5 | pricing | `fiyat_onayi` | After 5 because both edit `sync.ts`; the comparison inherits VKN grouping |
| 6 | kasa | `kasa_ay_bilgisi_butunluk` | Engine and dataset change; tell the owner October's commission moves |
| 7 | insight | — | Reads effective months; exports `salesBasis` for menu |
| 8 | menu | `fiyat_gecmisi` | Uses `salesBasis`; same Ürünler files as insight |
| 9 | today | — | Adds the `isler`, `fiyat-onay`, kasa-flag and `modpos` rows from the merged loaders |

After step 8, run `YEDEK_TEST_DATABASE_URL=… npm test` (the restore round trip over all new tables) and the
YEDEK.md drill once. After step 9, run the full suite and a manual pass over the bell, the dashboard and Bugün as admin
and as staff at 390 px.

---

## 6. Questions for the owner (defaults are implemented; nothing blocks)
1. **Before the first merge,** someone with Neon access runs one read-only query on production:
   `select created_at, hash from drizzle.__drizzle_migrations order by created_at`. Otherwise give the developer the
   unpooled URL. If the 21 Oct preview left a gap, the first guarded build would fail.
2. **Phone bottom bar.** Admin: Genel bakış · Bugün · Kasa · Ödemeler · Menü, with Satışlar and Faturalar moving to the
   drawer. Staff: Bugün · Karaoke · Kasa · Zayi · Reçeteler, and staff open on Bugün. OK?
3. **Kasa rules.** When the opening differs from the previous day's carry-over, saving requires a note. Staff can no
   longer edit a report once the next day's report exists (the admin still can). OK?
4. **Card share.** Use each month's real card share from the Z reports for the POS commission (October's commission
   will move slightly)? Default: yes.
5. **Price holds.** Paraşüt prices that differ by more than ±40% wait for approval, including the first Paraşüt price of
   an ingredient still on an Excel estimate. OK?
6. **Backup.** The file has no passwords or 2FA. Restore is done by a developer from a computer, not from the panel.
   The panel reminds you after 30 days. Also set up a free uptime monitor on `/api/health?isler=1`? Default: recommended.
7. **Cash plan defaults.** Salaries on the 1st, SGK at month end, card money arrives the same day, and Karaoke box / Alp
   Koç invoices are included. Correct?
8. **Two supplier cards with the same tax number.** For now the page tells you; a one-tap "Birleştir" can come in a
   second step (the target card's IBAN and term win). Want it?
9. **Password prompt.** Only actions that create or affect an admin ask for your password. Staff changes, unlock and
   "sign out everywhere" stay one tap. OK?
