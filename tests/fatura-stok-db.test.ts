// Faturadan stoğa doğru miktar ve fiyat (denetim 26 Eki, parti B03), gerçek Postgres'te; oturum ve next/cache taklit
// edilir:
// - E-06: fiyatı olmayan hammaddenin ilk fiyatı çarpanı faturanın ölçü biriminden gelmiyorsa onaya düşer (iki sayılı paket
//   adından ya da elle yazılan çarpanla yazılmaz); kg / lt çevirisiyle gelen ilk fiyat yazılır.
// - E-27: eşitlemenin yazdığı alınan miktar stok partileriyle aynı yüklemle çarpanı onay bekleyen kalemleri dışlar; fiyat
//   kararı (onay, red, geri alma) alınan miktarı yeniden hesaplar; Tutarlılık'ın "Alım yok (0)" satırı yazılır, geri
//   alınır ve faturası sonradan gelirse yerini faturadaki miktar alır (elle girilen satıra dokunulmaz).
// - İnceleme (B03): reddedilen fiyat Tutarlılık'ı "Fiyat onayı bekliyor"da bırakmaz, elle yazılan alım sapmayı açar;
//   öneri geçersiz kalınca (eşitlemede ya da onay anında) alınan miktar bütün aylarda geri yazılır.
// - E-07: kalemi hammaddeye bağlı ama kategorisi mal alışı olmayan ("Diğer") fatura kontrole düşer (eşitleme, ürün
//   bağlama), tek dokunuşla onaylanmaz; kategorisi mal alışı olunca gelir-gidere girer; bilerek "kalsın" denirse yeniden
//   kontrole düşmez, kategorisi değişince karar düşer.
//
// PARASUT_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı):
// test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler; verilen veritabanına dokunmaz.
// Çalıştırma: PARASUT_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/fatura-stok-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.PARASUT_TEST_DATABASE_URL;
const DB_NAME = `laffogato_fatura_stok_${process.pid}`;

describe("faturadan stoğa: veritabanında", { skip: !SERVER_URL && "PARASUT_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let sync: typeof import("../src/server/parasut/sync");
  let holdActions: typeof import("../src/server/actions/price-holds");
  let consistencyActions: typeof import("../src/server/actions/consistency");
  let lotsQuery: typeof import("../src/server/data/purchase-lots-query");
  let invoiceActions: typeof import("../src/server/actions/invoices");
  let stockOnlyData: typeof import("../src/server/data/stock-only-invoices");
  let dataset: typeof import("../src/server/data/dataset");
  let unpriced: typeof import("../src/server/data/unpriced");

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "fatura-stok-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır; oturum ve sayfa yenileme taklit edilir
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
    const [u] = await db.insert(s.users).values({ email: "test@laffogato.net", name: "Test", passwordHash: "x", role: "admin" }).returning();
    stub(require.resolve("../src/server/auth/dal"), { requireAdmin: async () => ({ ...u, role: "admin" }), requireUser: async () => ({ ...u, role: "admin" }) });
    sync = await import("../src/server/parasut/sync");
    holdActions = await import("../src/server/actions/price-holds");
    consistencyActions = await import("../src/server/actions/consistency");
    lotsQuery = await import("../src/server/data/purchase-lots-query");
    invoiceActions = await import("../src/server/actions/invoices");
    stockOnlyData = await import("../src/server/data/stock-only-invoices");
    dataset = await import("../src/server/data/dataset");
    unpriced = await import("../src/server/data/unpriced");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE ingredient_price_holds, ingredient_prices, parasut_product_links, purchase_quantities, stock_counts, parasut_bill_lines, invoices, ingredients, integration_state, activity_log RESTART IDENTITY CASCADE`,
    );
  });

  // ---------------------------------------------------------------- yardımcılar

  async function ingredient(name: string, unit: "gr" | "ml" | "adet", extra: Partial<typeof s.ingredients.$inferInsert> = {}) {
    const [r] = await db.insert(s.ingredients).values({ name, category: "Test", unit, ...extra }).returning();
    return r;
  }
  /** Paraşüt'ten gelmiş fatura ve tek kalemi */
  async function bill(p: { date: string; productKey: string; productName: string; unit: string | null; quantity: number; netTotal: number; category?: string; description?: string | null }) {
    const [inv] = await db
      .insert(s.invoices)
      .values({ date: p.date, supplier: "Test tedarikçi", category: p.category ?? "Hammadde & İçecek", amount: p.netTotal, payable: p.netTotal * 1.2, source: "parasut", origin: "parasut" })
      .returning();
    await db.insert(s.parasutBillLines).values({
      invoiceId: inv.id,
      externalId: `l-${inv.id}-${p.productKey}`,
      productKey: p.productKey,
      productName: p.productName,
      description: p.description ?? null,
      unit: p.unit,
      quantity: p.quantity,
      unitPrice: p.quantity ? p.netTotal / p.quantity : 0,
      netTotal: p.netTotal,
    });
    return inv;
  }
  async function link(productKey: string, productName: string, ingredientId: number, factor: number) {
    await db.insert(s.parasutProductLinks).values({ productKey, productName, ingredientId, factor });
  }
  const ing = async (id: number) => (await db.select().from(s.ingredients).where(eq(s.ingredients.id, id)))[0];
  const holds = () => db.select().from(s.ingredientPriceHolds).orderBy(asc(s.ingredientPriceHolds.id));

  // ---------------------------------------------------------------- E-06: ilk fiyat

  test("E-06: fiyatsız hammaddenin ilk fiyatı addan gelen çarpanla yazılmaz, onaya düşer; kg çevirisiyle gelen yazılır", async () => {
    // Personel "Karton bardak"ı sayımdan fiyatsız ekledi (0 ₺, Tahmini); ilk fatura 1 Koli 400 ₺, eski okumayla 1 Koli = 50
    const cup = await ingredient("Karton bardak 8oz", "adet", { packagePrice: 0, isEstimate: true });
    const cupBill = await bill({ date: "2026-10-12", productKey: "p:bardak", productName: "KARTON BARDAK 8 OZ 50'Lİ X 20", unit: "Koli", quantity: 1, netTotal: 400 });
    await link("p:bardak", "KARTON BARDAK 8 OZ 50'Lİ X 20", cup.id, 50);
    // Kakao 2 KG 1.800 ₺: 1 kg = 1000 gr faturanın biriminden, ilk fiyat doğrudan yazılır
    const cocoa = await ingredient("Kakao", "gr", { packagePrice: 0 });
    await bill({ date: "2026-10-12", productKey: "p:kakao", productName: "KAKAO TOZU", unit: "KG", quantity: 2, netTotal: 1800 });
    await link("p:kakao", "KAKAO TOZU", cocoa.id, 1000);

    const r = await sync.applyProductLinks();
    assert.equal(r.held, 1);
    assert.equal(r.prices, 1);
    // Bardak: fiyat yazılmadı, onayda (adet 8 ₺ gibi görünecekti; doğrusu 0,40 ₺)
    const c = await ing(cup.id);
    assert.deepEqual([c.packagePrice, c.packageSize, c.isEstimate], [0, 1, true]);
    const [h] = await holds();
    assert.deepEqual([h.ingredientId, h.invoiceId, h.status, h.factor, h.packagePrice, h.packageSize, h.prevPackagePrice], [cup.id, cupBill.id, "pending", 50, 400, 50, 0]);
    const [log] = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Fiyat onaya düştü"));
    assert.equal(log.detail, "Karton bardak 8oz (Test tedarikçi 12.10.2026)");
    // Kakao: kg çevirisi kesin, ilk fiyat yazıldı
    const k = await ing(cocoa.id);
    assert.deepEqual([k.packagePrice, k.packageSize, k.isEstimate], [900, 1000, false]);
    // Aynı fatura yeniden değerlendirilmez, ikinci öneri açılmaz
    const again = await sync.applyProductLinks();
    assert.deepEqual([again.held, again.prices], [0, 0]);
    assert.equal((await holds()).length, 1);
  });

  test("E-06: ilk fiyatı onay bekleyen hammadde zilde \"fiyatı girilmemiş\" sayılmaz; reddedilince yeniden sayılır", async () => {
    const cup = await ingredient("Karton bardak 8oz", "adet", { packagePrice: 0, isEstimate: true });
    await ingredient("Klips kapak", "adet", { packagePrice: 0 });
    await bill({ date: "2026-10-12", productKey: "p:bardak", productName: "KARTON BARDAK 8 OZ 50'Lİ X 20", unit: "Koli", quantity: 1, netTotal: 400 });
    await link("p:bardak", "KARTON BARDAK 8 OZ 50'Lİ X 20", cup.id, 1000);
    assert.deepEqual((await unpriced.loadUnpricedIngredients()).names, ["Karton bardak 8oz", "Klips kapak"]);
    await sync.applyProductLinks();
    const [h] = await holds();
    assert.deepEqual([h.ingredientId, h.status], [cup.id, "pending"]);
    // Zil ve Bugün bardağı "Fiyat onayı"nda gösterir; "paket fiyatını girin" demez
    const u = await unpriced.loadUnpricedIngredients();
    assert.deepEqual([u.count, u.names], [1, ["Klips kapak"]]);
    const rej = await holdActions.rejectPriceHold({ id: h.id, stopUpdates: false, note: null });
    assert.ok(rej.ok, JSON.stringify(rej));
    assert.deepEqual((await unpriced.loadUnpricedIngredients()).names, ["Karton bardak 8oz", "Klips kapak"]);
  });

  test("E-06: şimdiki fiyatı olan hammaddede kural değişmez (%40 içi yazılır)", async () => {
    const milk = await ingredient("Süt", "ml", { packagePrice: 30, packageSize: 1000 });
    await bill({ date: "2026-10-12", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 10, netTotal: 330 });
    await link("p:sut", "SÜT 1 L", milk.id, 1000);
    const r = await sync.applyProductLinks();
    assert.deepEqual([r.prices, r.held], [1, 0]);
    const m = await ing(milk.id);
    assert.deepEqual([m.packagePrice, m.packageSize], [33, 1000]);
  });

  // ---------------------------------------------------------------- E-27: alınan miktar ve onay bekleyen çarpan

  const purchases = async (ingredientId: number) =>
    (await db.select().from(s.purchaseQuantities).where(eq(s.purchaseQuantities.ingredientId, ingredientId)).orderBy(asc(s.purchaseQuantities.month))).map((p) => [
      p.month,
      p.qty,
      p.note,
    ]);
  /** Stok partilerinin ay toplamı (alınan miktarla aynı yüklem: ikisi aynı kalemleri saymalı) */
  const lotMonths = async (ingredientId: number) => {
    const m = new Map<string, number>();
    for (const l of await lotsQuery.queryPurchaseLots(db)) if (l.ingredientId === ingredientId) m.set(l.date.slice(0, 7), (m.get(l.date.slice(0, 7)) ?? 0) + l.qty);
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  };

  test("E-27: çarpanı onay bekleyen ürünün kalemleri alınan miktara girmez; red yalnız kendi faturasını, onay hepsini geri getirir", async () => {
    const milk = await ingredient("Süt", "ml", { packagePrice: 30, packageSize: 1000 });
    await bill({ date: "2026-09-10", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 10, netTotal: 300 });
    // Tedarikçi koliyi "Adet" yazdı: 2 × 372 ₺, çarpan 1000 ile ml başı 0,372 ₺ (+%1.140): onaya düşer
    const oct = await bill({ date: "2026-10-05", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 2, netTotal: 744 });
    await link("p:sut", "SÜT 1 L", milk.id, 1000);
    const r = await sync.applyProductLinks();
    assert.equal(r.held, 1);
    const [h] = await holds();
    assert.deepEqual([h.invoiceId, h.status], [oct.id, "pending"]);
    // Bağlantının bugünkü çarpanı şüpheli: ürünün bütün kalemleri dışarıda (stok partileri gibi); Tutarlılık işaretler
    assert.deepEqual(await purchases(milk.id), []);
    assert.deepEqual(await lotMonths(milk.id), []);
    assert.deepEqual(
      (await lotsQuery.queryHeldPurchases(db)).filter((x) => x.ingredientId === milk.id).sort((a, b) => a.month.localeCompare(b.month)),
      [
        { month: "2026-09", ingredientId: milk.id, invoices: 1, rejected: 0 },
        { month: "2026-10", ingredientId: milk.id, invoices: 1, rejected: 0 },
      ],
    );

    // Red: yalnız reddedilen fatura dışarıda, Eylül geri gelir (karar alınan miktarı yeniden hesaplar)
    const rej = await holdActions.rejectPriceHold({ id: h.id, stopUpdates: false, note: null });
    assert.ok(rej.ok, JSON.stringify(rej));
    assert.deepEqual(await purchases(milk.id), [["2026-09", 10000, "Paraşüt faturalarından"]]);
    assert.deepEqual(await lotMonths(milk.id), [["2026-09", 10000]]);
    // Bekleyen öneri yok: reddedilen fatura ayrı sayılır (Tutarlılık onaya götürmez, alımı elle yazdırır)
    assert.deepEqual((await lotsQuery.queryHeldPurchases(db)).filter((x) => x.ingredientId === milk.id), [{ month: "2026-10", ingredientId: milk.id, invoices: 0, rejected: 1 }]);
    // Geri al: yeniden bekliyor, ikisi de dışarıda
    const undo = await holdActions.undoPriceHold(h.id);
    assert.ok(undo.ok, JSON.stringify(undo));
    assert.deepEqual(await purchases(milk.id), []);
    // Onay: ikisi de girer (stok partileriyle aynı)
    const ok = await holdActions.approvePriceHold(h.id);
    assert.ok(ok.ok, JSON.stringify(ok));
    assert.deepEqual(await purchases(milk.id), [
      ["2026-09", 10000, "Paraşüt faturalarından"],
      ["2026-10", 2000, "Paraşüt faturalarından"],
    ]);
    assert.deepEqual(await lotMonths(milk.id), [
      ["2026-09", 10000],
      ["2026-10", 2000],
    ]);
    assert.deepEqual((await lotsQuery.queryHeldPurchases(db)).filter((x) => x.ingredientId === milk.id), []);
  });

  test("E-27: “Alım yok (0)” yazılır, alımı olana dokunmaz, geri alınır; faturası sonradan gelirse yerini faturadaki miktar alır", async () => {
    const cocoa = await ingredient("Kakao", "gr", { packagePrice: 900, packageSize: 1000 });
    const sugar = await ingredient("Şeker", "gr", { packagePrice: 50, packageSize: 1000 });
    await link("p:kakao", "KAKAO TOZU", cocoa.id, 1000);
    // Şekerin Kasım'ı elle girildi (nakit alım): toplu "Alım yok" ona dokunmaz
    await db.insert(s.purchaseQuantities).values({ month: "2026-11", ingredientId: sugar.id, qty: 3000, note: "Nakit, market" });
    const w = await consistencyActions.setNoPurchase("2026-11", [cocoa.id, sugar.id]);
    assert.ok(w.ok, JSON.stringify(w));
    assert.deepEqual(w.data.changed, [cocoa.id]);
    assert.deepEqual(await purchases(cocoa.id), [["2026-11", 0, "Bu ay alım yok"]]);
    assert.deepEqual(await purchases(sugar.id), [["2026-11", 3000, "Nakit, market"]]);
    const [log] = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Alım yok (0)"));
    assert.equal(log.detail, "Kasım 2026 · Kakao");
    // Kasım'ın faturası sonradan geldi: 0'ın yerine faturadaki miktar (yönetilen satır)
    await bill({ date: "2026-11-20", productKey: "p:kakao", productName: "KAKAO TOZU", unit: "KG", quantity: 2, netTotal: 1800 });
    await sync.applyProductLinks();
    assert.deepEqual(await purchases(cocoa.id), [["2026-11", 2000, "Paraşüt faturalarından"]]);
    // Geri al yalnız hâlâ 0 olan "Alım yok" satırını siler
    assert.deepEqual((await consistencyActions.setNoPurchase("2026-11", [cocoa.id], true)).ok && (await purchases(cocoa.id)).length, 1);
    const dec = await consistencyActions.setNoPurchase("2026-12", [cocoa.id]);
    assert.ok(dec.ok);
    const back = await consistencyActions.setNoPurchase("2026-12", [cocoa.id], true);
    assert.ok(back.ok);
    assert.deepEqual(back.data.changed, [cocoa.id]);
    assert.deepEqual(await purchases(cocoa.id), [["2026-11", 2000, "Paraşüt faturalarından"]]);
    // Elle düzeltilmiş satıra eşitleme dokunmaz (eski kural)
    await db.update(s.purchaseQuantities).set({ qty: 2100, note: "kontrol edildi" }).where(eq(s.purchaseQuantities.ingredientId, cocoa.id));
    await sync.applyProductLinks();
    assert.deepEqual(await purchases(cocoa.id), [["2026-11", 2100, "kontrol edildi"]]);
    // Alış ve iadesi aynı ayda: toplam 0 yazılır ("Alım girilmeli" kalmaz)
    const milk = await ingredient("Süt", "ml", { packagePrice: 30, packageSize: 1000 });
    await link("p:sut", "SÜT 1 L", milk.id, 1000);
    await bill({ date: "2026-11-02", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 5, netTotal: 150 });
    await bill({ date: "2026-11-03", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: -5, netTotal: -150 });
    await sync.applyProductLinks();
    assert.deepEqual(await purchases(milk.id), [["2026-11", 0, "Paraşüt faturalarından"]]);
  });

  test("denetim B03: reddedilen fiyat Tutarlılık'ı onayda bırakmaz; elle yazılan alımla sapma hesaplanır", async () => {
    const insights = await import("../src/lib/calc/insights");
    const milk = await ingredient("Süt", "ml", { packagePrice: 30, packageSize: 1000 });
    await bill({ date: "2026-10-03", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 40, netTotal: 1200 });
    // Tek seferlik pahalı market alışı (+%100, çarpan doğru): öneri açılır, sahip reddeder
    await bill({ date: "2026-10-20", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 10, netTotal: 600 });
    await link("p:sut", "SÜT 1 L", milk.id, 1000);
    await db.insert(s.stockCounts).values([
      { month: "2026-09", ingredientId: milk.id, qty: 20000, factor: 1 },
      { month: "2026-10", ingredientId: milk.id, qty: 15000, factor: 1 },
    ]);
    assert.equal((await sync.applyProductLinks()).held, 1);
    const row = async () => {
      const c = insights.consistency(await dataset.loadModel(), "2026-10");
      const r = c.rows.find((x) => x.ingredient.id === milk.id)!;
      return { stock: r.stock, held: r.held, rejected: r.rejected, purchased: r.purchased, variance: r.variance, heldCount: c.heldCount, rejectedCount: c.rejectedCount };
    };
    assert.deepEqual(await row(), { stock: "held", held: { invoices: 2 }, rejected: null, purchased: null, variance: null, heldCount: 1, rejectedCount: 0 });
    const [h] = await holds();
    assert.ok((await holdActions.rejectPriceHold({ id: h.id, stopUpdates: false, note: "tek seferlik market alışı" })).ok);
    // Bekleyen kart yok: "Fiyat onayı bekliyor" değil; reddedilen fatura alınana girmedi, alımı elle yazdırır
    assert.deepEqual(await row(), { stock: "rejected", held: null, rejected: { invoices: 1 }, purchased: 40000, variance: null, heldCount: 0, rejectedCount: 1 });
    // Sahip faturaya bakıp ayın alımını yazar (40 L + 10 L): sapma hesaplanır, toplama girer
    const w = await consistencyActions.setPurchaseQty("2026-10", milk.id, 50000, "kontrol edildi");
    assert.ok(w.ok, JSON.stringify(w));
    const after = await row();
    assert.deepEqual([after.stock, after.held, after.rejected, after.purchased, after.rejectedCount], ["complete", null, null, 50000, 0]);
    assert.equal(typeof after.variance, "number");
    // Eşitleme elle yazılanı ezmez
    await sync.applyProductLinks();
    assert.deepEqual(await purchases(milk.id), [["2026-10", 50000, "kontrol edildi"]]);
  });

  test("denetim B03: bekleyen öneri geçersiz kalınca alınan miktar bütün aylarda geri yazılır (stok partileriyle aynı)", async () => {
    const milk = await ingredient("Süt", "ml", { packagePrice: 30, packageSize: 1000 });
    for (const d of ["2026-03-10", "2026-06-10", "2026-09-10"]) await bill({ date: d, productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 10, netTotal: 300 });
    await link("p:sut", "SÜT 1 L", milk.id, 1000);
    const cocoa = await ingredient("Kakao", "gr", { packagePrice: 900, packageSize: 1000 });
    await link("p:kakao", "KAKAO TOZU", cocoa.id, 1000);
    await sync.applyProductLinks();
    // 20 Eki: süt +%50, kakao +%60: iki öneri; süt önerisi bağlantının bütün aylarını dışlar
    await bill({ date: "2026-10-20", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 10, netTotal: 450 });
    await bill({ date: "2026-10-20", productKey: "p:kakao", productName: "KAKAO TOZU", unit: "KG", quantity: 1, netTotal: 1440 });
    assert.equal((await sync.applyProductLinks()).held, 2);
    assert.deepEqual(await purchases(milk.id), []);
    // Kakao onaylanır (alınan miktar baştan hesaplanır; süt hâlâ bekliyor)
    const kh = (await holds()).find((x) => x.ingredientId === cocoa.id)!;
    assert.ok((await holdActions.approvePriceHold(kh.id)).ok);
    assert.deepEqual(await purchases(milk.id), []);
    // 27 Eki: süt eski fiyatla geldi, süt önerisi geçersiz ("Daha yeni faturada fiyat aynı"): Mart ve Haziran da geri gelir
    await bill({ date: "2026-10-27", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 10, netTotal: 300 });
    await sync.applyProductLinks();
    const sh = (await holds()).find((x) => x.ingredientId === milk.id)!;
    assert.deepEqual([sh.status, sh.note], ["superseded", "Daha yeni faturada fiyat aynı"]);
    const managed = (await purchases(milk.id)).map(([m, q]) => [m, q]);
    assert.deepEqual(managed, [
      ["2026-03", 10000],
      ["2026-06", 10000],
      ["2026-09", 10000],
      ["2026-10", 20000],
    ]);
    assert.deepEqual(managed, await lotMonths(milk.id), "alınan = stok partileri");
    assert.deepEqual((await lotsQuery.queryHeldPurchases(db)).filter((x) => x.ingredientId === milk.id), []);
  });

  test("denetim B03: onay anında geçersiz kalan öneri de alınan miktarı geri yazar", async () => {
    const milk = await ingredient("Süt", "ml", { packagePrice: 30, packageSize: 1000 });
    await bill({ date: "2026-06-10", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 10, netTotal: 300 });
    await bill({ date: "2026-10-20", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 10, netTotal: 450 });
    await link("p:sut", "SÜT 1 L", milk.id, 1000);
    assert.equal((await sync.applyProductLinks()).held, 1);
    assert.deepEqual(await purchases(milk.id), []);
    const [h] = await holds();
    // Bağlantının çarpanı arada değişti (eşitleme çalışmadan): onay öneriyi geçersiz sayar, alınan yeni çarpanla yazılır
    await db.update(s.parasutProductLinks).set({ factor: 500 }).where(eq(s.parasutProductLinks.productKey, "p:sut"));
    const r = await holdActions.approvePriceHold(h.id);
    assert.equal(r.ok, false);
    assert.equal((await holds())[0].status, "superseded");
    assert.deepEqual(
      (await purchases(milk.id)).map(([m, q]) => [m, q]),
      [
        ["2026-06", 5000],
        ["2026-10", 5000],
      ],
    );
  });

  // ---------------------------------------------------------------- E-07: stoğa girip gelir-gidere girmeyen fatura

  test("E-07: malzemeye bağlı “Diğer” faturası kontrole düşer, tek dokunuşla onaylanmaz; kategorisi mal alışı olunca gelir-gidere girer", async () => {
    const milk = await ingredient("Süt", "ml", { packagePrice: 30, packageSize: 1000 });
    // Yeni market tedarikçisi "Diğer · eşleşme yok" geldi, sahibi onaylamıştı (kontrol beklemiyor)
    const other = await bill({ date: "2026-10-12", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 100, netTotal: 3000, category: "Diğer" });
    const goods = await bill({ date: "2026-10-13", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 10, netTotal: 300 });
    const karaoke = await bill({ date: "2026-10-14", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 5, netTotal: 150, category: "Karaoke box" });
    const goodsOf = async () => (await dataset.loadModel()).goodsPurchases("2026-10");
    assert.equal(await goodsOf(), 300, "gelir-gider yalnız mal alışını sayar");

    // Ürün bağlanınca (eşitleme / bağlama) "Diğer" faturası kontrole düşer; mal alışı ve kafe dışı düşmez
    await link("p:sut", "SÜT 1 L", milk.id, 1000);
    const r = await sync.applyProductLinks();
    assert.equal(r.flagged, 1);
    const review = async () => (await db.select({ id: s.invoices.id }).from(s.invoices).where(eq(s.invoices.needsReview, true))).map((x) => x.id);
    assert.deepEqual(await review(), [other.id]);
    assert.deepEqual(await stockOnlyData.stockOnlyIds(db), [other.id]);
    assert.equal(await stockOnlyData.countStockOnlyReview(db), 1);
    assert.ok(karaoke.id && goods.id);
    const [log] = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Sistem · Fatura mal alışı sayılmıyor"));
    assert.match(log.detail ?? "", /^Test tedarikçi \(2026-10-12\): kalemi hammaddeye bağlı, kategorisi mal alışı değil; kontrolde$/);
    // Stoğa giriyor (alınan miktar 110 L), gelir-gidere girmiyor
    assert.deepEqual(await purchases(milk.id), [["2026-10", 110000, "Paraşüt faturalarından"]]);
    // Yeniden çalışma yeniden işaretlemez, sayı artmaz
    assert.equal((await sync.applyProductLinks()).flagged, 0);

    // Onayla: kontrolde kalır (neden: kept)
    const c = await invoiceActions.confirmInvoices([other.id, goods.id]);
    assert.ok(c.ok, JSON.stringify(c));
    assert.deepEqual(c.data.kept, [other.id]);
    assert.deepEqual(await review(), [other.id]);
    // Aynı kategoriyle "kategori doğru" da onaylamaz
    const same = await invoiceActions.setInvoiceCategory([{ id: other.id, category: "Diğer" }]);
    assert.ok(same.ok);
    assert.deepEqual(same.data.stockOnly, [other.id]);
    assert.deepEqual(await review(), [other.id]);

    // Kategori Hammadde & İçecek: kontrolden çıkar, gelir-gider 3.000 ₺ daha mal alışı sayar (stok ile K/Z tutarlı)
    const fix = await invoiceActions.setInvoiceCategory([{ id: other.id, category: "Hammadde & İçecek" }]);
    assert.ok(fix.ok);
    assert.deepEqual(fix.data.stockOnly, []);
    assert.deepEqual(await review(), []);
    assert.equal(await goodsOf(), 3300);
    assert.deepEqual(await stockOnlyData.stockOnlyIds(db), []);
    // Geri "Diğer" yapılırsa yine kontrole düşer
    const back = await invoiceActions.setInvoiceCategory([{ id: other.id, category: "Diğer" }]);
    assert.ok(back.ok);
    assert.deepEqual(back.data.stockOnly, [other.id]);
    assert.deepEqual(await review(), [other.id]);
  });

  test("E-07: bilerek “kalsın” denen fatura yeniden kontrole düşmez; kategorisi değişince karar düşer; pencereden kaydetmek uyarır", async () => {
    const milk = await ingredient("Süt", "ml", { packagePrice: 30, packageSize: 1000 });
    // Temizlik malzemesi ağırlıklı market faturası, bir kalemi süt
    const market = await bill({ date: "2026-10-12", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 2, netTotal: 60, category: "Diğer" });
    await link("p:sut", "SÜT 1 L", milk.id, 1000);
    await sync.applyProductLinks();
    const reviewOf = async (id: number) => (await db.select({ r: s.invoices.needsReview }).from(s.invoices).where(eq(s.invoices.id, id)))[0].r;
    assert.equal(await reviewOf(market.id), true);
    const ok = await invoiceActions.confirmInvoices([market.id], false, { acceptStockOnly: true });
    assert.ok(ok.ok, JSON.stringify(ok));
    assert.deepEqual([ok.data.ids, ok.data.kept], [[market.id], []]);
    assert.equal(await reviewOf(market.id), false);
    assert.deepEqual([...(await stockOnlyData.acceptedStockOnly(db))], [market.id]);
    const [log] = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Fatura mal alışı sayılmadan onaylandı"));
    assert.ok(log);
    // Eşitleme ve onay yeniden işaretlemez
    assert.equal((await sync.applyProductLinks()).flagged, 0);
    assert.equal(await reviewOf(market.id), false);
    // Geri al: karar da geri alınır
    const undo = await invoiceActions.confirmInvoices([market.id], true);
    assert.ok(undo.ok);
    assert.equal(await reviewOf(market.id), true);
    assert.deepEqual([...(await stockOnlyData.acceptedStockOnly(db))], []);
    // Yeniden kalsın; sonra kategori "Hizmet": karar o kategori içindi, yeniden kontrole düşer
    assert.ok((await invoiceActions.confirmInvoices([market.id], false, { acceptStockOnly: true })).ok);
    const hz = await invoiceActions.setInvoiceCategory([{ id: market.id, category: "Hizmet" }]);
    assert.ok(hz.ok);
    assert.deepEqual(hz.data.stockOnly, [market.id]);
    assert.equal(await reviewOf(market.id), true);
    assert.deepEqual([...(await stockOnlyData.acceptedStockOnly(db))], []);

    // Fatura penceresinden kaydetmek de onaylamaz: yanıt uyarır; mal alışı kategorisiyle kaydedince onaylanır
    const [inv] = await db.select().from(s.invoices).where(eq(s.invoices.id, market.id));
    const form = { id: inv.id, date: inv.date, supplier: inv.supplier, description: null, invoiceNo: null, category: "Diğer", amount: inv.amount, discount: 0, payable: inv.payable, unpaid: false, note: null };
    const saved = await invoiceActions.saveInvoice(form);
    assert.ok(saved.ok, JSON.stringify(saved));
    assert.equal(saved.data.stockOnly, true);
    assert.equal(await reviewOf(market.id), true);
    const fixed = await invoiceActions.saveInvoice({ ...form, category: "Hammadde & İçecek" });
    assert.ok(fixed.ok);
    assert.equal(fixed.data.stockOnly, false);
    assert.equal(await reviewOf(market.id), false);
  });
});
