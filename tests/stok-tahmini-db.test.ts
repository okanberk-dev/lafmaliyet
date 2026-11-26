// Tahmini stoğun LafPOS başlangıcı gerçek Postgres'te (docs/STOK-TAHMINI.md): geçiş ayında Marina'nın ModPOS listesi
// ayın bir gününde bitiyorsa (sales.coverage, integration_state'te) LafPOS satışları ertesi günden sayılır. Kayıt
// settings'te aranırsa hep boş kalıyordu ve başlangıç sonraki ayın 1'ine kayıyordu.
//
// Marina'nın online ay kaydı (26 Kasım 2026, docs/STOK-TAHMINI.md § 2; sitenin sahte ucuyla, laffogato.net'e gidilmez):
// `&branch=marina` ayrı anahtara yazılır, işletmenin kaydını okuyan loadSiteSales onu görmez; şubesiz (eski site) yanıt
// yazılmaz, durum hatayı söyler; Siteden yenile Marina'yı da ayrıca çeker; tahmin yalnız Marina'nın kasadan geçmeyen
// siparişini düşer (işletmenin kaydındaki öteki siparişler ve kasada ödenen sipariş düşülmez).
//
// Kendi geçici veritabanını açar (STOK_TAHMINI_TEST_DATABASE_URL'in sunucusunda), sonunda siler. Değişken yoksa atlanır.
// Çalıştırma: STOK_TAHMINI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/stok-tahmini-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "../src/lib/karaoke/signature";
import { SALES_COVERAGE_BRANCH_KEY, SALES_COVERAGE_KEY } from "../src/lib/sales-coverage";
import { monthRange, SITE_SALES_VERSION } from "../src/lib/site-sales/schema";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

import { LAFPOS_SUBE, MODPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.STOK_TAHMINI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_stok_tahmini_${process.pid}`;
const NOW = new Date("2026-11-25T12:00:00+03:00");
const SECRET = "stok-tahmini-test-anahtari-gercek-degil-0123456789";
const SITE = "http://site.test";

/** Sitenin sahte satış ucunun davranışı: şubeyi söyleyen yanıt (yeni site) ya da söylemeyen (eski site) ve gelen istekler */
const site = { echoBranch: true, requests: [] as { month: string | null; branch: string | null }[] };

/** Ayın satış yanıtı (sözleşme v1): `latte` Latte M adedi; kasada ödenen 2 ve elle girilen 1 sipariş satırlarda yok */
function salesBody(month: string, latte: number, branch?: string) {
  const zero = { grossMinor: 0, discountMinor: 0, deliveryMinor: 0, refundedMinor: 0, netMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 };
  return {
    version: SITE_SALES_VERSION,
    now: new Date().toISOString(),
    ...monthRange(month),
    closed: false,
    cafe: { orders: latte, ...zero, lines: [{ menuItemId: "mnu-0003", size: "M", name: "Latte", qty: latte, listMinor: 0 }] },
    shop: { orders: 0, ...zero },
    karaoke: { bookings: 0, collectedMinor: 0, refundedMinor: 0, netMinor: 0, refundPendingMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 },
    manual: { orders: 1, grossMinor: 0, netMinor: 0 },
    counter: { orders: 2, grossMinor: 0, netMinor: 0 },
    ...(branch ? { branch } : {}),
  };
}

describe("Tahmini stok: LafPOS'un sayıldığı ilk gün", { skip: !SERVER_URL && "STOK_TAHMINI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let estimate: typeof import("../src/server/data/stock-estimate");
  const realFetch = globalThis.fetch;

  /** Sitenin sahte satış ucu: imzayı denetler; Marina sorulursa Marina'nın satırları (Aralık 5, Kasım 30 Latte), sorulmazsa işletmenin (50) */
  async function fakeSite(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== SITE) return realFetch(input, init);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const signed = verifySignature(SECRET, { method: init?.method ?? "GET", url, body: "", timestamp: headers[TIMESTAMP_HEADER] ?? null, signature: headers[SIGNATURE_HEADER] ?? null });
    if (!signed) return json(401, { error: "unauthorized" });
    if (url.pathname !== "/api/panel/sales") return json(404, { error: "not_found" });
    const month = url.searchParams.get("month");
    const branch = url.searchParams.get("branch");
    site.requests.push({ month, branch });
    if (!month) return json(400, { error: "bad_period" });
    if (branch === "marina") return json(200, salesBody(month, month === "2026-12" ? 5 : 30, site.echoBranch ? "marina" : undefined));
    return json(200, salesBody(month, 50));
  }

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "stok-tahmini-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    const require = createRequire(import.meta.url);
    const p = require.resolve("server-only");
    require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await seedBranches(db);
    estimate = await import("../src/server/data/stock-estimate");
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  test("geçiş ayında ModPOS listesi 20 Kasım'da bitiyorsa LafPOS 21 Kasım'dan sayılır", async () => {
    await db.insert(s.settings).values({ key: "lafposGecisGunu", value: "2026-11-21" });
    await db.insert(s.months).values({ month: "2026-11", branchId: LAFPOS_SUBE }).onConflictDoNothing();
    await db.insert(s.salesLines).values({ month: "2026-11", branchId: LAFPOS_SUBE, posName: "LATTE", qty: 10, revenue: 1_000 });
    await db.insert(s.integrationState).values({ key: SALES_COVERAGE_KEY, value: { "2026-11": "2026-11-20" } });
    const r = await estimate.loadStockEstimate(db, NOW);
    assert.ok(r, "geçiş günü var: tahmin döner");
    assert.equal(r.switchDay, "2026-11-21");
    assert.equal(r.lafposFrom, "2026-11-21");
  });

  test("sınır Marina'nın kendi kapsam kaydından: Tuzla aynı aya 24 Kasım'a kadar yükleyince ya da Aralık'ta ayın tamamını yükleyince kaymaz", async () => {
    await db.insert(s.months).values({ month: "2026-11", branchId: MODPOS_SUBE }).onConflictDoNothing();
    await db.insert(s.salesLines).values({ month: "2026-11", branchId: MODPOS_SUBE, posName: "TUZLA LATTE", qty: 10, revenue: 1_000 });
    const coverage = async (shared: Record<string, string>, perBranch: Record<string, Record<string, string | null>>) => {
      await db.delete(s.integrationState);
      await db.insert(s.integrationState).values([
        { key: SALES_COVERAGE_KEY, value: shared },
        { key: SALES_COVERAGE_BRANCH_KEY, value: perBranch },
      ]);
      return (await estimate.loadStockEstimate(db, NOW))?.lafposFrom;
    };
    // Tuzla'nın yüklemesi ortak kaydı 24 Kasım yaptı; Marina'nın kendi kaydı 20 Kasım
    assert.equal(await coverage({ "2026-11": "2026-11-24" }, { [LAFPOS_SUBE]: { "2026-11": "2026-11-20" }, [MODPOS_SUBE]: { "2026-11": "2026-11-24" } }), "2026-11-21");
    // Tuzla Kasım'ın tamamını Aralık'ta yükledi: ortak kayıtta Kasım yok
    assert.equal(await coverage({}, { [LAFPOS_SUBE]: { "2026-11": "2026-11-20" }, [MODPOS_SUBE]: { "2026-11": null } }), "2026-11-21");
    // Şube kaydı olmayan (bu değişiklikten önce yüklenmiş) listede ortak kayıt
    assert.equal(await coverage({ "2026-11": "2026-11-20" }, {}), "2026-11-21");
  });

  test("Marina'ya gelen faturalar: liste kesilse de sayılar bütün dönemden, şubesi seçilmeyen önce (bulgu 42)", async () => {
    const [sut] = await db.insert(s.ingredients).values({ name: "Süt", category: "Test", unit: "ml", countUnit: "LT" }).returning();
    await db.insert(s.parasutProductLinks).values({ productKey: "p:sut", productName: "SÜT 1 LT", ingredientId: sut.id, factor: 1000 });
    /**
     * Hammaddeye bağlı tek kalemli Paraşüt faturası; `branch` verilirse şubesi seçilmiş (faturanın kendi şubesi,
     * docs/SUBE.md › Faturanın şubesi), "isletme" ise bilinçli işletme geneli (o da seçilmiş sayılır)
     */
    const bill = async (date: string, supplier: string, branch: string | null) => {
      const [inv] = await db
        .insert(s.invoices)
        .values({
          date,
          supplier,
          category: "Hammadde & İçecek",
          amount: 100,
          payable: 120,
          source: "parasut",
          origin: "parasut",
          branchId: branch && branch !== "isletme" ? branch : null,
          companyWide: branch === "isletme",
        })
        .returning();
      await db.insert(s.parasutBillLines).values({ invoiceId: inv.id, externalId: `l-${inv.id}`, productKey: "p:sut", productName: "SÜT 1 LT", unit: "Adet", quantity: 12, unitPrice: 8, netTotal: 100 });
      return inv.id;
    };
    // Eski (dönemin başı) şubesi seçilmemiş fatura, yeni ve seçilmiş faturaların arkasında kalırdı
    const eskiAcik = await bill("2026-09-02", "Eski süt", null);
    await bill("2026-11-20", "Yeni süt", LAFPOS_SUBE);
    await bill("2026-11-22", "Daha yeni süt", MODPOS_SUBE);
    const yeniAcik = await bill("2026-11-23", "Açık süt", null);
    await bill("2026-08-30", "Dönem dışı", null);
    // İşletme geneli bilinçli bir seçim: iş beklemez, seçilmişlerle sıralanır
    await bill("2026-11-21", "Ortak süt", "isletme");

    const all = await estimate.loadReceiptInvoices("2026-09-01", "2026-11-25", db);
    assert.equal(all.total, 5, "dönem dışı fatura sayılmaz");
    assert.equal(all.unassigned, 2, "işletme geneli şubesi seçilmemiş sayılmaz");
    assert.deepEqual(
      all.invoices.map((i) => i.supplier),
      ["Açık süt", "Eski süt", "Daha yeni süt", "Ortak süt", "Yeni süt"],
      "önce şubesi seçilmeyenler, sonra seçilmişler (şube ya da işletme geneli); ikisi de en yeni önce",
    );
    assert.deepEqual(all.invoices[0].items, ["Süt 12 LT"]);

    // Liste 2'de kesilince eski açık fatura yine listede; sayılar kesilmeden önceki dönemden
    const cut = await estimate.loadReceiptInvoices("2026-09-01", "2026-11-25", db, 2);
    assert.deepEqual(cut.invoices.map((i) => i.id), [yeniAcik, eskiAcik]);
    assert.equal(cut.total, 5);
    assert.equal(cut.unassigned, 2);
    // Liste 1'de kesilince sayaç yine iki açık fatura der (eskiden yalnız gösterilenleri sayıyordu)
    const one = await estimate.loadReceiptInvoices("2026-09-01", "2026-11-25", db, 1);
    assert.equal(one.invoices.length, 1);
    assert.equal(one.unassigned, 2);
  });

  test("Marina'nın online ay kaydı ayrı anahtarda: loadSiteSales görmez; şubesiz (eski site) yanıt yazılmaz", async () => {
    Object.assign(process.env, { KARAOKE_SYNC_SECRET: SECRET, LAFFOGATO_URL: SITE });
    globalThis.fetch = fakeSite as typeof fetch;
    const sync = await import("../src/server/site-sales/sync");

    const r = await sync.syncBranchSiteSales("marina", ["2026-11"]);
    assert.equal(r.status, "ok", "şubeye göre yanıt yazıldı");
    assert.deepEqual(site.requests, [{ month: "2026-11", branch: "marina" }]);
    const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, "site_sales_sube:marina:2026-11"));
    assert.ok(row, "Marina'nın Kasım kaydı ayrı anahtarda");
    assert.equal((row.value as { branch?: string }).branch, "marina");
    assert.deepEqual((await sync.loadSiteSales()).map((m) => m.month), [], "işletmenin kayıtlarını okuyan (kâr-zarar, KDV, tüketim) Marina'nınkini görmez");
    const marina = await sync.loadBranchSiteSales("marina", ["2026-11", "2026-12"], db);
    assert.deepEqual(marina.map((m) => [m.month, m.cafe.lines[0]?.qty]), [["2026-11", 30]]);
    const ok = await sync.readBranchSalesState("marina");
    assert.ok(ok.lastOkAt, "başarılı çekme durumda");
    assert.equal(ok.lastError, null);

    // Eski site: şubeyi söylemeyen yanıt Marina'ya yazılmaz (işletmenin rakamı Marina'nın kaydına girmesin)
    site.echoBranch = false;
    const old = await sync.syncBranchSiteSales("marina", ["2026-12"]);
    assert.equal(old.status, "error");
    assert.equal((await sync.loadBranchSiteSales("marina", ["2026-12"], db)).length, 0, "Aralık yazılmadı");
    const st = await sync.readBranchSalesState("marina");
    assert.match(st.lastError ?? "", /şubeye göre satış vermedi/);
    assert.equal(st.lastOkAt, ok.lastOkAt, "başarısız denemede son başarılı çekme korunur");
    site.echoBranch = true;
  });

  test("Siteden yenile Marina'yı da ayrıca çeker; tahmin yalnız Marina'nın kasadan geçmeyen siparişini düşer", async () => {
    const sync = await import("../src/server/site-sales/sync");
    site.requests = [];
    const r = await sync.syncSiteSales(["2026-12"]);
    assert.equal(r.status, "ok");
    assert.deepEqual(site.requests.map((q) => q.branch ?? "işletme").sort(), ["işletme", "marina"], "işletmenin ayı şubesiz, Marina'nınki &branch=marina ile");
    assert.deepEqual((await sync.loadSiteSales()).map((m) => [m.month, m.cafe.lines[0]?.qty]), [["2026-12", 50]], "işletmenin kaydı");

    // Marina: Kasım'da 10 LT süt sayıldı; Latte M'nin reçetesi 200 ml süt, siteye bağlı (mnu-0003, M)
    const [sut] = await db.select({ id: s.ingredients.id }).from(s.ingredients).where(eq(s.ingredients.name, "Süt"));
    assert.ok(sut, "önceki testin sütü");
    const [cat] = await db.insert(s.categories).values({ name: "Sıcak kahveler", sortOrder: 1 }).returning({ id: s.categories.id });
    const [latte] = await db
      .insert(s.products)
      .values({ categoryId: cat.id, name: "Latte", size: "M", price: 195, sortOrder: 1, siteMenuId: "mnu-0003", siteMenuSlot: "M" })
      .returning({ id: s.products.id });
    await db.insert(s.recipeItems).values({ productId: latte.id, ingredientId: sut.id, qty: 200 });
    await db.insert(s.stockCounts).values({ month: "2026-11", branchId: LAFPOS_SUBE, ingredientId: sut.id, qty: 10, factor: 1000 });

    const at = new Date("2026-12-10T12:00:00+03:00");
    const e = await estimate.loadStockEstimate(db, at);
    assert.ok(e, "geçiş günü var: tahmin döner");
    const line = e.estimate.lines.find((l) => l.ingredientId === sut.id);
    assert.ok(line, "süt listede");
    assert.equal(line.status, "tahmin");
    // Marina'nın Aralık'ı: 5 Latte × 200 ml × 1,05 (işletmenin kaydındaki 50 Latte değil)
    assert.ok(Math.abs((line.online ?? 0) - 1050) < 1e-6, `online tüketim ${line.online}`);
    assert.ok(Math.abs((line.estimate ?? 0) - (10_000 - 1050)) < 1e-6, `tahmin ${line.estimate}`);
    assert.ok(e.estimate.online, "site bağlı: online özeti var");
    assert.equal(e.estimate.online.orders, 5, "Aralık'ın kasadan geçmeyen siparişi");
    assert.equal(e.estimate.online.tillOrders, 3, "kasada ödenen 2 + elle girilen 1: LafPOS'ta, düşülmez");
    assert.deepEqual(e.estimate.online.missingMonths, [], "Kasım (ortalama) ve Aralık (dönem) var");

    // Marina'nın Aralık kaydı yokken ay eksik görünür ve düşülmez
    await db.delete(s.integrationState).where(eq(s.integrationState.key, "site_sales_sube:marina:2026-12"));
    const missing = await estimate.loadStockEstimate(db, at);
    assert.deepEqual(missing?.estimate.online?.missingMonths, ["2026-12"]);
    assert.equal(missing?.estimate.lines.find((l) => l.ingredientId === sut.id)?.online, 0, "kayıt yokken düşülmez");
  });
});
