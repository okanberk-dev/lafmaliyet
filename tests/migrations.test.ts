// Migration günlüğü ve doğrulaması (scripts/migration-check.ts): drizzle, veritabanındaki en yeni kayıttan eski
// tarihli migration'ı hata vermeden atlar. Günlüğün zamanları sırayla artmalı (dallar birleşme sırasıyla üretilir,
// docs/DEPLOY.md § 7); canlı derleme atlanan migration'da durur, günlükte olmayan kayıtta yalnız uyarır.
// Çalıştırma: npx tsx --test tests/migrations.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ESKI_SUTUNLAR, ESKI_TABLOLAR, TEL_KAYNAK } from "../src/lib/asilpos/eski-adlar";

import { duration, lockWaitMessage, MIGRATION_LIMITS, MIGRATION_LOCK, poolerRefusal, tableLockMessage } from "../scripts/migrate";
import { migrationGaps, migrationReport, readJournal, type JournalEntry } from "../scripts/migration-check";

test("günlük: sıra numaraları 0..n-1, zamanlar kesin artan, her girdinin SQL dosyası var", () => {
  const journal = readJournal();
  assert.ok(journal.length >= 20);
  journal.forEach((e, i) => {
    assert.equal(e.idx, i, `${e.tag}: sıra numarası`);
    assert.match(e.tag, new RegExp(`^${String(i).padStart(4, "0")}_`), `${e.tag}: dosya adı sırayla`);
    assert.ok(existsSync(join(process.cwd(), "drizzle", `${e.tag}.sql`)), `${e.tag}.sql yok`);
    if (i > 0) {
      const prev = journal[i - 1];
      assert.ok(e.when > prev.when, `${e.tag} (${e.when}) ${prev.tag} (${prev.when}) migration'ından önce üretilmiş: main'le birleştirip yeniden üretin`);
    }
  });
});

test("günlük: her migration'ın şema anlık görüntüsü var", () => {
  for (const e of readJournal()) {
    const snap = join(process.cwd(), "drizzle", "meta", `${e.tag.slice(0, 4)}_snapshot.json`);
    assert.ok(existsSync(snap), `${e.tag}: anlık görüntü yok`);
    assert.doesNotThrow(() => JSON.parse(readFileSync(snap, "utf8")));
  }
});

const J: JournalEntry[] = [
  { idx: 0, when: 1000, tag: "0000_init" },
  { idx: 1, when: 2000, tag: "0001_a" },
  { idx: 2, when: 3000, tag: "0002_b" },
];

test("doğrulama: hepsi uygulanmış", () => {
  assert.deepEqual(migrationGaps(J, [1000, 2000, 3000]), { missing: [], orphans: [] });
  const r = migrationReport(J, [1000, 2000, 3000]);
  assert.equal(r.error, null);
  assert.equal(r.warning, null);
  assert.equal(r.ok, "✓ Veritabanı şeması güncel (3 migration)");
});

test("doğrulama: sıra bozulup atlanan migration derlemeyi durdurur", () => {
  // 0002 önce uygulandı (daha yeni tarihli), 0001 drizzle tarafından atlandı
  assert.deepEqual(migrationGaps(J, [1000, 3000]).missing.map((e) => e.tag), ["0001_a"]);
  const r = migrationReport(J, [1000, 3000]);
  assert.match(r.error ?? "", /^Migration uygulanmadı: 0001_a\. /);
  assert.match(r.error ?? "", /npm run db:generate/);
  assert.match(r.error ?? "", /docs\/DEPLOY\.md § 7/);
});

test("doğrulama: günlükte olmayan kayıt (önizlemenin uyguladığı) yalnız uyarır", () => {
  // 21 Eki 2026: bir önizleme menü migration'ının erken sürümünü canlıya uyguladı; 0018 olarak yeniden uygulandı
  const orphan = Date.UTC(2026, 9, 21, 11, 2);
  assert.deepEqual(migrationGaps(J, [1000, orphan, 2000, 3000]).orphans, [orphan]);
  const r = migrationReport(J, [1000, 2000, orphan, 3000]);
  assert.equal(r.error, null);
  assert.match(r.warning ?? "", /^! Veritabanında depoda olmayan 1 migration kaydı var \(created_at \d+ = 2026-10-21 11:02 UTC\)/);
});

test("doğrulama: boş veritabanında hepsi eksik", () => {
  const { missing, orphans } = migrationGaps(J, []);
  assert.equal(missing.length, 3);
  assert.deepEqual(orphans, []);
  assert.match(migrationReport(J, []).error ?? "", /0000_init, 0001_a, 0002_b/);
});

test("derleme migration'dan sonra, kilidi bırakmadan doğrular", () => {
  const src = readFileSync(join(process.cwd(), "scripts/migrate.ts"), "utf8");
  // Kilit alınır, lock_timeout konur, migration uygulanır ve hemen doğrulanır; kilit ancak sonra bırakılır
  assert.match(
    src,
    /await takeMigrationLock\(db, limits\.waitForOtherMs\);\s*await db\.execute\(sql\.raw\(`set lock_timeout = [^`]+`\)\);\s*const applied = await applyMigrations\(db, limits, folder\);\s*await verifyMigrations\(db, folder\);\s*const \[lock\] = await db\.execute<\{ released: boolean \}>\(sql`select pg_advisory_unlock/,
  );
  assert.match(src, /await migrate\(db, \{ migrationsFolder: folder \}\);/);
  assert.match(src, /const \{ folder = "drizzle", \.\.\.given \} = options;/);
  assert.match(src, /if \(report\.error\) throw new Error\(report\.error\)/);
});

test("migration kilidi: tek bağlantı, yeniden denemesiz; anahtar uygulamanın int4 kilitlerine denk gelemez", () => {
  const src = readFileSync(join(process.cwd(), "scripts/migrate.ts"), "utf8");
  const fn = src.slice(src.indexOf("function migrationDb("), src.indexOf("export function poolerRefusal("));
  // Oturum kilidi ancak kilit, drizzle'ın okuması ve işlemi aynı sunucu oturumundaysa korur
  assert.match(fn, /max: 1,/);
  assert.match(fn, /idle_timeout: 0,/);
  assert.match(fn, /max_lifetime: 0,/);
  assert.match(fn, /connection: \{ application_name: MIGRATION_APP \}/);
  assert.doesNotMatch(fn, /createDb|withConnectionRetry/, "createDb'nin yeniden denemesi kopan sorguyu kilitsiz yeni bağlantıda gönderirdi");
  assert.ok(MIGRATION_LOCK > 2 ** 31 - 1 && Number.isSafeInteger(MIGRATION_LOCK), "hashtext(...) int4'tür: anahtar onun aralığının dışında olmalı");
  for (const n of [7_340_211, 7_340_212, 7_340_213]) assert.notEqual(MIGRATION_LOCK, n);
  // Vercel'in derleme sınırı (45 dk) içinde kalır: öteki migration'ı bekleme + bütün denemeler
  const { waitForOtherMs, lockTimeoutMs, attempts, retryPauseMs } = MIGRATION_LIMITS;
  assert.ok(waitForOtherMs + attempts * lockTimeoutMs * 2 + (attempts - 1) * retryPauseMs < 20 * 60_000);
});

test("migration havuzlu adrese (Neon -pooler) gitmez; havuzsuz ve yerel adres geçer", () => {
  const pooled = "postgres://u:p@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require";
  assert.match(poolerRefusal(pooled) ?? "", /^Migration havuzlu adrese gidiyor \(ep-cool-name-123456-pooler\.eu-central-1\.aws\.neon\.tech\): .*DATABASE_URL_UNPOOLED/);
  assert.doesNotMatch(poolerRefusal(pooled) ?? "", /u:p|parola/);
  assert.equal(poolerRefusal("postgres://u:p@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require"), null);
  assert.equal(poolerRefusal("postgres://postgres:postgres@localhost:5432/laffogato_test"), null);
});

test("DEPLOY.md § 7: aynı anda iki derleme ve tablo kilidi beklemesi; satırlar ve sınırlar koddakiyle aynı", () => {
  const doc = readFileSync(join(process.cwd(), "docs/DEPLOY.md"), "utf8").replace(/\s*\n\s*/g, " ");
  const s7 = doc.slice(doc.indexOf("## 7. Güncelleme ve yedek"), doc.indexOf("## 8."));
  const src = readFileSync(join(process.cwd(), "scripts/migrate.ts"), "utf8");
  const { waitForOtherMs, lockTimeoutMs, attempts, retryPauseMs } = MIGRATION_LIMITS;
  assert.ok(s7.includes(`\`… Başka bir migration sürüyor (pid …); bitmesi bekleniyor, en çok ${duration(waitForOtherMs)}\``));
  assert.ok(src.includes("`… Başka bir migration sürüyor (${holder}); bitmesi bekleniyor, en çok ${duration(waitMs)}`"));
  assert.ok(s7.includes("**kilidi aldıktan sonra** okur ve `✓ Veritabanı şeması güncel` der"));
  assert.ok(s7.includes(`migration ${duration(waitForOtherMs).replace(" dk", " dakikada")} bitmezse derleme \`Migration kilidi … içinde alınamadı\``));
  assert.match(lockWaitMessage(waitForOtherMs, "x"), /^Migration kilidi 10 dk içinde alınamadı: /);
  assert.ok(s7.includes(`her tablo kilidi en çok ${duration(lockTimeoutMs)} beklenir (\`lock_timeout\`)`));
  assert.ok(s7.includes(`${duration(retryPauseMs)} sonra yeniden denenir (en çok ${attempts} deneme; \`MIGRATION_LIMITS\`)`));
  assert.ok(s7.includes(`\`Migration ${attempts} denemede de tablo kilidini alamadı …\``));
  assert.ok(s7.includes("havuzlu (Neon `-pooler`, PgBouncer) adreste derleme şemaya dokunmadan durur"));
  // § 5'teki örnek günlük de uygulanan migration satırını gösterir
  const s5 = doc.slice(doc.indexOf("## 5."), doc.indexOf("## 6."));
  assert.match(s5, /✓ 21 migration uygulandı \([\d,]+ sn\) ✓ Veritabanı şeması güncel \(21 migration\)/);
  assert.ok(src.includes("console.log(`✓ ${applied} migration uygulandı (${duration(Date.now() - started)})`)"));
});

test("migration günlüğü: süreler ve iletiler", () => {
  assert.equal(duration(0), "0 sn");
  assert.equal(duration(200), "0,2 sn");
  assert.equal(duration(15_000), "15 sn");
  assert.equal(duration(10 * 60_000), "10 dk");
  assert.equal(duration(18 * 60_000 + 24_000), "18 dk 24 sn");
  assert.match(lockWaitMessage(600_000, "pid 42 · laffogato-migrate · 3 dk önce bağlandı"), /^Migration kilidi 10 dk içinde alınamadı: başka bir migration hâlâ sürüyor \(pid 42 · laffogato-migrate · /);
  const msg = tableLockMessage(MIGRATION_LIMITS, 'ALTER TABLE "invoices" ADD COLUMN "company_wide" boolean DEFAULT false NOT NULL;', [
    { pid: 7, state: "idle in transaction", app: "?", ms: 1_080_000, tables: "invoices, suppliers", query: "select 1" },
  ]);
  assert.match(msg, /^Migration 4 denemede de tablo kilidini alamadı \(her bekleyiş en çok 15 sn; takılan: ALTER TABLE "invoices"/);
  assert.match(msg, /Şemaya dokunulmadı \(işlem geri alındı\), yayındaki sürüm değişmedi\./);
  assert.match(msg, /\n {2}pid 7 · idle in transaction · açık: 18 dk · \? · tablolar: invoices, suppliers · son sorgu: select 1$/);
});

test("dalga 10 (personel yetkileri): tek migration; ortak onay kuyruğu, kasaya işle işaretleri ve eklenen sütunlar", () => {
  const entry = readJournal().find((e) => e.tag.endsWith("_personel_yetki"));
  assert.ok(entry, "personel_yetki migration'ı yok");
  const sql = readFileSync(join(process.cwd(), "drizzle", `${entry.tag}.sql`), "utf8");
  for (const re of [
    /CREATE TABLE "staff_requests"/,
    /CREATE TABLE "pos_marks"/,
    /"photo_ids" integer\[\] DEFAULT '\{\}'::integer\[\] NOT NULL/,
    /ALTER TABLE "recipe_change_requests" ADD COLUMN "version" integer DEFAULT 1 NOT NULL/,
    /ALTER TABLE "checklist_templates" ADD COLUMN "staff_since" timestamp with time zone/,
    /ALTER TABLE "push_subscriptions" ADD COLUMN "approvals" boolean DEFAULT true NOT NULL/,
    /ALTER TABLE "special_days" ADD COLUMN "by_staff" boolean DEFAULT false NOT NULL/,
    /ALTER TABLE "special_days" ADD COLUMN "updated_by" integer/,
    /ALTER TABLE "special_days" ADD COLUMN "updated_by_name" text/,
    /CREATE UNIQUE INDEX "staff_requests_pending_uq" ON "staff_requests" USING btree \("kind","subject","requested_by"\) WHERE status = 'pending'/,
    /CREATE UNIQUE INDEX "staff_requests_live_draft_uq" ON "staff_requests" USING btree \("subject"\) WHERE kind = 'mal-taslak' and status in \('pending', 'approved'\)/,
    /CREATE UNIQUE INDEX "staff_requests_client_key_uq"/,
  ]) {
    assert.match(sql, re);
  }
  // Elle yazılmış SQL yok: yalnız drizzle-kit'in ürettiği ifadeler
  assert.doesNotMatch(sql, /(^|--> statement-breakpoint\n?)\s*(UPDATE|INSERT INTO|DELETE FROM) /m);
});

test("AsilPOS bağlantısı: tek migration; günlük satış ve gün sonu özeti tabloları, yalnız ekleme (geri dönüşe uygun)", () => {
  const entry = readJournal().find((e) => e.tag.endsWith(`_${TEL_KAYNAK}_baglantisi`));
  assert.ok(entry, "AsilPOS bağlantısının migration'ı yok");
  // 26 Eki 2026'da canlı veritabanına uygulandı: günlükteki zamanı ve içeriği bir daha değişmez. Yeniden üretilince
  // drizzle onu yeni migration sayıp tabloları yeniden kurmaya çalıştı, canlı derleme durdu; değişiklik yeni migration'la
  assert.equal(entry.when, 1792997178951, `${entry.tag} canlıda uygulandı; yeniden üretmeyin, yeni migration ekleyin`);
  const sql = readFileSync(join(process.cwd(), "drizzle", `${entry.tag}.sql`), "utf8");
  for (const re of [
    /CREATE TABLE "pos_daily_sales"/,
    /"product_id" integer,/,
    /"is_service" boolean DEFAULT false NOT NULL/,
    /CREATE TABLE "pos_day_reports" \(\s*"date" text PRIMARY KEY NOT NULL,\s*"z" jsonb NOT NULL,\s*"payments" jsonb NOT NULL,\s*"ikram" jsonb NOT NULL,\s*"source" text NOT NULL,\s*"received_at" timestamp with time zone DEFAULT now\(\) NOT NULL\s*\);/,
    /FOREIGN KEY \("product_id"\) REFERENCES "public"\."products"\("id"\) ON DELETE set null/,
    /CREATE UNIQUE INDEX "pos_daily_sales_date_pos_name_uq" ON "pos_daily_sales" USING btree \("date","pos_name"\)/,
  ]) {
    assert.match(sql, re);
  }
  // Var olan tabloya dokunmaz; elle yazılmış SQL yok
  assert.doesNotMatch(sql, /ALTER TABLE "(?!pos_daily_sales")|DROP |(^|--> statement-breakpoint\n?)\s*(UPDATE|INSERT INTO|DELETE FROM) /m);
});

test("kasaya giren: tek ifade, kasa raporuna varsayılanlı NOT NULL sütun (eski kod yazarken 0, Instant Rollback'e uygun)", () => {
  const entry = readJournal().find((e) => e.tag.endsWith("_kasaya_giren"));
  assert.ok(entry, "kasaya_giren migration'ı yok");
  const sql = readFileSync(join(process.cwd(), "drizzle", `${entry.tag}.sql`), "utf8").trim();
  assert.equal(sql, 'ALTER TABLE "cash_reports" ADD COLUMN "cash_in" double precision DEFAULT 0 NOT NULL;');
});

test("karaokenin iade tutarı (29 Ekim 2026): tek boş olabilen sütun, yalnız ekleme (eski kod yazmazken boş; Instant Rollback'e uygun)", () => {
  const entry = readJournal().find((e) => e.tag.endsWith("_karaoke_iade_tutari"));
  assert.ok(entry, "karaoke_iade_tutari migration'ı yok");
  const sql = readFileSync(join(process.cwd(), "drizzle", `${entry.tag}.sql`), "utf8").trim();
  assert.equal(sql, 'ALTER TABLE "karaoke_sessions" ADD COLUMN "refund_minor" integer;');
});

test("AsilPOS satırının site kalemi ve hizmet işareti (denetim B08, E-33): iki boş olabilen, bir varsayılanlı sütun, yalnız ekleme (Instant Rollback'e uygun)", () => {
  const entry = readJournal().find((e) => e.tag.endsWith(`_${TEL_KAYNAK}_satir_site_kalemi`));
  assert.ok(entry, "satırın site kalemi migration'ı yok");
  const sql = readFileSync(join(process.cwd(), "drizzle", `${entry.tag}.sql`), "utf8").trim();
  assert.equal(
    sql,
    `ALTER TABLE "pos_daily_sales" ADD COLUMN "site_menu_id" text;--> statement-breakpoint\nALTER TABLE "pos_daily_sales" ADD COLUMN "slot" text;--> statement-breakpoint\nALTER TABLE "pos_daily_sales" ADD COLUMN "${ESKI_SUTUNLAR.hizmet}" boolean DEFAULT false NOT NULL;`,
  );
});

test("şubenin banka POS oranı (23 Kasım 2026): tek varsayılanlı NOT NULL sütun, var olan şubeler %2 (Instant Rollback'e uygun)", () => {
  const entry = readJournal().find((e) => e.tag.endsWith("_sube_pos_orani"));
  assert.ok(entry, "sube_pos_orani migration'ı yok");
  const sql = readFileSync(join(process.cwd(), "drizzle", `${entry.tag}.sql`), "utf8").trim();
  assert.equal(sql, 'ALTER TABLE "branches" ADD COLUMN "pos_rate" double precision DEFAULT 0.02 NOT NULL;');
});

test("AsilPOS gün sonunun Faz 2 alanları (23 Kasım 2026): yalnız ekleyen migration (yeni tablo, boş olabilen ya da varsayılanlı sütunlar; Instant Rollback'e uygun)", () => {
  const entry = readJournal().find((e) => e.tag.endsWith(`_${TEL_KAYNAK}_gun_alanlari`));
  assert.ok(entry, "gün sonunun Faz 2 alanlarının migration'ı yok");
  const sql = readFileSync(join(process.cwd(), "drizzle", `${entry.tag}.sql`), "utf8");
  assert.doesNotMatch(sql, /\b(DROP|RENAME|ALTER COLUMN)\b/);
  assert.match(sql, /CREATE TABLE "pos_day_revisions"/);
  for (const col of ['"off_device" jsonb;', '"refunds" jsonb;', '"iptal" jsonb;', '"correction" jsonb;', '"revision" integer;', '"gross" double precision;', '"is_addon" boolean DEFAULT false NOT NULL;']) {
    assert.ok(sql.includes(`ADD COLUMN ${col}`), `${col} eksik`);
  }
});

test("AsilPOS ad değişikliği (0098, 26 Kasım 2026): yalnız genişletme; eski sürüm build sırasında eski adlarla okuyup yazabilir", () => {
  const entry = readJournal().find((e) => e.tag === "0098_asilpos_adi");
  assert.ok(entry, "0098_asilpos_adi migration'ı yok");
  const sql = readFileSync(join(process.cwd(), "drizzle", `${entry.tag}.sql`), "utf8");
  // Hiçbir tablo, sütun ya da değer silinmez; değer değiştirilmez (yazılan eski değer, A3'e kadar)
  assert.doesNotMatch(sql, /DROP (TABLE|COLUMN|VIEW|INDEX|FUNCTION)|ALTER COLUMN|(^|\n)\s*DELETE /);
  assert.doesNotMatch(sql, /UPDATE "branches"|UPDATE "integration_state"|UPDATE "settings"|UPDATE "branch_settings"/);
  // Tablolar yeni adına taşınır, eski adla görünüm kalır (varsayılansız: geri yükleme nextval'li sütunları tarar)
  for (const [eski, yeni] of [[ESKI_TABLOLAR.kurulum, "asilpos_installs"], [ESKI_TABLOLAR.gunSonu, "asilpos_day_ends"]]) {
    assert.ok(sql.includes(`ALTER TABLE "${eski}" RENAME TO "${yeni}";`), yeni);
    assert.ok(sql.includes(`CREATE VIEW "${eski}" AS SELECT * FROM "${yeni}";`), `${eski} görünümü`);
  }
  assert.doesNotMatch(sql, /ALTER VIEW|SET DEFAULT/);
  // Yeni sütunlar doldurulur, tetikleyici eşit tutar; geri yüklemede yeniden oynatılabilir (fonksiyonlar silinmez)
  for (const col of ["asilpos_id", "asilpos_service"]) assert.ok(sql.includes(`ADD COLUMN "${col}"`), col);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 2);
  assert.equal((sql.match(/DROP TRIGGER IF EXISTS/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /CREATE FUNCTION/);
  // CHECK eski ve yeni değeri kabul eder
  assert.ok(sql.includes(`CHECK ("branches"."pos_source" in ('modpos','${TEL_KAYNAK}','asilpos','yok'))`));
});
