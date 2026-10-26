// Sayım listesi ve hammadde eylemleri gerçek Postgres'te, oturum ve next/cache taklit edilerek (denetim 26 Eki 2026 B02):
// aktif bir ürünün reçetesindeki malzeme pasif yapılamaz (E-04), pasif ama aktif reçetede geçen malzemenin sayımı kaydedilir;
// zayi / ikram kaydı olan malzeme silinmez, kayıt malzemesini korur (E-28); fiyatsız ek kalem yöneticiye bildirilir (E-22).
//
// SAYIM_TEST_DATABASE_URL (yoksa EKLE_TEST_DATABASE_URL) verilmezse atlanır. Bir Postgres sunucusunun adresi
// (veritabanı oluşturabilen kullanıcı): test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: SAYIM_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/sayim-deger-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SAYIM_TEST_DATABASE_URL ?? process.env.EKLE_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sayim_deger_${process.pid}`;

describe("sayım listesi, pasif malzeme ve silme: veritabanında", { skip: !SERVER_URL && "SAYIM_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let stock: typeof import("../src/server/actions/stock");
  let ingredients: typeof import("../src/server/actions/ingredients");
  let loadModel: typeof import("../src/server/data/dataset").loadModel;
  const who: { role: "admin" | "staff" } = { role: "admin" };
  let users: { admin: typeof s.users.$inferSelect; staff: typeof s.users.$inferSelect };
  let syrup = 0;
  let lemonTea = 0;
  let category = 0;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "sayim-deger-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır; oturum ve sayfa yenileme taklit edilir
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
    const [a] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const [p] = await db.insert(s.users).values({ email: "ayse@laffogato.net", name: "Ayşe", passwordHash: "x", role: "staff" }).returning();
    users = { admin: a, staff: p };
    const me = async () => ({ ...users[who.role], role: who.role });
    stub(require.resolve("../src/server/auth/dal"), {
      requireUser: me,
      requireAdmin: async () => {
        if (who.role !== "admin") throw new Error("yalnız yönetici");
        return me();
      },
    });
    stock = await import("../src/server/actions/stock");
    ingredients = await import("../src/server/actions/ingredients");
    loadModel = (await import("../src/server/data/dataset")).loadModel;
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE stock_counts, stock_extras, waste_entries, activity_log RESTART IDENTITY CASCADE`);
    await db.execute(sql`DELETE FROM recipe_items`);
    await db.execute(sql`DELETE FROM products`);
    await db.execute(sql`DELETE FROM categories`);
    await db.execute(sql`DELETE FROM ingredients`);
    const [c] = await db.insert(s.categories).values({ name: "Soğuk içecekler", sortOrder: 1 }).returning({ id: s.categories.id });
    category = c.id;
    const [ing] = await db
      .insert(s.ingredients)
      .values({ name: "Lime şurubu", category: "Sos & Şurup", unit: "ml", packagePrice: 300, packageSize: 1000, priceSource: "manual", countUnit: "LT", countGroup: "ŞURUP" })
      .returning({ id: s.ingredients.id });
    syrup = ing.id;
    const [prod] = await db.insert(s.products).values({ categoryId: category, name: "Lemon Tea", size: "M", price: 180 }).returning({ id: s.products.id });
    lemonTea = prod.id;
    await db.insert(s.recipeItems).values({ productId: lemonTea, ingredientId: syrup, qty: 30 });
  });

  afterEach(() => {
    mock.timers.reset();
    who.role = "admin";
  });

  const at = (iso: string) => mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
  const syrupRow = async () => (await db.select().from(s.ingredients).where(eq(s.ingredients.id, syrup)))[0];

  test("E-04: aktif ürünün reçetesindeki malzeme pasif yapılamaz (iki yoldan); ürün pasifken yapılır", async () => {
    const res = await ingredients.setIngredientActive(syrup, false);
    assert.equal(res.ok, false);
    assert.match(!res.ok ? res.error : "", /“Lime şurubu” 1 aktif ürünün reçetesinde kullanılıyor \(Lemon Tea · M\)\. Pasif yapmadan önce/);
    assert.equal((await syrupRow()).active, true, "aktif kaldı");
    // Düzenleme penceresinin "Aktif" kutusu (saveIngredient) aynı kapıdan
    const ing = await syrupRow();
    const viaForm = await ingredients.saveIngredient({
      id: syrup,
      name: ing.name,
      category: ing.category,
      supplier: null,
      packageDesc: null,
      packagePrice: ing.packagePrice,
      packageSize: ing.packageSize,
      unit: "ml",
      vatRate: ing.vatRate,
      note: null,
      isEstimate: false,
      priceSource: "manual",
      countUnit: "LT",
      countGroup: "ŞURUP",
      active: false,
    });
    assert.equal(viaForm.ok, false);
    assert.equal((await syrupRow()).active, true);
    // Silme de reddedilir ve ürünü sayar (pasif yapmayı önermez)
    const del = await ingredients.deleteIngredient(syrup);
    assert.equal(del.ok, false);
    assert.match(!del.ok ? del.error : "", /1 aktif ürünün reçetesinde kullanılıyor \(Lemon Tea · M\)\. Önce reçetelerden çıkarın\.$/);
    // Ürün emekliye ayrılınca (yalnız pasif ürünün reçetesinde) pasif yapılabilir; silme yine reçeteyi söyler
    await db.update(s.products).set({ active: false }).where(eq(s.products.id, lemonTea));
    assert.match((await ingredients.deleteIngredient(syrup) as { error: string }).error, /yalnız pasif ürünlerin reçetelerinde/);
    assert.deepEqual(await ingredients.setIngredientActive(syrup, false), { ok: true, data: null });
    assert.equal((await syrupRow()).active, false);
  });

  test("E-04: pasif ama aktif reçetede geçen malzeme sayım listesinde kalır ve sayımı kaydedilir", async () => {
    at("2026-10-31T19:00:00Z");
    // Eski veride malzeme zaten pasif (engel gelmeden önce pasif yapılmış)
    await db.update(s.ingredients).set({ active: false }).where(eq(s.ingredients.id, syrup));
    const model = await loadModel();
    const line = model.stockSheet("2026-11").groups.flatMap((g) => g.lines).find((l) => l.ingredient.id === syrup);
    assert.ok(line, "Kasım sayım listesinde");
    assert.equal(line!.archived, false);
    assert.equal(line!.passiveInUse, true);
    // Sayım kaydı reddedilmez (personel de)
    who.role = "staff";
    assert.equal((await stock.saveStockCounts("2026-10", [{ ingredientId: syrup, qty: 2.5, base: null }])).ok, true);
    const [c] = await db.select().from(s.stockCounts).where(and(eq(s.stockCounts.month, "2026-10"), eq(s.stockCounts.ingredientId, syrup)));
    assert.equal(c.qty, 2.5);
    assert.equal(c.factor, 1000, "bugünkü sayım birimiyle");
    // Ürün de pasif olunca listeden düşer: yeni sayım reddedilir (yöneticiye de; Ekim'in kayıtlı sayımı arşivde kalır)
    who.role = "admin";
    await db.update(s.products).set({ active: false }).where(eq(s.products.id, lemonTea));
    const off = (await loadModel()).stockSheet("2026-11").groups.flatMap((g) => g.lines).find((l) => l.ingredient.id === syrup);
    assert.equal(off, undefined, "Kasım listesinde yok");
    const refused = await stock.saveStockCounts("2026-11", [{ ingredientId: syrup, qty: 1, base: null }]);
    assert.equal(refused.ok, false);
    assert.match(!refused.ok ? refused.error : "", /sayım listesinde değil/);
  });

  test("E-28: zayi / ikram kaydı olan malzeme silinmez, kayıt malzemesini korur", async () => {
    // Reçetede olmayan, sayımı ve alımı olmayan Limon; Eylül'de iki zayi
    const [limon] = await db
      .insert(s.ingredients)
      .values({ name: "Limon", category: "Meyve", unit: "gr", packagePrice: 60, packageSize: 1000, priceSource: "manual", countUnit: null })
      .returning({ id: s.ingredients.id });
    await db.insert(s.wasteEntries).values([
      { date: "2026-09-12", kind: "zayi", ingredientId: limon.id, name: "Limon", qty: 2, unit: "KG", factor: 1000, createdByName: "Ayşe" },
      { date: "2026-09-20", kind: "zayi", ingredientId: limon.id, name: "Limon", qty: 1, unit: "KG", factor: 1000, createdByName: "Ayşe" },
    ]);
    const res = await ingredients.deleteIngredient(limon.id);
    assert.equal(res.ok, false);
    assert.match(!res.ok ? res.error : "", /2 zayi \/ ikram kaydı var; silinirse geçmiş ayların stok, zayi ve tutarlılık değerleri değişir\. Pasif yapın\.$/);
    const rows = await db.select().from(s.wasteEntries).where(eq(s.wasteEntries.ingredientId, limon.id));
    assert.equal(rows.length, 2, "zayi kayıtları malzemesine bağlı");
    // Pasif yapmak serbest (reçetede yok)
    assert.equal((await ingredients.setIngredientActive(limon.id, false)).ok, true);
    // Geçmişi olmayan malzeme silinir
    const [bos] = await db
      .insert(s.ingredients)
      .values({ name: "Deneme", category: "Meyve", unit: "gr", packagePrice: 1, packageSize: 1, priceSource: "manual" })
      .returning({ id: s.ingredients.id });
    assert.deepEqual(await ingredients.deleteIngredient(bos.id), { ok: true, data: null });
  });
});
