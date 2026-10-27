// Migration günlüğü ve doğrulaması (scripts/migration-check.ts): drizzle, veritabanındaki en yeni kayıttan eski
// tarihli migration'ı hata vermeden atlar. Günlüğün zamanları sırayla artmalı (dallar birleşme sırasıyla üretilir,
// docs/DEPLOY.md § 7); canlı derleme atlanan migration'da durur, günlükte olmayan kayıtta yalnız uyarır.
// Çalıştırma: npx tsx --test tests/migrations.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

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

test("derleme migration'dan sonra doğrular", () => {
  const src = readFileSync(join(process.cwd(), "scripts/migrate.ts"), "utf8");
  assert.match(src, /await migrate\(db, \{ migrationsFolder: "drizzle" \}\);\s*await verifyMigrations\(db\);/);
  assert.match(src, /if \(report\.error\) throw new Error\(report\.error\)/);
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

test("LafPOS bağlantısı: tek migration; günlük satış ve gün sonu özeti tabloları, yalnız ekleme (geri dönüşe uygun)", () => {
  const entry = readJournal().find((e) => e.tag.endsWith("_lafpos_baglantisi"));
  assert.ok(entry, "lafpos_baglantisi migration'ı yok");
  // 26 Eki 2026'da canlı veritabanına uygulandı: günlükteki zamanı ve içeriği bir daha değişmez. Yeniden üretilince
  // drizzle onu yeni migration sayıp tabloları yeniden kurmaya çalıştı, canlı derleme durdu; değişiklik yeni migration'la
  assert.equal(entry.when, 1792997178951, "0040_lafpos_baglantisi canlıda uygulandı; yeniden üretmeyin, yeni migration ekleyin");
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

test("LafPOS satırının site kalemi ve hizmet işareti (denetim B08, E-33): iki boş olabilen, bir varsayılanlı sütun, yalnız ekleme (Instant Rollback'e uygun)", () => {
  const entry = readJournal().find((e) => e.tag.endsWith("_lafpos_satir_site_kalemi"));
  assert.ok(entry, "lafpos_satir_site_kalemi migration'ı yok");
  const sql = readFileSync(join(process.cwd(), "drizzle", `${entry.tag}.sql`), "utf8").trim();
  assert.equal(
    sql,
    'ALTER TABLE "pos_daily_sales" ADD COLUMN "site_menu_id" text;--> statement-breakpoint\nALTER TABLE "pos_daily_sales" ADD COLUMN "slot" text;--> statement-breakpoint\nALTER TABLE "pos_daily_sales" ADD COLUMN "lafpos_service" boolean DEFAULT false NOT NULL;',
  );
});
