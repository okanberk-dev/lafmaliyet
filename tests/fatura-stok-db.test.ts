// Faturadan stoğa doğru miktar ve fiyat (denetim 26 Eki, parti B03), gerçek Postgres'te; oturum ve next/cache taklit
// edilir:
// - E-06: fiyatı olmayan hammaddenin ilk fiyatı çarpanı faturanın ölçü biriminden gelmiyorsa onaya düşer (iki sayılı paket
//   adından ya da elle yazılan çarpanla yazılmaz); kg / lt çevirisiyle gelen ilk fiyat yazılır.
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
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE ingredient_price_holds, ingredient_prices, parasut_product_links, purchase_quantities, parasut_bill_lines, invoices, ingredients, integration_state, activity_log RESTART IDENTITY CASCADE`,
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

  test("E-06: şimdiki fiyatı olan hammaddede kural değişmez (%40 içi yazılır)", async () => {
    const milk = await ingredient("Süt", "ml", { packagePrice: 30, packageSize: 1000 });
    await bill({ date: "2026-10-12", productKey: "p:sut", productName: "SÜT 1 L", unit: "Adet", quantity: 10, netTotal: 330 });
    await link("p:sut", "SÜT 1 L", milk.id, 1000);
    const r = await sync.applyProductLinks();
    assert.deepEqual([r.prices, r.held], [1, 0]);
    const m = await ing(milk.id);
    assert.deepEqual([m.packagePrice, m.packageSize], [33, 1000]);
  });
});
