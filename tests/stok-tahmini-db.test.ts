// Tahmini stoğun LafPOS başlangıcı gerçek Postgres'te (docs/STOK-TAHMINI.md): geçiş ayında Marina'nın ModPOS listesi
// ayın bir gününde bitiyorsa (sales.coverage, integration_state'te) LafPOS satışları ertesi günden sayılır. Kayıt
// settings'te aranırsa hep boş kalıyordu ve başlangıç sonraki ayın 1'ine kayıyordu.
//
// Kendi geçici veritabanını açar (STOK_TAHMINI_TEST_DATABASE_URL'in sunucusunda), sonunda siler. Değişken yoksa atlanır.
// Çalıştırma: STOK_TAHMINI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/stok-tahmini-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { SALES_COVERAGE_BRANCH_KEY, SALES_COVERAGE_KEY } from "../src/lib/sales-coverage";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

import { LAFPOS_SUBE, MODPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.STOK_TAHMINI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_stok_tahmini_${process.pid}`;
const NOW = new Date("2026-11-25T12:00:00+03:00");

describe("Tahmini stok: LafPOS'un sayıldığı ilk gün", { skip: !SERVER_URL && "STOK_TAHMINI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let estimate: typeof import("../src/server/data/stock-estimate");

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
    /** Hammaddeye bağlı tek kalemli Paraşüt faturası; `branch` verilirse şubesi seçilmiş */
    const bill = async (date: string, supplier: string, branch: string | null) => {
      const [inv] = await db
        .insert(s.invoices)
        .values({ date, supplier, category: "Hammadde & İçecek", amount: 100, payable: 120, source: "parasut", origin: "parasut" })
        .returning();
      await db.insert(s.parasutBillLines).values({ invoiceId: inv.id, externalId: `l-${inv.id}`, productKey: "p:sut", productName: "SÜT 1 LT", unit: "Adet", quantity: 12, unitPrice: 8, netTotal: 100 });
      if (branch) await db.insert(s.stockReceipts).values({ invoiceId: inv.id, branchId: branch });
      return inv.id;
    };
    // Eski (dönemin başı) şubesi seçilmemiş fatura, yeni ve seçilmiş faturaların arkasında kalırdı
    const eskiAcik = await bill("2026-09-02", "Eski süt", null);
    await bill("2026-11-20", "Yeni süt", LAFPOS_SUBE);
    await bill("2026-11-22", "Daha yeni süt", MODPOS_SUBE);
    const yeniAcik = await bill("2026-11-23", "Açık süt", null);
    await bill("2026-08-30", "Dönem dışı", null);

    const all = await estimate.loadReceiptInvoices("2026-09-01", "2026-11-25", db);
    assert.equal(all.total, 4, "dönem dışı fatura sayılmaz");
    assert.equal(all.unassigned, 2);
    assert.deepEqual(
      all.invoices.map((i) => i.supplier),
      ["Açık süt", "Eski süt", "Daha yeni süt", "Yeni süt"],
      "önce şubesi seçilmeyenler, sonra seçilmişler; ikisi de en yeni önce",
    );
    assert.deepEqual(all.invoices[0].items, ["Süt 12 LT"]);

    // Liste 2'de kesilince eski açık fatura yine listede; sayılar kesilmeden önceki dönemden
    const cut = await estimate.loadReceiptInvoices("2026-09-01", "2026-11-25", db, 2);
    assert.deepEqual(cut.invoices.map((i) => i.id), [yeniAcik, eskiAcik]);
    assert.equal(cut.total, 4);
    assert.equal(cut.unassigned, 2);
    // Liste 1'de kesilince sayaç yine iki açık fatura der (eskiden yalnız gösterilenleri sayıyordu)
    const one = await estimate.loadReceiptInvoices("2026-09-01", "2026-11-25", db, 1);
    assert.equal(one.invoices.length, 1);
    assert.equal(one.unassigned, 2);
  });
});
