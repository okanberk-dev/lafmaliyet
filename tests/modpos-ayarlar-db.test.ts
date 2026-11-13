// Ayarlar › ModPOS API kartı ve eylemleri, gerçek Postgres'te (docs/MODPOS-API.md › Nerede görünür, Kota ve
// çekme sırası, Ay rakamına yedek): kurulmamışken, önizlemede, ileri ya da takvimde olmayan günde, anahtar bozukken
// "Bu günü çek" hiçbir istek göndermez; alınan gün saklanır, işlem geçmişine "gün · alındı / değişmedi · kalan hak"
// düşer, kart günü Z özeti ve uyarısıyla gösterir; hak dolunca istek gitmez ve neden söylenir; bugün çekilen föy kesin
// değildir; servisin hatası (anahtar geçersiz, hak doldu) eylemin hatası olur, işlem geçmişine yazılmaz; ay rakamına
// yedek anahtarı settings › modposAyYedegi'ye yazılır (eski → yeni işlem geçmişine), personel değiştiremez.
//
// ModPOS sahte bir fetch'tir (istekler sayılır; gerçek ağa çıkılmaz). Günler testin çalıştığı güne göredir (eylem
// gerçek saati kullanır). Test kendi geçici veritabanını açar (MODPOS_TEST_DATABASE_URL'in sunucusunda), migration'ları
// uygular, sonunda siler.
//
// MODPOS_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: MODPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/modpos-ayarlar-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { dayMonthYearTR } from "../src/lib/lafpos/switch";
import { MODPOS_DAY_INVALID, MODPOS_KEY_BROKEN, MODPOS_NOT_CONFIGURED, MODPOS_PREVIEW, modposDayBadges } from "../src/lib/modpos/ayarlar";
import { finalAfter } from "../src/lib/modpos/z";
import { addDays, todayTR } from "../src/lib/reminders";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

const SERVER_URL = process.env.MODPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_modpos_ayarlar_${process.pid}`;
const KEY = "test-anahtar-0123456789-abcdef";
const plain = (s: string) => s.replace(/ /g, " ").replace(/⁠/g, "");
const FIXTURE = readFileSync(join(process.cwd(), "tests/fixtures/modpos/belge-ornegi.xml"), "utf8");
const KOTA = readFileSync(join(process.cwd(), "tests/fixtures/modpos/hata-kota.xml"), "utf8");

/** Belgenin örneği, istenen günün föyü olarak */
const foyXml = (day: string) => FIXTURE.replace("<kasaGunu>2026-11-01</kasaGunu>", `<kasaGunu>${day}</kasaGunu>`);
const quota = (kalan: number) => ({ "x-kota-hak": "2", "x-kota-kalan": String(kalan) });

describe("ModPOS Ayarlar kartı ve eylemleri: veritabanında", { skip: !SERVER_URL && "MODPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let status: typeof import("../src/server/modpos/status");
  let core: typeof import("../src/server/modpos/admin");
  let actions: typeof import("../src/server/actions/modpos");
  const users = { admin: { id: 0, name: "Yönetici", email: "modpos-yonetici@ornek.com", role: "admin" as const }, staff: { id: 0, name: "Ayşe", email: "modpos-ayse@ornek.com", role: "staff" as const } };
  let refreshes = 0;
  // Sahte ModPOS: her istek kaydedilir, sıradaki yanıt verilir (yanıt yoksa ağ hatası gibi)
  const calls: { url: string; key: string | null }[] = [];
  let replies: { status: number; body: string; headers?: Record<string, string> }[] = [];
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const today = todayTR();
  const d3 = addDays(today, -3);
  const keyEnv = () => ({ ...process.env, MODPOS_API_KEY: KEY });

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "modpos-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    for (const k of ["MODPOS_API_KEY", "MODPOS_API_URL", "MODPOS_SYNC_FROM", "VERCEL_ENV"]) delete process.env[k];
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => void refreshes++, revalidatePath: () => {}, revalidateTag: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    for (const k of ["admin", "staff"] as const) {
      const [u] = await db.insert(s.users).values({ email: users[k].email, name: users[k].name, passwordHash: "x", role: users[k].role }).returning({ id: s.users.id });
      users[k].id = u.id;
    }
    // Eylemlerin oturumu: yönetici (requireAdmin personeli zaten yönlendirir; çekirdek rolü yeniden denetler)
    stub(require.resolve("../src/server/auth/dal"), { requireAdmin: async () => users.admin, requireUser: async () => users.admin });
    status = await import("../src/server/modpos/status");
    core = await import("../src/server/modpos/admin");
    actions = await import("../src/server/actions/modpos");
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), key: new Headers(init?.headers).get("x-api-key") });
      const r = replies.shift();
      if (!r) throw new TypeError("fetch failed");
      return new Response(r.body, { status: r.status, headers: { "content-type": "application/xml", ...r.headers } });
    }) as typeof fetch;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    console.error = realError;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE modpos_cash_sheets, integration_state, activity_log RESTART IDENTITY CASCADE`);
    await db.delete(s.settings).where(eq(s.settings.key, "modposAyYedegi"));
    process.env.MODPOS_API_KEY = KEY;
    delete process.env.VERCEL_ENV;
    calls.length = 0;
    replies = [];
    refreshes = 0;
  });

  const logs = () => db.select().from(s.activityLog).orderBy(s.activityLog.id);
  const stateRow = async () => (await db.select().from(s.integrationState).where(eq(s.integrationState.key, "modpos")))[0]?.value as Record<string, unknown> | undefined;

  test("kurulmamış: kart Kurulmadı der, düğme kapalı; eylem istek göndermeden reddeder", async () => {
    delete process.env.MODPOS_API_KEY;
    const at = new Date();
    const card = await status.loadModposCard(db, at, {});
    assert.equal(card.summary.badge, "Kurulmadı");
    assert.equal(card.summary.canFetch, false);
    assert.equal(card.summary.fetchBlocked, "Anahtar tanımlı değil");
    assert.deepEqual(card.days, []);
    assert.deepEqual(card.stored, {});
    assert.equal(card.fallback, false);
    assert.equal(card.today, todayTR(at));
    // Kesinleşmiş son gün: gece yarısından 07:00'ye kadar dün henüz kesin değil, önceki gün (duvar saatine bağlı)
    assert.equal(card.defaultDay, at.getTime() >= finalAfter(addDays(todayTR(at), -1)) ? addDays(todayTR(at), -1) : addDays(todayTR(at), -2));
    assert.ok(card.input.missing > 0, "Temmuz'dan bu yana eksik günler");
    assert.deepEqual(await actions.fetchModposDay(d3), { ok: false, error: MODPOS_NOT_CONFIGURED });
    assert.equal(calls.length, 0);
    assert.equal(refreshes, 0, "istek denenmedi: kart yenilenmez");
    assert.deepEqual(await logs(), []);
  });

  test("önizleme, ileri tarih, takvimde olmayan gün, bozuk tarih, bozuk anahtar: istek gitmez", async () => {
    process.env.VERCEL_ENV = "preview";
    assert.deepEqual(await actions.fetchModposDay(d3), { ok: false, error: MODPOS_PREVIEW });
    assert.equal((await status.loadModposCard(db, new Date(), { ...keyEnv(), VERCEL_ENV: "preview" })).summary.canFetch, false);
    delete process.env.VERCEL_ENV;
    assert.deepEqual(await actions.fetchModposDay(addDays(today, 1)), { ok: false, error: MODPOS_DAY_INVALID });
    // Takvimde olmayan gün ortak tarih denetiminde düşer (zDate, denetim KP-09)
    assert.deepEqual(await actions.fetchModposDay("2026-02-30"), { ok: false, error: "Geçersiz tarih" });
    assert.deepEqual(await actions.fetchModposDay("dün"), { ok: false, error: "Geçersiz tarih" });
    process.env.MODPOS_API_KEY = "kısa";
    assert.deepEqual(await actions.fetchModposDay(d3), { ok: false, error: MODPOS_KEY_BROKEN });
    assert.equal(calls.length, 0);
    assert.deepEqual(await logs(), []);
  });

  test("Bu günü çek: gün saklanır, işlem geçmişine yazılır, kart Z özetiyle gösterir; ikinci çekim değişmedi; hak dolunca istek gitmez", async () => {
    replies = [{ status: 200, body: foyXml(d3), headers: quota(1) }];
    const res = await actions.fetchModposDay(d3);
    assert.ok(res.ok, JSON.stringify(res));
    assert.equal(plain(res.data.title), `${plain(dayMonthYearTR(d3))} ModPOS API verisi alındı`);
    assert.equal(plain(res.data.description), "Ciro 28.450,50 ₺ · 214 fiş · bugün kalan hak 1");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, new RegExp(`\\?tarih=${d3}$`));
    assert.equal(calls[0].key, KEY);
    assert.equal(refreshes, 1);
    const [log] = await logs();
    assert.equal(log.action, "ModPOS API verisi çekildi");
    assert.equal(plain(log.detail ?? ""), `${plain(dayMonthYearTR(d3))} · alındı · kalan hak 1`);
    assert.equal(log.userId, users.admin.id);
    // Saklanan föy kişi adlarıyla (sahibin kararı; yalnız yöneticiye çizilir) ve ham XML'iyle
    const [row] = await db.select().from(s.modposCashSheets).where(eq(s.modposCashSheets.day, d3));
    assert.equal(row.final, true);
    assert.match(JSON.stringify(row.sheet), /Ayşe Yılmaz[\s\S]*Mehmet Kaya[\s\S]*Yıldız Lojistik/);
    assert.match(row.raw ?? "", /^<\?xml[\s\S]*<kasaFoyu>[\s\S]*<\/kasaFoyu>/);
    const st = await stateRow();
    assert.equal((st?.runs as { trigger: string }[])[0].trigger, "elle");

    const card = await status.loadModposCard(db, new Date(), keyEnv());
    assert.equal(card.summary.badge, "Bağlı");
    assert.equal(card.summary.left, 1);
    assert.equal(card.summary.canFetch, true);
    assert.deepEqual(card.stored, { [d3]: true });
    assert.equal(card.input.stored.count, 1);
    assert.equal(card.lastRun?.trigger, "elle");
    assert.equal(card.days.length, 1);
    const [d] = card.days;
    assert.equal(d.day, d3);
    assert.equal(d.state, "KAPALI");
    assert.equal(d.z?.zTotal, 28450.5);
    assert.deepEqual(d.warnings.map((w) => w.kod), ["KASA_FARKI"]);
    assert.deepEqual(modposDayBadges(d).map((b) => b.text), ["Kapalı", "2 uyarı"]);

    // Aynı gün yeniden: içerik aynı, sürüm artmaz
    replies = [{ status: 200, body: foyXml(d3), headers: quota(0) }];
    const again = await actions.fetchModposDay(d3);
    assert.ok(again.ok);
    assert.equal(plain(again.data.title), `${plain(dayMonthYearTR(d3))} ModPOS API verisi değişmedi`);
    assert.equal(plain((await logs())[1].detail ?? ""), `${plain(dayMonthYearTR(d3))} · değişmedi · kalan hak 0`);

    // Hak doldu: istek gitmez, nedeni ve yenilenme söylenir; işlem geçmişine yazılmaz
    const full = await actions.fetchModposDay(addDays(today, -4));
    assert.deepEqual(full, { ok: false, error: "ModPOS API'nin bugünkü çekim hakkı doldu: hak bu gece 00:00'da yenilenir" });
    assert.equal(calls.length, 2);
    assert.equal((await logs()).length, 2);
    const blocked = await status.loadModposCard(db, new Date(), keyEnv());
    assert.equal(blocked.summary.canFetch, false);
    assert.equal(blocked.summary.fetchBlocked, "Bugünkü hak doldu; bu gece 00:00'da yenilenir");
  });

  test("bugün çekilen föy kesin değil: bildirim ve kartın rozeti söyler", async () => {
    replies = [{ status: 200, body: foyXml(today), headers: quota(1) }];
    const res = await actions.fetchModposDay(today);
    assert.ok(res.ok, JSON.stringify(res));
    assert.match(plain(res.data.description), /kesin değil: yarın sabah kendiliğinden yeniden çekilir/);
    const card = await status.loadModposCard(db, new Date(), keyEnv());
    assert.deepEqual(card.stored, { [today]: false });
    assert.ok(modposDayBadges(card.days[0]).some((b) => b.text === "Kesin değil"));
  });

  test("servisin hatası eylemin hatası olur: anahtar geçersiz (kart Hata), hak doldu (kart düğmeyi kapatır); işlem geçmişine yazılmaz", async () => {
    replies = [{ status: 401, body: "<hata><kod>ANAHTAR_GECERSIZ</kod><mesaj>Anahtar geçersiz</mesaj></hata>" }];
    assert.deepEqual(await actions.fetchModposDay(d3), { ok: false, error: "ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin" });
    assert.equal(refreshes, 1, "denendi: son hata kartta görünsün");
    const card = await status.loadModposCard(db, new Date(), keyEnv());
    assert.equal(card.summary.badge, "Hata");
    assert.equal(card.summary.tone, "red");
    assert.equal(card.summary.left, 2, "401 hak düşürmez");

    // Hak doldu: yenilenme yarının 00:00'ı (kitapçığın örneğindeki an geçmişte kalırdı)
    replies = [{ status: 429, body: KOTA.replace("2026-11-03T00:00:00+03:00", `${addDays(today, 1)}T00:00:00+03:00`) }];
    assert.deepEqual(await actions.fetchModposDay(d3), { ok: false, error: "ModPOS API'nin günlük 2 çekim hakkı doldu: hak bu gece 00:00'da yenilenir" });
    assert.equal(calls.length, 2);
    assert.equal((await status.loadModposCard(db, new Date(), keyEnv())).summary.canFetch, false);
    assert.deepEqual(await logs(), []);
    assert.deepEqual(await db.select().from(s.modposCashSheets), []);
  });

  test("ay rakamına yedek: açılır ve kapanır (eski → yeni işlem geçmişine), aynı değer yazılmaz; personel değiştiremez", async () => {
    const on = await actions.saveModposFallback(true);
    assert.deepEqual(on, { ok: true, data: { on: true, change: "ModPOS ay rakamına yedek: kapalı → açık" } });
    const [row] = await db.select().from(s.settings).where(eq(s.settings.key, "modposAyYedegi"));
    assert.equal(row.value, true);
    assert.equal(await status.loadModposFallback(db), true);
    assert.equal((await status.loadModposCard(db, new Date(), keyEnv())).fallback, true);
    assert.deepEqual(
      (await logs()).map((l) => [l.action, l.detail]),
      [["Ayarlar", "ModPOS ay rakamına yedek: kapalı → açık"]],
    );
    assert.equal(refreshes, 1);

    assert.deepEqual(await actions.saveModposFallback(true), { ok: true, data: { on: true, change: null } });
    assert.equal((await logs()).length, 1);
    assert.equal(refreshes, 1, "değişiklik yok: yenilenmez");

    assert.deepEqual(await actions.saveModposFallback(false), { ok: true, data: { on: false, change: "ModPOS ay rakamına yedek: açık → kapalı" } });
    assert.equal((await db.select().from(s.settings).where(eq(s.settings.key, "modposAyYedegi")))[0].value, false);
    assert.equal(await status.loadModposFallback(db), false);

    assert.deepEqual(await actions.saveModposFallback("evet" as unknown as boolean), { ok: false, error: "Geçersiz değer" });
    // Bozuk değer kapalı okunur; kapatmak onu temizler (görünür değişiklik yok)
    await db.update(s.settings).set({ value: "evet" }).where(eq(s.settings.key, "modposAyYedegi"));
    assert.equal(await status.loadModposFallback(db), false);
    assert.equal(await core.writeModposFallback(db, users.admin, false), null);
    assert.equal((await db.select().from(s.settings).where(eq(s.settings.key, "modposAyYedegi")))[0].value, false);

    await assert.rejects(core.writeModposFallback(db, users.staff, true), (e: unknown) => e instanceof UserError && e.message === core.MODPOS_ADMIN_ONLY);
    assert.equal(await status.loadModposFallback(db), false);
  });
});
