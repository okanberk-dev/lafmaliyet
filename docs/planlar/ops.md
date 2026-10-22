# Ops plan: suggestions 2, 3, 4

- 2: preview deployments must not migrate the production database
- 3: a full backup that can be restored, and a restore path that has been tested
- 4: warn when the daily jobs did not run or failed

Repo: `/home/user/lafmaliyet`, branch `claude/oneriler` (= main @ 981692e). Next 16.4 / React 19 / Drizzle 0.45 / postgres.js / Neon / Vercel (Hobby, fra1).

## 0. Findings that drive the design

These were checked read-only: the code, the local DB, and the Vercel project `lafmaliyet` (env var listing, deployment list, no secret values read).

1. **Previews use the production database.** The Neon env vars (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `DATABASE_*`) target **Preview + Production**, from the same Neon store. `AUTH_SECRET`, `CRON_SECRET`, `KARAOKE_SYNC_SECRET`, `PARASUT_*`, `resend_api_key` and `ADMIN_PASSWORD` are **Production only**. As a result:
   - Every preview build runs `scripts/predeploy.ts`, which migrates and seeds the production DB.
   - At runtime a preview cannot log anyone in (no `AUTH_SECRET`; `secretKey()` throws in production mode), cannot run crons, and cannot accept site pings.
2. **This has already caused an incident.** On 21 Oct 2026 the preview of branch `claude/brave-cannon-ctlv3a` applied an early "0017" site-menu migration to production. The renumbered `0018` then failed (deployment `dpl_2gWSYokKHVpP78j2cCo2S9f4X8FR` = ERROR). It was fixed by hand-editing `drizzle/0018_site_menu_baglantisi.sql` to use `IF NOT EXISTS` (see the comment at the top of that file).
3. **Drizzle can silently skip migrations.** `node_modules/drizzle-orm/pg-core/dialect.js:56-69` applies a migration only when its journal `when` (folderMillis) is greater than the newest `created_at` in `drizzle.__drizzle_migrations`. If a migration with a later timestamp lands first, every pending migration with an older timestamp is skipped forever, with no error. Two ways this happens:
   - a preview applies a migration early;
   - branches are merged in a different order from the one they were generated in. This matters for this workflow, where many groups generate migrations at the same time.
4. **`VERCEL_ENV` values.** Possible values are `production`, `preview` and `development`. Custom environments report `preview`, with the name in `VERCEL_TARGET_ENV`. Outside Vercel (`npm run build` on a laptop) `VERCEL` is unset.
   - Crons run only on production deployments.
   - "Promote to production" of a preview rebuilds with production env.
   - Instant Rollback does **not** rebuild: old code runs on the new schema.
5. **The current "Yedek" is not a backup you can restore from.** Ayarlar › Yedek is `/api/export` (`src/app/api/export/route.ts` + `workbook.ts`), a read-only Excel file. It has no users, reminders, expense entries or Paraşüt links, and nothing can be restored from it. DEPLOY.md § 7 calls Neon PITR "the real backup", but on Neon's small plans the PITR window is only hours to days.
6. **Data size.** The local DB is 10 MB, mostly index overhead. `invoices` has 111 rows, about 63 KB of JSON (`row_to_json`).
   - All row data gzipped is well under 1 MB today, and stays under 4.5 MB for years.
   - `invoice_documents.data` is `bytea`. Uploads are at most 4 MB each (photos are shrunk on the client).
   - Paraşüt PDFs are only a cache: `getInvoiceDocument()` downloads them again when missing (`src/server/documents.ts`).
7. **Secrets in the DB:**
   - `users.password_hash`, `users.recovery_codes`: scrypt.
   - `users.totp_secret`: sealed with `AUTH_SECRET`.
   - `user_tokens.token_hash`: sha256 of one-time links.
   - `push_subscriptions`: device endpoint keys.
   - `integration_state['parasut.token']` and `['webpush_vapid']`: sealed.
   - `src/server/secret-box.ts`: everything sealed is unreadable without `AUTH_SECRET`, and the app already regenerates or re-fetches it when unreadable.
8. **Crons today** (`vercel.json`): `/api/cron/parasut` at `30 4 * * *` (07:00–08:00 TR on Hobby) and `/api/cron/gunluk` at `0 5 * * *` (08:00–09:00 TR).
   - Nothing records that a job ran.
   - Only a *Paraşüt sync* failure is visible: `parasut_sync_runs` feeds the bell (`invoiceNotifications`), the dashboard task and the digest.
   - If `gunluk` does not run, or throws, nobody is told: the morning e-mail itself is what failed.
   - If `CRON_SECRET` is missing, both routes return 503 silently.
9. **JSON round trip.** Tested on local PG16: `row_to_json` → `json_populate_recordset(NULL::table, …)` round-trips timestamptz, `bytea` (`"\\x…"`), jsonb, `NaN`/`Infinity` (as strings) and text. Missing keys become NULL, **not** column defaults, so inserts must list columns explicitly. A jsonb value that is JSON `null` and an SQL NULL both serialise to `null`.
10. **FK graph.** No self-references and no cycles (`pg_constraint` listing). A topological order exists.

---

## 1. Suggestion 2: previews must not touch the production schema

### Goal

Only a production build (or a local build, as today) may run migrations and seed. Preview, development and unknown Vercel builds skip all database writes.

Every production build also checks that drizzle really applied every migration in the repo's journal. If one was skipped (out-of-order timestamps), the build fails loudly instead of deploying code against a schema it doesn't match. A unit test catches out-of-order journals before they ever reach Vercel.

### Behaviour

`npm run build` → `tsx scripts/predeploy.ts && next build`. The decision comes from the pure function `dbPrepareDecision(env)` in the new `scripts/db-policy.ts`:

| Where | `VERCEL` | `VERCEL_ENV` | Action |
|---|---|---|---|
| Laptop / local | unset | – | migrate + verify + seed if `DATABASE_URL`/`POSTGRES_URL` is set (unchanged). `SKIP_DB_PREPARE=1` skips. |
| Vercel production | `1` | `production` | migrate + verify + seed |
| Vercel preview / custom env | `1` | `preview` | skip, log the line below |
| `vercel build` (dev) | `1` | `development` | skip |
| Vercel, `VERCEL_ENV` empty or unknown | `1` | other | skip (fail safe: allow-list, never deny-list) |

Log lines, exact Turkish:

- Preview: `! Önizleme derlemesi (VERCEL_ENV=preview, dal <VERCEL_GIT_COMMIT_REF>): migration ve seed atlandı. Önizlemeler canlı veritabanını kullanır; şema yalnız production derlemesinde güncellenir.`
- Development or unknown: `! VERCEL_ENV=<değer>: migration ve seed yalnız production derlemesinde çalışır, atlandı.`
- Flag: `! SKIP_DB_PREPARE=1: migration ve seed atlandı.`
- No DB: the existing `! DATABASE_URL yok: migration ve seed atlandı`.

`npm run db:migrate` (manual, local) is unchanged except that it now also verifies.

### Migration verification (production build and `db:migrate`)

The pure function lives in `scripts/db-policy.ts`:

```ts
export interface JournalEntry { idx: number; when: number; tag: string }
export function readJournal(dir = "drizzle"): JournalEntry[]            // drizzle/meta/_journal.json
export function migrationGaps(journal: JournalEntry[], appliedCreatedAt: number[]):
  { missing: JournalEntry[]; orphans: number[] }
```

- `missing`: journal entries whose `when` has no row in `drizzle.__drizzle_migrations.created_at`.
- `orphans`: applied `created_at` values that are not in the journal (for example the row the 21 Oct preview applied).

`scripts/migrate.ts` › `runMigrations()` calls `verifyMigrations(db)` after `migrate()`:

- If `missing` is non-empty, throw. The build fails and Vercel keeps the current production deployment live. Message:
  > `Migration uygulanmadı: 0021_x, 0022_y. Veritabanında daha yeni tarihli bir migration kayıtlı olduğu için drizzle bunları atladı (sıra bozuk). Dalı main ile birleştirip "npm run db:generate" ile migration'ı yeniden üretin. Ayrıntı: docs/DEPLOY.md § 7.`
- If there are orphans, warn and continue:
  > `! Veritabanında depoda olmayan N migration kaydı var (created_at …). Bir önizleme uygulamış olabilir; şemayı docs/DEPLOY.md § 7'deki gibi kontrol edin.`
- Success: `✓ Veritabanı şeması güncel (20 migration)`.

**One-time pre-merge check (read-only, by the owner/dev with the production URL):**

```sql
select created_at, hash from drizzle.__drizzle_migrations order by created_at
```

Expect all 20 journal `when` values plus possibly one orphan from 21 Oct. If a journal entry is missing:

- If its schema change is present (for example `\d suppliers` shows `hidden_on`), insert the missing `(hash, created_at)` row as a documented one-off.
- Otherwise, run that migration's SQL.

Do this **before** merging. Otherwise the first production build with verification fails and blocks every deploy.

### Docs (DEPLOY.md)

- § 2 / § 5: "Build komutu yalnız production derlemesinde migration ve seed çalıştırır; önizlemeler canlı veritabanına bağlı ama şemayı değiştirmez."
- § 4: a note that the Neon variables are on Preview too, and why that is now safe.
- § 7, three new rules:
  - Migrations must be additive or backward-compatible, because Instant Rollback runs old code on the new schema.
  - Never hand-edit an applied migration.
  - What to do when the build says "Migration uygulanmadı" or warns about orphans.
- Remove the old sentence in KARAOKE/SITE-* docs, if any, that relied on previews migrating (grep "önizleme").

---

## 2. Suggestion 3: a backup you can restore, and a tested restore path

### Goal

The owner can download, from Ayarlar › Yedek and after typing their password, one `.json.gz` file. It holds every table needed to rebuild the panel. Credentials are left out (decision below).

A local command `npm run db:restore` loads that file into an empty database, or (with `--sil`) atomically replaces a database. Before loading it:
- verifies the file's integrity (sha256, end marker);
- verifies the schema version;
- migrates up to the backup's schema;
- after loading, migrates forward to the current code.

The restore is proven three ways: an automated round-trip test against real Postgres, unit tests for the pure parts, and a documented manual drill (prova) in `docs/YEDEK.md`. The Excel export stays as the "readable copy".

The panel reminds the owner when the last backup is older than 30 days.

### Decisions (defaults; see § 5 Owner decisions)

- **Credentials are left out of the file:**
  - `users.password_hash`, `totp_secret`, `totp_enabled`, `totp_last_step`, `recovery_codes`, `failed_logins`, `locked_until`, `session_version`;
  - the whole `user_tokens` and `push_subscriptions` tables;
  - `integration_state` keys `parasut.token` and `webpush_vapid`.

  On restore, users keep their *current* password when their e-mail matches the target DB. Otherwise they become "Davet bekliyor", and `ADMIN_EMAIL`/`ADMIN_PASSWORD` set the admin's password. Why: the file will sit in Downloads or Drive. Leaving out hashes and sealed secrets costs one "send a new link" step in a disaster, and nothing in a normal restore.
- **Not encrypted.** It is a plain gzip; losing a passphrase would mean losing the backup. Instead, the UI and docs say clearly that the file has revenue, salaries and IBANs.
- **Documents:**
  - Paraşüt PDFs (cache) are never included.
  - Uploaded documents (`source='upload'`) are included only when the owner ticks "Belgeleri de ekle", and only if their total is ≤ 25 MB.
  - Above that, they are taken with the CLI: `npm run db:backup -- --belgeler`.
- **Restore is CLI only, never in the panel.** A request body over 4.5 MB can't be uploaded to a Vercel function, and one tap must not replace all data.

### File format v1 (`src/lib/backup/format.ts` documents it; `docs/YEDEK.md` repeats it)

- Gzip of UTF-8 JSON Lines (one JSON value per line, `\n`).
- File name: `laffogato-yedek-YYYY-MM-DD-HHmm.json.gz` (TR time). A safety copy is `laffogato-yedek-once-<host>-YYYY-MM-DD-HHmm.json.gz`.

```
{"format":"laffogato-yedek","version":1,"createdAt":"2026-10-22T06:15:03.120Z","createdBy":"Okan",
 "app":"981692e","documents":false,
 "migrations":[{"hash":"…","createdAt":1792413340966}, …],          // source DB's drizzle.__drizzle_migrations
 "excluded":{"tables":["push_subscriptions","user_tokens"],"columns":{"users":[…]},
             "stateKeys":["parasut.token","webpush_vapid"],"documents":"parasut-onbellek"}}
{"table":"activity_log","columns":["id","at","user_name","action","detail"]}
{"r":{"id":1,"at":"2026-10-17T09:00:00+00:00","user_name":"Sistem","action":"Excel'den aktarım","detail":"…"}}
…
{"table":"categories","columns":[…]}
{"r":{…}}
…
{"end":{"tables":{"activity_log":13,"categories":12,…},"rows":4312,"sha256":"<hex>"}}
```

- Tables are written in alphabetical order. The `columns` list is the DB's columns in `ordinal_position` order, minus the left-out columns. Rows are `row_to_json` of `SELECT <columns>`, so timestamptz is ISO, bytea is `"\\x…"`, jsonb is nested.
- `sha256` covers the UTF-8 bytes of every line before the `end` line, each including its `\n`. A missing `end` line, a bad gzip stream or a wrong hash means "dosya eksik ya da bozuk", and the restore refuses.
- `app` = `VERCEL_GIT_COMMIT_SHA` (first 7 characters), or `"yerel"`.
- Tables are found **at runtime** from `information_schema.tables` (`table_schema='public'`, `BASE TABLE`). New tables from other groups are backed up with no code change.

Rules (constants in `format.ts`, one place):

```ts
export const BACKUP_FORMAT = "laffogato-yedek";
export const BACKUP_VERSION = 1;
export const PANEL_DOCUMENTS_MAX_BYTES = 25 * 1024 * 1024;
export const TABLE_RULES: Record<string, { skip?: string; dropColumns?: string[]; where?: string; documents?: true }> = {
  user_tokens: { skip: "tek kullanımlık bağlantılar (özet); yenisi gönderilir" },
  push_subscriptions: { skip: "cihazlar panel açılınca yeniden abone olur" },
  users: { dropColumns: ["password_hash","totp_secret","totp_enabled","totp_last_step","recovery_codes","failed_logins","locked_until","session_version"] },
  integration_state: { where: `key NOT IN ('parasut.token','webpush_vapid')` },
  invoice_documents: { where: `source = 'upload'`, documents: true },   // documents=false → table omitted, listed in excluded.tables
};
```

### Export core: `src/server/backup/core.ts`

This module has **no** `import "server-only"`. The route, the scripts and the tests all use it, the same way `src/server/db/index.ts` works today. Add a Turkish comment saying why.

```ts
export async function* backupLines(sql: postgres.Sql, opts: { documents: boolean; createdBy: string; app: string; now?: Date }):
  AsyncGenerator<string, BackupSummary>
export interface BackupSummary { tables: Record<string, number>; rows: number; sha256: string; documents: boolean; docCount: number }
```

Steps:

1. `const conn = await sql.reserve()`, then `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, so all tables come from one consistent snapshot. Then `COMMIT` and `release()` in `finally`.
2. Read `drizzle.__drizzle_migrations` (if the schema exists) and emit the header.
3. For each table:
   - read its columns from `information_schema.columns` and apply `TABLE_RULES`;
   - emit the table line;
   - fetch rows with keyset pages when the table has an integer `id` column: `SELECT row_to_json(x)::text AS j FROM (SELECT <cols> FROM "t" WHERE id > $1 [AND rule.where] ORDER BY id LIMIT 2000) x`. Use page size 10 for `invoice_documents`. Tables without `id` take a single `ORDER BY 1` query.
   - Yield `{"r":<j>}` per row.
   - Identifiers come only from `information_schema` and are quoted with `"…"` (double any `"`).
4. Hash each line as it is yielded (`node:crypto` `createHash('sha256')`), then yield the `end` line. Return the summary.

### Download

**Server action** `src/server/actions/backup.ts` (`"use server"`):

```ts
const schema = z.object({ password: z.string().min(1, "Parolanızı girin"), documents: z.boolean() });
export async function prepareBackupDownload(input: z.input<typeof schema>): Promise<ActionResult<{ url: string; fileName: string }>>
```

It runs inside `attempt()`:

1. `requireAdmin()`.
2. Parse the input.
3. **Step-up:** check the admin's own password with the shared re-auth helper. Group 1 (suggestion 1) is expected to move `confirmPassword`/`requirePassword` and the `reauthFails` limiter out of `src/server/actions/auth.ts` into a server-only module (for example `src/server/auth/reauth.ts`). Use it. If that hasn't landed, do the move here, with no behaviour change: 5 failures per 15 minutes, failures go to the activity log. **Do not export a helper from a "use server" file**: that would make it a callable action. Log a failure as `logActivity(me, "Hatalı parola onayı (Yedek)", me.email)`.
4. If `documents` is set and the uploads total is over `PANEL_DOCUMENTS_MAX_BYTES`, throw `UserError("Belgeler panelden indirilemeyecek kadar büyük (31,2 MB). Belgeli yedeği bilgisayardan alın: docs/YEDEK.md › Belgeler.")`.
5. Return `{ url: "/api/yedek?t=" + encodeURIComponent(handle), fileName }`, where `handle = seal(JSON.stringify({ u: me.id, d: documents, exp: Date.now() + 120_000 }), "backup")`. Add `"backup"` to `SealPurpose` in `src/server/secret-box.ts`.

There's no `refresh()`: nothing changes on the page until the download completes.

**Route** `src/app/api/yedek/route.ts` (GET, `export const maxDuration = 60`):

1. `getCurrentUser()`. If there is no user, or the user is not admin: 403 JSON `{ error: "Bu işlem için yönetici girişi gerekli" }`.
2. `openBackupHandle(t, user.id)` (in `src/server/backup/state.ts`, server-only). If it is invalid or expired: 403 `{ error: "İndirme bağlantısının süresi doldu. Ayarlar › Yedek'ten yeniden indirin." }`.
3. Stream: `ReadableStream.from(backupLines(getDb().$client, …))` → `TextEncoderStream` → `CompressionStream("gzip")` → a counting `TransformStream` → `Response`. The counter's `flush()`:
   - writes `integration_state['backup.last'] = { at, by, bytes, rows, tables, documents, docCount }`;
   - calls `logActivity(user, "Yedek indirildi", "41 tablo · 4.312 satır · 1,2 MB · belgeler hariç")`.

   Both happen only when the whole file has been delivered; an aborted download records nothing.
4. Headers:
   - `Content-Type: application/gzip`
   - `Content-Disposition: attachment; filename="laffogato-yedek-2026-10-22-0915.json.gz"`
   - `Cache-Control: no-store`

Before writing the route, read `node_modules/next/dist/docs/` on route handlers and streaming (AGENTS.md).

**Vercel response size:** check after deploy that a download over 4.5 MB with documents completes. If Vercel cuts streamed responses at 4.5 MB, lower `PANEL_DOCUMENTS_MAX_BYTES` to 4 MB and keep the CLI path. The data-only file is far below the limit either way.

### State: `src/server/backup/state.ts` (server-only)

- `backupHandle(userId, documents)`, `openBackupHandle(handle, userId)`
- `readLastBackup(): Promise<LastBackup | null>`, `saveLastBackup(v)`
- `loadBackupInfo()` returns `{ last, uploads: { count, bytes } }`, using `SELECT count(*), coalesce(sum(size),0) FROM invoice_documents WHERE source='upload'`.

### UI: Ayarlar › Yedek (rewrite `BackupCard` in `src/app/panel/ayarlar/page.tsx`; new client file `src/app/panel/ayarlar/backup-client.tsx`)

- `SectionCard id="yedek"`, icon `HardDriveDownload`, title **Yedek**.
- `summary` (phone, collapsed): one of
  - `Son yedek 12 Eki · 1,2 MB`
  - `Son yedek 34 gün önce`
  - `Henüz yedek indirilmedi`
- `description`:
  > Paneldeki bütün veri tek dosyada iner ve gerekirse geri yüklenir. Ayda bir indirip bilgisayarınızda ya da Google Drive'da saklayın. Parolalar dosyaya yazılmaz; dosyada ciro, maaş ve IBAN'lar var, kimseyle paylaşmayın.

  followed by `InfoTip`:
  > Veritabanı Neon'da da kendiliğinden yedeklenir ama yalnız kısa bir süre geriye gidilebilir; bu dosya sizde kalan uzun süreli kopyadır. Geri yükleme panelden yapılmaz (tek dokunuşla bütün veri değişmesin); bilgisayardan bir komutla yapılır, adımlar docs/YEDEK.md'de. Excel kopyası okunmak içindir, geri yüklenmez.
- Body, in a rounded `bg-surface ring-1 ring-line` box like `SiteLinksCard`:
  - `Son yedek: 12 Ekim 2026 09:15 · Okan · 1,2 MB · belgeler hariç`, plus `Badge tone="amber"` "30 günü geçti" when ≥ 30 days old.
  - Or `Henüz yedek indirilmedi.` with `Badge tone="amber"` "Yedek yok".
  - Second line, only if `uploads.count > 0`: `Yüklenen fatura belgeleri: 18 dosya · 6,4 MB` (use `formatBytes` from `src/lib/documents.ts`).
- Actions, both `max-sm:w-full`:
  - primary `Yedeği indir` with the `Download` icon;
  - secondary, the existing plain link `<a href="/api/export" download>` labelled `Excel kopyası`.
- Dialog: reuse `ConfirmPasswordDialog` (`src/app/panel/hesap/confirm-password.tsx`, or wherever group 1 moves it). Add an optional `children` prop rendered above the password field.
  - title `Yedeği indir`
  - description `Parolanızı girin: yedek paneldeki bütün veriyi taşır.`
  - confirmLabel `İndir`
  - child, only if uploads exist: `Checkbox` labelled `Yüklenen fatura belgelerini de ekle`, with helper text `18 dosya · 6,4 MB; dosya büyür, Wi-Fi'de indirin`. Above 25 MB it is disabled, with the text `Belgeler panelden indirilemeyecek kadar büyük (31,2 MB); docs/YEDEK.md › Belgeler`.
- On success:
  1. close the dialog first;
  2. then create an `<a href={url} download={fileName}>` and `.click()` it (not a router navigation);
  3. show `toast.success("Yedek iniyor", { description: fileName })`.

  On error, return the message so the dialog shows it under the field and stays open.
- Phone: the dialog is the `Dialog` bottom sheet, buttons are full width, nothing scrolls sideways at 390 px.

`sections.ts`: the `yedek` entry stays. Add the jobs section (§ 3).

### Backup reminder

The backup reminder is part of the system alerts in § 3. In production only, when `backup.last` is missing or ≥ 30 days old:

- bell item: group `sistem`, kind `info`, id `yedek-<last day or "yok">`, href `/panel/ayarlar#yedek`
- title `Yedek almayalı 34 gün oldu` / `Henüz yedek indirilmedi`
- body `Ayarlar › Yedek › Yedeği indir; dosyayı bilgisayarınızda ya da Drive'da saklayın.`

It does not appear in the dashboard banner (danger items only).

### CLI

`package.json`:

```json
"db:backup": "tsx scripts/backup.ts",
"db:restore": "tsx scripts/restore.ts"
```

`.gitignore`: add `laffogato-yedek-*.json.gz`, so a backup made in the repo folder can never be committed.

**`scripts/backup.ts`** (about 30 lines):

```
npm run db:backup -- [--belgeler] [--cikti <dosya>]
```

- Uses `DATABASE_URL_UNPOOLED ?? DATABASE_URL`, `createDb(url, 1).$client`, and `backupLines(…, { createdBy: "komut satırı" })`.
- Pipes through `zlib.createGzip()` to `--cikti`, by default `os.homedir()/laffogato-yedek-<ts>.json.gz`.
- Prints `✓ Yedek yazıldı: <yol> · 41 tablo · 4.312 satır · 1,2 MB`.

**`scripts/restore.ts`**: the core is in `src/server/backup/core.ts` › `restoreBackup(sql, file, opts)`, so tests can call it.

```
npm run db:restore -- <dosya.json.gz> [--sil] [--onay=<sunucu>]
```

Algorithm:

1. **Read and verify.** Stream `createReadStream(file).pipe(createGunzip())` line by line through `readline`:
   - recompute sha256;
   - collect `{ header, tables: Map<name, { columns, rows }> , end }`;
   - refuse on bad gzip, a missing `end`, a hash mismatch, or `format`/`version` not supported. Messages:
     - `Dosya eksik ya da bozuk (indirme yarıda kesilmiş olabilir): …`
     - `Bu yedek biçimi (sürüm 2) bu kodla okunamıyor; kodu güncelleyin.`
2. **Version check.** The pure `backupSchemaPlan(header.migrations, journal)` in `format.ts` returns either `{ upTo: when, unknown: number[] }` or `{ error }`:
   - `upTo` is the largest journal `when` the backup has applied.
   - If the backup has a `created_at` newer than the newest journal entry: `{ error: "Yedek bu koddan daha yeni bir sürümle alınmış: önce kodu güncelleyin (git pull)." }`.
   - Unknown older rows are orphans: warn.
3. **Target.** Print `Hedef: <host>/<db>` (password masked).
   - If `public` has any table, or the `drizzle` schema exists, `--sil` is required. Message: `Hedefte tablolar var (invoices 111 satır, …). Boş bir veritabanı verin ya da üzerine yazmak için --sil ekleyin; önce hedefin yedeği alınır.`
   - With `--sil` and a host other than localhost/127.0.0.1: require `--onay=<host>`, or (TTY only) an interactive prompt `Bu veritabanındaki bütün veri silinip yedekle değiştirilecek: <host>/<db>. Onaylamak için sunucu adını yazın:`.
   - If the backup has `documents=false` and the target has uploads, add this to the prompt: `Bu yedekte belge yok: hedefteki 18 yüklenen belge silinecek.`
4. **Safety copy** (`--sil` with a non-empty target). Run `backupLines(target, { documents: true, createdBy: "geri yükleme öncesi" })` to `<dirname(file)>/laffogato-yedek-once-<host>-<ts>.json.gz` and print the path. This happens before any change.
5. **Remember credentials** (target non-empty). `SELECT email, password_hash, totp_secret, totp_enabled, totp_last_step, recovery_codes, session_version FROM users` builds a map by `lower(email)`, plus `maxSv`.
6. **One transaction** on the unpooled connection, `sql.begin(async tx => …)`. Postgres DDL is transactional, so any failure leaves the target exactly as it was.
   1. With `--sil`: `DROP TABLE` every `public` base table `CASCADE`, then `DROP SCHEMA IF EXISTS drizzle CASCADE`. Do not drop the `public` schema itself, so grants are kept.
   2. `applyMigrations(tx, journalMigrations.filter(m => m.folderMillis <= upTo))`. This copies drizzle's own loop (dialect.js:44-71) in about 15 lines:
      - create the `drizzle` schema and the `__drizzle_migrations` table;
      - for each migration: `tx.unsafe(stmt)` per statement, then insert `(hash, created_at)`.

      Migrations come from the public `readMigrationFiles({ migrationsFolder: "drizzle" })` (`drizzle-orm/migrator`). Comment why: atomic, and stops at the backup's version.
   3. Order the tables with `orderTables(tableNames, fkEdges)`: a pure topological sort in `format.ts`, with parents first. Edges come from `pg_constraint` (`contype='f'`) of the target. Tables that are in the backup but not in the target: warn and skip. Columns in the backup but not in the target: warn and skip.
   4. Users: the pure `mergeUserRows(backupRows, saved, { adminEmail, adminHash, maxSv })`:
      - matched e-mail: copy the saved credential columns and set `session_version = saved + 1`;
      - unmatched: `password_hash = INVITE_PASSWORD_HASH` (`'!davet-bekliyor'` from `src/server/auth/tokens.ts`), `totp_enabled = false`, `session_version = maxSv + 1`;
      - `ADMIN_EMAIL` + `ADMIN_PASSWORD` set (loaded by `loadEnvConfig`): that user (created as admin/active if missing) gets `hashPassword(ADMIN_PASSWORD)`.

      Every old session cookie becomes invalid.
   5. Insert each table in batches of 500 rows: `tx.unsafe('INSERT INTO "t" (<cols>) SELECT <exprs> FROM json_populate_recordset(NULL::"t", $1::json)', [JSON.stringify(batch)])`.
      - `<exprs>` is the column itself, except for **NOT NULL jsonb** columns, which use `COALESCE("c", 'null'::jsonb)` (JSON `null` vs SQL NULL, finding 9).
      - Columns not in the file get their defaults because they are not listed.
   6. Sequences: for every column whose `column_default LIKE 'nextval(%'`, run `SELECT setval(pg_get_serial_sequence('"t"','c'), GREATEST(COALESCE(MAX("c"),0),1), COUNT(*)>0) FROM "t"`. This generalises what `seed.ts` does.
   7. `applyMigrations(tx, rest with folderMillis > upTo)`: data migrations run on the restored rows.
   8. Verify that the row count per table equals `end.tables`. On mismatch, throw, which rolls everything back.
   9. Insert into `activity_log`: `{ user_name: "Sistem", action: "Yedekten geri yüklendi", detail: "22.10.2026 09:15 yedeği · Okan · 4.312 satır" }`.
7. **Print the summary**, for example:

   ```
   ✓ Geri yükleme tamam. 41 tablo, 4.312 satır. Şema: 0019_siparis_bildirimi → 0021_gunluk_isler.
   ✓ Yönetici parolası ADMIN_PASSWORD ile ayarlandı (okan@…).
   ! Parolası olmayan kullanıcılar (Kullanıcılar & roller › Düzenle › Güvenlik › bağlantı gönderin): Ayşe, Mehmet
   ! Herkesin oturumu kapandı; yeniden giriş yapılacak.
   ! Paraşüt bağlantısı ilk eşitlemede yeniden kurulur; bildirim izinli cihazlar panel açılınca yeniden abone olur.
   ```

What happens to existing features after a restore (document these in YEDEK.md):

- Paraşüt's cursor goes back to the backup's date. The next sync re-imports bills made after the backup (`LOOKBACK_DAYS`), but their "ödendi" and "talep edildi" marks are not restored. Manual entries made after the backup are lost.
- The `notification_log` keys after the backup are gone, so a reminder may be e-mailed again once.
- Push devices re-subscribe on open. The VAPID key is regenerated (`getVapidKeys` already handles a missing row).
- The Paraşüt token is fetched again with the env credentials.
- `db:reset` (seed `--reset`) is unchanged and unrelated.

### Restore drill (prova), in `docs/YEDEK.md`

1. Ayarlar › Yedek › **Yedeği indir** (parola).
2. On the laptop:

   ```bash
   createdb laffogato_prova
   DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_prova npm run db:restore -- ~/Downloads/laffogato-yedek-….json.gz
   ```
3. Check that the printed row counts match the file (the script also checks this automatically).
4. Run `DATABASE_URL=…/laffogato_prova npm run dev` and log in with `.env.local`'s `ADMIN_EMAIL`/`ADMIN_PASSWORD`. Compare Genel bakış for a closed month, Faturalar' count, and Kasa raporu for a past day with the live panel.
5. `dropdb laffogato_prova`. Write the drill date in YEDEK.md's "Prova geçmişi" table. Do this every 3 months.

**Real restore order of preference:**

1. **Neon restore**, if the mistake is within the plan's window: Neon console › Branches › Restore. No file needed.
2. **The file**, with `--sil` into production, outside 07:00–09:30 TR and with the café closed:

   ```bash
   DATABASE_URL="<neon unpooled>" npm run db:restore -- <file> --sil --onay=<host>
   ```

   The script saves a safety copy first.

A second section, **Belgeler**, explains `npm run db:backup -- --belgeler` for uploaded documents over 25 MB.

---

## 3. Suggestion 4: silent failures in the daily jobs

### Goal

Every cron run leaves a row: started, finished, result per step. A pure function decides, for each job, whether the run that should have happened by now happened and succeeded. The owner is warned:

- **bell** (new group "Sistem");
- **dashboard** (a red banner above "Bu ayın işleri", only for serious problems);
- **e-mail**:
  - a "Sistem" section in the morning digest for yesterday's or this morning's problems;
  - a separate short alert from the Paraşüt job when yesterday's morning job failed. The two jobs watch each other, so one broken cron cannot hide itself.

Ayarlar gets a "Günlük işler" card showing what ran and when. `/api/health?isler=1` lets an optional external uptime monitor catch the case where both crons are dead.

### Data model (shared: `src/server/db/schema.ts`)

```ts
// ---------------------------------------------------------------- Günlük işler (Vercel Cron)
/**
 * Zamanlanmış işlerin her çalışması: başlarken "running", biterken sonucu yazılır. Satır yoksa iş çalışmamış,
 * "running"de kaldıysa yarıda kesilmiştir (işlev süresi doldu); zil, Genel bakış ve e-posta bunu söyler
 * (src/lib/job-health.ts). 90 günden eski satırlar iş başlarken silinir.
 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: serial("id").primaryKey(),
    job: text("job", { enum: ["parasut", "gunluk"] }).notNull(),
    status: text("status", { enum: ["running", "ok", "partial", "error", "skipped"] }).notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Adımların kısa sonucu, ör. { sync: "today", digest: "sent", menu: "error" } */
    steps: jsonb("steps").$type<Record<string, string>>(),
    /** Hata ya da atlanma nedeni (en çok 500 karakter) */
    message: text("message"),
  },
  (t) => [index("job_runs_job_started_idx").on(t.job, t.startedAt)],
);
```

Generate the migration with `npx drizzle-kit generate --name gunluk_isler`. Never hand-write it. The number depends on merge order with other groups: regenerate after merging main (§ 6).

Why a table and not `integration_state`: it keeps history for the card, double cron deliveries don't race, and it follows the `parasut_sync_runs` precedent.

New `integration_state` keys (no schema change):
- `jobs.watchSince`: ISO time when monitoring began. Used so a job that has never run since this deploy still counts as "late" after its first window.
- `backup.last` (§ 2).

### Pure logic: `src/lib/job-health.ts` (tests: `tests/gunluk-isler.test.ts`)

```ts
export type JobKey = "parasut" | "gunluk";
export const JOBS: Record<JobKey, { label: string; window: string; endMin: number; href: string }> = {
  parasut: { label: "Paraşüt eşitlemesi", window: "07:00–08:00", endMin: 8 * 60, href: "/panel/parasut" },
  gunluk:  { label: "Sabah işi",          window: "08:00–09:00", endMin: 9 * 60, href: "/panel/hatirlaticilar" },
};
export const GRACE_MIN = 30;            // Hobby'de saat penceresi esnek
export const STUCK_MS = 5 * 60_000;     // maxDuration 60 sn; "running" 5 dk'yı geçtiyse yarıda kesilmiş
export type RunStatus = "running" | "ok" | "partial" | "error" | "skipped";
export interface JobRunLite { id: number; job: JobKey; status: RunStatus; startedAt: string; finishedAt: string | null; steps: Record<string, string> | null; message: string | null }
export type JobState = "ok" | "skipped" | "running" | "waiting" | "late" | "stuck" | "failed" | "partial";

/** İstanbul saatiyle gün ve dakika (UTC+3, yaz saati yok; mevcut kodla aynı varsayım) */
export function trClock(now: Date): { day: string; minutes: number };
/** Şu ana kadar çalışmış olması gereken son günün tarihi: pencere sonu + grace geçtiyse bugün, değilse dün */
export function expectedDay(job: JobKey, now: Date, grace = GRACE_MIN): string;
export function jobHealth(job: JobKey, runs: JobRunLite[] /* yeni önce */, now: Date,
  opts: { watchSince: string | null; grace?: number }): { state: JobState; day: string; run: JobRunLite | null; lastOk: JobRunLite | null };
```

`jobHealth` rules:

- Take the latest run whose TR day is the expected day. A manual Vercel "Run" counts.
- If there is none:
  - `waiting` if `watchSince` is after that day's window end plus grace, so the first day after deploy raises no false alarm;
  - otherwise `late`.
- If there is one:
  - `running`: `stuck` when older than `STUCK_MS`, otherwise `running`;
  - `error` → `failed`; `partial` → `partial`; `skipped` → `skipped`; `ok` → `ok`.
- A later successful run the same day replaces an earlier failure.

The outcome classifiers are pure, so the routes stay thin:

```ts
export function dailyOutcome(r: { sync: "ok"|"error"|"today"|"off"; syncError?: string; digest: { status: "sent"|"skipped"|"error"; error?: string };
  reminders: "ok"|"error"; karaoke: string; menu: string; sales: string; errors: Record<string,string> }): { status: RunStatus; steps: Record<string,string>; message: string | null };
// digest error ya da istisna → "error"; başka bir adım "error" (sync dahil) → "partial"; aksi "ok"
export function parasutOutcome(r: { configured: boolean; result?: { ok: boolean; busy?: boolean; error?: string } }): { status: RunStatus; message: string | null };
// yapılandırılmamış → skipped "Paraşüt bağlı değil"; busy → skipped "Başka bir eşitleme sürüyordu"; !ok → error; ok → ok
export const STEP_LABELS: Record<string, Record<string, string>>;   // ekrandaki Türkçe karşılıklar (aşağıda)
```

Alert builder (pure, also tested):

```ts
export interface SystemAlert { id: string; level: "danger" | "warning" | "info"; title: string; body: string; href: string }
export function systemAlerts(i: { production: boolean; cronSecret: boolean; now: Date;
  health: Record<JobKey, ReturnType<typeof jobHealth>>; parasutSyncErrorAt: string | null; lastBackupAt: string | null }): SystemAlert[];
export function emailProblems(i: { now: Date; mode: "digest" | "watchdog"; health…; syncedToday: boolean }): { key: string; title: string; body: string }[];
```

`systemAlerts` returns `[]` when `!production`. Otherwise, in this order:

| Condition | id | level | Title | Body |
|---|---|---|---|---|
| `!cronSecret` | `is-cron-secret` | danger | `Günlük işler kapalı` | `Vercel'de CRON_SECRET tanımlı değil: Paraşüt eşitlemesi ve sabah e-postası çalışmıyor.` |
| gunluk `late` | `is-gunluk-late-<day>` | danger | `Sabah işi çalışmadı` | `<21 Ekim Salı> 08:00–09:00 arasında çalışması gerekiyordu. Sabah e-postası gitmedi; hatırlatıcı bildirimi ve laffogato.net eşitlemeleri yapılmadı.` |
| gunluk `failed` | `is-gunluk-failed-<runId>` | danger | `Sabah işi hata verdi` | message (≤ 200 chars) |
| gunluk `stuck` | `is-gunluk-stuck-<runId>` | danger | `Sabah işi yarıda kesildi` | `İşlev süresi doldu; sabah e-postası gitmemiş olabilir.` |
| gunluk `partial` | `is-gunluk-partial-<runId>` | warning | `Sabah işinde bir adım hata verdi` | `Menü eşitlemesi: <mesaj>` (first failing step) |
| parasut `late` | `is-parasut-late-<day>` | warning | `Paraşüt işi bu sabah çalışmadı` | `Sabah işi eşitlemeyi yeniden dener; Vercel › Cron Jobs'u kontrol edin.` |
| parasut `failed`/`stuck`, **and** no Paraşüt sync error already surfaced (`parasutSyncErrorAt` < run.startedAt or null) | `is-parasut-failed-<runId>` | danger | `Paraşüt işi hata verdi` | message |
| backup missing or ≥ 30 days | `yedek-<day or yok>` | info | see § 2 | see § 2 |

- All hrefs go to `/panel/ayarlar#isler`, except the backup alert (`#yedek`).
- The `parasut failed` dedupe avoids a second item next to the existing `fatura-eşitleme-<id>` ("Paraşüt eşitlemesi başarısız").
- `running` / `ok` / `skipped` / `waiting` produce no alert.

`emailProblems` returns items with keys `job:<job>:<day>:<state>`, used for dedupe in `notification_log`:

- **gunluk**, evaluated for *yesterday* (`expectedDay(…, now)` is yesterday while the gunluk job itself runs, and also at 07:xx when the watchdog runs). States `late`, `failed`, `stuck`, `partial`. Titles:
  - `Dünkü sabah işi çalışmadı (21 Ekim)`
  - `Dünkü sabah işi hata verdi`
  - `Dünkü sabah işi yarıda kesildi`
  - `Dünkü sabah işinde bir adım hata verdi`
- **parasut**, evaluated for *today* with `grace = 0`, digest mode only. The gunluk window starts when the Paraşüt window ends. States `late`, `stuck`. Body depends on `syncedToday`:
  - `Eşitlemeyi sabah işi yaptı.`
  - `Bugün eşitleme de yapılamadı.`

  Paraşüt `failed` is already in the digest as `syncError`, so it is not repeated.

### Server: `src/server/jobs/runs.ts` and `src/server/jobs/alerts.ts` (server-only)

`runs.ts`:

- `startJobRun(job)`:
  - mark this job's `running` rows older than `STUCK_MS` as `error` / `Yarıda kesildi (işlev süresi doldu)`, mirroring `openRun` in parasut/sync.ts;
  - delete rows older than 90 days;
  - insert `{job}`;
  - `INSERT … ON CONFLICT DO NOTHING` `jobs.watchSince`;
  - return the id.

  Best effort: on any error, `console.error` and return `null`. The job still runs.
- `finishJobRun(id, outcome)`: update `status`, `finishedAt`, `steps`, and `message` (cut to 500).
- `loadJobRuns(days = 8)`: the latest rows per job.
- `readWatchSince()`: when production and missing, upsert `now()` (one cheap write, wrapped in catch).

`alerts.ts`:

- `isProductionRuntime() = process.env.VERCEL_ENV === "production"`.
- `loadSystemAlerts(now = new Date())` reads runs, watchSince, the latest non-history `parasut_sync_runs` error, `CRON_SECRET` presence and `backup.last`, then calls `systemAlerts`. Used by the bell, the dashboard banner, `/api/health` and (for group 13) the "Bugün" view.
- `loadEmailProblems(mode, { syncedToday })` keeps only the items whose key is **not** in `notification_log`.
- `sendWatchdogAlert()`: used by the Paraşüt route. It sends only if:
  - `loadNotifySettings().emailEnabled`, and
  - `isEmailConfigured()`, and
  - there are active recipients, and
  - `loadEmailProblems("watchdog")` (gunluk yesterday) is non-empty.

  It renders with `renderSystemAlert(items, today)`. On success it inserts the keys into `notification_log` and calls `logActivity(null, "Sistem uyarısı e-postası", subject)`. The Resend idempotency key is `system-<today>-<sha of keys>`.

### Cron routes

**`src/app/api/cron/parasut/route.ts`**, after `rejectUnlessCron`:

```ts
const runId = await startJobRun("parasut");
await sendWatchdogAlert().catch((e) => console.error("[cron] sistem uyarısı", e));   // önce: eşitleme 45 sn'yi doldursa da gider
try { … existing logic … ; outcome = parasutOutcome(…) } catch (e) { outcome = { status: "error", message } ; throw-equivalent 500 }
finally { if (runId) await finishJobRun(runId, outcome) }
```

The response bodies and codes stay the same.

**`src/app/api/cron/gunluk/route.ts`**:

- Same wrapper: start, `try`, `finally` finish.
- Collect step results into `dailyOutcome`:
  - `sync`: `today` when skipped because `syncedToday()`, `off` when Paraşüt is not configured;
  - `digest` from `runReminderDigest`;
  - `extras` statuses, with error messages taken from their `{ error }` values.
- Pass `{ syncedToday: sync?.ok || alreadySynced }` to `runReminderDigest("cron", { syncedToday })`, so the digest's Sistem section can say whether the Paraşüt sync happened.
- The job order is unchanged: sync → digest → extras.
- Today's partial failures appear in the bell immediately and in tomorrow's e-mail.

`rejectUnlessCron` is unchanged. Unauthenticated calls never write rows. A 503 for a missing secret is caught by the `is-cron-secret` alert, which the panel computes from `process.env`.

### Morning digest (shared: `src/server/notify/digest.ts`, `digest-template.ts`)

- `runReminderDigest(trigger, ctx?: { syncedToday?: boolean })`: when ctx is missing (manual "Bugünküleri şimdi gönder"), compute `syncedToday` from `parasut_sync_runs`.
- Add `const system = isProductionRuntime() ? await loadEmailProblems("digest", …).catch(() => []) : []`. A non-empty `system` counts as news, the same way `invoiceNews` does, so an e-mail goes out.
- After a successful send, insert `system.map(p => ({ key: p.key, … }))` into `notification_log`. Add `sys:<keys>` to `keySeed`. Add `system: n` to the `"sent"` result.
- `renderDigest(rows, today, invoices?, prices?, system?: DigestSystem | null)` (5th positional argument; `DigestSystem = { items: { title: string; body: string }[] }`):
  - section heading `Sistem uyarıları`, at the **top** of the body, red tile style, link `${APP_URL}/panel/ayarlar#isler`;
  - subject: if only system news, `Sistem uyarısı: <first title>`; otherwise append ` · sistem uyarısı` to `extra`;
  - headline: when there are no payments, the first system title.
- `renderSystemAlert(items, today)` → `{ subject, html, text }`: a short e-mail using the same shell. Subject `L'Affogato · Sabah işi dün çalışmadı`, or the first title. Body: the items plus `Ne yapmalı: Vercel › lafmaliyet › Settings › Cron Jobs ekranında işi "Run" ile çalıştırın; sorun sürerse Vercel › Logs'a bakın. Paneldeki durum: Ayarlar › Günlük işler.`

### Bell (shared: `src/server/actions/notifications.ts`, `src/components/panel/notifications.tsx`)

- `PanelNotification.group` gains `"sistem"`.
- In `loadPanelNotifications` (admin branch), add `systemNotifications()`. It maps each `SystemAlert` to `{ id, kind: level, title, body, timeLabel: "" | dateTR(day), unread: true, href, group: "sistem" }`, wrapped in `.catch(() => [])`. Put system items **first** in the returned array.
- In `notifications.tsx` groups, add `{ id: "sistem", label: "Sistem", items: … }` as the **first** group. Icon: danger keeps `k.icon`; others use lucide `Activity`. Staff never see system items, because only the admin branch includes them.

### Dashboard banner (shared: `src/app/panel/page.tsx`, one line)

The new server component `src/app/panel/system-banner.tsx` renders `null` unless there are danger-level alerts:

```tsx
<div role="alert" className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad ring-1 ring-bad/20">
  <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
  <div className="min-w-0 flex-1">{items.slice(0, 2).map(i => <p key={i.id}><strong>{i.title}</strong> · {i.body}</p>)}
    {items.length > 2 ? <p>ve {items.length - 2} uyarı daha</p> : null}</div>
  <Link href="/panel/ayarlar#isler" className="font-medium underline underline-offset-2 max-sm:basis-full max-sm:pl-7">Ayrıntı</Link>
</div>
```

In `page.tsx`, add `<Suspense fallback={null}><SystemBanner /></Suspense>` as the first child of `<div className="space-y-4">`, above `<DashboardChecklist>`. It loads on its own and never blocks or breaks the dashboard (`.catch(() => [])` inside). The existing "Faturalar" task, which warns on a Paraşüt sync error, is unchanged.

### Ayarlar › Günlük işler (new card; shared: `sections.ts`, `page.tsx`)

`sections.ts`: add `{ id: "isler", label: "Günlük işler", icon: Timer }` after `gecmis` and before `site`.

New server component `src/app/panel/ayarlar/jobs-card.tsx`, rendered in `SettingsContent` before `<SiteLinksCard />`:

- `SectionCard id="isler"`, icon `Timer`, title **Günlük işler**.
- `summary` (phone):
  - `Bu sabah ikisi de çalıştı`
  - `Sabah işi çalışmadı`
  - `Paraşüt işi hata verdi`
  - `CRON_SECRET eksik`
  - `Yalnız canlıda çalışır`
- `description`: `Her sabah iki iş kendiliğinden çalışır: 07:00–08:00 Paraşüt eşitlemesi, 08:00–09:00 sabah işi (sabah e-postası, hatırlatıcı bildirimi, laffogato.net eşitlemeleri). Çalışmazsa ya da hata verirse zil, Genel bakış ve e-posta haber verir.`
- If `!CRON_SECRET`, a red well: `CRON_SECRET tanımlı değil: Vercel bu işleri çalıştıramıyor. Vercel › Settings › Environment Variables'a ekleyip yeniden yayınlayın (docs/DEPLOY.md § 4).`
- If not production, a grey note: `Günlük işler yalnız canlı sitede (Vercel Cron) çalışır; burada uyarı verilmez.` The runs list still shows if rows exist.
- List, one row per job, styled like `SiteLinksCard`:
  - **Line 1:** job label plus a badge:

    | State | Badge |
    |---|---|
    | ok | green `Çalıştı` |
    | skipped | grey `Atlandı` |
    | running | amber `Sürüyor` |
    | waiting | grey `Bekleniyor` |
    | late | red `Çalışmadı` |
    | failed | red `Hata` |
    | stuck | red `Yarıda kesildi` |
    | partial | amber `Kısmen` |
  - **Line 2:** `Her sabah 07:00–08:00 · son çalışma bugün 07:31 (12 sn)`, or `· henüz çalışmadı`.
  - **Line 3 (gunluk):** step words from `STEP_LABELS`, joined with ` · `, for example `E-posta gönderildi · Paraşüt bugün eşitlenmişti · Karaoke tamam · Menü hata · Online satış tamam · Hatırlatıcı bildirimi gitti`. Full map:

    | Step | Codes → text |
    |---|---|
    | sync | ok `Paraşüt eşitlendi` · today `Paraşüt bugün eşitlenmişti` · off `Paraşüt bağlı değil` · error `Paraşüt hata` |
    | digest | sent `E-posta gönderildi` · skipped `E-posta: yeni bir şey yok` · error `E-posta gönderilemedi` |
    | reminders | ok `Hatırlatıcı bildirimi gitti` · error `Hatırlatıcı bildirimi hata` |
    | karaoke / menu / sales | ok/fresh `… tamam` · off `… kurulmadı` · error `… hata` (prefix `Karaoke`, `Menü`, `Online satış`) |
  - **Error message:** shown in `rounded-lg bg-bad-soft px-2.5 py-1.5 text-[13px] text-bad`.
  - **Last 7 days:** `Son 7 gün` followed by 7 dots (green ok/skipped, red late/failed/stuck, amber partial, grey waiting or no expectation), each with `title` and `aria-label` `21 Eki: çalıştı`.
- Footer text with links: `Elle çalıştırmak için: Vercel › lafmaliyet › Settings › Cron Jobs › Run. Paraşüt'ü Paraşüt entegrasyonu › Şimdi eşitle, sabah e-postasını Ödemeler › Bugünküleri şimdi gönder ile de yapabilirsiniz.` (internal links to `/panel/parasut` and `/panel/hatirlaticilar`).

### Health endpoint for an external monitor (optional for the owner; small in code)

`src/app/api/health/route.ts`: when `?isler=1`, also call `loadSystemAlerts()` and return:

```
{ ok, db, ms, isler: { cronSecret: boolean, gunluk: JobState, parasut: JobState } }
```

The status is 503 if any danger alert is present (backup alerts don't count). No messages are exposed. Without `?isler=1` the endpoint behaves exactly as today.

---

## 4. Files

### Add

| File | What |
|---|---|
| `scripts/db-policy.ts` | `dbPrepareDecision(env)`, `readJournal()`, `migrationGaps()`: pure, no side effects on import |
| `scripts/backup.ts` | `npm run db:backup` |
| `scripts/restore.ts` | `npm run db:restore` (argument parsing, prompts, printing; logic in core) |
| `src/lib/backup/format.ts` | format constants, `TABLE_RULES`, line helpers, `backupSchemaPlan`, `orderTables`, `mergeUserRows`, `PANEL_DOCUMENTS_MAX_BYTES`, `backupFileName(now)` |
| `src/server/backup/core.ts` | `backupLines()`, `readBackupFile()`, `restoreBackup()`, `applyMigrations()` (no server-only) |
| `src/server/backup/state.ts` | handle seal/open, `backup.last`, `loadBackupInfo()` (server-only) |
| `src/server/actions/backup.ts` | `prepareBackupDownload` |
| `src/app/api/yedek/route.ts` | streaming download |
| `src/app/panel/ayarlar/backup-client.tsx` | "Yedeği indir" button and dialog |
| `src/app/panel/ayarlar/jobs-card.tsx` | Günlük işler card |
| `src/lib/job-health.ts` | job windows, `jobHealth`, outcomes, `systemAlerts`, `emailProblems`, `STEP_LABELS` |
| `src/server/jobs/runs.ts` | `startJobRun` / `finishJobRun` / `loadJobRuns` / `readWatchSince` |
| `src/server/jobs/alerts.ts` | `loadSystemAlerts`, `loadEmailProblems`, `sendWatchdogAlert`, `isProductionRuntime` |
| `src/app/panel/system-banner.tsx` | dashboard banner |
| `drizzle/00NN_gunluk_isler.sql` + `meta/00NN_snapshot.json` + journal | generated by drizzle-kit |
| `docs/YEDEK.md` | format, contents, download, drill, real restore, documents, security |
| `tests/deploy-policy.test.ts`, `tests/migrations.test.ts`, `tests/yedek.test.ts`, `tests/yedek-geri-yukleme.test.ts`, `tests/gunluk-isler.test.ts` | § 5 |

### Change

| File | Change | Shared? |
|---|---|---|
| `scripts/predeploy.ts` | use `dbPrepareDecision`; log lines | – |
| `scripts/migrate.ts` | `verifyMigrations()` after `migrate()` | – |
| `src/server/db/schema.ts` | `jobRuns` table | **shared** |
| `src/app/api/cron/parasut/route.ts` | job run wrapper and watchdog | – |
| `src/app/api/cron/gunluk/route.ts` | job run wrapper, step outcome, `syncedToday` to digest | – |
| `src/server/notify/digest.ts` | system problems section and log keys | **shared** (groups 7/8/9 may add sections) |
| `src/server/notify/digest-template.ts` | `renderDigest` 5th argument, `renderSystemAlert` | **shared** |
| `src/server/actions/notifications.ts` | `"sistem"` group and `systemNotifications()` | **shared** |
| `src/components/panel/notifications.tsx` | "Sistem" group label and icon | **shared** |
| `src/app/panel/page.tsx` | one `<Suspense><SystemBanner/></Suspense>` line plus import | **shared** (groups 8/9/13) |
| `src/app/panel/ayarlar/page.tsx` | `BackupCard` rewrite, `JobsCard` | **shared** (group 1 might touch the users card) |
| `src/app/panel/ayarlar/sections.ts` | `isler` section | shared |
| `src/server/secret-box.ts` | `SealPurpose` += `"backup"` | shared (group 1 may add a purpose) |
| `src/app/panel/hesap/confirm-password.tsx` | optional `children` | **shared with group 1** (they may move it) |
| `src/server/actions/auth.ts` → `src/server/auth/reauth.ts` | re-auth helper (if group 1 hasn't done it) | **shared with group 1** |
| `src/app/api/health/route.ts` | `?isler=1` | – |
| `package.json` | `db:backup`, `db:restore` | shared |
| `.gitignore` | `laffogato-yedek-*.json.gz` | – |
| `README.md` | commands, screens (Ayarlar), API list (`/api/yedek`, `/api/health?isler=1`), folders (`server/backup`, `server/jobs`) | **shared** |
| `docs/DEPLOY.md` | §§ 2, 4, 5, 7 | shared |
| `docs/BILDIRIMLER.md` | new section "Sistem uyarıları (günlük işler)" | shared |
| `src/app/panel/yardim/page.tsx` | (optional) FAQ "Yedek nasıl alınır, nasıl geri yüklenir?" pointing to Ayarlar › Yedek | shared |

Not touched: `vercel.json` (no new cron; Hobby allows a limited number), `src/proxy.ts` (the route checks auth itself), `scripts/seed.ts` (`--reset` doesn't truncate `job_runs`, which is intended: job history survives a data reset), `/api/export` (it stays).

---

## 5. Tests (`npx tsx --test tests/*.test.ts`)

1. **`tests/deploy-policy.test.ts`**: `dbPrepareDecision` for:
   - local with no `VERCEL` → run;
   - `SKIP_DB_PREPARE=1` → skip;
   - no DB URL → skip;
   - `VERCEL=1` with production → run;
   - preview → skip, and the message contains the branch;
   - development → skip;
   - `VERCEL=1` with an empty or unknown `VERCEL_ENV` → skip;
   - `POSTGRES_URL`-only counts as a DB.
2. **`tests/migrations.test.ts`**:
   - the real `drizzle/meta/_journal.json`: `idx` runs 0..n-1, `when` strictly increases by `idx`, each tag has `drizzle/<tag>.sql`;
   - `migrationGaps` on synthetic data: complete; one missing in the middle (the out-of-order case); an orphan; an empty DB.
3. **`tests/yedek.test.ts`** (pure):
   - header, table and row lines encode and parse; the sha256 check fails when the last row is dropped or one byte is changed;
   - `TABLE_RULES` × the drizzle schema (iterate `src/server/db/schema.ts` exports with `getTableConfig` from `drizzle-orm/pg-core`): every column whose name matches `/secret|token|password|recovery|p256dh|^auth$/` is in a `skip` table or in `dropColumns`. This guard catches new secret columns from other groups.
   - `orderTables` on the FK edges derived from the drizzle schema: every table comes after its parents, and every schema table is present;
   - `backupSchemaPlan`: same version; older (staged); newer → error; orphan → warning;
   - `mergeUserRows`: a matched e-mail (case-insensitive) keeps its credentials with `sv + 1`; unmatched → `'!davet-bekliyor'`, totp off, `sv = maxSv + 1`; `ADMIN_EMAIL` overrides, and creates the admin when missing;
   - `backupFileName` uses TR time.
4. **`tests/yedek-geri-yukleme.test.ts`**: the restore drill as code. It is **skipped unless** `YEDEK_TEST_DATABASE_URL` is set, for example `postgres://postgres:postgres@localhost/postgres`.
   1. Create databases `laf_yedek_a_<pid>` and `_b_<pid>`.
   2. In A: `runMigrations` and `runSeed`, then add the rows that exercise edge cases:
      - an upload `invoice_documents` with bytes `\x00ff…`;
      - a `settings` row whose jsonb value is JSON `null`;
      - a `users` row with a password and totp;
      - an `integration_state` `parasut.token`;
      - a `user_tokens` row.
   3. Export A into a buffer with `backupLines` (documents true), gzip it, and restore into empty B.
   4. Assert:
      - per table, `md5(string_agg(row_to_json(t)::text, '' ORDER BY <pk>))` is equal for every column except the left-out ones;
      - `user_tokens`, `push_subscriptions` and `parasut.token` are absent in B;
      - B's user has `'!davet-bekliyor'` (no `ADMIN_*` in this test) or the admin hash when `ADMIN_*` is passed;
      - inserting a new `invoices` row in B gets `id > max`;
      - a truncated file is rejected;
      - restoring into non-empty B without `--sil` is refused;
      - `--sil` into B is atomic: inject a failure (an `end` count off by one) and assert B is unchanged;
      - a **staged** restore works: build A at an older version with `applyMigrations(…, ≤ 0018)`, export, restore, then check that B ends at the latest migration.
   5. Drop both databases in `after()`.

   The implementer **must run this locally before merging**. Document it in YEDEK.md as "Otomatik prova".
5. **`tests/gunluk-isler.test.ts`**:
   - `trClock` and `expectedDay` at the boundaries (07:59, 08:29, 08:30, 09:29, 09:30 TR; 23:59 UTC vs TR day);
   - `jobHealth`: ok, late, waiting (`watchSince` after the window), stuck (running for 6 minutes), running (2 minutes), failed, partial, a later success replacing an earlier failure, a manual run at 23:00 counting for that day;
   - `dailyOutcome` / `parasutOutcome` mapping;
   - `systemAlerts`:
     - empty when not production;
     - the `cron-secret` alert;
     - the dedupe of parasut failed against `parasutSyncErrorAt`;
     - backup at 29, 30 and "never";
     - ordering;
   - `emailProblems` keys: digest vs watchdog, parasut with grace 0 at 08:05, gunluk yesterday at 07:30.
6. **`tests/hatirlaticilar-digest.test.ts`** (extend):
   - `renderDigest(…, system)` shows `Sistem uyarıları` first; the subject is `Sistem uyarısı: …` when it is the only news, and gets ` · sistem uyarısı` otherwise; the text version contains the items;
   - `renderSystemAlert` subject and text.

Manual checks before merge:

- `npm run lint`, `npx tsc --noEmit`, `npm test`.
- `YEDEK_TEST_DATABASE_URL=… npm test`.
- `npm run dev` with `VERCEL_ENV=production` (only to see the alerts locally): look at the bell, the banner, the Ayarlar cards at 390 px and at desktop width.
- Download a backup and restore it into a local DB (the drill).
- `curl` both cron routes with `CRON_SECRET` locally and check the `job_runs` rows.
- After deploy:
  - one preview build shows the skip line;
  - the production build shows `✓ Veritabanı şeması güncel (N migration)`;
  - a production download works;
  - a download over 4.5 MB with documents works, or the cap is lowered (§ 2).

---

## 6. Owner decisions (with recommended defaults; none blocks implementation)

1. **Should password hashes and 2FA secrets go into the backup file?** Default: **no**. On restore, users with the same e-mail keep their current password; others get a new link; the admin is set from `ADMIN_PASSWORD`.
2. **Should the backup file be encrypted with a passphrase?** Default: **no**. The UI and docs warn the file holds revenue, salaries and IBANs. A lost passphrase would mean a lost backup.
3. **Backup reminder interval?** Default: **30 days** (bell info plus the card badge).
4. **Uploaded invoice documents in the panel download?** Default: **opt-in checkbox, up to 25 MB**. Above that, CLI `npm run db:backup -- --belgeler`. Lower to 4 MB if Vercel cuts streamed responses.
5. **Automatic weekly backup e-mailed as an attachment?** Default: **no** for now. It would put all data in every notification recipient's inbox. It can be added later as a single-recipient weekly step in `gunluk`.
6. **Keep the Neon env vars on Preview?** Default: **keep**. The code guard stops migrations, and previews can't log in anyway. Optional hardening: untick Preview in Vercel › Storage › Neon, so previews get no DB.
7. **External uptime monitor on `https://ladmin.laffogato.net/api/health?isler=1`** (for example a free UptimeRobot e-mail alert)? Default: **recommended, optional**. It is the only alarm if *both* crons stop. Steps go in BILDIRIMLER.md.
8. **A "Şimdi çalıştır" button for the daily job in the panel?** Default: **no**. Use Vercel › Cron Jobs › Run, plus the existing "Şimdi eşitle" and "Bugünküleri şimdi gönder".
9. **Who gets the watchdog e-mail?** Default: **the same active notification recipients as the morning e-mail**.

---

## 7. Risks and integration notes

- **First production build after this change.** If production's `drizzle.__drizzle_migrations` has a gap from the 21 Oct incident, the new verification fails the build. Do the one-time read-only check in § 1 before merging.
- **Parallel groups and migrations.** Every group that adds a migration must regenerate it after merging main, so journal `when` order matches merge order. `tests/migrations.test.ts` and the build verification make a mistake visible instead of silent. Merge this group's `0NNN_gunluk_isler` like any other.
- **Vercel streaming limit** is unverified for responses over 4.5 MB. The data-only backup is far below it. For documents, there is a cap plus a fallback (§ 2).
- **Restore in place** (`--sil`) drops and recreates tables in one transaction. Locks block the app while it runs (seconds for this data size). Run it outside 07:00–09:30 TR. Neon PITR remains the undo.
- **Restoring an older backup** loses everything made after it, except Paraşüt bills, which re-import without their paid marks. A reminder e-mail may repeat once. All of this is documented.
- **`json_populate_recordset`:** jsonb JSON-`null` vs SQL NULL is handled for NOT NULL jsonb columns. Any jsonb column that is nullable *and* stores JSON `null` comes back as SQL NULL. No such column exists today; the integration test covers `settings`.
- **False alarms:**
  - Hobby cron drift is covered by a 30-minute grace.
  - The first day after deploy is covered by `watchSince`.
  - Local and preview get no alarms (`VERCEL_ENV`).
  - If `startJobRun` can't write (DB down), the panel shows "late" the next time it loads. That is acceptable and honest.
- **Double cron delivery** makes two rows; the latest wins.
- **Group 1 dependency:** the backup uses the shared re-auth helper and `ConfirmPasswordDialog`. If group 1 renames or moves them, adapt the imports. The behaviour (5 failures per 15 minutes, activity log) must stay identical.
- **Group 13 ("Bugün")** can show `loadSystemAlerts()` items. **Groups 7/8/9** editing the digest should add their sections after "Sistem uyarıları" and keep the 5th-argument order, or switch to an options object together.

Order of work:

1. § 1 (policy, verification, tests).
2. § 3: schema and migration, pure logic and tests, routes, bell, banner, card, digest, health.
3. § 2: format and tests, core, integration test, action and route, UI, CLI.
4. Docs.
