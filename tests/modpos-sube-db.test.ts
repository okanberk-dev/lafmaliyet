// ModPOS'un şube şube çekilmesi ve saklanması, gerçek Postgres'te (docs/MODPOS-API.md › Şubeler; src/lib/modpos/sube.ts,
// src/server/modpos/sync.ts, store.ts): marka anahtarının föyü kasaların şube adına göre ayrılıp her parça kendi şubesinin
// gününe yazılır; her şubenin kendi anahtarı, hakkı, durumu, kirası ve planlayıcı günleri vardır; kendi anahtarı olan
// şubenin kasası başka anahtarın föyünden alınmaz; başka şubeyle aynı anahtar kullanılmaz; bağlanamayan şube adı hiçbir
// şubeye yazılmaz; sabah işi bütün ModPOS şubelerini sırayla çeker; okuyucular şube karıştırmaz.
//
// Test kendi geçici veritabanını açar (MODPOS_TEST_DATABASE_URL'in sunucusunda), migration'ları uygular, sonunda siler.
// Anahtarlar sahtedir; ağa çıkılmaz (istekler sahte fetch'e gider).
//
// MODPOS_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: MODPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/modpos-sube-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { addDays } from "../src/lib/reminders";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.MODPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_modpos_sube_${process.pid}`;
const FIX = join(__dirname, "fixtures", "modpos");

const TUZLA_KEY = "sk_test_tuzla_0123456789abcdef0123";
const MARINA_KEY = "sk_test_marina_0123456789abcdef012";
/** 12 Kasım 08:00; elle çekilen gün 10 Kasım (kesin) */
const NOW = new Date("2026-11-12T08:00:00+03:00");
const DAY = "2026-11-10";

/** İki kasalı föy (KASA-1, KASA-2), kasaların şube adlarıyla */
function foyXml(day: string, subeler: [string, string]): string {
  let i = 0;
  return readFileSync(join(FIX, "iki-kasa.xml"), "utf8")
    .replace("<kasaGunu>2026-10-31</kasaGunu>", `<kasaGunu>${day}</kasaGunu>`)
    .replace("<olusturulma>2026-11-01T08:05:00+03:00</olusturulma>", `<olusturulma>${addDays(day, 1)}T07:30:00+03:00</olusturulma>`)
    .replace(/<sube>Örnek Şube<\/sube>/g, () => `<sube>${subeler[i++]}</sube>`);
}

/** Yalnız tek kasalı föy (KASA-1'in şubesi verilen ad; KASA-2 çıkarılır) */
function oneKasaXml(day: string, sube: string): string {
  const body = foyXml(day, [sube, "SİLİNECEK"]);
  const start = body.indexOf("<kasa>", body.indexOf("</kasa>"));
  const end = body.indexOf("</kasa>", start) + "</kasa>".length;
  return body.slice(0, start) + body.slice(end);
}

const ok = (body: string, kalan = 1) =>
  new Response(body, { status: 200, headers: { "content-type": "application/xml; charset=utf-8", "X-Kota-Hak": "2", "X-Kota-Kalan": String(kalan), "X-Kota-Yenilenme": "2026-11-13T00:00:00+03:00" } });

/** Sahte ModPOS: yanıt anahtara göre (hangi şubenin anahtarıyla istendi); istekler kaydedilir */
function modpos(byKey: Record<string, (day: string) => Response>) {
  const calls: { key: string; day: string }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const key = new Headers(init?.headers).get("x-api-key") ?? "";
    const day = new URL(String(input)).searchParams.get("tarih")!;
    calls.push({ key, day });
    const answer = byKey[key];
    assert.ok(answer, "beklenmeyen anahtar");
    return answer(day);
  }) as typeof fetch;
  return { impl, calls };
}

describe("ModPOS şube şube: veritabanında", { skip: !SERVER_URL && "MODPOS_TEST_DATABASE_URL yok" }, () => {
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
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db
      .insert(s.branches)
      .values({ id: "marina", name: "Marina", kind: "fiziksel", posSource: "modpos", sortOrder: 2 })
      .onConflictDoNothing();
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

  const rowOf = async (branchId: string, day = DAY) =>
    (await db.select().from(s.modposCashSheets).where(and(eq(s.modposCashSheets.day, day), eq(s.modposCashSheets.branchId, branchId))))[0];
  const kasalar = async (branchId: string, day = DAY) => ((await rowOf(branchId, day))?.sheet.kasalar ?? null)?.map((k) => k.kasaAdi) ?? null;
  const opts = (fetchImpl: typeof fetch, env: Record<string, string>, o: Partial<Parameters<typeof import("../src/server/modpos/sync").syncModpos>[1]> = {}) => ({
    now: NOW,
    deadlineAt: Date.now() + 60_000,
    db,
    fetchImpl,
    env: { MODPOS_SYNC_FROM: "2026-11-01", ...env },
    ...o,
  });

  test("marka anahtarı (yalnız Tuzla'nın anahtarı): iki şubenin kasası ayrılır, her biri kendi gününe; ham XML çekende", async () => {
    const m = modpos({ [TUZLA_KEY]: (d) => ok(foyXml(d, ["LAF FOGATO TUZLA", "LAF FOGATO MARINA"])) });
    const r = await sync.syncModpos("elle", opts(m.impl, { MODPOS_API_KEY: TUZLA_KEY }, { days: [DAY] }));
    assert.equal(r.status, "ok");
    assert.deepEqual(m.calls, [{ key: TUZLA_KEY, day: DAY }], "tek istek, Tuzla'nın anahtarı");
    assert.deepEqual(await kasalar("tuzla"), ["KASA-1"]);
    assert.deepEqual(await kasalar("marina"), ["KASA-2"], "Marina'nın kasası Tuzla'nın gününe girmedi");
    assert.ok((await rowOf("tuzla"))!.raw?.includes("<kasaFoyu>"));
    assert.equal((await rowOf("marina"))!.raw, null, "ham föy yalnız çekende");
    // Okuyucular şubeyle: tek gün hep tek şubenin, liste her föyü şubesiyle
    assert.deepEqual((await store.loadModposSheet(DAY, db, { branchId: "marina" }))?.foy.kasalar.map((k) => k.kasaAdi), ["KASA-2"]);
    assert.deepEqual((await store.loadModposSheet(DAY, db))?.branchId, "tuzla", "istek dışında (Tümü) Tuzla");
    assert.deepEqual(
      (await store.loadModposSheets(DAY, DAY, db)).map((x) => [x.branchId, x.foy.kasalar.length]),
      [
        ["marina", 1],
        ["tuzla", 1],
      ],
    );
    assert.deepEqual((await store.loadModposSheets(DAY, DAY, db, { branchId: "marina" })).map((x) => x.branchId), ["marina"]);
    // Planlayıcının günleri şube başına; durum yalnız çekenin
    assert.deepEqual([...(await store.loadModposIndex(db, "tuzla")).keys()], [DAY]);
    assert.deepEqual([...(await store.loadModposIndex(db, "marina")).keys()], [DAY]);
    assert.equal((await store.readModposState(db, "tuzla")).runs.length, 1);
    assert.equal((await store.readModposState(db, "marina")).runs.length, 0);
    // Aynı gün yeniden çekilince ikisi de "aynı" (ayrım her seferinde aynı)
    await sync.syncModpos("elle", opts(m.impl, { MODPOS_API_KEY: TUZLA_KEY }, { days: [DAY], now: new Date("2026-11-12T09:00:00+03:00") }));
    assert.equal((await rowOf("tuzla"))!.revision, 1);
    assert.equal((await rowOf("marina"))!.revision, 1);
  });

  test("şube başına anahtar: sabah işi iki şubeyi sırayla, her biri kendi anahtarı, hakkı ve durumuyla; marka föyündeki öteki şube atlanır", async () => {
    const m = modpos({
      // Tuzla'nın anahtarı markaya bağlı (Marina'nın kasasını da veriyor) ama Marina'nın kendi anahtarı var: alınmaz
      [TUZLA_KEY]: (d) => ok(foyXml(d, ["LAF FOGATO TUZLA", "LAF FOGATO MARINA"]), 1),
      [MARINA_KEY]: (d) => ok(oneKasaXml(d, "LAF FOGATO MARINA"), 0),
    });
    const env = { MODPOS_API_KEY: TUZLA_KEY, MODPOS_API_KEY_MARINA: MARINA_KEY };
    const r = await sync.syncModposAll("cron", opts(m.impl, env, { days: [DAY] }));
    assert.equal(r.status, "ok");
    assert.deepEqual(
      r.days.map((d) => [d.branchId, d.day, d.result]),
      [
        ["tuzla", DAY, "yeni"],
        ["marina", DAY, "yeni"],
      ],
    );
    assert.deepEqual(m.calls, [
      { key: TUZLA_KEY, day: DAY },
      { key: MARINA_KEY, day: DAY },
    ]);
    assert.deepEqual(await kasalar("tuzla"), ["KASA-1"]);
    assert.deepEqual(await kasalar("marina"), ["KASA-1"], "Marina'nın föyü kendi anahtarından (tek kasa)");
    assert.equal((await rowOf("marina"))!.revision, 1, "Tuzla'nın föyündeki Marina kasası Marina'nın gününü ezmedi");
    // Hak ve çalışma şube başına (integration_state › modpos, modpos:marina)
    const [t, mr] = [await store.readModposState(db, "tuzla"), await store.readModposState(db, "marina")];
    assert.deepEqual([t.quota?.kalan, mr.quota?.kalan], [1, 0]);
    assert.deepEqual([t.runs.length, mr.runs.length], [1, 1]);
    assert.ok(t.lastCronAt && mr.lastCronAt);
    const keys = (await db.select({ key: s.integrationState.key }).from(s.integrationState)).map((x) => x.key).sort();
    assert.deepEqual(keys, ["modpos", "modpos:marina"], "kiralar bırakıldı, durum iki anahtarda");
  });

  test("Marina'nın anahtarı yoksa Marina için istek gitmez (Tuzla'nınkine düşülmez); Marina'nın hakkı dolsa Tuzla çekilir", async () => {
    const m = modpos({ [TUZLA_KEY]: (d) => ok(oneKasaXml(d, "LAF FOGATO TUZLA")) });
    const r = await sync.syncModposAll("cron", opts(m.impl, { MODPOS_API_KEY: TUZLA_KEY }, { days: [DAY] }));
    assert.equal(r.status, "ok");
    assert.deepEqual(m.calls.map((c) => c.key), [TUZLA_KEY]);
    assert.equal(await rowOf("marina"), undefined);
    assert.equal((await store.readModposState(db, "marina")).runs.length, 0);
    // Marina'nın elle çekimi kurulmamış: istek yok
    const off = await sync.syncModpos("elle", opts(m.impl, { MODPOS_API_KEY: TUZLA_KEY }, { days: [DAY], branchId: "marina" }));
    assert.deepEqual(off, { status: "off", days: [], left: null });
    // Marina'nın hakkı dolu, Tuzla'nınki değil: Tuzla çekilir
    await store.noteModposRun(db, { quota: { day: "2026-11-12", hak: 2, kalan: 0, yenilenme: "2026-11-13T00:00:00+03:00", at: NOW.toISOString() } }, null, undefined, "marina");
    const both = modpos({ [TUZLA_KEY]: (d) => ok(oneKasaXml(d, "LAF FOGATO TUZLA")), [MARINA_KEY]: (d) => ok(oneKasaXml(d, "LAF FOGATO MARINA")) });
    const r2 = await sync.syncModposAll("elle", opts(both.impl, { MODPOS_API_KEY: TUZLA_KEY, MODPOS_API_KEY_MARINA: MARINA_KEY }, { days: ["2026-11-09"] }));
    assert.deepEqual(both.calls.map((c) => c.key), [TUZLA_KEY], "Marina'nın hakkı yok");
    assert.equal(r2.status, "ok");
  });

  test("başka şubeyle aynı anahtar kullanılmaz: Marina'ya Tuzla'nın föyü yazılmaz, sabah işi 'kısmen' der", async () => {
    const m = modpos({ [TUZLA_KEY]: (d) => ok(oneKasaXml(d, "LAF FOGATO TUZLA")) });
    const env = { MODPOS_API_KEY: TUZLA_KEY, MODPOS_API_KEY_MARINA: TUZLA_KEY };
    const r = await sync.syncModposAll("cron", opts(m.impl, env, { days: [DAY] }));
    assert.equal(r.status, "partial");
    assert.match(r.error ?? "", /^Marina: MODPOS_API_KEY_MARINA başka bir şubenin ModPOS anahtarıyla aynı/);
    assert.deepEqual(m.calls.map((c) => c.key), [TUZLA_KEY], "ortak anahtarla ikinci istek yok");
    assert.equal(await rowOf("marina"), undefined);
    assert.deepEqual(await kasalar("tuzla"), ["KASA-1"]);
  });

  test("kira şube başına: Tuzla'nın çekimi sürerken Marina çekilebilir; Tuzla'nınki 'busy'", async () => {
    const lease = await store.takeModposLease(db, new Date(), "tuzla");
    assert.ok(lease);
    const m = modpos({ [TUZLA_KEY]: (d) => ok(oneKasaXml(d, "LAF FOGATO TUZLA")), [MARINA_KEY]: (d) => ok(oneKasaXml(d, "LAF FOGATO MARINA")) });
    const env = { MODPOS_API_KEY: TUZLA_KEY, MODPOS_API_KEY_MARINA: MARINA_KEY };
    assert.equal((await sync.syncModpos("elle", opts(m.impl, env, { days: [DAY] }))).status, "busy");
    assert.equal((await sync.syncModpos("elle", opts(m.impl, env, { days: [DAY], branchId: "marina" }))).status, "ok");
    assert.deepEqual(m.calls.map((c) => c.key), [MARINA_KEY]);
    await store.releaseModposLease(db, lease!, "tuzla");
  });

  test("çok adlı föyde bağlanamayan şube adı hiçbir şubeye yazılmaz, çalışmanın metninde söylenir; eşlemeyle yazılır", async () => {
    const m = modpos({ [TUZLA_KEY]: (d) => ok(foyXml(d, ["LAF FOGATO TUZLA", "Sahil Şube"])) });
    await sync.syncModpos("elle", opts(m.impl, { MODPOS_API_KEY: TUZLA_KEY }, { days: [DAY] }));
    assert.deepEqual(await kasalar("tuzla"), ["KASA-1"], "Sahil'in kasası Tuzla'ya girmedi");
    assert.equal(await rowOf("marina"), undefined);
    const run = (await store.readModposState(db, "tuzla")).runs[0];
    assert.match(run.text ?? "", /"Sahil Şube" şubesi panelde bir şubeyle eşleşmedi, kasası hiçbir şubeye yazılmadı/);
    // Elle eşleme (MODPOS_SUBELER) ile Marina'ya
    await sync.syncModpos("elle", opts(m.impl, { MODPOS_API_KEY: TUZLA_KEY, MODPOS_SUBELER: "Sahil Şube=marina" }, { days: [DAY], now: new Date("2026-11-12T09:00:00+03:00") }));
    assert.deepEqual(await kasalar("marina"), ["KASA-2"]);
    assert.deepEqual(await kasalar("tuzla"), ["KASA-1"]);
  });

  test("tek şube adlı föy bugünkü gibi çekenin gününe (ad tanınmasa da), Marina'nın günü yazılmaz", async () => {
    const m = modpos({ [TUZLA_KEY]: (d) => ok(foyXml(d, ["Örnek Şube", "Örnek Şube"])) });
    await sync.syncModpos("elle", opts(m.impl, { MODPOS_API_KEY: TUZLA_KEY }, { days: [DAY] }));
    assert.deepEqual(await kasalar("tuzla"), ["KASA-1", "KASA-2"]);
    assert.equal(await rowOf("marina"), undefined);
    assert.notEqual((await rowOf("tuzla"))!.sheet.ozet, null, "ayrılmayan föyün özeti kalır");
  });
});
