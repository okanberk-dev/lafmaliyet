// Otomatik haftalık yedek ve veritabanı kotası gerçek Postgres'te (docs/YEDEK.md › Otomatik haftalık yedek,
// › Veritabanı kotası). Yedek: bu haftanın dosyası yoksa alınır, panelden indirilenle aynı biçimdedir (geri yüklemenin
// okuyucusu kabul eder), gizli değerler dosyaya girmez, son 8 dosya kalır, hata durum kaydına ve Ayarlar'daki satıra
// düşer, süre dolunca bağlantı havuza döner; indirme bağlantısı kişiye ve dosyaya mühürlüdür. Kota: boyut
// pg_database_size'dan, %70 ve %90 eşiği ilk geçişte bir kez bildirilir (gidemeyen e-posta ertesi sabah yeniden), zil
// uyarısı durumdan okunur, e-posta sabah e-postasının alıcılarına (personel hesabının adresi düşer) Resend'le gider.
//
// Kendi geçici veritabanını açar (YEDEK_KOTA_TEST_DATABASE_URL'in sunucusunda), sonunda siler. Değişken yoksa atlanır.
// Çalıştırma: TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/lm_yedek_kota npm run test:db -- tests/yedek-kota-db.test.ts

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { gunzipSync } from "node:zlib";

import { desc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { autoBackupName, parseAutoBackupName } from "../src/lib/backup/auto";
import type { EmailProblem } from "../src/lib/job-health";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { memoryBackupStore, type BackupStore } from "../src/server/backup/store";

import { seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.YEDEK_KOTA_TEST_DATABASE_URL;
const DB_NAME = `laffogato_yedek_kota_${process.pid}`;
const MB = 1024 * 1024;

/** İstanbul saatiyle "2026-11-23 08:12" → Date */
const tr = (v: string) => new Date(`${v.replace(" ", "T")}:00+03:00`);

describe("Otomatik yedek ve veritabanı kotası (veritabanında)", { skip: !SERVER_URL && "YEDEK_KOTA_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let auto: typeof import("../src/server/backup/auto");
  let storeMod: typeof import("../src/server/backup/store");
  let check: typeof import("../src/server/db-quota/check");
  let quotaState: typeof import("../src/server/db-quota/state");
  let alerts: typeof import("../src/server/jobs/alerts");
  let restore: typeof import("../src/server/backup/restore");
  const realFetch = globalThis.fetch;
  const sent: { to: string[]; subject: string; html: string; text: string }[] = [];
  const ali = { id: 0, name: "Ali", role: "admin" as const, email: "kota-ali@ornek.com" };
  const ayse = { id: 0, name: "Ayşe", role: "staff" as const, email: "kota-ayse@ornek.com" };

  /** Gzip'li yedeğin satırları */
  const linesOf = (bytes: Uint8Array) => gunzipSync(bytes).toString("utf8").split("\n").filter(Boolean);

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "yedek-kota-testi-icin-en-az-otuz-iki-karakterlik-anahtar", RESEND_API_KEY: "re_test_yedek_kota" });
    delete process.env.DB_QUOTA_MB;
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await seedBranches(db);
    for (const u of [ali, ayse]) {
      const [row] = await db.insert(s.users).values({ email: u.email, name: u.name, passwordHash: `gizli-parola-ozeti-${u.name}`, role: u.role }).returning({ id: s.users.id });
      u.id = row.id;
    }
    auto = await import("../src/server/backup/auto");
    storeMod = await import("../src/server/backup/store");
    check = await import("../src/server/db-quota/check");
    quotaState = await import("../src/server/db-quota/state");
    alerts = await import("../src/server/jobs/alerts");
    restore = await import("../src/server/backup/restore");
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const href = String(input instanceof Request ? input.url : input);
      if (href.startsWith("https://api.resend.com/")) {
        const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string; html: string; text: string };
        sent.push({ to: body.to, subject: body.subject, html: body.html, text: body.text });
        return new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Beklenmeyen ağ isteği: ${href}`);
    }) as typeof fetch;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    storeMod?.__setBackupStoreForTests(undefined);
    delete process.env.VERCEL_ENV;
    delete process.env.DB_QUOTA_MB;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE activity_log, notification_log, notification_recipients, integration_state RESTART IDENTITY CASCADE`);
    // Gizli değerler: Paraşüt oturumu dosyaya girmez (docs/YEDEK.md § 2)
    await db.insert(s.integrationState).values({ key: "parasut.token", value: { access: "gizli-parasut-belirteci" } });
    sent.length = 0;
    storeMod.__setBackupStoreForTests(undefined);
    delete process.env.VERCEL_ENV;
    delete process.env.DB_QUOTA_MB;
  });

  // ------------------------------------------------------------------ Otomatik yedek

  test("bu haftanın yedeği yoksa alınır: panelden inenle aynı biçim, gizliler yok; aynı hafta yeniden alınmaz", async () => {
    const store = memoryBackupStore();
    const monday = tr("2026-11-23 08:05");
    const r = await auto.runAutoBackup(monday, { db, store });
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.ok(r.status === "ok" && r.rows > 0 && r.tables > 10, "satır ve tablo sayısı");
    const files = await store.list();
    assert.equal(files.length, 1);
    assert.equal(parseAutoBackupName(files[0].name)?.day, "2026-11-23");
    const bytes = await store.get(files[0].name);
    assert.ok(bytes, "dosya depoda");
    const lines = linesOf(bytes);
    const header = JSON.parse(lines[0]) as { format: string; createdBy: string; documents: boolean; excluded: { stateKeys: string[] } };
    assert.equal(header.format, "laffogato-yedek");
    assert.equal(header.createdBy, "Otomatik (sabah işi)");
    assert.equal(header.documents, false, "yüklenen belgeler otomatik yedeğe girmez");
    assert.ok(header.excluded.stateKeys.includes("parasut.token"), "Paraşüt oturumu yazılmayanlarda");
    const text = lines.join("\n");
    assert.doesNotMatch(text, /gizli-parola-ozeti/, "parola özeti dosyada yok");
    assert.doesNotMatch(text, /gizli-parasut-belirteci/, "Paraşüt belirteci dosyada yok");
    assert.match(text, /kota-ali@ornek\.com/, "kullanıcılar (parolasız) dosyada");
    // Geri yüklemenin okuyucusu dosyayı kabul eder (özet ve satır sayıları tutar)
    const dir = await mkdtemp(join(tmpdir(), "yedek-oto-db-"));
    try {
      const path = join(dir, files[0].name);
      await writeFile(path, bytes);
      const parsed = await restore.readBackupFile(path);
      assert.equal(parsed.end.rows, r.status === "ok" ? r.rows : -1);
      assert.ok(parsed.tables.has("users"), "users tablosu");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    // Durum kaydı ve işlem geçmişi
    const state = await auto.readAutoBackupState(db);
    assert.equal(state.lastError, null);
    assert.equal(state.lastOk?.name, files[0].name);
    assert.equal(state.lastOk?.bytes, bytes.byteLength);
    const [log] = await db.select().from(s.activityLog).orderBy(desc(s.activityLog.id)).limit(1);
    assert.equal(log?.action, "Otomatik yedek alındı");
    assert.equal(log?.userName, "Sistem");
    // Salı: bu hafta alındı, dokunulmaz
    assert.deepEqual(await auto.runAutoBackup(tr("2026-11-24 08:05"), { db, store }), { status: "skip" });
    assert.equal((await store.list()).length, 1);
    // Depo yok: kapalı
    assert.deepEqual(await auto.runAutoBackup(tr("2026-11-30 08:05"), { db, store: null }), { status: "off" });
  });

  test("son 8 hafta kalır: dokuzuncu dosya gelince en eskisi silinir; yabancı dosyaya dokunulmaz", async () => {
    const store = memoryBackupStore();
    const weeks = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"];
    for (const d of weeks) await store.put(autoBackupName(tr(`${d} 08:10`), "0a1b2c3d"), new Uint8Array([1]));
    const r = await auto.runAutoBackup(tr("2026-11-30 08:05"), { db, store });
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.equal(r.status === "ok" ? r.deleted : -1, 1);
    const days = (await store.list()).map((f) => parseAutoBackupName(f.name)?.day).sort();
    assert.equal(days.length, 8);
    assert.equal(days[0], "2026-10-12", "en eski (5 Ekim) silindi");
    assert.equal(days.at(-1), "2026-11-30");
    const [log] = await db.select().from(s.activityLog).orderBy(desc(s.activityLog.id)).limit(1);
    assert.match(log?.detail ?? "", /1 eski yedek silindi/);
  });

  test("yazılamazsa hata durum kaydına ve Ayarlar'daki satıra düşer; önceki başarılı yedek unutulmaz", async () => {
    const store = memoryBackupStore();
    assert.equal((await auto.runAutoBackup(tr("2026-11-23 08:05"), { db, store })).status, "ok");
    const before = await auto.readAutoBackupState(db);
    const broken: BackupStore = { ...store, put: async () => Promise.reject(new Error("Blob: 503 Service Unavailable")) };
    const r = await auto.runAutoBackup(tr("2026-11-30 08:05"), { db, store: broken });
    assert.deepEqual(r, { status: "error", error: "Blob: 503 Service Unavailable" });
    const state = await auto.readAutoBackupState(db);
    assert.equal(state.lastError, "Blob: 503 Service Unavailable");
    assert.equal(state.lastAttemptAt, tr("2026-11-30 08:05").toISOString());
    assert.deepEqual(state.lastOk, before.lastOk, "önceki başarılı yedek kayıtta kalır");
    storeMod.__setBackupStoreForTests(store);
    const info = await auto.loadAutoBackupInfo(tr("2026-11-30 10:00"));
    assert.equal(info.available, true);
    assert.equal(info.items.length, 1);
    assert.equal(info.status.badge, "Alınamadı");
    assert.match(info.status.text, /Blob: 503/);
    // Ertesi sabah yeniden denenir ve düzelir
    assert.equal((await auto.runAutoBackup(tr("2026-12-01 08:05"), { db, store })).status, "ok");
    assert.equal((await auto.loadAutoBackupInfo(tr("2026-12-01 10:00"))).status.badge, "Çalışıyor");
  });

  test("süre dolarsa yarıda bırakılır, dosya yazılmaz, bağlantı havuza döner", async () => {
    const store = memoryBackupStore();
    const r = await auto.runAutoBackup(tr("2026-11-23 08:05"), { db, store, deadlineAt: Date.now() - 1 });
    assert.deepEqual(r, { status: "error", error: "süre yetmedi" });
    assert.deepEqual(await store.list(), []);
    // Okuma işlemi kapandı: aynı havuzdan sorgular çalışır (bağlantı takılı kalmadı)
    const rows = await Promise.all(Array.from({ length: 6 }, () => db.execute<{ n: number }>(sql`SELECT 1 AS n`)));
    assert.equal(rows.length, 6);
    const [open] = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'`);
    assert.equal(open?.n, "0", "yarım kalan işlem yok");
  });

  test("indirme bağlantısı kişiye ve dosyaya mühürlü, iki dakika geçerli", async () => {
    const n = autoBackupName(tr("2026-11-23 08:12"), "0a1b2c3d");
    const h = auto.storedBackupHandle(ali.id, n);
    assert.equal(auto.openStoredBackupHandle(h, ali.id), n);
    assert.equal(auto.openStoredBackupHandle(h, ayse.id), null, "başka kişi açamaz");
    assert.equal(auto.openStoredBackupHandle(`${h.slice(0, -2)}xx`, ali.id), null, "bozuk");
    assert.equal(auto.openStoredBackupHandle("", ali.id), null);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 121_000;
      assert.equal(auto.openStoredBackupHandle(h, ali.id), null, "süresi geçti");
    } finally {
      Date.now = realNow;
    }
  });

  // ------------------------------------------------------------------ Veritabanı kotası

  test("boyut pg_database_size'dan; kota DB_QUOTA_MB'den (varsayılan 512)", async () => {
    const bytes = await quotaState.readDbSizeBytes(db);
    assert.ok(bytes > MB, `veritabanı boyutu ölçüldü (${bytes})`);
    const usage = await quotaState.loadDbUsage(db);
    assert.equal(usage.quotaMb, 512);
    assert.ok(Math.abs(usage.pct - (usage.bytes / (512 * MB)) * 100) < 1e-9, "yüzde");
    process.env.DB_QUOTA_MB = "10240";
    assert.equal((await quotaState.loadDbUsage(db)).quotaMb, 10240);
  });

  test("eşik başına bir kez; gidemeyen e-posta ertesi sabah yeniden; düşüp yeniden geçerse yine", async () => {
    const mails: EmailProblem[][] = [];
    let fail = false;
    const send = async (items: EmailProblem[]) => {
      mails.push(items);
      return fail ? ("error" as const) : ("sent" as const);
    };
    const day = async (d: string, pct: number) => check.runQuotaCheck(tr(`${d} 08:05`), { db, bytes: (pct / 100) * 512 * MB, send });

    assert.deepEqual(await day("2026-11-20", 50), { status: "ok", pct: 50, level: 0, notified: null, mail: "none" });
    assert.equal(mails.length, 0);
    const r70 = await day("2026-11-21", 72);
    assert.equal(r70.status === "ok" && r70.notified, 70);
    assert.equal(mails.length, 1);
    assert.equal(mails[0][0].key, "db-kota:70:2026-11-21");
    assert.equal(mails[0][0].title, "Veritabanı kotasının %70'i doldu");
    const [log] = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Veritabanı kotası uyarısı"));
    assert.match(log?.detail ?? "", /%72 .*%70 eşiği geçildi/);
    await day("2026-11-22", 74);
    assert.equal(mails.length, 1, "aynı eşik yeniden bildirilmez");

    fail = true;
    const r90 = await day("2026-11-23", 91);
    assert.equal(r90.status === "ok" && r90.mail, "error");
    assert.equal((await quotaState.readDbQuotaState(db)).mailed, false);
    fail = false;
    await day("2026-11-24", 91.5);
    assert.equal(mails.length, 3, "gidemeyen e-posta ertesi sabah yeniden");
    assert.equal(mails[2][0].key, "db-kota:90:2026-11-23", "anahtar geçişin gününden");
    await day("2026-11-25", 92);
    assert.equal(mails.length, 3, "gitti: bir daha yok");
    const st = await quotaState.readDbQuotaState(db);
    assert.equal(st.level, 90);
    assert.equal(st.since, tr("2026-11-23 08:05").toISOString());
    assert.equal(st.mailed, true);

    // Temizlik: %60'a indi (seviye düşer), sonra yeniden %71
    assert.equal((await day("2026-11-26", 60)).status === "ok" && (await quotaState.readDbQuotaState(db)).level, 0);
    await day("2026-11-27", 71);
    assert.equal(mails.length, 4, "yeniden geçince yine");
    assert.equal(mails[3][0].key, "db-kota:70:2026-11-27");
  });

  test("canlıda: zil uyarısı durumdan; e-posta sabah e-postasının alıcılarına, personel adresi düşer", async () => {
    process.env.VERCEL_ENV = "production";
    await db.insert(s.notificationRecipients).values([{ email: ali.email }, { email: ayse.email }]);
    const r = await check.runQuotaCheck(tr("2026-11-26 08:05"), { db, bytes: 0.93 * 512 * MB });
    assert.deepEqual(r, { status: "ok", pct: 93, level: 90, notified: 90, mail: "sent" });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, [ali.email], "personel hesabının adresi düşer");
    assert.equal(sent[0].subject, "L'Affogato · Veritabanı kotasının %90'ı doldu");
    assert.match(sent[0].html, /Veritabanı kullanımını aç/);
    assert.match(sent[0].html, /\/panel\/ayarlar#veritabani/);
    assert.match(sent[0].text, /Neon konsolunda/);
    const [logged] = await db.select().from(s.notificationLog).where(eq(s.notificationLog.key, "db-kota:90:2026-11-26"));
    assert.ok(logged?.ok, "notification_log'a yazıldı");
    // Zil ve Genel bakış şeridi (sistem uyarıları): durumdan okunur, boyut yeniden sorulmaz
    const list = await alerts.loadSystemAlerts(tr("2026-11-26 10:00"));
    const q = list.find((a) => a.id === "db-kota-90-2026-11-26");
    assert.ok(q, `kota uyarısı zilde (${list.map((a) => a.id).join(", ")})`);
    assert.equal(q.banner, true);
    assert.equal(q.href, "/panel/ayarlar#veritabani");
    // Ertesi gün aynı seviye: e-posta yok
    await check.runQuotaCheck(tr("2026-11-27 08:05"), { db, bytes: 0.94 * 512 * MB });
    assert.equal(sent.length, 1);
  });
});
