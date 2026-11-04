// ModPOS kasa föyünün saklanması ve çekilmesi, gerçek Postgres'te (docs/MODPOS-API.md › Saklama, Kota ve çekme sırası;
// src/server/modpos/store.ts, sync.ts): föy yeni → aynı (yalnız çekilme anı, kesinleşebilir) → değişti (sürüm artar,
// önceki özet kalır); aynı günün eşzamanlı iki yazımı danışma kilidiyle sıraya girer; okuyucular; integration_state ›
// modpos (son 10 çalışma, eşzamanlı iki not ikisini de tutar); sahte ModPOS'la sabah işi (dün + bir geçmiş gün, kota
// başlıktan), hak dolunca ve anahtar çalışmayınca durma, elle çekim, önizleme ve kurulmamış bağlantıda hiç istek yok.
//
// Test kendi geçici veritabanını açar (MODPOS_TEST_DATABASE_URL'in sunucusunda), migration'ları uygular, sonunda siler.
// Anahtar sahtedir; ağa çıkılmaz (istekler sahte fetch'e gider).
//
// MODPOS_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: MODPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/modpos-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { parseKasaFoyu, type KasaFoyu } from "../src/lib/modpos/foy";
import type { ModposRun } from "../src/lib/modpos/status";
import { sheetPrevious } from "../src/lib/modpos/z";
import { addDays } from "../src/lib/reminders";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.MODPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_modpos_${process.pid}`;
const FIX = join(__dirname, "fixtures", "modpos");
const xml = (name: string) => readFileSync(join(FIX, `${name}.xml`), "utf8");
const plain = (v: string) => v.replace(/[\u00a0\u202f]/g, " ");
/** Sahte anahtar */
const KEY = "sk_test_veritabani_0123456789abcdef0123";
const ENV = { MODPOS_API_KEY: KEY, MODPOS_SYNC_FROM: "2026-11-01" };
/** Sabah işinin "şimdi"si: 12 Kasım 08:00 (bugün 12 Kasım, dün 11 Kasım) */
const NOW = new Date("2026-11-12T08:00:00+03:00");

/** Kitapçığın örneği, istenen güne taşınmış (kasaGunu, ertesi sabah hazırlanmış); `cash` verilirse nakit ve ciro değişir */
function foyXml(day: string, o: { cash?: number; olusturulma?: string } = {}): string {
  let body = xml("belge-ornegi")
    .replace("<kasaGunu>2026-11-01</kasaGunu>", `<kasaGunu>${day}</kasaGunu>`)
    .replace("<olusturulma>2026-11-02T11:15:42+03:00</olusturulma>", `<olusturulma>${o.olusturulma ?? `${addDays(day, 1)}T07:30:00+03:00`}</olusturulma>`);
  if (o.cash !== undefined) body = body.replace("<satis>8210</satis>", `<satis>${o.cash}</satis>`).replace("<ciro>28450.5</ciro>", `<ciro>${28450.5 - 8210 + o.cash}</ciro>`);
  return body;
}
function foyOf(body: string): KasaFoyu {
  const r = parseKasaFoyu(body);
  assert.ok(r.ok, JSON.stringify(r));
  return r.foy;
}

describe("ModPOS kasa föyü: veritabanında", { skip: !SERVER_URL && "MODPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let store: typeof import("../src/server/modpos/store");
  let sync: typeof import("../src/server/modpos/sync");

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, DB_POOL_MAX: "5" });
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır: test modülleri doğrudan çalıştırır
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    store = await import("../src/server/modpos/store");
    sync = await import("../src/server/modpos/sync");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE modpos_cash_sheets, integration_state`);
  });

  const rowOf = async (day: string) => (await db.select().from(s.modposCashSheets).where(eq(s.modposCashSheets.day, day)))[0];
  const stateRow = async () => (await db.select().from(s.integrationState).where(eq(s.integrationState.key, "modpos")))[0]?.value as Record<string, unknown> | undefined;

  // ------------------------------------------------------------ storeFoy

  test("storeFoy: yeni → aynı (yalnız çekilme anı; 07:00'den sonra kesinleşir) → değişti (sürüm 2, önceki özet)", async () => {
    const t1 = new Date("2026-11-02T06:00:00+03:00");
    const first = foyOf(foyXml("2026-11-01", { olusturulma: "2026-11-02T05:59:00+03:00" }));
    assert.deepEqual(await store.storeFoy(db, first, t1), { change: "yeni", revision: 1, final: false, previous: null });
    const r1 = await rowOf("2026-11-01");
    assert.deepEqual([r1.state, r1.final, r1.revision, r1.previous, r1.fetchedAt.toISOString(), r1.changedAt.toISOString(), r1.generatedAt?.toISOString()], ["KAPALI", false, 1, null, t1.toISOString(), t1.toISOString(), "2026-11-02T02:59:00.000Z"]);
    assert.equal(r1.fingerprint, store.sheetFingerprint(first));
    assert.match(r1.fingerprint, /^[0-9a-f]{64}$/);
    assert.match(JSON.stringify(r1.sheet), /Ayşe Yılmaz[\s\S]*Mehmet Kaya[\s\S]*Yıldız Lojistik/, "kişi adları saklanır (sahibin kararı)");
    assert.equal(r1.raw, null, "ham XML verilmediyse boş");

    // Aynı içerik, başka hazırlanma anı ve kota: yalnız çekilme anı (ve kesinlik) değişir
    const t2 = new Date("2026-11-02T08:30:00+03:00");
    const same = { ...foyOf(foyXml("2026-11-01", { olusturulma: "2026-11-02T08:29:00+03:00" })), kota: { gunlukHak: 2, kullanilan: 2, kalan: 0, yenilenme: null } };
    assert.deepEqual(await store.storeFoy(db, same, t2, "<kasaFoyu>ikinci</kasaFoyu>"), { change: "ayni", revision: 1, final: true, previous: null });
    // İçerik aynıyken de son ham XML yazılır; ham XML verilmezse eskisi kalır
    assert.equal((await store.loadModposSheet(first.kasaGunu, db, { raw: true }))?.raw, "<kasaFoyu>ikinci</kasaFoyu>");
    const r2 = await rowOf("2026-11-01");
    assert.deepEqual([r2.final, r2.revision, r2.fingerprint, r2.fetchedAt.toISOString(), r2.changedAt.toISOString(), r2.generatedAt?.toISOString()], [true, 1, r1.fingerprint, t2.toISOString(), t1.toISOString(), "2026-11-02T05:29:00.000Z"]);
    assert.equal(r2.sheet.kota?.kalan, 0, "son yanıtın föyü saklanır");

    // İçerik değişti (kapanıştan sonra düzeltme): sürüm 2, önceki sürümün özeti
    const t3 = new Date("2026-11-03T08:00:00+03:00");
    const changed = foyOf(foyXml("2026-11-01", { cash: 8000, olusturulma: "2026-11-03T07:59:00+03:00" }));
    const prev = sheetPrevious(same, { fetchedAt: t2.toISOString(), generatedAt: "2026-11-02T05:29:00.000Z", revision: 1 });
    assert.deepEqual(await store.storeFoy(db, changed, t3), { change: "degisti", revision: 2, final: true, previous: prev });
    assert.equal(prev.cash, 8210);
    assert.equal(prev.zTotal, 28450.5);
    const r3 = await rowOf("2026-11-01");
    assert.deepEqual([r3.revision, r3.final, r3.changedAt.toISOString(), r3.fetchedAt.toISOString(), r3.previous], [2, true, t3.toISOString(), t3.toISOString(), prev]);
    assert.notEqual(r3.fingerprint, r1.fingerprint);
    assert.equal(r3.sheet.kasalar[0].odemeler[0].satis, 8000);

    // Kesinleşmiş gün sonraki (erken) yazımda da kesin kalır
    const early = foyOf(foyXml("2026-11-01", { cash: 7000 }));
    const r4 = await store.storeFoy(db, early, new Date("2026-11-02T05:00:00+03:00"));
    assert.deepEqual([r4.change, r4.revision, r4.final, r4.previous?.cash, r4.previous?.revision], ["degisti", 3, true, 8000, 2]);
  });

  test("storeFoy: açık gün (ACIK, kesin değil) ertesi sabah kapanmış föyle değişir (KAPALI, kesin; önceki özet ACIK)", async () => {
    const acik = foyOf(xml("acik-gun"));
    assert.deepEqual(await store.storeFoy(db, acik, new Date("2026-11-02T20:15:00+03:00")), { change: "yeni", revision: 1, final: false, previous: null });
    assert.equal((await rowOf("2026-11-02")).state, "ACIK");
    const closed: KasaFoyu = { ...acik, kasalar: acik.kasalar.map((k) => ({ ...k, durum: "KAPALI" as const, zNo: "0045", nakitKasa: { ...k.nakitKasa!, dayanak: "Z_RAPORU", sayilan: 2950, fark: 0 } })) };
    const r = await store.storeFoy(db, closed, new Date("2026-11-03T08:01:00+03:00"));
    assert.deepEqual([r.change, r.revision, r.final, r.previous?.state, r.previous?.countedCash], ["degisti", 2, true, "ACIK", null]);
    const row = await rowOf("2026-11-02");
    assert.deepEqual([row.state, row.final], ["KAPALI", true]);
    // Föysüz gün BOS
    await store.storeFoy(db, foyOf(xml("foysuz-gun")), new Date("2026-10-26T09:00:00+03:00"));
    assert.deepEqual([(await rowOf("2026-10-25")).state, (await rowOf("2026-10-25")).final], ["BOS", true]);
  });

  test("storeFoy: aynı günün eşzamanlı yazımları danışma kilidiyle sıraya girer (tek satır, çakışma hatası yok)", async () => {
    const foy = foyOf(foyXml("2026-11-05"));
    const at = new Date("2026-11-06T08:00:00+03:00");
    const five = await Promise.all(Array.from({ length: 5 }, () => store.storeFoy(db, foy, at)));
    assert.deepEqual(five.map((r) => r.change).sort(), ["ayni", "ayni", "ayni", "ayni", "yeni"]);
    assert.equal((await rowOf("2026-11-05")).revision, 1);
    // Farklı içerikler: biri yeni, öteki değişti (sürüm 2)
    const a = foyOf(foyXml("2026-11-06"));
    const b = foyOf(foyXml("2026-11-06", { cash: 9000 }));
    const two = await Promise.all([store.storeFoy(db, a, at), store.storeFoy(db, b, at)]);
    assert.deepEqual(two.map((r) => r.change).sort(), ["degisti", "yeni"]);
    assert.equal((await rowOf("2026-11-06")).revision, 2);
    assert.equal((await db.select().from(s.modposCashSheets)).length, 2);
  });

  // ------------------------------------------------------------ okuyucular

  test("loadModposSheet / loadModposSheets / loadModposIndex / recentModposSheets; bozuk satır okunmaz", async () => {
    await store.storeFoy(db, foyOf(xml("belge-ornegi")), new Date("2026-11-02T11:20:00+03:00"));
    await store.storeFoy(db, foyOf(xml("iki-kasa")), new Date("2026-11-01T08:06:00+03:00"));
    await store.storeFoy(db, foyOf(xml("foysuz-gun")), new Date("2026-10-26T09:01:00+03:00"));
    await store.storeFoy(db, foyOf(xml("acik-gun")), new Date("2026-11-02T20:16:00+03:00"));
    await db.insert(s.modposCashSheets).values({ day: "2026-10-01", sheet: { eski: true } as unknown as KasaFoyu, state: "KAPALI", fingerprint: "eski" });

    const one = await store.loadModposSheet("2026-11-01", db);
    assert.deepEqual(one, {
      day: "2026-11-01",
      foy: foyOf(xml("belge-ornegi")),
      state: "KAPALI",
      final: true,
      revision: 1,
      previous: null,
      generatedAt: "2026-11-02T08:15:42.000Z",
      fetchedAt: "2026-11-02T08:20:00.000Z",
      changedAt: "2026-11-02T08:20:00.000Z",
    });
    assert.equal(await store.loadModposSheet("2026-10-02", db), null, "yok");
    assert.equal(await store.loadModposSheet("2026-10-01", db), null, "bozuk satır");
    assert.deepEqual(
      (await store.loadModposSheets("2026-10-01", "2026-10-31", db)).map((x) => [x.day, x.state]),
      [
        ["2026-10-25", "BOS"],
        ["2026-10-31", "KAPALI"],
      ],
      "eskiden yeniye, iki uç dahil, bozuk satır atlanır",
    );
    assert.deepEqual((await store.loadModposSheets("2026-11-03", "2026-11-30", db)).length, 0);
    const index = await store.loadModposIndex(db);
    assert.deepEqual(
      [...index.entries()].sort(([a], [b]) => a.localeCompare(b)),
      [
        ["2026-10-01", { final: false, fetchedAt: index.get("2026-10-01")!.fetchedAt }],
        ["2026-10-25", { final: true, fetchedAt: "2026-10-26T06:01:00.000Z" }],
        ["2026-10-31", { final: true, fetchedAt: "2026-11-01T05:06:00.000Z" }],
        ["2026-11-01", { final: true, fetchedAt: "2026-11-02T08:20:00.000Z" }],
        ["2026-11-02", { final: false, fetchedAt: "2026-11-02T17:16:00.000Z" }],
      ],
      "planlayıcı bozuk satırı da 'var' sayar (yeniden çekilmez, üzerine yazılır)",
    );
    assert.deepEqual(
      (await store.recentModposSheets(2, db)).map((x) => x.day),
      ["2026-11-02", "2026-11-01"],
    );
    assert.deepEqual(
      (await store.recentModposSheets(10, db)).map((x) => x.day),
      ["2026-11-02", "2026-11-01", "2026-10-31", "2026-10-25"],
    );
    // Varsayılan bağlantı (getDb) da aynı veritabanı
    assert.equal((await store.loadModposSheet("2026-11-01"))?.revision, 1);
  });

  // ------------------------------------------------------------ durum

  const run = (i: number, o: Partial<ModposRun> = {}): ModposRun => ({ at: new Date(NOW.getTime() + i * 60_000).toISOString(), trigger: "cron", days: [{ day: "2026-11-11", result: "yeni" }], status: "ok", text: `çalışma ${i}`, ...o });

  test("readModposState / noteModposRun: boş durum, üst alanlar birleşir, çalışmalar başa (en çok 10), bozuk değer onarılır", async () => {
    assert.deepEqual(await store.readModposState(db), { quota: null, lastOk: null, lastError: null, runs: [], dayErrors: {}, lastCronAt: null });
    const quota = { day: "2026-11-12", hak: 2, kalan: 1, yenilenme: "2026-11-13T00:00:00+03:00", at: NOW.toISOString() };
    await store.noteModposRun(db, { quota }, run(0));
    await store.noteModposRun(db, { lastOk: { at: NOW.toISOString(), day: "2026-11-11" } }, null);
    const err = { at: NOW.toISOString(), day: "2026-11-10", kod: "BAGLANTI", text: "ModPOS'a bağlanılamadı: sonra yeniden denenecek", keyError: false };
    await store.noteModposRun(db, { lastError: err }, null);
    let st = await store.readModposState(db);
    assert.deepEqual(st, { quota, lastOk: { at: NOW.toISOString(), day: "2026-11-11" }, lastError: err, runs: [run(0)], dayErrors: {}, lastCronAt: null });
    await store.noteModposRun(db, { lastError: null }, null);
    assert.equal((await store.readModposState(db)).lastError, null);
    for (let i = 1; i <= 11; i++) await store.noteModposRun(db, {}, run(i));
    st = await store.readModposState(db);
    assert.equal(st.runs.length, 10);
    assert.deepEqual(
      st.runs.map((r) => r.text),
      Array.from({ length: 10 }, (_, i) => `çalışma ${11 - i}`),
    );
    assert.deepEqual(st.quota, quota, "çalışma notu kotayı silmez");
    // Bozuk saklanmış değer: bozuk parça atılır, not yine yazılır
    await db.execute(sql`update integration_state set value = '{"quota":"bozuk","runs":[1,2],"lastOk":{"at":1}}'::jsonb where key = 'modpos'`);
    await store.noteModposRun(db, {}, run(20));
    assert.deepEqual(await store.readModposState(db), { quota: null, lastOk: null, lastError: null, runs: [run(20)], dayErrors: {}, lastCronAt: null });
    // Anahtar durum satırında yok
    assert.doesNotMatch(JSON.stringify(await stateRow()), /sk_/);
  });

  test("noteModposRun: eşzamanlı iki not ikisini de tutar (satır kilidi); yazılamazsa ana sonucu bozmaz", async () => {
    await Promise.all([store.noteModposRun(db, {}, run(1, { trigger: "cron" })), store.noteModposRun(db, {}, run(2, { trigger: "elle" }))]);
    const st = await store.readModposState(db);
    assert.deepEqual(st.runs.map((r) => r.trigger).sort(), ["cron", "elle"]);
    await Promise.all(Array.from({ length: 6 }, (_, i) => store.noteModposRun(db, {}, run(10 + i))));
    assert.equal((await store.readModposState(db)).runs.length, 8);
    // Veritabanı hatası fırlamaz (günlüğe yazılır)
    const logged: unknown[] = [];
    const realError = console.error;
    console.error = (...a: unknown[]) => void logged.push(a);
    try {
      const broken = { transaction: async () => Promise.reject(new Error("bağlantı koptu")) } as unknown as DB;
      await store.noteModposRun(broken, {}, run(99));
    } finally {
      console.error = realError;
    }
    assert.deepEqual(logged, [["[modpos] durum yazılamadı:", "bağlantı koptu"]]);
  });

  // ------------------------------------------------------------ syncModpos (sahte ModPOS)

  /** Sahte ModPOS: istenen günü (?tarih=) kaydeder, başlığı denetler, yanıtı `answer`dan */
  function modpos(answer: (day: string, n: number) => Response | Promise<Response>) {
    const days: string[] = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(input));
      assert.equal(`${u.origin}${u.pathname}`, "https://api.gafdigi.com/api/v2/external/raporlar/kasa-foyu");
      assert.equal(new Headers(init?.headers).get("x-api-key"), KEY);
      const day = u.searchParams.get("tarih")!;
      days.push(day);
      return answer(day, days.length);
    }) as typeof fetch;
    return { impl, days };
  }
  const RENEW = "2026-11-13T00:00:00+03:00";
  const okRes = (day: string, kalan: number, o: { cash?: number; renew?: string } = {}) =>
    new Response(foyXml(day, o), { status: 200, headers: { "content-type": "application/xml; charset=utf-8", "X-Kota-Hak": "2", "X-Kota-Kalan": String(kalan), "X-Kota-Yenilenme": o.renew ?? RENEW } });
  const hataRes = (status: number, kod: string, ayrinti = "") =>
    new Response(`<?xml version="1.0" encoding="UTF-8"?><hata><kod>${kod}</kod><mesaj>servisin mesajı</mesaj>${ayrinti}</hata>`, { status, headers: { "content-type": "application/xml; charset=utf-8" } });
  const kotaRes = () => hataRes(429, "KOTA_DOLDU", `<ayrinti><gunlukHak>2</gunlukHak><yenilenme>${RENEW}</yenilenme></ayrinti>`);
  const opts = (fetchImpl: typeof fetch, o: Partial<Parameters<typeof import("../src/server/modpos/sync").syncModpos>[1]> = {}) => ({ now: NOW, deadlineAt: Date.now() + 60_000, db, fetchImpl, env: ENV, ...o });

  test("sabah işi (12 Kasım 08:00, ilk kurulum): dün ve en yeni eksik gün (evvelsi gün); kota başlıktan, ikisi de kesin; hak bitince istek yok", async () => {
    const m = modpos((day, n) => okRes(day, 2 - n));
    const r = await sync.syncModpos("cron", opts(m.impl));
    assert.deepEqual(r, {
      status: "ok",
      days: [
        { day: "2026-11-11", result: "yeni" },
        { day: "2026-11-10", result: "yeni" },
      ],
      left: 0,
    });
    assert.deepEqual(m.days, ["2026-11-11", "2026-11-10"], "önce dün, sonra en yeni eksik gün (yeniden eskiye); günde 2 hak");
    const st = await store.readModposState(db);
    // Çalışmanın saati verilen `now`: ikinci isteğin kotası ve kesinliği de 12 Kasım'a göre
    assert.deepEqual({ ...st.quota, at: undefined }, { day: "2026-11-12", hak: 2, kalan: 0, yenilenme: RENEW, at: undefined });
    assert.ok(st.quota!.at.startsWith("2026-11-12T05:00"), st.quota!.at);
    assert.equal(st.lastOk?.day, "2026-11-10");
    assert.ok(st.lastOk!.at.startsWith("2026-11-12T05:00"), st.lastOk!.at);
    assert.equal(st.lastError, null);
    // Sabah işinin çalıştığı an
    assert.equal(st.lastCronAt, NOW.toISOString());
    assert.equal(st.runs.length, 1);
    assert.deepEqual({ ...st.runs[0], at: undefined, text: plain(st.runs[0].text!) }, {
      at: undefined,
      trigger: "cron",
      days: [
        { day: "2026-11-11", result: "yeni" },
        { day: "2026-11-10", result: "yeni" },
      ],
      status: "ok",
      text: "11 Kasım alındı · 10 Kasım alındı",
    });
    assert.ok(st.runs[0].at.startsWith("2026-11-12T05:00"), st.runs[0].at);
    const index = await store.loadModposIndex(db);
    assert.deepEqual(
      [...index.entries()].map(([d, h]) => [d, h.final, h.fetchedAt.slice(0, 16)]).sort(),
      [
        ["2026-11-10", true, "2026-11-12T05:00"],
        ["2026-11-11", true, "2026-11-12T05:00"],
      ],
    );
    // Ham XML saklanır (yalnız günün görünümü okur); föyde kişi adları var (sahibin kararı); listeler ham föyü taşımaz
    const one = await store.loadModposSheet("2026-11-11", db, { raw: true });
    assert.equal(one?.raw, foyXml("2026-11-11"));
    assert.equal(one?.foy.kasalar[0].kapanis.personel, "Mehmet Kaya");
    assert.equal(one?.foy.kasalar[0].cariTahsilatlar.kalemler[0].musteri, "Yıldız Lojistik");
    assert.equal((await store.loadModposSheet("2026-11-11", db))?.raw, undefined);
    assert.ok((await store.loadModposSheets("2026-11-01", "2026-11-11", db)).every((x) => x.raw === undefined));
    assert.ok((await store.recentModposSheets(5, db)).every((x) => x.raw === undefined));
    // Aynı gün yeniden: hak 0, hiç istek gitmez, çalışma yazılmaz
    const again = await sync.syncModpos("cron", opts(m.impl, { now: new Date("2026-11-12T08:30:00+03:00") }));
    assert.deepEqual(again, { status: "kota", days: [], left: 0, error: "ModPOS'un bugünkü çekim hakkı doldu" });
    assert.equal(m.days.length, 2);
    assert.equal((await store.readModposState(db)).runs.length, 1);
    // Ertesi sabah: hak yenilendi; dün (12 Kasım) ve geçmişin sıradaki günü (9 Kasım, geriye doğru)
    const next = modpos((day, n) => okRes(day, 2 - n));
    const r2 = await sync.syncModpos("cron", opts(next.impl, { now: new Date("2026-11-13T08:00:00+03:00") }));
    assert.equal(r2.status, "ok");
    assert.deepEqual(next.days, ["2026-11-12", "2026-11-09"]);
  });

  test("başlık da föyün kotası da yoksa kalan hak elle düşülür (bir sonraki istek boşuna 429 almasın)", async () => {
    const bare = (day: string) => new Response(foyXml(day).replace(/<kota>[\s\S]*<\/kota>/, ""), { status: 200 });
    const m = modpos((day) => bare(day));
    const r = await sync.syncModpos("cron", opts(m.impl));
    assert.deepEqual([r.status, r.left, m.days], ["ok", 0, ["2026-11-11", "2026-11-10"]]);
    const q = (await store.readModposState(db)).quota!;
    assert.deepEqual([q.day, q.hak, q.kalan, q.yenilenme], ["2026-11-12", 2, 0, null]);
  });

  test("429 KOTA_DOLDU: çalışma durur, ikinci gün istenmez; kalan hak 0 ve yenilenme hatadan; aynı gün yeni istek yok", async () => {
    const m = modpos(() => kotaRes());
    const r = await sync.syncModpos("cron", opts(m.impl));
    assert.deepEqual(r, { status: "kota", days: [], left: 0, error: "ModPOS'un günlük 2 çekim hakkı doldu: hak bu gece 00:00'da yenilenir" });
    assert.deepEqual(m.days, ["2026-11-11"]);
    const st = await store.readModposState(db);
    assert.deepEqual([st.quota?.day, st.quota?.kalan, st.quota?.yenilenme, st.lastError?.kod, st.lastError?.keyError, st.runs[0].status], ["2026-11-12", 0, RENEW, "KOTA_DOLDU", false, "kota"]);
    assert.equal((await db.select().from(s.modposCashSheets)).length, 0);
    const again = await sync.syncModpos("cron", opts(m.impl, { now: new Date("2026-11-12T12:00:00+03:00") }));
    assert.equal(again.status, "kota");
    assert.equal(m.days.length, 1, "istek gitmedi");
    // Birinci gün alındı, ikincide hak doldu: kısmi
    await db.execute(sql`TRUNCATE modpos_cash_sheets, integration_state`);
    const p = modpos((day, n) => (n === 1 ? okRes(day, 1) : kotaRes()));
    const rp = await sync.syncModpos("cron", opts(p.impl));
    assert.deepEqual([rp.status, rp.days, rp.left, p.days], ["partial", [{ day: "2026-11-11", result: "yeni" }], 0, ["2026-11-11", "2026-11-10"]]);
  });

  test("anahtar hatası (401 / 403): çalışma durur, gün hata; ağ hatası da durur; günlük hata (500) yalnız o günü düşürür", async () => {
    const k = modpos(() => hataRes(401, "ANAHTAR_GECERSIZ"));
    const r = await sync.syncModpos("cron", opts(k.impl));
    assert.deepEqual(r, {
      status: "error",
      days: [{ day: "2026-11-11", result: "hata", text: "ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin", kod: "ANAHTAR_GECERSIZ" }],
      left: null,
      error: "ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin",
    });
    assert.deepEqual(k.days, ["2026-11-11"], "ikinci gün denenmedi");
    let st = await store.readModposState(db);
    assert.deepEqual([st.lastError?.kod, st.lastError?.keyError, st.lastError?.day, st.runs[0].status, st.quota], ["ANAHTAR_GECERSIZ", true, "2026-11-11", "error", null]);
    const ip = modpos(() => hataRes(403, "IP_IZINSIZ"));
    assert.equal((await sync.syncModpos("cron", opts(ip.impl))).status, "error");
    assert.equal(ip.days.length, 1);

    await db.execute(sql`TRUNCATE modpos_cash_sheets, integration_state`);
    const net = modpos(() => Promise.reject(new TypeError("fetch failed")));
    const rn = await sync.syncModpos("cron", opts(net.impl));
    assert.deepEqual([rn.status, net.days, rn.days[0]?.text], ["error", ["2026-11-11"], "ModPOS'a bağlanılamadı: sonra yeniden denenecek"]);

    // 500 (hak geri verildi) yalnız o günü düşürür; geri verilen hak sıradaki güne gider (geriye doğru 9 Kasım)
    await db.execute(sql`TRUNCATE modpos_cash_sheets, integration_state`);
    const half = modpos((day, n) => (n === 1 ? hataRes(500, "RAPOR_URETILEMEDI") : okRes(day, 3 - n)));
    const rh = await sync.syncModpos("cron", opts(half.impl));
    assert.deepEqual(rh, {
      status: "partial",
      days: [
        { day: "2026-11-11", result: "hata", text: "ModPOS föyü hazırlayamadı (hak geri verildi): sonra yeniden denenecek", kod: "RAPOR_URETILEMEDI" },
        { day: "2026-11-10", result: "yeni" },
        { day: "2026-11-09", result: "yeni" },
      ],
      left: 0,
      error: "ModPOS föyü hazırlayamadı (hak geri verildi): sonra yeniden denenecek",
    });
    assert.deepEqual(half.days, ["2026-11-11", "2026-11-10", "2026-11-09"]);
    st = await store.readModposState(db);
    assert.deepEqual([st.lastOk?.day, st.lastError?.kod, st.runs[0].status, st.runs[0].text], ["2026-11-09", "RAPOR_URETILEMEDI", "partial", "ModPOS föyü hazırlayamadı (hak geri verildi): sonra yeniden denenecek"]);
    // Ertesi sabah 11 Kasım hâlâ eksik ama alınamayan gün 2 gün bekler: önce dün, sonra geçmişin sıradaki günü (8 Kasım)
    const next = modpos((day, n) => okRes(day, 2 - n));
    await sync.syncModpos("cron", opts(next.impl, { now: new Date("2026-11-13T08:00:00+03:00") }));
    assert.deepEqual(next.days, ["2026-11-12", "2026-11-08"]);
    // Elle çekimde geri verilen hak başka güne gitmez (yalnız verilen gün)
    await db.execute(sql`TRUNCATE modpos_cash_sheets, integration_state`);
    const manual = modpos(() => hataRes(500, "RAPOR_URETILEMEDI"));
    await sync.syncModpos("elle", opts(manual.impl, { days: ["2026-11-05"] }));
    assert.deepEqual(manual.days, ["2026-11-05"]);
    // Her gün 500 dönse de çalışma en çok 2 kez yer değiştirir (döngüye girmez)
    await db.execute(sql`TRUNCATE modpos_cash_sheets, integration_state`);
    const all500 = modpos(() => hataRes(500, "RAPOR_URETILEMEDI"));
    await sync.syncModpos("cron", opts(all500.impl));
    assert.deepEqual(all500.days, ["2026-11-11", "2026-11-10", "2026-11-09", "2026-11-08"]);
    assert.equal((await store.readModposState(db)).dayErrors["2026-11-11"]?.count, 1);
  });

  test("elle çekim: yalnız verilen gün; aynı içerik 'değişmedi', farklı içerik yeni sürüm; ileri tarih ve hak 0'da istek yok", async () => {
    const m = modpos((day, n) => okRes(day, 2 - n));
    const r = await sync.syncModpos("elle", opts(m.impl, { days: ["2026-11-05"] }));
    assert.deepEqual([r.status, r.days, r.left, m.days], ["ok", [{ day: "2026-11-05", result: "yeni" }], 1, ["2026-11-05"]]);
    let st = await store.readModposState(db);
    assert.deepEqual([st.runs[0].trigger, plain(st.runs[0].text!)], ["elle", "5 Kasım alındı"]);
    // Aynı gün, aynı içerik
    const r2 = await sync.syncModpos("elle", opts(modpos((day) => okRes(day, 0)).impl, { days: ["2026-11-05"], now: new Date("2026-11-12T09:00:00+03:00") }));
    assert.deepEqual(r2.days, [{ day: "2026-11-05", result: "ayni" }]);
    st = await store.readModposState(db);
    assert.equal(plain(st.runs[0].text!), "5 Kasım değişmedi");
    // Hak 0: istek gitmez
    const none = modpos(() => assert.fail("istek gitmemeli"));
    const r3 = await sync.syncModpos("elle", opts(none.impl, { days: ["2026-11-06"], now: new Date("2026-11-12T10:00:00+03:00") }));
    assert.deepEqual(r3, { status: "kota", days: [], left: 0, error: "ModPOS'un bugünkü çekim hakkı doldu" });
    // Ertesi gün: içerik değişti → sürüm 2
    const r4 = await sync.syncModpos("elle", opts(modpos((day) => okRes(day, 1, { cash: 8000, renew: "2026-11-14T00:00:00+03:00" })).impl, { days: ["2026-11-05"], now: new Date("2026-11-13T09:00:00+03:00") }));
    assert.deepEqual(r4.days, [{ day: "2026-11-05", result: "degisti", revision: 2 }]);
    assert.equal(plain((await store.readModposState(db)).runs[0].text!), "5 Kasım değişti");
    // İleri tarih süzülür: istek yok
    const r5 = await sync.syncModpos("elle", opts(none.impl, { days: ["2026-11-14"], now: new Date("2026-11-13T09:30:00+03:00") }));
    assert.deepEqual(r5, { status: "nothing", days: [], left: 1 });
    // Bugün istenebilir (açık gün, kesin değil)
    const today = modpos(() => new Response(xml("acik-gun").replace(/2026-11-02/g, "2026-11-13"), { status: 200, headers: { "X-Kota-Hak": "2", "X-Kota-Kalan": "0" } }));
    const r6 = await sync.syncModpos("elle", opts(today.impl, { days: ["2026-11-13"], now: new Date("2026-11-13T20:00:00+03:00") }));
    assert.deepEqual(r6.days, [{ day: "2026-11-13", result: "yeni" }]);
    assert.deepEqual([(await rowOf("2026-11-13")).state, (await rowOf("2026-11-13")).final], ["ACIK", false]);
    assert.equal(none.days.length, 0, "hak 0'da ve ileri tarihte istek gitmedi");
  });

  test("önizleme (VERCEL_ENV=preview) ve kurulmamış bağlantı: hiç istek yok, hiçbir şey yazılmaz", async () => {
    const none = modpos(() => assert.fail("istek gitmemeli"));
    assert.deepEqual(await sync.syncModpos("cron", opts(none.impl, { env: { ...ENV, VERCEL_ENV: "preview" } })), { status: "preview", days: [], left: null });
    assert.deepEqual(await sync.syncModpos("elle", opts(none.impl, { env: { ...ENV, VERCEL_ENV: "preview" }, days: ["2026-11-11"] })), { status: "preview", days: [], left: null });
    assert.deepEqual(await sync.syncModpos("cron", opts(none.impl, { env: {} })), { status: "off", days: [], left: null });
    assert.deepEqual(await sync.syncModpos("cron", opts(none.impl, { env: { MODPOS_API_KEY: "sk_kisa" } })), { status: "off", days: [], left: null });
    assert.equal(none.days.length, 0);
    assert.equal(await stateRow(), undefined);
    assert.equal((await db.select().from(s.modposCashSheets)).length, 0);
    assert.equal(sync.canFetchModpos({ VERCEL_ENV: "production" }), true);
    assert.equal(sync.canFetchModpos({}), true);
    assert.equal(sync.canFetchModpos({ VERCEL_ENV: "preview" }), false);
  });

  test("komut satırı --kaydet: çekip yazar (kota ve 'elle' çalışma da); --dosya --kaydet dosyadaki föyü yazar", async () => {
    const { runModposFoy } = await import("../scripts/modpos-foy");
    const env = { ...ENV, DATABASE_URL: process.env.DATABASE_URL };
    const realFetch = globalThis.fetch;
    const realLog = console.log;
    const realError = console.error;
    const out: string[] = [];
    const m = modpos((day) => okRes(day, 1));
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.error = (...a: unknown[]) => void out.push(a.join(" "));
    globalThis.fetch = m.impl;
    const codes: number[] = [];
    try {
      codes.push(await runModposFoy(["2026-11-11", "--kaydet"], env, NOW));
      codes.push(await runModposFoy(["--dosya", join(FIX, "iki-kasa.xml"), "--kaydet"], { DATABASE_URL: env.DATABASE_URL }, NOW));
      codes.push(await runModposFoy(["--dosya", join(FIX, "iki-kasa.xml"), "--kaydet"], { DATABASE_URL: env.DATABASE_URL }, new Date(NOW.getTime() + 60_000)));
    } finally {
      globalThis.fetch = realFetch;
      console.log = realLog;
      console.error = realError;
    }
    const text = plain(out.join("\n"));
    assert.deepEqual(codes, [0, 0, 0], text);
    assert.deepEqual(m.days, ["2026-11-11"]);
    assert.match(text, /Hedef: localhost\/laffogato_modpos_/);
    assert.match(text, /✓ Veritabanına yazıldı: yeni föy · kalan hak 1/);
    assert.match(text, /✓ Veritabanına yazıldı: yeni föy · kesin/);
    assert.match(text, /✓ Veritabanına yazıldı: föy aynı \(yalnız çekilme anı\) · kesin/);
    assert.ok(!text.includes(KEY));
    assert.equal((await rowOf("2026-11-11")).final, true);
    assert.equal((await rowOf("2026-10-31")).revision, 1);
    const st = await store.readModposState(db);
    assert.deepEqual([st.runs.length, st.runs[0].trigger, st.quota?.kalan, st.lastOk?.day], [1, "elle", 1, "2026-11-11"]);
  });

  test("aynı anda tek çekim: kira tutuluyken ikinci çalışma 'busy' döner, istek göndermez; kira bırakılınca alınır", async () => {
    const lease = await store.takeModposLease(db);
    assert.ok(lease);
    assert.equal(await store.takeModposLease(db), null, "ikinci kira alınmaz");
    const none = modpos(() => assert.fail("istek gitmemeli"));
    const r = await sync.syncModpos("cron", opts(none.impl));
    assert.equal(r.status, "busy");
    assert.equal(none.days.length, 0);
    await store.releaseModposLease(db, lease!);
    const m = modpos((day, n) => okRes(day, 2 - n));
    assert.equal((await sync.syncModpos("cron", opts(m.impl))).status, "ok");
    // Çalışma kirayı bıraktı; süresi geçmiş kira da alınır
    const again = await store.takeModposLease(db);
    assert.ok(again);
    assert.ok(await store.takeModposLease(db, new Date(Date.now() + store.MODPOS_LEASE_MS + 1_000)), "süresi geçen kira düşer");
  });

  test("alınamayan gün kaydı: 2xx bozuk yanıtta çalışma durur (ikinci hak harcanmaz), gün sayılır; alınınca silinir", async () => {
    const bad = modpos(() => new Response(foyXml("2026-11-11").replace("<ciro>", "<ciro>x"), { status: 200, headers: { "X-Kota-Hak": "2", "X-Kota-Kalan": "1", "X-Kota-Yenilenme": RENEW } }));
    const r = await sync.syncModpos("cron", opts(bad.impl));
    assert.equal(r.status, "error");
    assert.deepEqual(bad.days, ["2026-11-11"], "ikinci gün istenmedi");
    let st = await store.readModposState(db);
    assert.deepEqual(Object.keys(st.dayErrors), ["2026-11-11"]);
    assert.equal(st.dayErrors["2026-11-11"].count, 1);
    assert.equal(st.dayErrors["2026-11-11"].kod, "BOZUK");
    // Ertesi gün alınınca silinir
    const ok = modpos((day, n) => okRes(day, 2 - n));
    await sync.syncModpos("elle", opts(ok.impl, { days: ["2026-11-11"], now: new Date("2026-11-13T09:00:00+03:00") }));
    st = await store.readModposState(db);
    assert.deepEqual(st.dayErrors, {});
  });

  test("süre dolmak üzereyse (5 sn'den az) yeni istek başlamaz; hiçbir istek başlamadıysa 'çekilecek gün yok' değil süre doldu", async () => {
    const none = modpos(() => assert.fail("istek gitmemeli"));
    const r = await sync.syncModpos("cron", opts(none.impl, { deadlineAt: Date.now() + 3_000 }));
    assert.deepEqual([r.status, r.days, none.days], ["error", [], []]);
    assert.match(r.error ?? "", /süre doldu/);
    const st = await store.readModposState(db);
    assert.equal(st.lastError?.kod, "SURE_DOLDU");
    assert.equal(st.runs[0]?.status, "error");
  });

  test("anahtar yoksa veritabanına da gidilmez: eski kota 0 olsa da 'hak doldu' değil kurulmadı", async () => {
    await store.noteModposRun(db, { quota: { day: "2026-11-12", hak: 2, kalan: 0, yenilenme: RENEW, at: NOW.toISOString() } }, null);
    const none = modpos(() => assert.fail("istek gitmemeli"));
    assert.deepEqual(await sync.syncModpos("cron", opts(none.impl, { env: {} })), { status: "off", days: [], left: null });
    assert.deepEqual(await sync.syncModpos("elle", opts(none.impl, { env: {}, days: ["2026-11-11"] })), { status: "off", days: [], left: null });
  });

  test("elle çekim: aynı gün iki kez verilse de tek istek (iki hak harcanmaz)", async () => {
    const m = modpos((day, n) => okRes(day, 2 - n));
    const r = await sync.syncModpos("elle", opts(m.impl, { days: ["2026-11-11", "2026-11-11"] }));
    assert.deepEqual(m.days, ["2026-11-11"]);
    assert.deepEqual(r.days.map((d) => d.day), ["2026-11-11"]);
  });

  test("sabah işi çalıştığı anı yazar (elle çekim yazmaz); çalışmadığı sabahın günü eski günlerin önünde", async () => {
    const m = modpos((day, n) => okRes(day, 2 - n));
    await sync.syncModpos("elle", opts(m.impl, { days: ["2026-11-05"], now: new Date("2026-11-06T10:00:00+03:00") }));
    assert.equal((await store.readModposState(db)).lastCronAt, null);
    await sync.syncModpos("cron", opts(m.impl));
    assert.equal((await store.readModposState(db)).lastCronAt, NOW.toISOString());
    // 13 Kasım sabahı iş çalışmadı; 14 Kasım: dün (13) ve kaçan gün (12), eski günlerden önce
    const next = modpos((day, n) => okRes(day, 2 - n));
    await sync.syncModpos("cron", opts(next.impl, { now: new Date("2026-11-14T08:00:00+03:00") }));
    assert.deepEqual(next.days, ["2026-11-13", "2026-11-12"]);
  });
});
