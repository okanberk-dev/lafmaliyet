// Menü maliyeti gerçek Postgres'te, oturum ve next/cache taklit edilerek (denetim 26 Eki 2026 B13): Ürünler › Yeni ürün
// ile açılan, satış satırı eşleştirilen ama reçetesi henüz boş ürün sıfır maliyet sayılmaz (E-47); reçetesi girilince
// kendi maliyetiyle sayılır. Su + buz litre maliyeti aynı ayın laffogato.net siparişlerinin suyunu da sayar (E-57).
//
// MENU_TEST_DATABASE_URL (yoksa FIFO_TEST_DATABASE_URL) verilmezse atlanır. Bir Postgres sunucusunun adresi
// (veritabanı oluşturabilen kullanıcı): test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: MENU_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/menu-maliyet-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.MENU_TEST_DATABASE_URL ?? process.env.FIFO_TEST_DATABASE_URL;
const DB_NAME = `laffogato_menu_maliyet_${process.pid}`;
const M = "2026-09";

function close(actual: number | null | undefined, expected: number, label: string, eps = 1e-6) {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < eps, `${label}: beklenen ${expected}, bulunan ${actual}`);
}

describe("reçetesiz ürün ve su maliyeti: veritabanında", { skip: !SERVER_URL && "MENU_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let products: typeof import("../src/server/actions/products");
  let sales: typeof import("../src/server/actions/sales");
  let loadModel: typeof import("../src/server/data/dataset").loadModel;
  let insights: typeof import("../src/lib/calc/insights");
  let tasks: typeof import("../src/app/panel/dashboard-tasks");
  let category = 0;
  let milk = 0;
  let coffee = 0;
  let water = 0;
  let latte = 0;
  let americano = 0;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "menu-maliyet-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    const me = async () => ({ ...a, role: "admin" as const });
    stub(require.resolve("../src/server/auth/dal"), { requireUser: me, requireAdmin: me });
    products = await import("../src/server/actions/products");
    sales = await import("../src/server/actions/sales");
    loadModel = (await import("../src/server/data/dataset")).loadModel;
    insights = await import("../src/lib/calc/insights");
    tasks = await import("../src/app/panel/dashboard-tasks");

    const [c] = await db.insert(s.categories).values({ name: "Sıcak kahveler", sortOrder: 1 }).returning({ id: s.categories.id });
    category = c.id;
    const [m] = await db
      .insert(s.ingredients)
      .values({ name: "Süt", category: "Süt", unit: "ml", packagePrice: 40, packageSize: 1000, priceSource: "manual", countUnit: "LT", countGroup: "SÜT" })
      .returning({ id: s.ingredients.id });
    milk = m.id;
    const [w] = await db
      .insert(s.ingredients)
      .values({ name: "Su", category: "Su", unit: "ml", packagePrice: 0, packageSize: 1000, priceSource: "water", vatRate: 0.2 })
      .returning({ id: s.ingredients.id });
    water = w.id;
    const [k] = await db
      .insert(s.ingredients)
      .values({ name: "Espresso çekirdeği", category: "Kahve", unit: "gr", packagePrice: 1_200, packageSize: 1000, priceSource: "manual", countUnit: "KG", countGroup: "KAHVE" })
      .returning({ id: s.ingredients.id });
    coffee = k.id;
    const [l] = await db.insert(s.products).values({ categoryId: category, name: "Latte", size: "M", price: 165 }).returning({ id: s.products.id });
    latte = l.id;
    const [am] = await db.insert(s.products).values({ categoryId: category, name: "Americano", size: "M", price: 130, siteMenuId: "mnu-0010", siteMenuSlot: "M" }).returning({ id: s.products.id });
    americano = am.id;
    await db.insert(s.recipeItems).values([
      { productId: latte, ingredientId: milk, qty: 200 },
      { productId: americano, ingredientId: coffee, qty: 18 },
      { productId: americano, ingredientId: water, qty: 180 },
    ]);
    // Eylül satış listesi: Latte, Americano ve henüz ürünü olmayan "PUMPKIN LATTE M"
    await db.insert(s.months).values({ month: M, openDays: 30, posRevenue: 60_000 });
    await db.insert(s.salesLines).values([
      { month: M, posName: "LATTE M", qty: 200, revenue: 33_000, productId: latte, sortOrder: 1 },
      { month: M, posName: "AMERICANO M", qty: 100, revenue: 13_000, productId: americano, sortOrder: 2 },
      { month: M, posName: "PUMPKIN LATTE M", qty: 60, revenue: 13_200, productId: null, sortOrder: 3 },
    ]);
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const pumpkinId = async () => (await db.select({ id: s.products.id }).from(s.products).where(eq(s.products.name, "Pumpkin Latte")))[0]?.id;
  const satisTask = async () => {
    const model = await loadModel();
    const d = insights.dashboard(model, M);
    return tasks.monthTasks(tasks.monthTaskFacts(model, M, d.monthState, d.refMonth, { payments: null, parasut: null })).find((t) => t.key === "satis")!;
  };

  test("E-47: Yeni ürün açılıp satırı eşleştirilen, reçetesi boş ürün ortalama oranla maliyetlenir; reçete girilince kendi maliyetiyle", async () => {
    const unmatched = (await loadModel()).monthSales(M);
    const pumpkinLine = unmatched.lines.find((l) => l.line.posName === "PUMPKIN LATTE M")!;
    assert.equal(pumpkinLine.matched, false);

    // Sahip Ürünler › Yeni ürün ile açar, Satışlar'da satırı eşler (reçete bir hafta sonra)
    const created = await products.createProduct({ name: "Pumpkin Latte", size: "M", categoryId: category, price: 220 });
    assert.equal(created.ok, true, JSON.stringify(created));
    const pumpkin = (await pumpkinId())!;
    const matched = await sales.setLineMatch(pumpkinLine.line.id, pumpkin, false);
    assert.equal(matched.ok, true, JSON.stringify(matched));

    const model = await loadModel();
    const ms = model.monthSales(M);
    const line = ms.lines.find((l) => l.line.posName === "PUMPKIN LATTE M")!;
    assert.equal(line.matched, true, "satır ürüne bağlı");
    assert.equal(line.noRecipe, true);
    assert.equal(line.unitCost, null);
    assert.equal(model.products.find((p) => p.product.id === pumpkin)!.status, "Reçete yok");
    // Ortalama oran yalnız reçeteli satırlardan; eşleşmemiş hâliyle aynı oran ve aynı brüt kâr
    close(ms.avgCostRatio, unmatched.avgCostRatio, "ortalama oran değişmedi");
    close(ms.grossProfit, unmatched.grossProfit, "brüt kâr eşleşmemiş hâliyle aynı");
    close(line.cost, line.net * ms.avgCostRatio, "net × ortalama oran");
    assert.ok(line.cost > 0, "sıfır maliyet değil");
    assert.deepEqual(ms.noRecipe.map((l) => l.line.id), [line.line.id]);
    // Analiz: Yıldız değil, ayrı listede; Bu ayın işleri reçeteyi ister
    const me = insights.menuEngineering(model, M);
    assert.equal(me.items.some((i) => i.p.product.id === pumpkin), false);
    assert.deepEqual(me.noRecipe.map((x) => [x.p.product.id, x.qty]), [[pumpkin, 60]]);
    const t = await satisTask();
    assert.equal(t.status, "todo");
    assert.match(t.detail, /1 satılan ürünün reçetesi boş \(Pumpkin Latte · M\)/);
    assert.equal(t.action, "Reçete gir");

    // Reçete kartı kaydedilir: satır kendi maliyetiyle, ortalama orana da girer
    const saved = await products.saveRecipe({
      productId: pumpkin,
      name: "Pumpkin Latte",
      size: "M",
      categoryId: category,
      price: 220,
      fireOverride: null,
      note: null,
      active: true,
      showOnMenu: true,
      seenPrice: 220,
      items: [{ ingredientId: milk, qty: 220, qtyExpr: null, note: null }],
    });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const filled = await loadModel();
    const fms = filled.monthSales(M);
    const fl = fms.lines.find((l) => l.line.posName === "PUMPKIN LATTE M")!;
    const pc = filled.products.find((p) => p.product.id === pumpkin)!;
    assert.equal(fl.noRecipe, false);
    close(fl.unitCost, pc.cost, "reçete maliyeti");
    close(fl.cost, 60 * pc.cost, "adet × birim maliyet");
    assert.equal(fms.noRecipe.length, 0);
    close(fms.matchedNet, fms.lines.filter((l) => l.matched).reduce((a, l) => a + l.net, 0), "oranın dayanağına girdi");
    assert.equal((await satisTask()).status, "done");
    assert.ok(insights.menuEngineering(filled, M).items.some((i) => i.p.product.id === pumpkin), "artık sınıflanır");
  });

  test("E-57: SU GİDERİ satış listesi ve aynı ayın online siparişlerinin su + buzuna bölünür", async () => {
    await db.insert(s.pnlEntries).values({ month: M, rowKey: "manual:su", amount: 1_800 });
    const listOnly = await loadModel();
    assert.equal(listOnly.water.reason, "ok");
    close(listOnly.water.liters, (100 * 180) / 1000, "100 Americano × 180 ml");
    close(listOnly.water.perLiter, 1_800 / 18, "fatura ÷ litre");
    assert.equal(listOnly.water.onlineLiters, 0);

    // Panel Eylül'ün online satışını çeker: 50 Americano uygulamadan (Americano M sitenin mnu-0010'una bağlı)
    const none = { orders: 0, grossMinor: 0, discountMinor: 0, deliveryMinor: 0, refundedMinor: 0, netMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 };
    const record = {
      month: M,
      pulledAt: "2026-10-01T06:00:00.000Z",
      now: "2026-10-01T06:00:00.000Z",
      from: "2026-09-01",
      to: "2026-09-30",
      closed: true,
      cafe: { ...none, orders: 50, grossMinor: 650_000, netMinor: 650_000, kdvMinor: 59_091, lines: [{ menuItemId: "mnu-0010", size: "M", name: "Americano", qty: 50, listMinor: 650_000 }] },
      shop: { ...none },
      karaoke: { bookings: 0, collectedMinor: 0, refundedMinor: 0, netMinor: 0, refundPendingMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 },
      manual: { orders: 0, grossMinor: 0, netMinor: 0 },
    };
    await db.insert(s.integrationState).values({ key: `site_sales:${M}`, value: record });

    const model = await loadModel();
    assert.equal(model.siteMonths.includes(M), true, "kayıt okundu");
    close(model.water.onlineLiters, (50 * 180) / 1000, "50 Americano × 180 ml");
    close(model.water.liters, 27, "18 L liste + 9 L online");
    close(model.water.perLiter, 1_800 / 27, "fatura ÷ (liste + online)");
    close(model.water.perLiter, listOnly.water.perLiter * (18 / 27), "orantılı düştü");
    // Americano'nun maliyeti suyun yeni litre fiyatıyla
    close(model.products.find((p) => p.product.id === americano)!.ingredientTotal, 18 * 1.2 + 0.18 * model.water.perLiter, "18 gr kahve + 180 ml × litre fiyatı");
  });
});
