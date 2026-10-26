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
  let alerts: typeof import("../src/server/data/count-alerts");
  let opsBell: typeof import("../src/server/bell/ops").opsBell;
  let extrasActions: typeof import("../src/app/panel/sayim/actions");
  let products: typeof import("../src/server/actions/products");
  let countProgress: typeof import("../src/server/data/count-progress").countProgress;
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
    alerts = await import("../src/server/data/count-alerts");
    opsBell = (await import("../src/server/bell/ops")).opsBell;
    extrasActions = await import("../src/app/panel/sayim/actions");
    products = await import("../src/server/actions/products");
    countProgress = (await import("../src/server/data/count-progress")).countProgress;
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

  const at = (iso: string) => {
    mock.timers.reset();
    mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
  };
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

  const bellOf = async (role: "admin" | "staff") => opsBell({ ...users[role], role } as Parameters<typeof opsBell>[0]);

  test("Sayım ilerlemesi (Bugün, zil, ay sonu bildirimi) Stok sayımı listesiyle aynı: pasif ama aktif reçetede geçen kalem de sayılır", async () => {
    at("2026-11-03T09:00:00Z");
    const { countStatus } = await import("../src/app/panel/sayim/logic");
    const [milk] = await db
      .insert(s.ingredients)
      .values({ name: "Süt", category: "Süt", unit: "ml", packagePrice: 40, packageSize: 1000, priceSource: "manual", countUnit: "LT", countGroup: "SÜT" })
      .returning({ id: s.ingredients.id });
    // Lime şurubu eski veride pasif ama Lemon Tea'nin reçetesinde; Ekim'de yalnız süt sayıldı
    await db.update(s.ingredients).set({ active: false }).where(eq(s.ingredients.id, syrup));
    await db.insert(s.stockCounts).values({ month: "2026-10", ingredientId: milk.id, qty: 4, factor: 1000, countedBy: "Ayşe" });
    const status = countStatus((await loadModel()).stockSheet("2026-10"));
    assert.deepEqual(status, { counted: 1, total: 2, complete: false });
    assert.deepEqual(await countProgress("2026-10"), { counted: status.counted, total: status.total });
    // Zil de yarım der (ayın ilk 10 günü, yönetici)
    const bell = await bellOf("admin");
    assert.ok(
      bell.some((n) => /Ekim 2026/.test(n.title) && /1 \/ 2/.test(`${n.title} ${n.body}`)),
      JSON.stringify(bell.map((n) => [n.id, n.title, n.body])),
    );
    // Şurup da sayılınca ikisi de tamam
    await db.insert(s.stockCounts).values({ month: "2026-10", ingredientId: syrup, qty: 1.5, factor: 1000, countedBy: "Ayşe" });
    assert.deepEqual(countStatus((await loadModel()).stockSheet("2026-10")), { counted: 2, total: 2, complete: true });
    assert.deepEqual(await countProgress("2026-10"), { counted: 2, total: 2 });
    // Ürün de pasif olunca şurup listeden düşer: Kasım'da ikisi de yalnız sütü sayar (Ekim'in kaydı arşivde kalır)
    await db.update(s.products).set({ active: false }).where(eq(s.products.id, lemonTea));
    const nov = countStatus((await loadModel()).stockSheet("2026-11"));
    assert.deepEqual(nov, { counted: 0, total: 1, complete: false });
    assert.deepEqual(await countProgress("2026-11"), { counted: 0, total: 1 });
  });

  test("Pasif malzeme yazımla aktif bir reçeteye girince sayım listesine bu aydan girer; zaten listedeyse dokunulmaz", async () => {
    at("2026-11-03T09:00:00Z");
    // Ürün emekli, şurup pasif (yalnız pasif ürünün reçetesinde: listede değil)
    await db.update(s.products).set({ active: false }).where(eq(s.products.id, lemonTea));
    await db.update(s.ingredients).set({ active: false, countFrom: null }).where(eq(s.ingredients.id, syrup));
    const listedIn = async (m: string) => (await loadModel()).stockSheet(m).groups.flatMap((g) => g.lines).some((l) => l.ingredient.id === syrup);
    assert.equal(await listedIn("2026-11"), false);
    // Ürün reçete kartından yeniden aktif olur: şurup Kasım'dan listede, geçmiş aylar "yarım" olmaz
    const recipe = {
      productId: lemonTea,
      name: "Lemon Tea",
      size: "M" as const,
      categoryId: category,
      price: 180,
      fireOverride: null,
      note: null,
      active: true,
      showOnMenu: true,
      items: [{ ingredientId: syrup, qty: 30, qtyExpr: null, note: null }],
    };
    const saved = await products.saveRecipe(recipe);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal((await syrupRow()).countFrom, "2026-11");
    assert.equal(await listedIn("2026-11"), true);
    assert.equal(await listedIn("2026-10"), false, "Ekim'in listesine girmez (o ay ürün emekliydi)");
    // Aynı reçete yeniden kaydedilir (şurup zaten listede): count_from değişmez
    at("2026-12-02T09:00:00Z");
    assert.equal((await products.saveRecipe(recipe)).ok, true);
    assert.equal((await syrupRow()).countFrom, "2026-11");
    // Kopyalanan ürün: şurup zaten listede, dokunulmaz; yeni pasif malzemeli kopya listeye bu aydan alır
    const [vanilla] = await db
      .insert(s.ingredients)
      .values({ name: "Vanilya şurubu", category: "Sos & Şurup", unit: "ml", packagePrice: 300, packageSize: 1000, priceSource: "manual", countUnit: "LT", countGroup: "ŞURUP", active: false, countFrom: "2026-03" })
      .returning({ id: s.ingredients.id });
    const [retired] = await db.insert(s.products).values({ categoryId: category, name: "Vanilla Latte", size: "M", price: 190, active: false }).returning({ id: s.products.id });
    await db.insert(s.recipeItems).values([
      { productId: retired.id, ingredientId: vanilla.id, qty: 20 },
      { productId: retired.id, ingredientId: syrup, qty: 5 },
    ]);
    const copy = await products.createProduct({ name: "Vanilla Latte", size: "L", categoryId: category, price: 210, copyFromId: retired.id });
    assert.equal(copy.ok, true, JSON.stringify(copy));
    const vanillaRow = (await db.select().from(s.ingredients).where(eq(s.ingredients.id, vanilla.id)))[0];
    assert.equal(vanillaRow.countFrom, "2026-12");
    assert.equal((await syrupRow()).countFrom, "2026-11", "zaten listedeydi");
  });

  test("Migration 0043: eski veride pasif ama aktif reçetede geçen kalem bu aydan listede; ötekilere dokunmaz", async () => {
    const { readFileSync } = await import("node:fs");
    const [other] = await db
      .insert(s.ingredients)
      .values({ name: "Eski şurup", category: "Sos & Şurup", unit: "ml", packagePrice: 300, packageSize: 1000, priceSource: "manual", countUnit: "LT", active: false })
      .returning({ id: s.ingredients.id });
    const [later] = await db
      .insert(s.ingredients)
      .values({ name: "İleri şurup", category: "Sos & Şurup", unit: "ml", packagePrice: 300, packageSize: 1000, priceSource: "manual", countUnit: "LT", active: false, countFrom: "2099-01" })
      .returning({ id: s.ingredients.id });
    await db.insert(s.recipeItems).values({ productId: lemonTea, ingredientId: later.id, qty: 1 });
    await db.update(s.ingredients).set({ active: false, countFrom: "2026-01" }).where(eq(s.ingredients.id, syrup));
    await db.execute(sql.raw(readFileSync("drizzle/0043_pasif_recetede_sayim.sql", "utf8")));
    const [{ month }] = (await db.execute(sql`SELECT to_char(now() AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM') AS month`)) as unknown as { month: string }[];
    const fromOf = async (id: number) => (await db.select({ f: s.ingredients.countFrom }).from(s.ingredients).where(eq(s.ingredients.id, id)))[0].f;
    assert.equal(await fromOf(syrup), month, "reçetede: bu aydan");
    assert.equal(await fromOf(other.id), null, "hiçbir aktif reçetede yok: dokunulmaz");
    assert.equal(await fromOf(later.id), "2099-01", "ileri bir aydan çıkan kalem: dokunulmaz");
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

  test("E-22: fiyatsız ek kalem yöneticinin zilinde; fiyat girilince kalkar; personelde yok", async () => {
    at("2026-11-03T09:00:00Z");
    await db.insert(s.stockExtras).values([
      { month: "2026-10", name: "Bulaşık deterjanı", unit: "BİDON", qty: 4, unitPrice: 0 },
      { month: "2026-10", name: "Kağıt havlu", unit: "ADET", qty: 12, unitPrice: 0 },
      { month: "2026-10", name: "Peçete", unit: "PAKET", qty: 3, unitPrice: 12.5 },
      // Miktarı 0 olan fiyatsız kalem stok değerine girmez: uyarı yok
      { month: "2026-10", name: "Eldiven", unit: "KUTU", qty: 0, unitPrice: 0 },
      // İki ay önce: uyarı penceresinin dışında
      { month: "2026-09", name: "Eski kalem", unit: "ADET", qty: 2, unitPrice: 0 },
    ]);
    const u = await alerts.loadUnpricedExtras(["2026-11", "2026-10"]);
    assert.deepEqual(
      u.map((x) => [x.month, x.count, x.names]),
      [["2026-10", 2, ["Bulaşık deterjanı", "Kağıt havlu"]]],
    );
    const line = (await bellOf("admin")).find((n) => n.id.startsWith("sayim-ek-fiyatsiz-"));
    assert.ok(line, "yöneticinin zilinde");
    assert.equal(line!.title, "Ekim 2026: 2 ek kalemin fiyatı yok");
    assert.equal(line!.href, "/panel/sayim?ay=2026-10#listede-olmayanlar");
    assert.equal(line!.group, "uyari");
    assert.ok(!(await bellOf("staff")).some((n) => n.id.startsWith("sayim-ek-fiyatsiz-")), "personelde yok");
    // Yönetici fiyatları girer (ek kalemler formu): satır kalkar
    const rows = (await db.select().from(s.stockExtras).where(eq(s.stockExtras.month, "2026-10"))).sort((a, b) => a.id - b.id);
    const { extrasBase } = await import("../src/app/panel/sayim/logic");
    const saved = await stock.saveStockExtras(
      "2026-10",
      rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, qty: r.qty, unitPrice: r.unitPrice || 40 })),
      extrasBase(rows),
    );
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.deepEqual(await alerts.loadUnpricedExtras(["2026-11", "2026-10"]), []);
    assert.ok(!(await bellOf("admin")).some((n) => n.id.startsWith("sayim-ek-fiyatsiz-")), "fiyat girilince kalkar");
  });

  test("Personel geçen ayın sayımını ay bittikten sonra değiştirince yöneticiye zil satırı (yöneticinin kendi kaydı sayılmaz)", async () => {
    await db.insert(s.stockCounts).values({ month: "2026-10", ingredientId: syrup, qty: 3, factor: 1000, countedBy: "Ayşe" });
    // İşlem geçmişinin anı veritabanının saatiyle yazılır (taklit edilen saat değil): her kaydın anı elle verilir
    const stamp = (iso: string) => db.execute(sql`UPDATE activity_log SET at = ${iso}::timestamptz WHERE id = (SELECT max(id) FROM activity_log)`);
    // Ekim 31 gece yarısından sonra (iş günü hâlâ Ekim): ay sonu sayımının parçası, uyarı yok
    at("2026-10-31T22:30:00Z");
    who.role = "staff";
    assert.equal((await stock.saveStockCounts("2026-10", [{ ingredientId: syrup, qty: 2.5, base: 3 }])).ok, true);
    await stamp("2026-10-31T22:30:00Z");
    assert.deepEqual(await alerts.loadStaffLateEdits("2026-10"), []);
    // 3 Kasım: personel Ekim'i düzeltir (pencere içinde: kaydedilir) ve ek kalem ekler
    at("2026-11-03T07:10:00Z");
    assert.equal((await stock.saveStockCounts("2026-10", [{ ingredientId: syrup, qty: 2, base: 2.5 }])).ok, true);
    await stamp("2026-11-03T07:10:00Z");
    const { extrasBase } = await import("../src/app/panel/sayim/logic");
    assert.equal((await extrasActions.saveStaffStockExtras("2026-10", [{ name: "Kağıt havlu", unit: "ADET", qty: 12 }], extrasBase([]))).ok, true);
    await stamp("2026-11-03T07:12:00Z");
    // Yöneticinin kendi düzeltmesi sayılmaz
    who.role = "admin";
    assert.equal((await stock.saveStockCounts("2026-10", [{ ingredientId: syrup, qty: 2.2, base: 2 }])).ok, true);
    await stamp("2026-11-03T08:00:00Z");
    const edits = await alerts.loadStaffLateEdits("2026-10");
    assert.deepEqual(
      edits.map((e) => [e.name, e.saves, e.items]),
      [["Ayşe", 2, 2]],
    );
    const line = (await bellOf("admin")).find((n) => n.id.startsWith("sayim-personel-2026-10-"));
    assert.ok(line, "yöneticinin zilinde");
    assert.equal(line!.title, "Ayşe, Ekim 2026 sayımını değiştirdi");
    assert.match(line!.body, /^Ay bittikten sonra 2 kayıt, 2 kalem\./);
    assert.ok(!(await bellOf("staff")).some((n) => n.id.startsWith("sayim-personel-")), "personelde yok");
  });
});

// Taze ortam (E-29): db:seed Excel'i yükledikten sonra sayıma sonradan eklenen sekiz kalemi de ekler (migration boş
// veritabanında atlar); reçeteler değişmez. Kendi geçici veritabanını açar, sonunda siler.
describe("taze db:seed: sayım listesinin sekiz kalemi", { skip: !SERVER_URL && "SAYIM_TEST_DATABASE_URL yok" }, () => {
  const NAME = `laffogato_seed_deger_${process.pid}`;
  let admin: postgres.Sql;
  let target: postgres.Sql;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${NAME}`);
  });

  after(async () => {
    await target?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin?.end();
  });

  test("sekiz kalem tahmini fiyatla, Ekim 2026'dan sayım listesinde; hiçbir reçetede yok; ikinci seed eklemez", async () => {
    const url = new URL(SERVER_URL!);
    url.pathname = `/${NAME}`;
    const { createDb } = await import("../src/server/db");
    const mdb = createDb(url.href, 1);
    await migrate(mdb, { migrationsFolder: "drizzle" });
    await mdb.$client.end();
    const { runSeed } = await import("../scripts/seed");
    const env = { url: process.env.DATABASE_URL_UNPOOLED, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
    process.env.DATABASE_URL_UNPOOLED = url.href;
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
    const log = console.log;
    const lines: string[] = [];
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      await runSeed();
      await runSeed();
    } finally {
      console.log = log;
      if (env.url === undefined) delete process.env.DATABASE_URL_UNPOOLED;
      else process.env.DATABASE_URL_UNPOOLED = env.url;
      if (env.email !== undefined) process.env.ADMIN_EMAIL = env.email;
      if (env.password !== undefined) process.env.ADMIN_PASSWORD = env.password;
    }
    assert.ok(lines.some((l) => /✓ Excel verisi yüklendi: 74 hammadde \(\+8 sayım kalemi\)/.test(l)), lines.join("\n"));
    target = postgres(url.href, { max: 1, onnotice: () => {} });
    const eight = ["Çilek şurubu", "Cookie şurubu", "Lemon tea şurubu", "Hazelnut şurubu", "Vanilya sos", "Yaban mersini püre", "Böğürtlen püre", "Klips kapak"];
    const rows = await target<{ id: number; name: string; count_from: string; is_estimate: boolean; active: boolean; count_unit: string }[]>`
      SELECT id, name, count_from, is_estimate, active, count_unit FROM ingredients WHERE name IN ${target(eight)} ORDER BY sort_order`;
    assert.deepEqual(
      rows.map((r) => r.name),
      eight,
    );
    assert.ok(rows.every((r) => r.count_from === "2026-10" && r.is_estimate && r.active && r.count_unit), "Ekim'den listede, tahmini");
    const [{ n }] = await target<{ n: number }[]>`SELECT count(*)::int AS n FROM ingredients`;
    assert.equal(n, 82, "ikinci seed eklemez");
    const [{ used }] = await target<{ used: number }[]>`SELECT count(*)::int AS used FROM recipe_items WHERE ingredient_id IN ${target(rows.map((r) => r.id))}`;
    assert.equal(used, 0, "reçeteler değişmedi (sahibin cevabı bekleniyor)");
    const [{ prices }] = await target<{ prices: number }[]>`SELECT count(*)::int AS prices FROM ingredient_prices WHERE ingredient_id IN ${target(rows.map((r) => r.id))}`;
    assert.equal(prices, 8, "fiyat geçmişi tahminle başlar");
  });
});
