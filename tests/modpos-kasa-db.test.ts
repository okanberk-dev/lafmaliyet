// Yöneticinin Kasa ekranının ModPOS föyü okuyucusu, gerçek Postgres'te (docs/MODPOS-API.md › Nerede görünür;
// src/server/data/modpos-day.ts): saklanan föy günün Z özetiyle okunur, föyü olmayan ModPOS günü "henüz alınmadı" olur,
// AsilPOS geçiş gününden itibaren gün AsilPOS'tur (o güne çekilmiş föy de okunmaz), ayın listesi tek sorguyla aynı sonucu
// verir ve okuyucu ModPOS'a hiçbir zaman istek göndermez (günde 2 hak).
//
// Test kendi geçici veritabanını açar (MODPOS_TEST_DATABASE_URL'in sunucusunda), migration'ları uygular, sonunda siler.
// MODPOS_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: MODPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/modpos-kasa-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { parseKasaFoyu, type KasaFoyu } from "../src/lib/modpos/foy";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

import { ASILPOS_SUBE, MODPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.MODPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_modpos_kasa_${process.pid}`;

/** Kitapçığın örnek föyü (1 Kasım 2026), istenirse başka bir güne taşınmış */
function foyOn(day: string): KasaFoyu {
  const p = parseKasaFoyu(readFileSync(join(process.cwd(), "tests/fixtures/modpos/belge-ornegi.xml"), "utf8"), "2026-11-01");
  if (!p.ok) throw new Error("örnek föy okunamadı");
  return { ...p.foy, kasaGunu: day };
}

describe("Kasa ekranının ModPOS föyü okuyucusu: veritabanında", { skip: !SERVER_URL && "MODPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let day: typeof import("../src/server/data/modpos-day");
  let store: typeof import("../src/server/modpos/store");
  const realFetch = globalThis.fetch;
  let fetches = 0;

  const setSwitch = async (d: string | null) => {
    await db.delete(s.settings).where(eq(s.settings.key, "asilposGecisGunu"));
    if (d) await db.insert(s.settings).values({ key: "asilposGecisGunu", value: d });
  };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "modpos-kasa-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    const require = createRequire(import.meta.url);
    const p = require.resolve("server-only");
    require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await seedBranches(db);
    day = await import("../src/server/data/modpos-day");
    store = await import("../src/server/modpos/store");
    // Okuyucu ağa çıkmaz: her istek sayılır ve reddedilir
    globalThis.fetch = (async () => {
      fetches++;
      throw new Error("Kasa ekranı ModPOS'a istek göndermemeli");
    }) as typeof fetch;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.delete(s.modposCashSheets);
    await setSwitch(null);
    fetches = 0;
  });

  test("ModPOS günü: föy varsa Z özetiyle, yoksa 'henüz alınmadı' (sheet ve z boş)", async () => {
    assert.deepEqual(await day.loadKasaModpos("2026-11-01", db), { modpos: true, sheet: null, z: null });
    await store.storeFoy(db, foyOn("2026-11-01"), new Date("2026-11-02T08:02:00+03:00"));
    const got = await day.loadKasaModpos("2026-11-01", db);
    assert.equal(got.modpos, true);
    assert.equal(got.sheet?.day, "2026-11-01");
    assert.equal(got.sheet?.final, true, "ertesi sabah 07:00'den sonra alınan kapalı föy kesin");
    assert.equal(got.sheet?.state, "KAPALI");
    assert.equal(got.z?.zTotal, 28_450.5);
    assert.equal(got.z?.zNo, "0312");
    // Günün görünümü föyü kişi adlarıyla ve (saklandıysa) ham XML'iyle okur
    assert.match(JSON.stringify(got.sheet), /Ayşe Yılmaz[\s\S]*Mehmet Kaya[\s\S]*Yıldız Lojistik/);
    assert.ok(got.sheet && "raw" in got.sheet, "günün görünümü ham föyü de okur");
    assert.equal(fetches, 0);
    // Anahtar kurulu mu: föysüz günün satırı yalnız kuruluyken (biçimi bozuk anahtar kurulmamış sayılır)
    assert.equal(day.modposKeySet({}), false);
    assert.equal(day.modposKeySet({ MODPOS_API_KEY: "sk_0123456789abcdef0123" }), true);
    assert.equal(day.modposKeySet({ MODPOS_API_KEY: "sk_0123 456789abcdef" }), false);
  });

  test("AsilPOS geçiş gününden itibaren gün AsilPOS: föy okunmaz; öncesi ModPOS", async () => {
    // İki şubenin de föyü var: AsilPOS'un şubesi (Marina; ModPOS'u yedek olarak çekilmeye devam eder) ve Tuzla
    for (const sube of [ASILPOS_SUBE, MODPOS_SUBE]) {
      await store.storeFoy(db, foyOn("2026-11-01"), new Date("2026-11-02T08:02:00+03:00"), null, sube);
      await store.storeFoy(db, foyOn("2026-11-05"), new Date("2026-11-06T08:02:00+03:00"), null, sube);
    }
    await setSwitch("2026-11-03");
    // AsilPOS'un şubesinin kasası: geçiş gününden itibaren AsilPOS, föy okunmaz
    assert.equal((await day.loadKasaModpos("2026-11-01", db, ASILPOS_SUBE)).sheet?.day, "2026-11-01");
    assert.deepEqual(await day.loadKasaModpos("2026-11-03", db, ASILPOS_SUBE), day.NO_MODPOS);
    assert.deepEqual(await day.loadKasaModpos("2026-11-05", db, ASILPOS_SUBE), day.NO_MODPOS, "geçişten sonraki güne çekilmiş föy okunmaz");
    const of = await day.loadKasaModposDays("2026-11-01", "2026-11-30", db, ASILPOS_SUBE);
    assert.equal(of("2026-11-01").sheet?.day, "2026-11-01");
    assert.equal(of("2026-11-01").sheet?.branchId, ASILPOS_SUBE);
    assert.deepEqual(of("2026-11-02"), { modpos: true, sheet: null, z: null });
    assert.deepEqual(of("2026-11-03"), day.NO_MODPOS);
    assert.deepEqual(of("2026-11-05"), day.NO_MODPOS);
    // Geçiş günü yalnız o kasanındır: Tuzla'nın (şube verilmezse de o) her günü ModPOS günü, föyü geçiş gününden sonra da okunur
    assert.equal((await day.loadKasaModpos("2026-11-05", db, MODPOS_SUBE)).sheet?.day, "2026-11-05");
    assert.equal((await day.loadKasaModpos("2026-11-05", db)).sheet?.branchId, MODPOS_SUBE);
    assert.deepEqual(await day.loadKasaModpos("2026-11-03", db, MODPOS_SUBE), { modpos: true, sheet: null, z: null });
    assert.equal(of("2026-11-05", MODPOS_SUBE).sheet?.day, "2026-11-05");
    assert.equal(of("2026-11-05", MODPOS_SUBE).sheet?.branchId, MODPOS_SUBE);
    // Ayın tamamı geçiş gününden sonra: AsilPOS'un şubesinde hiçbir gün ModPOS değil, Tuzla'da hepsi
    await setSwitch("2026-10-15");
    const later = await day.loadKasaModposDays("2026-11-01", "2026-11-30", db, ASILPOS_SUBE);
    assert.deepEqual(later("2026-11-01"), day.NO_MODPOS);
    assert.equal(later("2026-11-01", MODPOS_SUBE).sheet?.day, "2026-11-01");
    assert.equal(fetches, 0);
  });

  test("ayın listesi gün görünümüyle aynı sonucu verir; aralık dışı föy listede yok", async () => {
    await store.storeFoy(db, foyOn("2026-10-31"), new Date("2026-11-01T08:02:00+03:00"));
    await store.storeFoy(db, foyOn("2026-11-01"), new Date("2026-11-02T08:02:00+03:00"));
    // Gün açıkken alınan föy (kesin değil)
    const open = foyOn("2026-11-02");
    await store.storeFoy(db, { ...open, kasalar: open.kasalar.map((k) => ({ ...k, durum: "ACIK" as const })) }, new Date("2026-11-02T20:00:00+03:00"));
    const of = await day.loadKasaModposDays("2026-11-01", "2026-11-30", db);
    // Gün görünümü ham XML'i de okur (listede yok); gerisi aynı
    const noRaw = (k: Awaited<ReturnType<typeof day.loadKasaModpos>>) => {
      if (!k.sheet) return k;
      const sheet = { ...k.sheet };
      delete sheet.raw;
      return { ...k, sheet };
    };
    for (const d of ["2026-11-01", "2026-11-02", "2026-11-03"]) assert.deepEqual(of(d), noRaw(await day.loadKasaModpos(d, db)), d);
    assert.equal(of("2026-11-02").sheet?.final, false);
    assert.equal(of("2026-11-02").z?.durum, "ACIK");
    assert.equal(of("2026-10-31").sheet, null, "aralığın dışındaki gün okunmadı");
    assert.equal(fetches, 0);
  });
});
