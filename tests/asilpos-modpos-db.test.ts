// AsilPOS'un ModPOS dönemi ucu, gerçek Postgres'te (docs/ASILPOS.md › ModPOS dönemi: `GET /api/panel/pos/modpos-gunler`):
// Marina'nın 13–21 Kasım 2026 ModPOS günleri panelin kendi kaynaklarından (günün kasa raporu, raporsuz günde kapanmış
// ModPOS föyü; föy günü Ayarlar › ModPOS › Ay rakamına yedek'ten bağımsız gider, CONTRACT §9) ve Marina'nın Kasım ModPOS
// ürün listesi sözleşmenin rakamlarını kuruşu kuruşuna verir (CONTRACT §6: ciro 27.348,75, kart 19.744,25, nakit
// 7.604,50, indirim 2.066,25, ödenmez 1.500,00, 135 fiş, KDV hariç 24.862,51; liste 31 satır, 240 adet, 29.415,00).
// Her gün kaynağını söyler (`kaynak`); föy gününde indirim bilinmez (null). Tuzla'nın raporu, föyü ve listesi, açık föy,
// geçiş günü ve sonrası (Marina ModPOS'a dönmez) gitmez; panelin ay kuralı değişmez; imzasız istek 401, başka şube 409,
// geçiş günü boşken gün yok. Sahibin derdi: AsilPOS Uzaktan › Raporlar › "Geçen hafta"da 16–21 Kasım görünmüyordu; kasa
// bu günleri buradan çekip kendisi iter (AsilPOS LP-D).
//
// Test kendi geçici veritabanını açar (ASILPOS_TEST_DATABASE_URL'in sunucusunda), migration'ları uygular, sonunda siler.
//
// ASILPOS_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: ASILPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/asilpos-modpos-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { signedHeaders } from "../src/lib/karaoke/signature";
import type { ModposDay, ModposProducts } from "../src/lib/asilpos/modpos-gunler";
import { parseKasaFoyu, type KasaFoyu } from "../src/lib/modpos/foy";
import { MODPOS_FALLBACK_KEY } from "../src/lib/modpos/status";
import { addDays } from "../src/lib/reminders";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

import { ASILPOS_SUBE, MODPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.ASILPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_asilpos_modpos_${process.pid}`;
const SECRET = "test-secret-0123456789-abcdefghijklmnop";
/** Testin "şimdi"si: 23 Kasım 2026 sabahı (Marina 22 Kasım'da AsilPOS'a geçti) */
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

describe("AsilPOS ModPOS dönemi ucu: veritabanında", { skip: !SERVER_URL && "ASILPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let modpos: typeof import("../src/server/asilpos/modpos-gunler");
  let store: typeof import("../src/server/modpos/store");
  let cash: typeof import("../src/server/data/cash-reports");
  let withBranchScope: typeof import("../src/server/branch-scope").withBranchScope;
  let sales: typeof import("../src/server/actions/sales");

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
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "asilpos-modpos-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    modpos = await import("../src/server/asilpos/modpos-gunler");
    store = await import("../src/server/modpos/store");
    cash = await import("../src/server/data/cash-reports");
    withBranchScope = (await import("../src/server/branch-scope")).withBranchScope;
    // Satışlar'ın içe aktarması (kapsam kaydı) yönetici oturumuyla
    const [u] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    stub(require.resolve("../src/server/auth/dal"), { requireAdmin: async () => ({ ...u, role: "admin" }), requireUser: async () => ({ ...u, role: "admin" }) });
    sales = await import("../src/server/actions/sales");
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
    await setting("asilposGecisGunu", SWITCH);
    await setting(MODPOS_FALLBACK_KEY, true);

    // Marina: kasa raporları (Z toplamı ödenmezi içerir: ciro yine ödemelerin toplamı), raporsuz iki günde föy
    for (const [date, ciro, kart, nakit, indirim, odenmez, fis, zNo] of MARINA) {
      if (FOY_DAYS.has(date)) {
        await saveFoy(foy(date, { kart, nakit, fis, zNo }), ASILPOS_SUBE);
        continue;
      }
      await db.insert(s.cashReports).values({
        date,
        branchId: ASILPOS_SUBE,
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
    await saveFoy(foy("2026-11-17", { kart: 9_999, nakit: 1, fis: 99, zNo: "FOY-17" }), ASILPOS_SUBE);
    // Geçiş günü ve sonrası AsilPOS'un: ne föy ne rapor gider
    await saveFoy(foy(SWITCH, { kart: 5_555, nakit: 0, fis: 5, zNo: "FOY-22" }), ASILPOS_SUBE);
    await db.insert(s.cashReports).values({ date: SWITCH, branchId: ASILPOS_SUBE, zNo: "L-1", zTotal: 6_285, cash: 1_255, card: 5_030, submittedByName: "Ayşe" });
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
      { month: "2026-11", branchId: ASILPOS_SUBE },
      { month: "2026-11", branchId: MODPOS_SUBE },
    ]);
    await db.insert(s.salesLines).values(
      Array.from({ length: 31 }, (_, i) => ({
        month: "2026-11",
        branchId: ASILPOS_SUBE,
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
      "yalnız 13–21 Kasım: 22 Kasım AsilPOS'un",
    );
    for (const [i, [date, ciro, kart, nakit, indirim, odenmez, fis, zNo]] of MARINA.entries()) {
      const d = days[i];
      const fromFoy = FOY_DAYS.has(date);
      assert.deepEqual(
        { ciro: d.ciro, kart: d.kart, nakit: d.nakit, yemek: d.yemek, online: d.online, diger: d.diger, indirim: d.indirim, odenmez: d.odenmez, ikram: d.ikram, fis: d.fis, zNo: d.zNo, kaynak: d.kaynak },
        // Föy gününde indirim bilinmez (föyde yok): null, 0 değil (CONTRACT §9)
        { ciro, kart, nakit, yemek: 0, online: 0, diger: 0, indirim: fromFoy ? null : indirim, odenmez, ikram: 0, fis, zNo, kaynak: fromFoy ? "foy" : "kasa_raporu" },
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
    assert.equal(sumK(days.map((d) => d.indirim ?? 0)), 206_625, "indirim 2.066,25 (föy günlerinin indirimi bilinmiyor: §6'da ikisi de 0)");
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
    assert.equal(sumK(p.rows.map((x) => x.tutar)), sumK(days.map((d) => d.ciro + (d.indirim ?? 0))), "liste = ciro + indirim");
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

  test("föy günü Ay rakamına yedek'ten bağımsız (CONTRACT §9): yedek kapalıyken de 13 ve 16 Kasım föyden gider; kesintisiz kısmın dışındaki kapanmış föy de; açık föy, Tuzla ve geçiş günü sonrası gitmez; panelin ay kuralı değişmez", async () => {
    await setting(MODPOS_FALLBACK_KEY, undefined);
    // Kesintisiz kısmın dışında (11–12 Kasım föysüz) kapanmış föy: panelin ay rakamı saymaz, AsilPOS'a yine gider
    await saveFoy(foy("2026-11-10", { kart: 7_777, nakit: 0, odenmez: 70, fis: 7, zNo: "FOY-10" }), ASILPOS_SUBE);
    // Kasası hâlâ açık föy (tutarlar değişir): gitmez
    const open = foy("2026-11-11", { kart: 1_111, nakit: 0, fis: 1, zNo: "FOY-11" });
    open.kasalar[0].durum = "ACIK";
    await saveFoy(open, ASILPOS_SUBE);
    // Marina geçişten sonra ModPOS kullanmaz (sahip, 23 Kasım 2026): sonradan gelen föy de gitmez
    await saveFoy(foy("2026-11-23", { kart: 2_323, nakit: 0, fis: 2, zNo: "FOY-23" }), ASILPOS_SUBE);

    const r = await get("?sube=marina");
    assert.equal(r.status, 200);
    const days = r.body.days as ModposDay[];
    assert.deepEqual(
      days.map((d) => [d.date, d.kaynak]),
      [["2026-11-10", "foy"], ...MARINA.map((m) => [m[0], FOY_DAYS.has(m[0]) ? "foy" : "kasa_raporu"])],
      "föy günleri yedek kapalıyken de; 11 Kasım (açık), 12 Kasım (Tuzla), 22 ve 23 Kasım (geçişten sonra) yok",
    );
    for (const d of days.filter((x) => x.kaynak === "foy")) {
      assert.equal(d.indirim, null, `${d.date}: föyde indirim yok, bilinmiyor`);
      assert.deepEqual(
        d.kdv.map((k) => k.rate),
        [10],
        `${d.date}: föy KDV dökümü vermez, tek satır %10`,
      );
      assert.equal(sumK(d.kdv.map((k) => k.base + k.vat)), Math.round(d.ciro * 100), `${d.date}: KDV dahil = ciro`);
    }
    const ten = days[0];
    assert.deepEqual([ten.ciro, ten.kart, ten.odenmez, ten.fis, ten.zNo], [7_777, 7_777, 70, 7, "FOY-10"]);
    // Ürün bloğunun ilk günü ayın ilk ModPOS günü: 10 Kasım föyü de listenin ayında
    assert.equal((r.body.urunler as ModposProducts).from, "2026-11-10");

    // Panelin ay kuralı değişmedi (docs/ASILPOS.md › ModPOS dönemi): yedek kapalıyken ay yalnız raporları sayar, açıkken
    // föyleri yalnız ilk rapora kesintisiz uzanan kısımla (10 Kasım hiç)
    const monthDays = async () => (await withBranchScope(ASILPOS_SUBE, () => cash.tillRows(db))).filter((x) => x.date < SWITCH).map((x) => x.date);
    assert.deepEqual(
      await monthDays(),
      MARINA.map((m) => m[0]).filter((d) => !FOY_DAYS.has(d)),
    );
    await setting(MODPOS_FALLBACK_KEY, true);
    assert.deepEqual(
      await monthDays(),
      MARINA.map((m) => m[0]),
    );
    // Uç ayardan bağımsız: aynı günler
    assert.deepEqual(((await get("?sube=marina")).body.days as ModposDay[]).map((d) => d.date), days.map((d) => d.date));
  });

  test("KDV: kasa raporunun yazarkasa dökümü ciroyu tutuyorsa oran oran (karaoke %20), tutmuyorsa ve föy gününde tek satır %10", async () => {
    // 21 Kasım: yazarkasa dökümü ciroyu (4.620,50) kuruşu kuruşuna tutuyor; karaoke %20
    await db
      .update(s.cashReports)
      .set({
        okcVat: [
          { rate: 10, total: 3_870.5, vat: 351.86 },
          { rate: 20, total: 750, vat: 125 },
        ],
      })
      .where(and(eq(s.cashReports.date, "2026-11-21"), eq(s.cashReports.branchId, ASILPOS_SUBE)));
    const days = (await get("?sube=marina")).body.days as ModposDay[];
    const by = new Map(days.map((d) => [d.date, d]));
    assert.deepEqual(by.get("2026-11-21")!.kdv, [
      { rate: 10, base: 3_518.64, vat: 351.86 },
      { rate: 20, base: 625, vat: 125 },
    ]);
    // 20 Kasım: döküm ciroyu tutmuyor; 13 ve 16 Kasım: föy (döküm yok): tek satır %10, %20 varsayılmaz
    const ten = (ciro: number) => {
      const k = Math.round(ciro * 100);
      const base = Math.round((k * 100) / 110);
      return [{ rate: 10, base: base / 100, vat: (k - base) / 100 }];
    };
    for (const date of ["2026-11-20", "2026-11-13", "2026-11-16"]) assert.deepEqual(by.get(date)!.kdv, ten(by.get(date)!.ciro), date);
    assert.deepEqual(
      ["2026-11-13", "2026-11-16", "2026-11-20", "2026-11-21"].map((d) => by.get(d)!.kaynak),
      ["foy", "foy", "kasa_raporu", "kasa_raporu"],
    );
  });

  test("ürün bloğunun son günü Marina'nın kendi kaydından: Tuzla'nın aynı aya sonradan kendi son günüyle yüklediği liste Marina'nın bloğunu kaydırmaz; Marina'nın listesini temizlemek kendi kaydını siler", async () => {
    // Satışlar'ın kuralı bugüne bakar: 23 Kasım (Kasım süren ay)
    mock.timers.enable({ apis: ["Date"], now: NOW });
    try {
      await db.execute(sql`TRUNCATE sales_lines, integration_state RESTART IDENTITY CASCADE`);
      const list = Array.from({ length: 31 }, (_, i) => ({ posName: `ÜRÜN ${String(i + 1).padStart(2, "0")}`, qty: i < 23 ? 8 : 7, revenue: i < 30 ? 950 : 915 }));
      const marina = await withBranchScope(ASILPOS_SUBE, () => sales.importSales({ month: "2026-11", lines: list, mode: "replace", through: "2026-11-21" }));
      assert.ok(marina.ok, JSON.stringify(marina));
      // Tuzla (ModPOS'ta kalan şube) Kasım listesini sonradan, 10 Kasım'a kadar yükler: ortak kayıt 10 Kasım olur
      const tuzla = await withBranchScope(MODPOS_SUBE, () => sales.importSales({ month: "2026-11", lines: [{ posName: "TUZLA LATTE", qty: 500, revenue: 100_000 }], mode: "replace", through: "2026-11-10" }));
      assert.ok(tuzla.ok, JSON.stringify(tuzla));
      const [shared] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "sales.coverage"));
      assert.deepEqual(shared.value, { "2026-11": "2026-11-10" }, "panelin ortak kaydı (ay kuralı) değişmedi: son yükleyenin günü");
      const p = (await get("?sube=marina")).body.urunler as ModposProducts;
      assert.deepEqual([p.from, p.to], ["2026-11-13", "2026-11-21"], "Marina'nın listesi 13–21 Kasım (Tuzla'nın 1–10'u değil)");
      assert.equal(sumK(p.rows.map((x) => x.tutar)), 2_941_500, "yalnız Marina'nın satırları");
      // Marina'nın listesi temizlenince kendi kaydı da gider; Tuzla'nınki kalır
      const cleared = await withBranchScope(ASILPOS_SUBE, () => sales.clearMonthSales("2026-11", { scope: ASILPOS_SUBE, count: list.length }));
      assert.ok(cleared.ok, JSON.stringify(cleared));
      const [own] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "sales.coverage.sube"));
      assert.deepEqual(own.value, { [ASILPOS_SUBE]: {}, [MODPOS_SUBE]: { "2026-11": "2026-11-10" } });
      assert.equal((await get("?sube=marina")).body.urunler, null, "Marina'nın listesi yok");
    } finally {
      mock.timers.reset();
    }
  });

  test("geçiş günü boşken: gün yok, ürün listesi yok (her gün ModPOS; AsilPOS'un çekeceği dönem yok)", async () => {
    await setting("asilposGecisGunu", undefined);
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
