// Hata kaydı gerçek Postgres'te (docs/HATA-KAYDI.md; src/server/errors/store.ts, alert.ts, src/app/api/hata/route.ts,
// src/app/api/csp-rapor/route.ts, src/server/actions/util.ts attempt, src/server/actions/error-log.ts): aynı hata tek
// satır (sayı, ilk / son görülüş, son beş hata kodu), "Çözüldü" ve yeniden açılma, kaynak başına günlük yeni satır
// sınırı, saklama süresi ve satır tavanı, denetim karakterli satır, günde bir kritik e-posta (başka örnekte de; takılan
// gönderimin anahtarı yeniden alınır), tarayıcı ucunun kapıları (köken, oturum, boyut, sıklık), CSP raporunun kaydı (IP
// başına sınır, eklenti yazılmaz, CSP yağmuru sunucu hatasını düşürmez), attempt()'in yalnız beklenmeyen hatayı
// yazması (sorgu parametresi yazılmaz), yönetici eylemleri.
//
// HATA_TEST_DATABASE_URL verilmezse atlanır: bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı); test
// kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: HATA_TEST_DATABASE_URL=postgres://localhost/postgres npx tsx --test tests/hata-kaydi-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { DrizzleQueryError, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { NextRequest } from "next/server";
import postgres from "postgres";

import { createWriteGate, DAILY_NEW_CAP, MAX_ROWS, RETENTION_DAYS, type CleanEntry } from "../src/lib/error-log";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.HATA_TEST_DATABASE_URL;
const DB_NAME = `laffogato_hata_kaydi_${process.pid}`;
const ORIGIN = "https://panel.test";
const NOW = new Date("2026-11-27T09:30:00Z");
const DAY = 86_400_000;

describe("hata kaydı: veritabanında", { skip: !SERVER_URL && "HATA_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let store: typeof import("../src/server/errors/store");
  let alert: typeof import("../src/server/errors/alert");
  let hataRoute: typeof import("../src/app/api/hata/route");
  let cspRoute: typeof import("../src/app/api/csp-rapor/route");
  let util: typeof import("../src/server/actions/util");
  let actions: typeof import("../src/server/actions/error-log");
  let NextRequestCtor: typeof NextRequest;
  let who: { id: number; name: string; email: string; role: "admin" | "staff" } | null = null;
  const noAlert = async () => {};

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "hata-kaydi-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    delete process.env.VERCEL_ENV;
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    const nextServer = require("next/server") as typeof import("next/server");
    NextRequestCtor = nextServer.NextRequest;
    stub("next/server", { ...nextServer, connection: async () => {} });
    // Eylemin sayfası başlıktan okunur (istek bağlamı yok): sabit bir Referer
    stub("next/headers", { ...require("next/headers"), headers: async () => new Headers({ referer: `${ORIGIN}/panel/kasa?gun=2026-11-01` }) });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    const [u] = await db.insert(s.users).values({ email: "hata-yonetici@ornek.com", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const me = async () => who;
    const adminOnly = async () => {
      if (!who || who.role !== "admin") throw new Error("yönetici değil");
      return who;
    };
    stub(require.resolve("../src/server/auth/dal"), { getCurrentUser: me, requireUser: me, requireAdmin: adminOnly });
    who = { id: u.id, name: u.name, email: u.email, role: "admin" };
    store = await import("../src/server/errors/store");
    alert = await import("../src/server/errors/alert");
    hataRoute = await import("../src/app/api/hata/route");
    cspRoute = await import("../src/app/api/csp-rapor/route");
    util = await import("../src/server/actions/util");
    actions = await import("../src/server/actions/error-log");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE error_log, notification_log, integration_state, activity_log RESTART IDENTITY CASCADE`);
    alert.resetAlertMemo();
  });

  const rows = () => db.select().from(s.errorLog).orderBy(s.errorLog.id);
  /** Kapı her çağrıda serbest (gruplamayı sınamak için) */
  const open = () => createWriteGate({ perKeyMs: 0, perMinute: 10_000 });
  /** Beklenmeyen kayıt: en çok 3 sn satır beklenir */
  const waitRows = async (n: number) => {
    for (let i = 0; i < 60; i++) {
      const r = await rows();
      if (r.length >= n) return r;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    return rows();
  };

  test("aynı hata tek satır: sayı, ilk / son görülüş, son ileti; kişisel veri yazılmaz; Çözüldü sonra yeniden açılır", async () => {
    const e = { source: "server" as const, name: "Error", message: "Fatura 12 bulunamadı: ayse@ornek.com", path: "/panel/faturalar/12?t=abc", route: "/panel/faturalar/[id]", digest: "111" };
    assert.equal(await store.recordError(e, { db, now: NOW, gate: open(), alert: noAlert }), "inserted");
    const later = new Date(NOW.getTime() + 60_000);
    assert.equal(await store.recordError({ ...e, message: "Fatura 13 bulunamadı: ayse@ornek.com", path: "/panel/faturalar/13", digest: "222" }, { db, now: later, gate: open(), alert: noAlert }), "updated");
    let [r] = await rows();
    assert.equal((await rows()).length, 1);
    assert.equal(r.count, 2);
    assert.equal(r.firstSeen.toISOString(), NOW.toISOString());
    assert.equal(r.lastSeen.toISOString(), later.toISOString());
    assert.equal(r.message, "Fatura 13 bulunamadı: [e-posta]");
    assert.equal(r.path, "/panel/faturalar/13");
    assert.equal(r.digest, "222 111", "son kodlar, yeni önce");
    assert.doesNotMatch(JSON.stringify(await rows()), /ornek\.com/, "e-posta yazılmadı");
    assert.equal(await store.resolveErrors(db, [r.id], later), 1);
    assert.equal((await store.loadErrorLog(db)).openCount, 0);
    // Yeniden görülünce açılır, sayısı sürer
    assert.equal(await store.recordError(e, { db, now: new Date(later.getTime() + 1000), gate: open(), alert: noAlert }), "updated");
    [r] = await rows();
    assert.equal(r.resolvedAt, null);
    assert.equal(r.count, 3);
    // Hata kodları: aynısı bir kez (öne gelir), en çok beş, ekranda dizi
    for (const [i, digest] of ["333", "444", "555", "666", "222"].entries()) {
      await store.recordError({ ...e, digest }, { db, now: new Date(later.getTime() + 2000 + i), gate: open(), alert: noAlert });
    }
    [r] = await rows();
    assert.equal(r.digest, "222 666 555 444 333");
    await store.recordError({ ...e, digest: null }, { db, now: new Date(later.getTime() + 3000), gate: open(), alert: noAlert });
    assert.deepEqual((await store.loadErrorLog(db)).open[0].digests, ["222", "666", "555", "444", "333"], "kodsuz görülüş kodları silmez");
  });

  test("denetim karakterli hata (NUL) yazılır: Postgres reddetmez, satır temizlenmiş", async () => {
    const e = { source: "client" as const, name: "Syntax\u0000Error", message: "Unexpected token '\u0000', \"\u0000\u0001abc\" is not valid JSON", stack: "f@https://panel.test/a.js:1:2\u0000", path: "/panel\u0000/kasa", detail: "x\u0000" };
    assert.equal(await store.recordError(e, { db, now: NOW, gate: open() }), "inserted");
    const [r] = await rows();
    assert.equal(r.message, "Unexpected token '', \"abc\" is not valid JSON");
    assert.equal(r.name, "SyntaxError");
    assert.equal(r.path, "/panel/kasa");
    assert.equal(r.stack, "f@/a.js:1:2");
  });

  test("döngü veritabanını boğmaz: aynı hata örnek başına 10 sn'de bir yazılır, aradakiler sonraki yazıma eklenir", async () => {
    const gate = createWriteGate();
    const e = { source: "client" as const, message: "x is undefined", path: "/panel/kasa" };
    const outcomes = [];
    for (let i = 0; i < 100; i++) outcomes.push(await store.recordError(e, { db, now: new Date(NOW.getTime() + i * 10), gate, alert: noAlert }));
    assert.equal(outcomes.filter((o) => o === "inserted").length, 1);
    assert.equal(outcomes.filter((o) => o === "throttled").length, 99);
    assert.equal((await rows())[0].count, 1);
    assert.equal(await store.recordError(e, { db, now: new Date(NOW.getTime() + 11_000), gate, alert: noAlert }), "updated");
    assert.equal((await rows())[0].count, 101, "bekleyen 99 + bu");
  });

  test("kaynak başına günde sınırlı yeni satır; aşılınca tek 'sınır doldu' satırı sayılır; ertesi gün yeniden açılır", async () => {
    const cap = DAILY_NEW_CAP.csp;
    for (let i = 0; i < cap; i++) {
      assert.equal(await store.recordError({ source: "csp", name: "img-src", message: `img-src https://x${String.fromCharCode(97 + (i % 26))}${"y".repeat(Math.floor(i / 26) + 1)}.example`, path: "/panel" }, { db, now: NOW, gate: open() }), "inserted");
    }
    assert.equal(await store.recordError({ source: "csp", message: "img-src https://fazla1.example", path: "/panel" }, { db, now: NOW, gate: open() }), "capped");
    assert.equal(await store.recordError({ source: "csp", message: "img-src https://fazla2.example", path: "/panel" }, { db, now: NOW, gate: open() }), "capped");
    // Var olan satır sınırdan etkilenmez; başka kaynak kendi sınırında
    assert.equal(await store.recordError({ source: "csp", name: "img-src", message: "img-src https://xay.example", path: "/panel" }, { db, now: NOW, gate: open() }), "updated");
    assert.equal(await store.recordError({ source: "server", message: "başka kaynak" }, { db, now: NOW, gate: open(), alert: noAlert }), "inserted");
    const all = await rows();
    const overflow = all.filter((r) => r.fingerprint.startsWith("sinir:"));
    assert.equal(overflow.length, 1);
    assert.equal(overflow[0].count, 2);
    assert.equal(overflow[0].level, "warning");
    assert.equal(overflow[0].message, "Günlük sınır doldu (27 Kas): o gün 30 farklı CSP ihlalinden sonrakiler ayrı satır açmadı, yalnız sayıldı");
    assert.equal(all.length, cap + 2);
    assert.equal(await store.recordError({ source: "csp", message: "img-src https://ertesi.example", path: "/panel" }, { db, now: new Date(NOW.getTime() + DAY), gate: open() }), "inserted");
    const view = await store.loadErrorLog(db);
    assert.equal(view.open.length, cap + 3);
    assert.equal(view.openCount, cap + 3);
    assert.equal(view.csp.length, cap + 2);
  });

  test("saklama süresi: 30 gündür görülmeyen silinir; tavan 2000 satır (en eski son görülüşten); kaydın başlangıcı yazılır", async () => {
    await store.recordError({ source: "server", message: "eski" }, { db, now: new Date(NOW.getTime() - (RETENTION_DAYS + 1) * DAY), gate: open(), alert: noAlert });
    await store.recordError({ source: "server", message: "yeni" }, { db, now: NOW, gate: open(), alert: noAlert });
    assert.equal(await store.pruneErrorLog(db, NOW), 1);
    assert.deepEqual((await rows()).map((r) => r.message), ["yeni"]);
    assert.equal(await store.readErrorsSince(db), NOW.toISOString());
    // Başlangıç bir kez yazılır
    await store.pruneErrorLog(db, new Date(NOW.getTime() + DAY));
    assert.equal(await store.readErrorsSince(db), NOW.toISOString());
    await db.execute(sql`
      INSERT INTO error_log (fingerprint, source, message, first_seen, last_seen)
      SELECT 'toplu-' || g, 'client', 'toplu ' || g, ${NOW.toISOString()}::timestamptz - (g || ' minutes')::interval, ${NOW.toISOString()}::timestamptz - (g || ' minutes')::interval
      FROM generate_series(1, ${MAX_ROWS + 10}) g`);
    assert.equal(await store.pruneErrorLog(db, NOW), 11);
    const left = await rows();
    assert.equal(left.length, MAX_ROWS);
    assert.ok(left.some((r) => r.message === "yeni"), "en yeni kalır");
    assert.ok(!left.some((r) => r.message === `toplu ${MAX_ROWS + 10}`), "en eski gider");
  });

  test("kritik hata e-postası günde bir: anahtar önce alınır (başka örnek de göndermez); gidemezse bırakılır; canlı değilse hiç", async () => {
    const e = { source: "server", level: "error", name: "Error", message: "Bağlantı koptu", path: "/panel/kasa", route: "/panel/kasa", detail: null, digest: "42", stack: null } satisfies CleanEntry;
    const sent: string[] = [];
    const send = async (items: { key: string; title: string }[]) => {
      sent.push(...items.map((i) => `${i.key} ${i.title}`));
      return "sent" as const;
    };
    assert.equal(await alert.sendCriticalAlert(e, NOW, { db, production: false, send }), "none");
    assert.equal((await db.select().from(s.notificationLog)).length, 0);
    assert.equal(await alert.sendCriticalAlert(e, NOW, { db, production: true, send }), "sent");
    assert.deepEqual(sent, ["hata-kaydi:2026-11-27 Panelde hata: Bağlantı koptu"]);
    const claim = async (day: string) => (await db.select().from(s.notificationLog).where(eq(s.notificationLog.key, `hata-kaydi:${day}`)))[0];
    assert.deepEqual([(await claim("2026-11-27")).ok, (await claim("2026-11-27")).error], [true, null], "gidince anahtar 'gönderildi'");
    assert.equal(await alert.sendCriticalAlert(e, NOW, { db, production: true, send }), "skip", "aynı örnek veritabanına sormaz");
    alert.resetAlertMemo();
    assert.equal(await alert.sendCriticalAlert(e, NOW, { db, production: true, send }), "done", "başka örnek: anahtar alınmış");
    assert.equal(sent.length, 1);
    // Ertesi gün yeniden; gönderim düşerse anahtar bırakılır, 10 dakika sonra yeniden denenir
    const tomorrow = new Date(NOW.getTime() + DAY);
    assert.equal(await alert.sendCriticalAlert(e, tomorrow, { db, production: true, send: async () => "error" }), "error");
    assert.equal((await db.select().from(s.notificationLog).where(eq(s.notificationLog.key, "hata-kaydi:2026-11-28"))).length, 0);
    assert.equal(await alert.sendCriticalAlert(e, new Date(tomorrow.getTime() + 60_000), { db, production: true, send }), "skip");
    assert.equal(await alert.sendCriticalAlert(e, new Date(tomorrow.getTime() + 11 * 60_000), { db, production: true, send }), "sent");
    assert.equal(sent.length, 2);
    // Başka örnek gönderirken durduruldu (anahtar "gönderiliyor" kaldı): 5 dakika içinde dokunulmaz, sonra yeniden alınır
    const day3 = new Date(NOW.getTime() + 2 * DAY);
    alert.resetAlertMemo();
    await db.insert(s.notificationLog).values({ key: "hata-kaydi:2026-11-29", subject: "x", ok: false, error: alert.PENDING, sentAt: new Date(day3.getTime() - 60_000) });
    assert.equal(await alert.sendCriticalAlert(e, day3, { db, production: true, send }), "done", "öteki örnek hâlâ gönderiyor olabilir");
    assert.equal(await alert.sendCriticalAlert(e, new Date(day3.getTime() + 60_000), { db, production: true, send }), "skip");
    assert.equal(sent.length, 2);
    assert.equal(await alert.sendCriticalAlert(e, new Date(day3.getTime() + alert.PENDING_MS), { db, production: true, send }), "sent", "takılan anahtar yeniden alındı");
    assert.equal(sent.length, 3);
    assert.equal((await claim("2026-11-29")).ok, true);
    alert.resetAlertMemo();
    assert.equal(await alert.sendCriticalAlert(e, new Date(day3.getTime() + 2 * alert.PENDING_MS), { db, production: true, send }), "done");
    assert.equal(sent.length, 3, "gittikten sonra yeniden alınmaz");
  });

  test("kayıt kritik hatada e-postayı dener; tarayıcı ve CSP'de denemez; sınır satırında denemez", async () => {
    const tried: string[] = [];
    const hook = async (e: CleanEntry) => void tried.push(e.source);
    await store.recordError({ source: "server", message: "a" }, { db, now: NOW, gate: open(), alert: hook });
    await store.recordError({ source: "action", message: "b" }, { db, now: NOW, gate: open(), alert: hook });
    await store.recordError({ source: "client", message: "c" }, { db, now: NOW, gate: open(), alert: hook });
    await store.recordError({ source: "csp", message: "d" }, { db, now: NOW, gate: open(), alert: hook });
    assert.deepEqual(tried, ["server", "action"]);
    // E-postanın hatası kaydı bozmaz
    assert.equal(await store.recordError({ source: "server", message: "e" }, { db, now: NOW, gate: open(), alert: async () => { throw new Error("Resend yok"); } }), "inserted");
  });

  test("tarayıcı ucu: yalnız aynı köken ve oturum; boyut, biçim ve sıklık sınırı; yanıt beklemez, satır yazılır", async () => {
    const body = JSON.stringify({ kind: "error", name: "TypeError", message: "x is undefined; ayse@ornek.com", stack: "f@https://panel.test/_next/static/chunks/a.js?dpl=1:1:2", path: "/panel/kasa" });
    const req = (init: { body?: string; headers?: Record<string, string> } = {}) =>
      new NextRequestCtor(`${ORIGIN}/api/hata`, {
        method: "POST",
        body: init.body ?? body,
        headers: { origin: ORIGIN, host: "panel.test", "content-type": "application/json", "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Version/18.1 Mobile/15E148 Safari/604.1", ...init.headers },
      });
    assert.equal((await hataRoute.POST(req({ headers: { origin: "https://baska.example" } }))).status, 403);
    const noOrigin = new NextRequestCtor(`${ORIGIN}/api/hata`, { method: "POST", body, headers: { host: "panel.test" } });
    assert.equal((await hataRoute.POST(noOrigin)).status, 403);
    const signedIn = who;
    who = null;
    assert.equal((await hataRoute.POST(req())).status, 401);
    who = signedIn;
    assert.equal((await hataRoute.POST(req({ body: "x".repeat(9000) }))).status, 413);
    assert.equal((await hataRoute.POST(req({ body: "{bozuk" }))).status, 400);
    assert.equal((await hataRoute.POST(req({ body: JSON.stringify({ kind: "baska", message: "x", path: "/panel" }) }))).status, 400);
    assert.equal((await hataRoute.POST(req())).status, 204);
    const [r] = await waitRows(1);
    assert.equal(r.source, "client");
    assert.equal(r.message, "x is undefined; [e-posta]");
    assert.equal(r.detail, "Sayfa hatası · Safari · iOS");
    assert.equal(r.stack, "f@/_next/static/chunks/a.js:1:2");
    assert.equal(r.path, "/panel/kasa");
    // Kişi başına 10 dakikada en çok 20 (sayaç bu örnekte)
    const statuses = [];
    for (let i = 0; i < 25; i++) statuses.push((await hataRoute.POST(req({ body: JSON.stringify({ kind: "error", message: `hata ${i}`, path: "/panel" }) }))).status);
    assert.ok(statuses.includes(429), "sıklık sınırı");
    // "hata 0" … "hata 24" aynı hata (sayılar atılır): tek satır; arka plandaki yazımlar bitsin
    assert.equal((await waitRows(2)).length, 2);
  });

  test("CSP raporu: oturumsuz, hep 204; ihlal satırı yazılır (sorgu ve kişisel veri yok); IP başına sınır; eklenti yazılmaz; yağmur sunucu hatasını düşürmez", async () => {
    store.resetErrorGates();
    const post = (body: string, ip = "203.0.113.1", type = "application/csp-report") =>
      cspRoute.POST(new Request(`${ORIGIN}/api/csp-rapor`, { method: "POST", body, headers: { "content-type": type, "x-forwarded-for": ip } }));
    const report = JSON.stringify({ "csp-report": { "document-uri": "https://panel.test/panel/kasa?gun=1", "effective-directive": "img-src", "blocked-uri": "https://iz.example.com/p.gif?e=ayse@ornek.com", disposition: "report" } });
    assert.equal((await post(report)).status, 204);
    assert.equal((await post("bozuk")).status, 204);
    const [r] = await waitRows(1);
    assert.deepEqual([r.source, r.level, r.message, r.path, r.detail], ["csp", "warning", "img-src https://iz.example.com/p.gif", "/panel/kasa", "Report-Only"]);
    const lines: string[] = [];
    const warn = console.warn;
    console.warn = (line: string) => void lines.push(line);
    try {
      // Eklentinin ihlali yalnız günlüğe
      const ext = JSON.stringify([{ type: "csp-violation", body: { documentURL: "https://panel.test/panel", effectiveDirective: "script-src-elem", blockedURL: "inline", sourceFile: "chrome-extension://abc/content.js", disposition: "report" } }]);
      assert.equal((await post(ext, "203.0.113.1", "application/reports+json")).status, 204);
      // Tek IP iki gövdeyle 40 farklı ihlal: yalnız 20'si işlenir
      const many = (from: number) =>
        JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ type: "csp-violation", body: { documentURL: "https://panel.test/panel", effectiveDirective: "img-src", blockedURL: `https://h${String.fromCharCode(97 + ((from + i) % 26))}${from + i >= 26 ? "z" : ""}.example/p.gif`, disposition: "report" } })));
      await post(many(0), "203.0.113.2", "application/reports+json");
      await post(many(20), "203.0.113.2", "application/reports+json");
      const one = JSON.stringify([{ type: "csp-violation", body: { documentURL: "https://panel.test/panel", effectiveDirective: "img-src", blockedURL: "https://hbaska.example/p.gif", disposition: "report" } }]);
      await post(one, "203.0.113.3", "application/reports+json");
    } finally {
      console.warn = warn;
    }
    assert.ok(lines[0].includes("eklenti"), lines[0]);
    assert.equal(lines.filter((l) => /\/\/h[a-z]+\.example/.test(l)).length, 20 + 1, "IP başına 20; başka IP yine işlenir");
    // CSP'nin kendi kapısı: örnek başına dakikada 10 yazım; sunucu hatası yine yazılır
    const written = await waitRows(10);
    await new Promise((ok) => setTimeout(ok, 200));
    assert.equal((await rows()).length, 10);
    assert.ok(!written.some((x) => (x.detail ?? "").includes("eklenti") || x.message.includes("inline")), "eklenti yazılmadı");
    assert.equal(await store.recordError({ source: "server", message: "gerçek hata" }, { db, alert: noAlert }), "inserted");
  });

  test("attempt(): yalnız beklenmeyen hata kayda girer (doğrulama, UserError, bilinen kısıt girmez); yanıt beklemez", async () => {
    const orig = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await util.attempt(async () => { throw new util.UserError("Tutar girin"); }), { ok: false, error: "Tutar girin" });
      assert.equal((await util.attempt(async () => util.zMoney.parse("x"))).ok, false);
      assert.equal((await util.attempt(async () => { throw Object.assign(new Error("dup"), { code: "23505" }); })).ok, false);
      const cause = Object.assign(new Error('relation "yok" does not exist'), { code: "42P01", name: "PostgresError" });
      const res = await util.attempt(async () => {
        throw new DrizzleQueryError("select * from yok where note = $1", ["Kapıda ödeme\nAdres: Moda Cad. 12 D:4\nKart son 4: 4421", "ayse@ornek.com"], cause);
      });
      assert.deepEqual(res, { ok: false, error: "İşlem tamamlanamadı. Lütfen tekrar deneyin." });
    } finally {
      console.error = orig;
    }
    const all = await waitRows(1);
    assert.equal(all.length, 1, "yalnız beklenmeyen hata");
    const [r] = all;
    assert.equal(r.source, "action");
    assert.equal(r.name, "Error (42P01)");
    assert.equal(r.message, 'relation "yok" does not exist\nFailed query: select * from yok where note = $1');
    for (const leak of ["Moda", "4421", "ornek.com", "Kapıda"]) assert.ok(!JSON.stringify(r).includes(leak), `kayıtta yok: ${leak}`);
    assert.equal(r.path, "/panel/kasa");
    assert.equal(r.detail, "Sunucu eylemi");
  });

  test("yönetici eylemleri: tek satır ve hepsi Çözüldü; işlem geçmişine düşer; personel yapamaz", async () => {
    for (const m of ["a", "b", "c"]) await store.recordError({ source: "client", message: m }, { db, now: NOW, gate: open() });
    const [first] = await rows();
    const one = await actions.resolveErrorEntry(first.id);
    assert.deepEqual(one, { ok: true, data: { resolved: 1 } });
    const all = await actions.resolveAllErrorEntries();
    assert.deepEqual(all, { ok: true, data: { resolved: 2 } });
    const view = await store.loadErrorLog(db);
    assert.deepEqual([view.openCount, view.resolvedCount], [0, 3]);
    assert.deepEqual((await db.select({ d: s.activityLog.detail }).from(s.activityLog)).map((x) => x.d), ["1 hata çözüldü işaretlendi", "2 hata çözüldü işaretlendi"]);
    const signedIn = who!;
    who = { ...signedIn, role: "staff" };
    const orig = console.error;
    console.error = () => {};
    try {
      assert.equal((await actions.resolveAllErrorEntries()).ok, false);
      assert.equal((await actions.resolveErrorEntry(-1)).ok, false);
    } finally {
      console.error = orig;
      who = signedIn;
    }
    // Yetkisiz çağrının hatası da (beklenmeyen) kayda düşer; arka plandaki yazım bitsin
    assert.equal((await waitRows(4)).filter((r) => r.source === "action").length, 1);
  });
});
