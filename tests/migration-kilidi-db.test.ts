// Aynı anda iki migration (scripts/migrate.ts › runMigrations; 26 Kasım 2026). #151'in canlı derlemesi 0087–0092'yi
// uygularken #152'ninki başladı, drizzle.__drizzle_migrations'ı ilk işlem commit olmadan okudu ve
// `column "company_wide" of relation "invoices" already exists` (42701) ile düştü. Burada gerçek Postgres'te:
// - kilitsiz (drizzle'ın migrate'i tek başına) aynı yarış düşer: olayın kendisi, test yarışı gerçekten kuruyor;
// - kilitle iki çalıştırmanın ikisi de biter: biri hepsini uygular, öteki kilidi bekler, sonra okur ve "güncel" der;
// - öteki migration bitmezse bekleme sınırında durur, şemaya dokunmaz, kilidi tutan oturumu yazar;
// - canlı uygulamanın açık işlemi tabloyu tutarken ALTER TABLE en çok lock_timeout kadar bekler; denemeler biterse
//   derleme tutan işlemi yazarak durur (şema değişmez), işlem biterse sonraki deneme geçer.
// Her test kendi geçici veritabanını açar, sonunda siler.
//
// GOC_TEST_DATABASE_URL verilmezse atlanır (veritabanı oluşturabilen bir kullanıcıyla herhangi bir veritabanı).
// Çalıştırma: GOC_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/migration-kilidi-db.test.ts
// (npm run test:db bunu da koşar.)

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { MIGRATION_APP, MIGRATION_LOCK, runMigrations } from "../scripts/migrate";
import { readJournal } from "../scripts/migration-check";

const SERVER_URL = process.env.GOC_TEST_DATABASE_URL;
const PREFIX = `laffogato_goc_test_${process.pid}`;

/** Veritabanında migration kilidini tutan oturum sayısı (pg_locks sunucu genelidir) */
const LOCK_HELD = (dbName: string) => `
  select count(*)::int as n from pg_locks l join pg_database d on d.oid = l.database
  where d.datname = '${dbName}' and l.locktype = 'advisory' and l.granted and l.objsubid = 1
    and l.classid::bigint * 4294967296 + l.objid::bigint = ${MIGRATION_LOCK}`;

async function waitFor(what: string, check: () => Promise<boolean>, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`${what}: ${ms} ms içinde olmadı`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("migration kilidi: aynı anda iki derleme", { skip: !SERVER_URL && "GOC_TEST_DATABASE_URL tanımlı değil" }, () => {
  let admin: postgres.Sql;
  const databases: string[] = [];
  const clients: postgres.Sql[] = [];
  let dir: string | undefined;
  // runMigrations'ın günlüğü (console.log ve console.warn) yakalanır
  const logs: string[] = [];
  const realLog = console.log;
  const realWarn = console.warn;

  /** Boş geçici veritabanı; adresi */
  async function freshDb(name: string): Promise<{ url: string; name: string }> {
    const db = `${PREFIX}_${name}`;
    await admin.unsafe(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${db}`);
    databases.push(db);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${db}`;
    return { url: url.href, name: db };
  }

  /** Tek bağlantılı istemci; `app`: pg_stat_activity'deki adı */
  function client(url: string, app: string): postgres.Sql {
    const c = postgres(url, { max: 1, onnotice: () => {}, connection: { application_name: app } });
    clients.push(c);
    return c;
  }

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    console.log = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
    console.warn = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
  });

  after(async () => {
    console.log = realLog;
    console.warn = realWarn;
    for (const c of clients) await c.end({ timeout: 5 });
    for (const db of databases) await admin?.unsafe(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin?.end({ timeout: 5 });
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("kilitsiz (drizzle'ın migrate'i tek başına) aynı yarışta düşer: olayın kendisi", async () => {
    const { url } = await freshDb("kilitsiz");
    const run = (app: string) => migrate(drizzle(client(url, app)), { migrationsFolder: "drizzle" });
    const results = await Promise.allSettled([run("kilitsiz-a"), run("kilitsiz-b")]);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.ok(failed.length >= 1, "kilitsiz iki migration da geçti: test yarışı kurmuyor");
  });

  test("iki canlı derleme aynı anda: biri hepsini uygular, öteki kilidi bekler, sonra okur ve 'güncel' der", async () => {
    const { url, name } = await freshDb("ikili");
    const journal = readJournal();
    logs.length = 0;
    const first = runMigrations(url);
    // İkinci derleme birincinin migration'ı sürerken başlar (olaydaki gibi: 11:43, öteki 11:27'den beri sürüyordu)
    await waitFor("birinci derleme kilidi almadı", async () => (await admin.unsafe(LOCK_HELD(name)))[0].n === 1);
    const second = runMigrations(url);
    const [a, b] = await Promise.all([first, second]);

    assert.deepEqual(a, { applied: journal.length, waitedMs: 0 }, "birinci derleme hepsini bekletmeden uygular");
    assert.equal(b.applied, 0, "ikinci derleme hiçbir migration'ı yeniden uygulamaz");
    assert.ok(b.waitedMs > 0, "ikinci derleme kilidi beklemedi");
    // Günlük: ikincisi kimin tuttuğunu yazar, bekler; ikisi de "güncel" der, hata yok
    assert.ok(
      logs.some((l) => new RegExp(`^… Başka bir migration sürüyor \\(pid \\d+ · ${MIGRATION_APP} · `).test(l)),
      `bekleme satırı yok:\n${logs.join("\n")}`,
    );
    assert.ok(logs.some((l) => /^✓ Öteki migration bitti, kilit alındı \([\d,]+ sn beklendi\)$/.test(l)), logs.join("\n"));
    assert.equal(logs.filter((l) => l === `✓ ${journal.length} migration uygulandı` || l.startsWith(`✓ ${journal.length} migration uygulandı (`)).length, 1);
    assert.equal(logs.filter((l) => l === `✓ Veritabanı şeması güncel (${journal.length} migration)`).length, 2, logs.join("\n"));

    // Veritabanı: her migration bir kez kayıtlı, kilit bırakıldı
    const c = client(url, "test");
    const rows = await c`select created_at from drizzle.__drizzle_migrations`;
    assert.equal(rows.length, journal.length);
    assert.equal(new Set(rows.map((r) => Number(r.created_at))).size, journal.length);
    assert.equal((await admin.unsafe(LOCK_HELD(name)))[0].n, 0, "kilit bırakılmadı");
    // Sonraki derleme de (kilit boş) beklemeden "güncel" der
    assert.deepEqual(await runMigrations(url), { applied: 0, waitedMs: 0 });
  });

  test("öteki migration bitmezse bekleme sınırında durur, şemaya dokunmaz, kilidi tutanı yazar", async () => {
    const { url } = await freshDb("bekleme");
    const other = client(url, "baska-derleme");
    await other.unsafe(`select pg_advisory_lock(${MIGRATION_LOCK})`);
    await assert.rejects(runMigrations(url, { waitForOtherMs: 300 }), (e: Error) => {
      assert.match(e.message, /^Migration kilidi 0,3 sn içinde alınamadı: başka bir migration hâlâ sürüyor \(pid \d+ · baska-derleme · /);
      assert.match(e.message, /Şemaya dokunulmadı, yayındaki sürüm değişmedi/);
      assert.match(e.message, /pg_terminate_backend/);
      return true;
    });
    const [t] = await other`select to_regclass('drizzle.__drizzle_migrations') is null as empty`;
    assert.equal(t.empty, true, "kilit alınamadan şemaya dokunuldu");
    // Öteki bitince yeniden dağıtım geçer
    await other.unsafe(`select pg_advisory_unlock(${MIGRATION_LOCK})`);
    assert.equal((await runMigrations(url)).applied, readJournal().length);
  });

  test("canlı uygulamanın açık işlemi tabloyu tutarken: ALTER TABLE sınırlı bekler, denemeler biterse tutanı yazar, işlem biterse geçer", async () => {
    // Küçük bir migration klasörü: 0000 tabloyu açar, 0001 olaydaki sütunu ekler
    dir = mkdtempSync(join(tmpdir(), "laffogato-goc-"));
    mkdirSync(join(dir, "meta"));
    const entries = [
      { idx: 0, version: "7", when: 1_000, tag: "0000_faturalar", breakpoints: true },
      { idx: 1, version: "7", when: 2_000, tag: "0001_fatura_sube", breakpoints: true },
    ];
    writeFileSync(join(dir, "0000_faturalar.sql"), `CREATE TABLE "invoices" ("id" serial PRIMARY KEY NOT NULL, "branch_id" text);`);
    writeFileSync(join(dir, "0001_fatura_sube.sql"), `ALTER TABLE "invoices" ADD COLUMN "company_wide" boolean DEFAULT false NOT NULL;`);
    const journal = (n: number) => writeFileSync(join(dir!, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql", entries: entries.slice(0, n) }));
    journal(1);
    const { url } = await freshDb("tablo");
    assert.equal((await runMigrations(url, { folder: dir })).applied, 1);
    journal(2);

    // Canlı uygulama faturaları okudu, işlemi açık kaldı (idle in transaction): ALTER TABLE onu bekler
    const app = client(url, "canli-uygulama");
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    const appTx = app.begin(async (tx) => {
      await tx`select count(*) from invoices`;
      await released;
    });
    const probe = client(url, "test");
    const idle = async () =>
      (await probe`select count(*)::int as n from pg_stat_activity where application_name = 'canli-uygulama' and state = 'idle in transaction'`)[0].n === 1;
    await waitFor("uygulamanın işlemi açılmadı", idle);
    const columns = async () => (await probe`select count(*)::int as n from information_schema.columns where table_name = 'invoices' and column_name = 'company_wide'`)[0].n;
    const recorded = async () => (await probe`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n;

    try {
      logs.length = 0;
      await assert.rejects(runMigrations(url, { folder: dir, lockTimeoutMs: 200, attempts: 2, retryPauseMs: 50 }), (e: Error) => {
        assert.match(e.message, /^Migration 2 denemede de tablo kilidini alamadı \(her bekleyiş en çok 0,2 sn; takılan: ALTER TABLE "invoices" ADD COLUMN "company_wide"/);
        assert.match(e.message, /Şemaya dokunulmadı \(işlem geri alındı\), yayındaki sürüm değişmedi/);
        assert.match(e.message, /\n {2}pid \d+ · idle in transaction · açık: [\d,]+ sn · canli-uygulama · tablolar: invoices · son sorgu: select count\(\*\) from invoices/);
        return true;
      });
      assert.ok(logs.some((l) => /^! Migration denemesi 1\/2: tablo kilidi 0,2 sn içinde alınamadı \(ALTER TABLE "invoices"/.test(l)), logs.join("\n"));
      assert.equal(await columns(), 0, "sütun eklenmemeli");
      assert.equal(await recorded(), 1);
      assert.equal(await idle(), true, "uygulamanın işlemi migration'dan etkilenmemeli");

      // İşlem bitince sonraki deneme geçer
      logs.length = 0;
      const run = runMigrations(url, { folder: dir, lockTimeoutMs: 200, attempts: 20, retryPauseMs: 50 });
      await waitFor("ilk deneme beklemedi", async () => logs.some((l) => l.startsWith("! Migration denemesi 1/20: ")));
      release();
      await appTx;
      assert.deepEqual(await run, { applied: 1, waitedMs: 0 });
      assert.equal(await columns(), 1);
      assert.equal(await recorded(), 2);
      assert.ok(logs.includes("✓ Veritabanı şeması güncel (2 migration)"), logs.join("\n"));
    } finally {
      // Düşen bir iddia uygulamanın işlemini açık bırakmasın (kapanışta yakalanmamış bağlantı hatası olurdu)
      release();
      await appTx.catch(() => {});
    }
  });
});
