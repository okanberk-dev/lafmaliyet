// LafPOS'un ModPOS dönemi ucu, gerçek Postgres'te (docs/LAFPOS.md › ModPOS dönemi: `GET /api/panel/pos/modpos-gunler`):
// Marina'nın 13–21 Kasım 2026 ModPOS günleri panelin kendi kaynaklarından (kasa raporu; raporsuz günde, Ayarlar › ModPOS
// › Ay rakamına yedek açıkken kapanmış föy; öncelik ay rakamınınkiyle aynı, src/server/data/cash-reports.ts tillRows)
// ve Marina'nın Kasım ModPOS ürün listesi sözleşmenin rakamlarını kuruşu kuruşuna verir (CONTRACT §6: ciro 27.348,75,
// kart 19.744,25, nakit 7.604,50, indirim 2.066,25, ödenmez 1.500,00, 135 fiş, KDV hariç 24.862,51; liste 31 satır,
// 240 adet, 29.415,00). Tuzla'nın raporu, föyü ve listesi, geçiş günü ve sonrası, föylerin kesintisiz kısmının dışı
// gitmez; imzasız istek 401, başka şube 409, geçiş günü boşken gün yok. Sahibin derdi: LafPOS Uzaktan › Raporlar ›
// "Geçen hafta"da 16–21 Kasım görünmüyordu; kasa bu günleri buradan çekip kendisi iter (LafPOS LP-D).
//
// Test kendi geçici veritabanını açar (LAFPOS_TEST_DATABASE_URL'in sunucusunda), migration'ları uygular, sonunda siler.
//
// LAFPOS_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: LAFPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/lafpos-modpos-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { signedHeaders } from "../src/lib/karaoke/signature";
import type { ModposDay, ModposProducts } from "../src/lib/lafpos/modpos-gunler";
import { parseKasaFoyu, type KasaFoyu } from "../src/lib/modpos/foy";
import { MODPOS_FALLBACK_KEY } from "../src/lib/modpos/status";
import { addDays } from "../src/lib/reminders";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

import { LAFPOS_SUBE, MODPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.LAFPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_lafpos_modpos_${process.pid}`;
const SECRET = "test-secret-0123456789-abcdefghijklmnop";
/** Testin "şimdi"si: 23 Kasım 2026 sabahı (Marina 22 Kasım'da LafPOS'a geçti) */
const NOW = new Date("2026-11-23T10:00:00+03:00");
const SWITCH = "2026-11-22";
const ENDPOINT = "https://ladmin.laffogato.net/api/panel/pos/modpos-gunler";

/** CONTRACT §6: gün, ciro, kart, nakit, indirim, ödenmez, fiş, ModPOS Z (TL) */
const MARINA: [string, number, number, number, number, number, number, string][] = [
  ["2026-11-13", 390, 195, 195, 0, 0, 2, "Z-2026-002"],
  ["2026-11-14", 3311, 2687.25, 623.75, 249, 0, 14, "Z-2026-003"],
  ["2026-11-15", 5753, 4146.5, 1606.5, 517, 190, 27, "Z-2026-004"],
  ["2026-11-16", 2670, 2140, 530, 0, 0, 9, "Z-2026-005"],
  ["2026-11-17", 1641.25, 1171.25, 470, 153.75, 455, 12, "Z-2026-006"],
  ["2026-11-18", 2419.25, 1814.5, 604.75, 315.75, 400, 16, "Z-2026-007"],
  ["2026-11-19", 2535.75, 1472.5, 1063.25, 204.25, 200, 19, "Z-2026-008"],
  ["2026-11-20", 4008, 2914.25, 1093.75, 397, 255, 19, "Z-2026-009"],
  ["2026-11-21", 4620.5, 3203, 1417.5, 229.5, 0, 17, "Z-2026-010"],
];
/** Kasa raporu yazılmamış, kapanmış föyü olan günler (indirimsiz iki gün: föyde indirim yok) */
const FOY_DAYS = new Set(["2026-11-13", "2026-11-16"]);

const parsed = parseKasaFoyu(readFileSync(join(__dirname, "fixtures/modpos/belge-ornegi.xml"), "utf8"));
assert.ok(parsed.ok, "kitapçığın örneği okunur");
const SAMPLE = parsed.foy;

/** Tek kasalı, kapanmış föy: kart ve nakit satış, ödenmez (ciroDisi), adisyon, Z no */
function foy(day: string, o: { kart: number; nakit: number; odenmez?: number; fis: number; zNo: string }): KasaFoyu {
  const f = structuredClone(SAMPLE);
  const k = f.kasalar[0];
  const pay = (i: number, kod: string, satis: number) => ({ ...k.odemeler[i], kod, satis, cariTahsilat: 0, sistem: satis, defter: satis, fark: 0, kirilim: [] });
  f.kasaGunu = day;
  f.kasalar = [
    {
      ...k,
      zNo: o.zNo,
      durum: "KAPALI",
      satis: { ...k.satis, ciro: o.kart + o.nakit, ciroDisi: o.odenmez ?? 0, adisyonSayisi: o.fis },
      odemeler: [pay(0, "NAKIT", o.nakit), pay(1, "KREDI_KARTI", o.kart)],
    },
  ];
  return f;
}

/** Kuruş toplamı (kayan nokta artığı olmadan) */
const sumK = (xs: number[]) => xs.reduce((a, v) => a + Math.round(v * 100), 0);

describe("LafPOS ModPOS dönemi ucu: veritabanında", { skip: !SERVER_URL && "LAFPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let modpos: typeof import("../src/server/lafpos/modpos-gunler");
  let store: typeof import("../src/server/modpos/store");

  const setting = async (key: string, value: unknown) => {
    await db.delete(s.settings).where(eq(s.settings.key, key));
    if (value !== undefined) await db.insert(s.settings).values({ key, value });
  };
  /** Föyü sabah işi gibi ertesi sabah 09:00'da çekilmiş (kesin) saklar */
  const saveFoy = (f: KasaFoyu, branchId: string) => store.storeFoy(db, f, new Date(`${addDays(f.kasaGunu, 1)}T09:00:00+03:00`), null, branchId);
  /** İmzalı istek (sorgu imzanın içinde) */
  const get = (query: string, o: { signed?: boolean; secret?: string | null } = {}) => {
    const url = new URL(`${ENDPOINT}${query}`);
    const h = signedHeaders(SECRET, "GET", url, "", NOW.getTime());
    return modpos.serveModposDays({
      secret: o.secret === undefined ? SECRET : o.secret,
      url,
      timestamp: h["x-laf-timestamp"],
      signature: o.signed === false ? null : h["x-laf-signature"],
      now: NOW,
    });
  };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "lafpos-modpos-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await seedBranches(db);
    modpos = await import("../src/server/lafpos/modpos-gunler");
    store = await import("../src/server/modpos/store");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE modpos_cash_sheets, cash_reports, sales_lines, months, integration_state RESTART IDENTITY CASCADE`);
    await db.execute(sql`DELETE FROM products`);
    await db.execute(sql`DELETE FROM categories`);
    await setting("lafposGecisGunu", SWITCH);
    await setting(MODPOS_FALLBACK_KEY, true);

    // Marina: kasa raporları (Z toplamı ödenmezi içerir: ciro yine ödemelerin toplamı), raporsuz iki günde föy
    for (const [date, ciro, kart, nakit, indirim, odenmez, fis, zNo] of MARINA) {
      if (FOY_DAYS.has(date)) {
        await saveFoy(foy(date, { kart, nakit, fis, zNo }), LAFPOS_SUBE);
        continue;
      }
      await db.insert(s.cashReports).values({
        date,
        branchId: LAFPOS_SUBE,
        zNo,
        receipts: fis,
        zTotal: ciro + odenmez,
        cash: nakit,
        card: kart,
        discounts: indirim,
        offRevenue: odenmez,
        // 20 Kasım: yazarkasanın KDV dökümü ModPOS'un cirosunu tutmuyor (fiş dışı satış): %10 kuralı geçer
        okcVat: date === "2026-11-20" ? [{ rate: 10, total: 3500, vat: 318.18 }] : null,
        submittedByName: "Ayşe",
      });
    }
    // Raporu olan günün föyü (başka rakam): rapor kazanır
    await saveFoy(foy("2026-11-17", { kart: 9_999, nakit: 1, fis: 99, zNo: "FOY-17" }), LAFPOS_SUBE);
    // Föylerin kesintisiz kısmının dışı (11–12 Kasım boş): ay rakamı gibi sayılmaz
    await saveFoy(foy("2026-11-10", { kart: 7_777, nakit: 0, fis: 7, zNo: "FOY-10" }), LAFPOS_SUBE);
    // Geçiş günü ve sonrası LafPOS'un: ne föy ne rapor gider
    await saveFoy(foy(SWITCH, { kart: 5_555, nakit: 0, fis: 5, zNo: "FOY-22" }), LAFPOS_SUBE);
    await db.insert(s.cashReports).values({ date: SWITCH, branchId: LAFPOS_SUBE, zNo: "L-1", zTotal: 6_285, cash: 1_255, card: 5_030, submittedByName: "Ayşe" });
    // Tuzla (ModPOS'ta kalan şube): aynı günlerin raporu ve föyü Marina'nın cevabına girmez
    for (const [date] of MARINA) {
      await db.insert(s.cashReports).values({ date, branchId: MODPOS_SUBE, zNo: "TUZLA", receipts: 50, zTotal: 10_000, cash: 10_000, discounts: 100, submittedByName: "Ayşe" });
    }
    await saveFoy(foy("2026-11-12", { kart: 3_333, nakit: 0, fis: 3, zNo: "TUZLA-FOY" }), MODPOS_SUBE);

    // Ürünler: üç satır panelin ürününe bağlı (ad ve boy oradan), gerisi ModPOS adıyla
    const [cat] = await db.insert(s.categories).values({ name: "Kahveler", sortOrder: 1 }).returning();
    const product = async (name: string, size: "M" | "L" | "Tek") => (await db.insert(s.products).values({ categoryId: cat.id, name, size, price: 200 }).returning({ id: s.products.id }))[0].id;
    const linked = [await product("Latte", "M"), await product("Latte", "L"), await product("Tiramisu", "Tek")];
    // Marina'nın Kasım listesi: 31 satır, 240 adet, 29.415,00 (13–21 Kasım, indirim öncesi); kapsam 21 Kasım
    await db.insert(s.months).values([
      { month: "2026-11", branchId: LAFPOS_SUBE },
      { month: "2026-11", branchId: MODPOS_SUBE },
    ]);
    await db.insert(s.salesLines).values(
      Array.from({ length: 31 }, (_, i) => ({
        month: "2026-11",
        branchId: LAFPOS_SUBE,
        posName: `ÜRÜN ${String(i + 1).padStart(2, "0")}`,
        qty: i < 23 ? 8 : 7,
        revenue: i < 30 ? 950 : 915,
        productId: linked[i] ?? null,
        sortOrder: i + 1,
      })),
    );
    await db.insert(s.salesLines).values({ month: "2026-11", branchId: MODPOS_SUBE, posName: "TUZLA LATTE", qty: 500, revenue: 100_000, sortOrder: 1 });
    await db.insert(s.integrationState).values({ key: "sales.coverage", value: { "2026-11": "2026-11-21" } });
  });

  test("Marina 13–21 Kasım: günler kasa raporundan, raporsuz günde föyden; toplamlar ve KDV sözleşmenin rakamları; ürün listesi bloğu", async () => {
    const r = await get("?sube=marina");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(Object.keys(r.body), ["version", "now", "sube", "switchDay", "days", "urunler"]);
    assert.equal(r.body.version, 1);
    assert.equal(r.body.now, NOW.toISOString());
    assert.equal(r.body.sube, "marina");
    assert.equal(r.body.switchDay, SWITCH);
    const days = r.body.days as ModposDay[];
    assert.deepEqual(
      days.map((d) => d.date),
      MARINA.map((m) => m[0]),
      "yalnız 13–21 Kasım: 10 Kasım föyü kesintisiz kısmın dışında, 22 Kasım LafPOS'un",
    );
    for (const [i, [date, ciro, kart, nakit, indirim, odenmez, fis, zNo]] of MARINA.entries()) {
      const d = days[i];
      assert.deepEqual(
        { ciro: d.ciro, kart: d.kart, nakit: d.nakit, yemek: d.yemek, online: d.online, diger: d.diger, indirim: d.indirim, odenmez: d.odenmez, ikram: d.ikram, fis: d.fis, zNo: d.zNo },
        { ciro, kart, nakit, yemek: 0, online: 0, diger: 0, indirim, odenmez, ikram: 0, fis, zNo },
        date,
      );
      assert.equal(d.kdv.length, 1, `${date}: tek KDV satırı`);
      assert.equal(d.kdv[0].rate, 10, date);
      assert.equal(Math.round(d.kdv[0].base * 100), Math.round((Math.round(ciro * 100) * 100) / 110), `${date}: matrah round(ciro × 100 / 110)`);
    }
    // CONTRACT §6 toplamları (kuruş)
    assert.equal(sumK(days.map((d) => d.ciro)), 2_734_875, "ciro 27.348,75");
    assert.equal(sumK(days.map((d) => d.kart)), 1_974_425, "kart 19.744,25");
    assert.equal(sumK(days.map((d) => d.nakit)), 760_450, "nakit 7.604,50");
    assert.equal(sumK(days.map((d) => d.yemek)), 0, "yemek kartı 0");
    assert.equal(sumK(days.map((d) => d.indirim)), 206_625, "indirim 2.066,25");
    assert.equal(sumK(days.map((d) => d.odenmez + d.ikram)), 150_000, "ödenmez 1.500,00");
    assert.equal(
      days.reduce((a, d) => a + d.fis, 0),
      135,
      "135 fiş",
    );
    assert.equal(sumK(days.flatMap((d) => d.kdv.map((k) => k.base))), 2_486_251, "KDV hariç 24.862,51");
    assert.equal(sumK(days.flatMap((d) => d.kdv.map((k) => k.vat))), 248_624, "KDV 2.486,24");

    const p = r.body.urunler as ModposProducts;
    assert.ok(p, "ürün listesi var");
    assert.deepEqual([p.from, p.to], ["2026-11-13", "2026-11-21"]);
    assert.equal(p.rows.length, 31, "31 satır (Tuzla'nın listesi yok)");
    assert.equal(
      p.rows.reduce((a, x) => a + x.adet, 0),
      240,
      "240 adet",
    );
    assert.equal(sumK(p.rows.map((x) => x.tutar)), 2_941_500, "29.415,00 indirim öncesi");
    assert.equal(sumK(p.rows.map((x) => x.tutar)), sumK(days.map((d) => d.ciro + d.indirim)), "liste = ciro + indirim");
    const named = p.rows.filter((x) => x.ad === "Latte" || x.ad === "Tiramisu").map((x) => [x.ad, x.boy]);
    assert.deepEqual(named.sort(), [
      ["Latte", "L"],
      ["Latte", "M"],
      ["Tiramisu", null],
    ]);
    assert.ok(p.rows.some((x) => x.ad === "ÜRÜN 31" && x.boy === null && x.adet === 7 && x.tutar === 915), "bağlanmamış satır ModPOS adıyla");
    // Kişi adı gitmez (raporu gönderen, föydeki personel ve cari müşteri)
    const json = JSON.stringify(r.body);
    for (const name of ["Ayşe", "Mehmet", "Yıldız", "TUZLA", "FOY-"]) assert.doesNotMatch(json, new RegExp(name), name);
  });

  test("öncelik ay rakamınınki: Ay rakamına yedek kapalıyken föy günü gitmez (13 ve 16 Kasım yok); rapor her zaman", async () => {
    await setting(MODPOS_FALLBACK_KEY, undefined);
    const r = await get("?sube=marina");
    assert.equal(r.status, 200);
    const days = (r.body.days as ModposDay[]).map((d) => d.date);
    assert.deepEqual(
      days,
      MARINA.map((m) => m[0]).filter((d) => !FOY_DAYS.has(d)),
    );
    // Ürün bloğunun ilk günü artık ayın ilk raporlu günü
    assert.equal((r.body.urunler as ModposProducts).from, "2026-11-14");
  });

  test("geçiş günü boşken: gün yok, ürün listesi yok (her gün ModPOS; LafPOS'un çekeceği dönem yok)", async () => {
    await setting("lafposGecisGunu", undefined);
    const r = await get("?sube=marina");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { version: 1, now: NOW.toISOString(), sube: "marina", switchDay: null, days: [], urunler: null });
  });

  test("imzasız 401, anahtarsız 503, şubesiz 400, başka şube 409: hiçbir rakam gitmez", async () => {
    assert.deepEqual(await get("?sube=marina", { signed: false }), { status: 401, body: { error: "unauthorized" } });
    assert.deepEqual(await get("?sube=marina", { secret: null }), { status: 503, body: { error: "not_configured" } });
    assert.deepEqual(await get(""), { status: 400, body: { error: "invalid", field: "sube" } });
    assert.deepEqual(await get("?sube=tuzla"), { status: 409, body: { error: "wrong_branch", sube: "tuzla", expected: "marina" } });
  });
});
