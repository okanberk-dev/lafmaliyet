// LafPOS bağlantısı, gerçek Postgres'te (docs/LAFPOS.md): imzalı gün sonu yazılır (ürün önce sitenin kalemi ve boyuyla,
// yoksa POS eşleştirmesiyle), aynı gün aynı Z no ile yeniden gelince öncekinin yerine geçer (idempotent; aynı anda iki
// gönderim sırayla), başka Z no ile gelen gün 409 alır ve hiçbir şey yazmaz, reddedilen istek hiçbir şey yazmaz;
// loadDailyProductSales satır varken satırları, yokken null döner; Kasa raporunun okuyucusu yalnız Z'yi verir (kasa
// eşlemesi saklanan özetten); maliyet ucu yalnız siteye bağlı ürünleri, yalnız altı alanla verir.
//
// Kendi kategorisini, ürünlerini, hammaddesini ve eşleştirmelerini açar, sonunda siler. Günler 2029 Mart'ta: öteki
// veritabanı testlerinin günleriyle karışmaz.
//
// LAFPOS_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: LAFPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_lafpos npx tsx --test tests/lafpos-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { asc, eq, inArray } from "drizzle-orm";

import { signedHeaders } from "../src/lib/karaoke/signature";
import { parsePosDay } from "../src/lib/lafpos/day";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const URL_ = process.env.LAFPOS_TEST_DATABASE_URL;
const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const GUN = new URL("https://ladmin.laffogato.net/api/pos/gun");
const URUNLER = new URL("https://ladmin.laffogato.net/api/panel/pos/urunler");
/** Testin "şimdi"si: günler bundan önce (ileri gün reddedilir) */
const NOW = new Date("2029-03-20T12:00:00+03:00");
const D1 = "2029-03-01";
const D2 = "2029-03-02";
const D3 = "2029-03-03";
const D4 = "2029-03-04";
const D5 = "2029-03-05";

describe("LafPOS bağlantısı: veritabanında", { skip: !URL_ && "LAFPOS_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let ingest: typeof import("../src/server/lafpos/ingest");
  let products: typeof import("../src/server/lafpos/products");
  let daily: typeof import("../src/server/data/daily-sales");
  let kasa: typeof import("../src/server/data/lafpos-day");
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  const site = (k: string) => `lafpos-${tag}-${k}`;
  const ids = { category: 0, ingredient: 0, latteM: 0, latteL: 0, mocha: 0, cay: 0 };
  const posNames = { mocha: `LAFPOS MOCHA ${tag}`, cay: `LAFPOS ÇAY ${tag}`, karaoke: `LAFPOS KARAOKE ${tag}` };

  const push = (date: string, lines: Record<string, unknown>[], z: Record<string, unknown> = {}) => ({
    version: 1,
    source: "lafpos",
    date,
    z: {
      zNo: 128,
      receipts: 214,
      zTotal: 45210.5,
      cash: 12000,
      card: 29110.5,
      mealCard: 3100,
      online: 0,
      other: 1000,
      offRevenue: 640,
      discounts: 380,
      openingCash: 1500,
      cashOut: 450,
      countedCash: 12980,
      handedOver: 0,
      cashDiff: -70,
      ...z,
    },
    lines,
    ikram: [{ posName: "TIRAMISU", siteMenuId: null, slot: null, qty: 1, menuValue: 260, reason: "Doğum günü" }],
    payments: [{ name: "Pluxee", zField: "meal_card", channel: "pluxee", count: 7, amount: 1850 }],
  });
  const line = (posName: string, o: Record<string, unknown> = {}) => ({ posName, siteMenuId: null, slot: null, qty: 2, revenue: 400, isService: false, ...o });
  /** İmzalı gönderim (uçla aynı çekirdek) */
  const send = (body: unknown, o: { secret?: string | null; signWith?: string; now?: Date } = {}) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const now = o.now ?? NOW;
    const h = signedHeaders(o.signWith ?? SECRET, "POST", GUN, raw, now.getTime());
    return ingest.receivePosDay(db, { secret: o.secret === undefined ? SECRET : o.secret, url: GUN, body: raw, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"] }, now);
  };
  const rowsOf = (date: string) =>
    db
      .select({ posName: s.posDailySales.posName, productId: s.posDailySales.productId, qty: s.posDailySales.qty, revenue: s.posDailySales.revenue, isService: s.posDailySales.isService })
      .from(s.posDailySales)
      .where(eq(s.posDailySales.date, date))
      .orderBy(asc(s.posDailySales.posName));

  before(async () => {
    process.env.DATABASE_URL = URL_;
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL_!, 4);
    ingest = await import("../src/server/lafpos/ingest");
    products = await import("../src/server/lafpos/products");
    daily = await import("../src/server/data/daily-sales");
    kasa = await import("../src/server/data/lafpos-day");
    const [c] = await db.insert(s.categories).values({ name: `LafPOS deneme ${tag}`, sortOrder: 999 }).returning({ id: s.categories.id });
    ids.category = c.id;
    const product = async (name: string, size: "M" | "L" | "Tek", siteMenuId: string | null, siteMenuSlot: "M" | "L" | null) => {
      const [p] = await db.insert(s.products).values({ categoryId: c.id, name, size, price: 200, siteMenuId, siteMenuSlot }).returning({ id: s.products.id });
      return p.id;
    };
    ids.latteM = await product(`LafPOS Latte ${tag}`, "M", site("latte"), "M");
    ids.latteL = await product(`LafPOS Latte ${tag}`, "L", site("latte"), "L");
    ids.mocha = await product(`LafPOS Mocha ${tag}`, "Tek", null, null);
    ids.cay = await product(`LafPOS Çay ${tag}`, "Tek", site("cay"), "M");
    // Eşleştirmeler (Satışlar'ın hafızası; anahtar posMatchKey): Mocha'nın adı Mocha'ya; Çay'ın adı başka ürüne (Mocha)
    // gösterir, Çay sitenin kalemiyle bulunmalı; karaoke HİZMET
    await db.insert(s.posMappings).values([
      { posName: posNames.mocha, productId: ids.mocha, isService: false },
      { posName: posNames.cay, productId: ids.mocha, isService: false },
      { posName: posNames.karaoke, productId: null, isService: true },
    ]);
    // Latte M'nin reçetesi: 200 gr × (100 ₺ / 1000 gr) = 20 ₺ malzeme
    const [i] = await db
      .insert(s.ingredients)
      .values({ name: `LafPOS süt ${tag}`, category: "Süt", unit: "gr", packagePrice: 100, packageSize: 1000, vatRate: 0.01 })
      .returning({ id: s.ingredients.id });
    ids.ingredient = i.id;
    await db.insert(s.recipeItems).values({ productId: ids.latteM, ingredientId: i.id, qty: 200 });
  });

  after(async () => {
    if (!db) return;
    await db.delete(s.posDailySales).where(inArray(s.posDailySales.date, [D1, D2, D3, D4, D5]));
    await db.delete(s.posDayReports).where(inArray(s.posDayReports.date, [D1, D2, D3, D4, D5]));
    await db.delete(s.posMappings).where(inArray(s.posMappings.posName, Object.values(posNames)));
    await db.delete(s.recipeItems).where(eq(s.recipeItems.ingredientId, ids.ingredient));
    await db.delete(s.products).where(eq(s.products.categoryId, ids.category));
    await db.delete(s.ingredients).where(eq(s.ingredients.id, ids.ingredient));
    await db.delete(s.categories).where(eq(s.categories.id, ids.category));
    await db.$client.end();
    const { getDb } = await import("../src/server/db");
    await getDb().$client.end();
  });

  test("gün sonu yazılır: ürün önce sitenin kalemi ve boyuyla, yoksa POS eşleştirmesiyle (posMatchKey), hizmet ürünsüz", async () => {
    const r = await send(
      push(D1, [
        line("LATTE MEDIUM", { siteMenuId: site("latte"), slot: "M", qty: 42, revenue: 8190 }),
        line("LATTE LARGE", { siteMenuId: site("latte"), slot: "L" }),
        // Site kalemi eşleştirmeyi yener (eşleştirme Çay'ın adını Mocha'ya gösteriyor)
        line(posNames.cay, { siteMenuId: site("cay"), slot: "M" }),
        // Panelde bağlı olmayan kalem: POS adıyla, büyük / küçük harf farkı yok
        line(posNames.mocha.toLowerCase(), { siteMenuId: site("yok"), slot: "M" }),
        line(posNames.karaoke, { revenue: 3000, isService: false }),
        line(`YENİ ÜRÜN ${tag}`),
        line(`LAFPOS ODA ${tag}`, { isService: true }),
      ]),
    );
    assert.deepEqual(r, { status: 200, body: { ok: true, date: D1, lines: 7 } });
    const rows = new Map((await rowsOf(D1)).map((x) => [x.posName, x]));
    assert.equal(rows.get("LATTE MEDIUM")?.productId, ids.latteM);
    assert.equal(rows.get("LATTE MEDIUM")?.qty, 42);
    assert.equal(rows.get("LATTE MEDIUM")?.revenue, 8190);
    assert.equal(rows.get("LATTE LARGE")?.productId, ids.latteL);
    assert.equal(rows.get(posNames.cay)?.productId, ids.cay);
    assert.equal(rows.get(posNames.mocha.toLowerCase())?.productId, ids.mocha);
    assert.deepEqual([rows.get(posNames.karaoke)?.productId, rows.get(posNames.karaoke)?.isService], [null, true], "HİZMET eşleştirmesi");
    assert.deepEqual([rows.get(`LAFPOS ODA ${tag}`)?.productId, rows.get(`LAFPOS ODA ${tag}`)?.isService], [null, true], "LafPOS'un hizmet satırı");
    assert.deepEqual([rows.get(`YENİ ÜRÜN ${tag}`)?.productId, rows.get(`YENİ ÜRÜN ${tag}`)?.isService], [null, false]);
    const [rep] = await db.select().from(s.posDayReports).where(eq(s.posDayReports.date, D1));
    assert.equal(rep.source, "lafpos");
    assert.equal(rep.z.zTotal, 45210.5);
    assert.deepEqual(rep.payments, [{ name: "Pluxee", zField: "meal_card", channel: "pluxee", count: 7, amount: 1850 }]);
    assert.deepEqual(rep.ikram, [{ posName: "TIRAMISU", siteMenuId: null, slot: null, qty: 1, menuValue: 260, reason: "Doğum günü" }]);
    assert.equal(rep.receivedAt.getTime(), NOW.getTime());
  });

  test("aynı gün yeniden gelince öncekinin yerine geçer (idempotent); öteki günler kalır; aynı anda iki gönderim sırayla", async () => {
    const first = push(D2, [line("LATTE MEDIUM", { siteMenuId: site("latte"), slot: "M" }), line(posNames.mocha), line(`ESKİ ${tag}`)]);
    assert.equal((await send(first)).status, 200);
    assert.equal((await send(push(D3, [line("LATTE LARGE", { siteMenuId: site("latte"), slot: "L" })]))).status, 200);
    // Aynı gövde iki kez: aynı satırlar (yinelenen anahtar hatası yok)
    const before = await rowsOf(D2);
    assert.equal((await send(first)).status, 200);
    assert.deepEqual(await rowsOf(D2), before);
    // Düzeltme: satırlar ve Z bütünüyle yenisiyle değişir, geliş anı ilerler
    const later = new Date(NOW.getTime() + 60_000);
    const fixed = push(D2, [line("LATTE MEDIUM", { siteMenuId: site("latte"), slot: "M", qty: 5, revenue: 975 })], { zTotal: 975, cash: 975, card: 0 });
    assert.deepEqual(await send(fixed, { now: later }), { status: 200, body: { ok: true, date: D2, lines: 1 } });
    assert.deepEqual(await rowsOf(D2), [{ posName: "LATTE MEDIUM", productId: ids.latteM, qty: 5, revenue: 975, isService: false }]);
    const [rep] = await db.select().from(s.posDayReports).where(eq(s.posDayReports.date, D2));
    assert.equal(rep.z.zTotal, 975);
    assert.equal(rep.receivedAt.getTime(), later.getTime());
    assert.equal((await rowsOf(D3)).length, 1, "öteki gün kalır");
    // Satışsız düzeltme günün satırlarını boşaltır, özet kalır
    assert.equal((await send(push(D3, []))).status, 200);
    assert.deepEqual(await rowsOf(D3), []);
    assert.equal((await db.select().from(s.posDayReports).where(eq(s.posDayReports.date, D3))).length, 1);
    // Aynı anda iki gönderim (LafPOS'un yeniden denemesi): danışma kilidi sıraya koyar, biri bütünüyle kalır
    const a = parsePosDay(JSON.stringify(push(D3, [line(`A1 ${tag}`), line(`A2 ${tag}`)])), NOW);
    const b = parsePosDay(JSON.stringify(push(D3, [line(`B1 ${tag}`)])), NOW);
    assert.ok(a.ok && b.ok);
    await Promise.all([ingest.storePosDay(db, a.data, NOW), ingest.storePosDay(db, b.data, NOW)]);
    const names = (await rowsOf(D3)).map((x) => x.posName);
    assert.ok(JSON.stringify(names) === JSON.stringify([`A1 ${tag}`, `A2 ${tag}`]) || JSON.stringify(names) === JSON.stringify([`B1 ${tag}`]), names.join(", "));
  });

  test("ret hiçbir şey yazmaz: imza 401, bozuk gövde 400 (alanın yolu), anahtar yoksa 503, ileri gün 400", async () => {
    const body = push(D1, [line(`RET ${tag}`)], { zTotal: 1 });
    const before = await rowsOf(D1);
    assert.deepEqual(await send(body, { signWith: `${SECRET}x` }), { status: 401, body: { error: "unauthorized" } });
    assert.deepEqual(await send(body, { secret: null }), { status: 503, body: { error: "not_configured" } });
    assert.deepEqual(await send({ ...body, lines: [line(`RET ${tag}`, { qty: -1 })] }), { status: 400, body: { error: "invalid", field: "lines.0.qty" } });
    assert.deepEqual(await send("{bozuk"), { status: 400, body: { error: "invalid", field: "body" } });
    assert.deepEqual(await send({ ...body, date: "2029-03-21" }), { status: 400, body: { error: "invalid", field: "date" } });
    assert.deepEqual(await rowsOf(D1), before);
    const [rep] = await db.select({ z: s.posDayReports.z }).from(s.posDayReports).where(eq(s.posDayReports.date, D1));
    assert.equal(rep.z.zTotal, 45210.5, "özet değişmedi");
  });

  test("başka Z no ile gelen gün 409 z_conflict alır, hiçbir şey yazmaz; aynı Z no düzeltmedir; kasa eşlemesi saklanan özetten", async () => {
    // LafPOS'un yeni alanlarıyla: gün ortasında 5.000 teslim, 700 giren; LafPOS 1.500 + 12.000 + 700 − 450 − 5.000 = 8.750 bekler
    const first = push(D4, [line(`Z300 ${tag}`)], { zNo: 300, handedOver: 5000, cashIn: 700, expectedCash: 8750, countedCash: 8750, cashDiff: 0 });
    assert.deepEqual(await send(first), { status: 200, body: { ok: true, date: D4, lines: 1 } });
    const later = new Date(NOW.getTime() + 60_000);
    const other = push(D4, [line(`Z301 ${tag}`)], { zNo: 301, zTotal: 1 });
    assert.deepEqual(await send(other, { now: later }), { status: 409, body: { error: "z_conflict", date: D4, zNo: 300 } });
    // Hiçbir şey yazılmadı: satırlar, Z ve geliş anı öncekinin
    assert.deepEqual((await rowsOf(D4)).map((x) => x.posName), [`Z300 ${tag}`]);
    const [kept] = await db.select().from(s.posDayReports).where(eq(s.posDayReports.date, D4));
    assert.deepEqual([kept.z.zNo, kept.z.zTotal, kept.z.cashIn, kept.z.expectedCash], [300, 45210.5, 700, 8750]);
    assert.equal(kept.receivedAt.getTime(), NOW.getTime());
    // Kasa raporu saklanan özetten: teslim gün içinde çıkana, giren düşülür (450 + 5.000 − 700), Teslim edilen 0
    const day = await kasa.loadLafposDay(D4, db);
    assert.ok(day);
    assert.equal(day.prefill.values.cashOut?.value, 4750);
    assert.equal(day.prefill.values.handedOver?.value, 0);
    assert.deepEqual(day.prefill.checks, []);
    // Aynı Z no düzeltmedir: yerine geçer (yeni alanları olmayan eski biçimli gövde de)
    const fixed = push(D4, [line(`Z300 DÜZELTME ${tag}`)], { zNo: 300 });
    assert.deepEqual(await send(fixed, { now: later }), { status: 200, body: { ok: true, date: D4, lines: 1 } });
    assert.deepEqual((await rowsOf(D4)).map((x) => x.posName), [`Z300 DÜZELTME ${tag}`]);
    const [rep] = await db.select().from(s.posDayReports).where(eq(s.posDayReports.date, D4));
    assert.equal(rep.receivedAt.getTime(), later.getTime());
    assert.ok(!("cashIn" in rep.z), "eski biçimli gövde: alan yok");
    assert.equal((await kasa.loadLafposDay(D4, db))?.prefill.values.cashOut?.value, 450);
    // Aynı anda iki ayrı Z aynı güne: danışma kilidi sıraya koyar, biri yazılır, öteki kayıtlı Z'yi görüp hiçbir şey yazmaz
    const a = parsePosDay(JSON.stringify(push(D5, [line(`A ${tag}`)], { zNo: 400 })), NOW);
    const b = parsePosDay(JSON.stringify(push(D5, [line(`B1 ${tag}`), line(`B2 ${tag}`)], { zNo: 401 })), NOW);
    assert.ok(a.ok && b.ok);
    const results = await Promise.all([ingest.storePosDay(db, a.data, NOW), ingest.storePosDay(db, b.data, NOW)]);
    const [winner] = await db.select({ z: s.posDayReports.z }).from(s.posDayReports).where(eq(s.posDayReports.date, D5));
    assert.ok(winner.z.zNo === 400 || winner.z.zNo === 401, String(winner.z.zNo));
    assert.deepEqual(results.filter((r) => !r.ok), [{ ok: false, zNo: winner.z.zNo }]);
    assert.deepEqual((await rowsOf(D5)).map((x) => x.posName), winner.z.zNo === 400 ? [`A ${tag}`] : [`B1 ${tag}`, `B2 ${tag}`]);
  });

  test("loadDailyProductSales: aralıkta satır varsa satırlar (güne ve ada göre), yoksa null (okuyanlar aylık veriye düşer)", async () => {
    const rows = await daily.dailyProductSalesFrom(db, D1, D2);
    assert.ok(rows);
    assert.equal(rows.length, 8, "1 Mart'ın 7 satırı ve 2 Mart'ın düzeltilmiş 1 satırı");
    const ours = rows.filter((r) => r.date === D2);
    assert.deepEqual(ours, [{ date: D2, posName: "LATTE MEDIUM", productId: ids.latteM, qty: 5, revenue: 975, isService: false }]);
    assert.deepEqual(rows.map((r) => r.date), [...rows.map((r) => r.date)].sort(), "güne göre sıralı");
    for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ["date", "isService", "posName", "productId", "qty", "revenue"]);
    assert.equal(await daily.dailyProductSalesFrom(db, "2029-01-01", "2029-01-31"), null);
    assert.equal(await daily.dailyProductSalesFrom(db, D2, D1), null, "ters aralık");
    // Ağzın kendisi (okuyanların çağırdığı) aynı tabloyu okur
    assert.deepEqual(await daily.loadDailyProductSales(D2, D2), ours);
  });

  test("Kasa raporu: günün özeti yalnız Z'den (ödeme kanalı ve ikram gitmez); gün yoksa null", async () => {
    const day = await kasa.loadLafposDay(D1, db);
    assert.ok(day);
    assert.equal(day.receivedAt, NOW.toISOString());
    assert.equal(day.prefill.source, "lafpos");
    assert.deepEqual(day.prefill.values.zNo, { value: "128", confidence: "high" });
    assert.deepEqual(day.prefill.values.countedCash, { value: 12980, confidence: "high" });
    assert.doesNotMatch(JSON.stringify(day), /pluxee|Pluxee|TIRAMISU|Doğum|menuValue|channel|cashDiff/);
    assert.equal(await kasa.loadLafposDay("2029-01-15", db), null);
  });

  test("ürün maliyetleri: yalnız imzayla; yalnız siteye bağlı ürünler ve altı alan; maliyet modelden, kuruş", async () => {
    const h = signedHeaders(SECRET, "GET", URUNLER, "", NOW.getTime());
    const input = { secret: SECRET, url: URUNLER, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"], now: NOW };
    assert.deepEqual(await products.servePosProducts({ ...input, signature: null }), { status: 401, body: { error: "unauthorized" } });
    assert.deepEqual(await products.servePosProducts({ ...input, secret: null }), { status: 503, body: { error: "not_configured" } });
    const r = await products.servePosProducts(input);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body), ["version", "now", "items"]);
    assert.equal(r.body.version, 1);
    assert.equal(r.body.now, NOW.toISOString());
    const items = (r.body.items as { siteMenuId: string }[]).filter((i) => i.siteMenuId.startsWith(`lafpos-${tag}-`));
    const { loadModel } = await import("../src/server/data/dataset");
    const cost = (await loadModel()).products.find((p) => p.product.id === ids.latteM)!.cost;
    assert.ok(cost >= 20, `malzeme 20 ₺ + fire: ${cost}`);
    assert.deepEqual(items, [
      { siteMenuId: site("cay"), slot: "M", name: `LafPOS Çay ${tag}`, size: "Tek", costMinor: 0, active: true },
      { siteMenuId: site("latte"), slot: "L", name: `LafPOS Latte ${tag}`, size: "L", costMinor: 0, active: true },
      { siteMenuId: site("latte"), slot: "M", name: `LafPOS Latte ${tag}`, size: "M", costMinor: Math.round(cost * 100), active: true },
    ]);
    // Bağlı olmayan ürün (Mocha) listede yok
    assert.doesNotMatch(JSON.stringify(r.body), new RegExp(`LafPOS Mocha ${tag}`));
    // Hiçbir satırda fiyat, kâr ya da reçete yok
    for (const i of r.body.items as Record<string, unknown>[]) assert.deepEqual(Object.keys(i), ["siteMenuId", "slot", "name", "size", "costMinor", "active"]);
  });
});
