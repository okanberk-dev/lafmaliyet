// LafPOS satışları aylık modele, gerçek Postgres'te (docs/LAFPOS.md › Günlük satış; denetim B08: E-08, E-33, E-34):
// geçiş günü boşken veri kümesi, tahmin ve tatlı payı LafPOS satırları varken de bayt bayt aynı (deneme günleri hiçbir
// hesaba girmez); geçiş günü seçilince geçiş ayında ModPOS listesi kendi son gününe kadar, LafPOS geçiş gününden itibaren
// sayılır, sonraki ayda yalnız LafPOS (yüklü ModPOS listesi sayılmaz), LafPOS ayına sentetik kapsam; Satışlar'ın içe
// aktarma kuralı (LafPOS ayında red, geçiş ayında kırpma ve Z uyarısı, elle satır yok); ürünsüz satırların sonradan
// bağlanması (site kalemi, POS adı eşleştirmesi, Satışlar ve Ayarlar eylemleri); LafPOS satırı olan ürün silinmez;
// satış tahmini raporsuz günde LafPOS Z'si.
//
// Ayarlar ve satış satırları veritabanında tektir: test kendi geçici veritabanını açar (LAFPOS_TEST_DATABASE_URL'in
// sunucusunda), migration'ları uygular, sonunda siler; öteki testlerin verisine dokunmaz.
//
// LAFPOS_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: LAFPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/lafpos-satis-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";

import { and, asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { createModel } from "../src/lib/calc/engine";
import { posMatchKey } from "../src/lib/calc/pos-paste";
import { parsePosDay } from "../src/lib/lafpos/day";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.LAFPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_lafpos_satis_${process.pid}`;
/** Testin "şimdi"si: 10 Aralık 2026 öğlen (Kasım geçiş ayı bitti, Aralık LafPOS'tan sürüyor) */
const NOW = "2026-12-10T12:00:00+03:00";
const S = "2026-11-10";

describe("LafPOS satışları aylık modele: veritabanında", { skip: !SERVER_URL && "LAFPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let dataset: typeof import("../src/server/data/dataset");
  let sales: typeof import("../src/server/actions/sales");
  let products: typeof import("../src/server/actions/products");
  let history: typeof import("../src/server/data/product-history");
  let rematch: typeof import("../src/server/lafpos/rematch");
  let ingest: typeof import("../src/server/lafpos/ingest");
  let forecast: typeof import("../src/server/forecast/load");
  let mix: typeof import("../src/server/forecast/mix");
  const ids = { cat: 0, desserts: 0, latteM: 0, latteL: 0, mocha: 0, tiramisu: 0, only: 0, milk: 0 };

  const at = (iso: string) => {
    mock.timers.reset();
    mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
  };
  const setSwitch = async (day: string | null) => {
    await db.delete(s.settings).where(eq(s.settings.key, "lafposGecisGunu"));
    if (day) await db.insert(s.settings).values({ key: "lafposGecisGunu", value: day });
  };
  const z = (zTotal: number, zNo = 1) => ({
    zNo,
    receipts: 10,
    zTotal,
    cash: zTotal,
    card: 0,
    mealCard: 0,
    online: 0,
    other: 0,
    offRevenue: 0,
    discounts: 0,
    openingCash: 0,
    cashOut: 0,
    countedCash: null,
    handedOver: 0,
    cashDiff: null,
  });
  /** LafPOS günü doğrudan (imza ve gövde tests/lafpos-db.test.ts'te) */
  const day = async (date: string, zTotal: number, lines: { posName: string; productId?: number | null; qty: number; revenue: number; isService?: boolean; siteMenuId?: string | null; slot?: "M" | "L" | null }[]) => {
    await db.insert(s.posDayReports).values({ date, z: z(zTotal), payments: [], ikram: [], source: "lafpos" });
    if (lines.length) {
      await db.insert(s.posDailySales).values(
        lines.map((l) => ({ date, posName: l.posName, productId: l.productId ?? null, qty: l.qty, revenue: l.revenue, isService: l.isService ?? false, siteMenuId: l.siteMenuId ?? null, slot: l.slot ?? null })),
      );
    }
  };
  const report = (date: string, zTotal: number) => db.insert(s.cashReports).values({ date, zTotal, cash: zTotal, submittedByName: "Ayşe" });
  const modpos = async (month: string, rows: { posName: string; productId?: number | null; qty: number; revenue: number }[]) => {
    await db.insert(s.months).values({ month }).onConflictDoNothing();
    await db.insert(s.salesLines).values(rows.map((r, i) => ({ month, posName: r.posName, productId: r.productId ?? null, qty: r.qty, revenue: r.revenue, isService: false, sortOrder: i + 1 })));
  };
  const setCoverage = (value: Record<string, string>) =>
    db
      .insert(s.integrationState)
      .values({ key: "sales.coverage", value })
      .onConflictDoUpdate({ target: s.integrationState.key, set: { value } });
  const rowsOf = (posName: string) =>
    db
      .select({ date: s.posDailySales.date, productId: s.posDailySales.productId, isService: s.posDailySales.isService })
      .from(s.posDailySales)
      .where(eq(s.posDailySales.posName, posName))
      .orderBy(asc(s.posDailySales.date));
  /** Veri kümesinin JSON'u: "bayt bayt aynı" karşılaştırması */
  const snapshot = async () => JSON.stringify(await dataset.loadDataset());

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "lafpos-satis-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    const [u] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    stub(require.resolve("../src/server/auth/dal"), { requireAdmin: async () => ({ ...u, role: "admin" }), requireUser: async () => ({ ...u, role: "admin" }) });
    dataset = await import("../src/server/data/dataset");
    sales = await import("../src/server/actions/sales");
    products = await import("../src/server/actions/products");
    history = await import("../src/server/data/product-history");
    rematch = await import("../src/server/lafpos/rematch");
    ingest = await import("../src/server/lafpos/ingest");
    forecast = await import("../src/server/forecast/load");
    mix = await import("../src/server/forecast/mix");
  });

  after(async () => {
    mock.timers.reset();
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    at(NOW);
    await db.execute(sql`TRUNCATE pos_daily_sales, pos_day_reports, sales_lines, pos_mappings, cash_reports, integration_state, activity_log, months RESTART IDENTITY CASCADE`);
    await db.execute(sql`DELETE FROM recipe_items`);
    await db.execute(sql`DELETE FROM products`);
    await db.execute(sql`DELETE FROM categories`);
    await db.execute(sql`DELETE FROM ingredients`);
    await setSwitch(null);
    const [c] = await db.insert(s.categories).values({ name: "Kahveler", sortOrder: 1 }).returning();
    const [t] = await db.insert(s.categories).values({ name: "Tatlılar", sortOrder: 2 }).returning();
    ids.cat = c.id;
    ids.desserts = t.id;
    const product = async (categoryId: number, name: string, size: "M" | "L" | "Tek", siteMenuId: string | null = null, siteMenuSlot: "M" | "L" | null = null) =>
      (await db.insert(s.products).values({ categoryId, name, size, price: 200, siteMenuId, siteMenuSlot }).returning({ id: s.products.id }))[0].id;
    ids.latteM = await product(c.id, "Latte", "M", "mnu-0003", "M");
    ids.latteL = await product(c.id, "Latte", "L", "mnu-0003", "L");
    ids.mocha = await product(c.id, "Mocha", "Tek");
    ids.tiramisu = await product(t.id, "Tiramisu", "Tek");
    ids.only = await product(c.id, "Yalnız LafPOS", "Tek");
    const [milk] = await db.insert(s.ingredients).values({ name: "Süt", category: "Süt", unit: "gr", packagePrice: 100, packageSize: 1000, vatRate: 0.01 }).returning();
    ids.milk = milk.id;
    await db.insert(s.recipeItems).values({ productId: ids.latteM, ingredientId: milk.id, qty: 200 });
    // Ekim: ModPOS (ayın tamamı); Kasım: ModPOS listesi 1-9 Kasım (kapsam kaydı); Aralık'a eskiden yüklenmiş liste
    await modpos("2026-10", [
      { posName: "LATTE MEDIUM", productId: ids.latteM, qty: 100, revenue: 20_000 },
      { posName: "TIRAMISU", productId: ids.tiramisu, qty: 10, revenue: 2_000 },
    ]);
    await modpos("2026-11", [
      { posName: "LATTE MEDIUM", productId: ids.latteM, qty: 30, revenue: 6_000 },
      { posName: "PUMPKIN LATTE", qty: 2, revenue: 400 },
    ]);
    await modpos("2026-12", [{ posName: "LATTE MEDIUM", productId: ids.latteM, qty: 999, revenue: 199_800 }]);
    await setCoverage({ "2026-11": "2026-11-09" });
    // Kasa raporları: 1-9 Kasım (8 Kasım yok), 10 Kasım
    for (const d of ["01", "02", "03", "04", "05", "06", "07", "09", "10"]) await report(`2026-11-${d}`, 1_000);
    // LafPOS: 8 Kasım deneme (geçiş gününden önce; raporu da yok), 10-12 Kasım, 1-3 Aralık
    await day("2026-11-08", 7_777, [{ posName: "LATTE MEDIUM", productId: ids.latteM, qty: 50, revenue: 10_000 }]);
    for (const d of ["2026-11-10", "2026-11-11", "2026-11-12"]) {
      await day(d, 2_500, [
        { posName: "LATTE MEDIUM", productId: ids.latteM, qty: 10, revenue: 2_000 },
        { posName: "KARAOKE KİŞİ BAŞI", qty: 2, revenue: 400, isService: true },
        { posName: "PUMPKIN LATTE", qty: 1, revenue: 200 },
      ]);
    }
    for (const d of ["2026-12-01", "2026-12-02", "2026-12-03"]) {
      await day(d, 1_800, [
        { posName: "LATTE MEDIUM", productId: ids.latteM, qty: 5, revenue: 1_000 },
        { posName: "TIRAMISU", productId: ids.tiramisu, qty: 4, revenue: 800 },
      ]);
    }
  });

  afterEach(() => mock.timers.reset());

  test("geçiş günü boşken veri kümesi, günlük toplamlar ve tatlı payı LafPOS satırları varken de bayt bayt aynı", async () => {
    const withLafpos = await snapshot();
    const totals = JSON.stringify(await forecast.loadDailyTotals("2026-11-01", "2026-12-09"));
    const dessert = JSON.stringify(await mix.loadDessertMix({ dessertCategories: [] }, "2026-12-10"));
    const ds = await dataset.loadDataset();
    assert.equal("lafposSales" in ds, false);
    assert.ok(ds.salesLines.every((l) => l.id > 0 && !l.lafpos), "yalnız sales_lines");
    assert.equal(ds.salesLines.length, 5, "Aralık'a yüklenmiş liste de bugünkü gibi sayılır");
    await db.execute(sql`TRUNCATE pos_daily_sales, pos_day_reports`);
    assert.equal(await snapshot(), withLafpos);
    assert.equal(JSON.stringify(await forecast.loadDailyTotals("2026-11-01", "2026-12-09")), totals);
    assert.equal(JSON.stringify(await mix.loadDessertMix({ dessertCategories: [] }, "2026-12-10")), dessert);
  });

  test("geçiş günü seçilince: geçiş ayında liste 1-9 Kasım + LafPOS 10 Kasım'dan, Aralık yalnız LafPOS; deneme günü sayılmaz", async () => {
    await setSwitch(S);
    const ds = await dataset.loadDataset();
    const by = (month: string) => ds.salesLines.filter((l) => l.month === month).map((l) => [l.posName, l.qty, l.revenue, l.productId, l.isService, l.lafpos?.days ?? null]);
    assert.deepEqual(by("2026-10"), [
      ["LATTE MEDIUM", 100, 20_000, ids.latteM, false, null],
      ["TIRAMISU", 10, 2_000, ids.tiramisu, false, null],
    ]);
    assert.deepEqual(by("2026-11"), [
      ["LATTE MEDIUM", 30, 6_000, ids.latteM, false, null],
      ["PUMPKIN LATTE", 2, 400, null, false, null],
      // LafPOS 10-12 Kasım (8 Kasım deneme: 50 latte sayılmaz), ciroya göre
      ["LATTE MEDIUM", 30, 6_000, ids.latteM, false, 3],
      ["KARAOKE KİŞİ BAŞI", 6, 1_200, null, true, 3],
      ["PUMPKIN LATTE", 3, 600, null, false, 3],
    ]);
    assert.deepEqual(by("2026-12"), [
      ["LATTE MEDIUM", 15, 3_000, ids.latteM, false, 3],
      ["TIRAMISU", 12, 2_400, ids.tiramisu, false, 3],
    ]);
    assert.ok(ds.salesLines.filter((l) => l.lafpos).every((l) => l.id < 0), "LafPOS satırları eksi kimlikli");
    // Kapsam: Kasım'da son LafPOS günü 12 Kasım, Aralık'ta 3 Aralık (Aralık'ın ModPOS kaydı yok sayılır)
    assert.deepEqual(
      ds.salesCoverage?.map((c) => [c.month, c.through]),
      [
        ["2026-11", "2026-11-12"],
        ["2026-12", "2026-12-03"],
      ],
    );
    // Ayların kaynağı (Satışlar'ın bandı)
    const months = ds.lafposSales?.months ?? [];
    assert.equal(ds.lafposSales?.switchDay, S);
    assert.equal(ds.lafposSales?.countFrom, S);
    const nov = months.find((m) => m.month === "2026-11");
    assert.deepEqual(nov && [nov.source, nov.from, nov.lafpos, nov.modpos, nov.modposZ, nov.gap, nov.overlap], [
      "gecis",
      S,
      { days: 3, last: "2026-11-12" },
      { lines: 2, revenue: 6_400, through: "2026-11-09", counted: true },
      8_000,
      null,
      null,
    ]);
    const dec = months.find((m) => m.month === "2026-12");
    assert.deepEqual(dec && [dec.source, dec.from, dec.modpos?.lines, dec.modpos?.counted], ["lafpos", "2026-12-01", 1, false]);
    // Model: karaoke payı hizmet satırlarından (KDV %20), LafPOS'un latte'si reçeteye göre süt tüketir
    const model = createModel(ds);
    assert.equal(model.monthSales("2026-11").serviceRevenue, 1_200);
    assert.equal(model.ingredientUsage("2026-12").get(ids.milk), 15 * 200);
    assert.equal(model.ingredientUsage("2026-11").get(ids.milk), 60 * 200, "ModPOS 30 + LafPOS 30");
    assert.ok(model.salesMonths.includes("2026-12"));
  });

  test("süren ayda kasa raporu girilmemiş LafPOS günü rapor girilince sayılır: liste ↔ POS cirosu aynı günlerle karşılaştırılır", async () => {
    at("2026-12-10T23:30:00+03:00");
    await setSwitch("2026-12-01");
    await db.execute(sql`TRUNCATE pos_daily_sales, pos_day_reports, cash_reports RESTART IDENTITY CASCADE`);
    for (let d = 1; d <= 9; d++) await report(`2026-12-${String(d).padStart(2, "0")}`, 2_000);
    for (let d = 1; d <= 10; d++) await day(`2026-12-${String(d).padStart(2, "0")}`, 2_000, [{ posName: "LATTE MEDIUM", productId: ids.latteM, qty: 10, revenue: 2_000 }]);
    const insights = await import("../src/lib/calc/insights");
    const lafposNotes = (await import("../src/lib/lafpos/sales")).lafposMonthNotes;
    const titles = (m: ReturnType<typeof createModel>) => insights.alerts(m, "2026-12").map((a) => a.title);
    // LafPOS'un 10 Aralık'ı geldi, kasa raporu henüz yok: 1-9 Aralık sayılır, kasa dönemiyle aynı
    const ds = await dataset.loadDataset();
    const dec = () => ds.salesLines.filter((l) => l.month === "2026-12").map((l) => [l.posName, l.qty, l.revenue, l.lafpos?.days ?? null]);
    assert.deepEqual(dec(), [["LATTE MEDIUM", 90, 18_000, 9]]);
    assert.equal(ds.salesCoverage?.find((c) => c.month === "2026-12")?.through, "2026-12-09");
    const st = ds.lafposSales?.months.find((m) => m.month === "2026-12");
    assert.deepEqual([st?.lafpos, st?.held], [{ days: 10, last: "2026-12-10" }, { from: "2026-12-10", to: "2026-12-10" }]);
    assert.match(lafposNotes(st!, "2026-12-01").info.replace(/ /g, " "), /\(10 gün geldi, son gün 10 Aralık; 10 Aralık kasa raporu girilince sayılır\)/);
    const model = createModel(ds);
    assert.ok(!titles(model).includes("Satış listesi ile POS cirosu tutmuyor"), JSON.stringify(titles(model)));
    // Ertesi sabah rapor hâlâ girilmemiş: kasa dönemi düne kadar uzar, liste 1-9 Aralık dönemiyle karşılaştırılır
    at("2026-12-11T09:00:00+03:00");
    const morning = createModel(await dataset.loadDataset());
    assert.equal(morning.listPeriod("2026-12")?.through, "2026-12-09");
    assert.ok(!titles(morning).includes("Satış listesi ile POS cirosu tutmuyor"));
    // Rapor girilince 10 Aralık sayılır, bekleyen gün kalmaz
    await report("2026-12-10", 2_000);
    const done = await dataset.loadDataset();
    assert.deepEqual(done.salesLines.filter((l) => l.month === "2026-12").map((l) => [l.qty, l.lafpos?.days ?? null]), [[100, 10]]);
    assert.equal(done.lafposSales?.months.find((m) => m.month === "2026-12")?.held, undefined);
    assert.ok(!titles(createModel(done)).includes("Satış listesi ile POS cirosu tutmuyor"));
  });

  test("geçiş ayına sonradan ayın tamamının listesi yüklendiyse LafPOS'un o ayki günleri sayılmaz (çift sayım yok)", async () => {
    await setSwitch(S);
    await setCoverage({});
    const ds = await dataset.loadDataset();
    assert.equal(ds.lafposSales?.countFrom, "2026-12-01");
    assert.deepEqual(
      ds.salesLines.filter((l) => l.month === "2026-11").map((l) => [l.posName, l.lafpos ? "lafpos" : "modpos"]),
      [
        ["LATTE MEDIUM", "modpos"],
        ["PUMPKIN LATTE", "modpos"],
      ],
    );
    const nov = ds.lafposSales?.months.find((m) => m.month === "2026-11");
    assert.deepEqual([nov?.from, nov?.overlap], [null, { from: S, to: "2026-11-30" }]);
  });

  test("içe aktarma: LafPOS ayında red, elle satır yok; geçiş ayında liste geçiş gününden önceki güne kırpılır, Z'yi aşarsa uyarı", async () => {
    await setSwitch(S);
    const lines = [{ posName: "LATTE MEDIUM", qty: 50, revenue: 10_000 }];
    const dec = await sales.importSales({ month: "2026-12", lines, mode: "replace" });
    assert.deepEqual(dec, { ok: false, error: "Aralık 2026 LafPOS'tan geliyor; ModPOS listesi yüklenmez. Satışlar her gün sonunda LafPOS'tan kendiliğinden gelir." });
    const add = await sales.saveLine({ id: null, month: "2026-12", posName: "ESPRESSO", qty: 1, revenue: 100 });
    assert.equal(add.ok, false);
    assert.match(!add.ok ? add.error : "", /^Aralık 2026 LafPOS'tan geliyor/);
    // Kasım bitti: liste ayın tamamı sayılmaz, 9 Kasım'a kadar (verilen 15 Kasım kırpılır); 10.000 ₺ liste, 1-9 Kasım Z 8.000 ₺
    const nov = await sales.importSales({ month: "2026-11", lines, mode: "replace", through: "2026-11-15" });
    assert.ok(nov.ok);
    assert.equal(nov.data.through, "2026-11-09");
    // Bölünmez boşluklar (tutar ve gün) düz boşluğa çevrilip karşılaştırılır
    assert.match((nov.data.warning ?? "").replace(/\u00a0/g, " ").replace(/\u2060/g, ""), /^ModPOS listesinin toplamı \(10\.000 ₺\) 1–9 Kasım kasa raporlarının Z toplamından \(8\.000 ₺\) %25 fazla/);
    const [cov] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "sales.coverage"));
    assert.deepEqual(cov.value, { "2026-11": "2026-11-09" });
    // Z'yi aşmayan liste: uyarı yok
    const small = await sales.importSales({ month: "2026-11", lines: [{ posName: "LATTE MEDIUM", qty: 40, revenue: 8_200 }], mode: "replace" });
    assert.ok(small.ok);
    assert.equal(small.data.warning, null);
    // Geçiş gününden önceki ay bugünkü gibi (biten ay: ayın tamamı, kayıt yok)
    const oct = await sales.importSales({ month: "2026-10", lines, mode: "replace" });
    assert.ok(oct.ok);
    assert.deepEqual([oct.data.through, oct.data.warning], [null, null]);
  });

  test("geçiş ayının ilk elle satırı ModPOS listesini geçiş gününden önceki güne kadar başlatır: LafPOS günleri hesaptan düşmez", async () => {
    await setSwitch(S);
    // Kasım'ın listesi yok (yüklenmedi ya da "Ayı temizle"): LafPOS 10 Kasım'dan sayılıyor
    await db.delete(s.salesLines).where(eq(s.salesLines.month, "2026-11"));
    await setCoverage({});
    const before = await dataset.loadDataset();
    assert.equal(before.lafposSales?.countFrom, S);
    const add = await sales.saveLine({ id: null, month: "2026-11", posName: "ESPRESSO", qty: 5, revenue: 500 });
    assert.ok(add.ok, JSON.stringify(add));
    const [cov] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "sales.coverage"));
    assert.deepEqual(cov.value, { "2026-11": "2026-11-09" }, "içe aktarmadaki kural: en çok geçiş gününden önceki gün");
    const ds = await dataset.loadDataset();
    assert.equal(ds.lafposSales?.countFrom, S, "LafPOS'un Kasım günleri sayılmaya devam eder");
    assert.deepEqual(
      ds.salesLines.filter((l) => l.month === "2026-11").map((l) => [l.posName, l.lafpos ? "lafpos" : "modpos"]),
      [
        ["ESPRESSO", "modpos"],
        ["LATTE MEDIUM", "lafpos"],
        ["KARAOKE KİŞİ BAŞI", "lafpos"],
        ["PUMPKIN LATTE", "lafpos"],
      ],
    );
    assert.equal(createModel(ds).ingredientUsage("2026-11").get(ids.milk), 30 * 200);
    // Listesi olan aya eklenen satır kapsamı değiştirmez (kullanıcının seçtiği son gün kalır)
    await setCoverage({ "2026-11": "2026-11-05" });
    assert.ok((await sales.saveLine({ id: null, month: "2026-11", posName: "MOCHA", qty: 1, revenue: 100 })).ok);
    const [cov2] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "sales.coverage"));
    assert.deepEqual(cov2.value, { "2026-11": "2026-11-05" });
  });

  test("Satışlar'da LafPOS'un hizmet işaretli ya da sitenin bağlı kalemiyle gelen satırı başka ürüne bağlanmaz (sonraki gün sonu geri alırdı)", async () => {
    await setSwitch(S);
    const push = async (date: string, zNo: number, lines: { posName: string; siteMenuId?: string | null; slot?: "M" | "L" | null; qty: number; revenue: number; isService?: boolean }[]) => {
      const parsed = parsePosDay(
        JSON.stringify({
          version: 1,
          source: "lafpos",
          date,
          z: z(lines.reduce((a, l) => a + l.revenue, 0), zNo),
          lines: lines.map((l) => ({ siteMenuId: null, slot: null, isService: false, ...l })),
          ikram: [],
          payments: [],
        }),
        new Date(NOW),
      );
      assert.ok(parsed.ok);
      assert.equal((await ingest.storePosDay(db, parsed.data, new Date(NOW))).ok, true);
    };
    await push("2026-12-05", 205, [
      { posName: "LATTE ORTA", siteMenuId: "mnu-0003", slot: "M", qty: 10, revenue: 2_000 },
      { posName: "KARAOKE SAAT", qty: 1, revenue: 500, isService: true },
    ]);
    assert.deepEqual((await rowsOf("LATTE ORTA")).map((x) => x.productId), [ids.latteM]);
    const moved = await sales.matchLafposName({ month: "2026-12", posName: "LATTE ORTA", productId: ids.mocha, isService: false, current: { productId: ids.latteM, isService: false } });
    assert.equal(moved.ok, false);
    assert.match(!moved.ok ? moved.error : "", /sitenin kalemiyle geliyor ve Latte · M ürününe bağlı; .*Ürünler › Site menüsü/);
    const cleared = await sales.matchLafposName({ month: "2026-12", posName: "LATTE ORTA", productId: null, isService: false, current: { productId: ids.latteM, isService: false } });
    assert.equal(cleared.ok, false, "eşleşmeyi kaldırmak da kalıcı olmaz");
    const service = await sales.matchLafposName({ month: "2026-12", posName: "KARAOKE SAAT", productId: ids.mocha, isService: false, current: { productId: null, isService: true } });
    assert.equal(service.ok, false);
    assert.match(!service.ok ? service.error : "", /hizmet \(karaoke\) olarak geliyor/);
    // Hiçbir şey değişmedi: satırlar, ad hafızası
    assert.deepEqual((await rowsOf("LATTE ORTA")).map((x) => x.productId), [ids.latteM]);
    assert.deepEqual((await rowsOf("KARAOKE SAAT")).map((x) => [x.productId, x.isService]), [[null, true]]);
    assert.equal((await db.select().from(s.posMappings)).length, 0);
    // Bağlı kalemin kendi ürünü seçilirse ret yok; adla bağlanan satır kalıcı: sonraki gün sonu ve düzeltme gönderimi aynı ürüne yazar
    assert.ok((await sales.matchLafposName({ month: "2026-12", posName: "LATTE ORTA", productId: ids.latteM, isService: false, current: { productId: ids.latteM, isService: false } })).ok);
    await push("2026-12-06", 206, [{ posName: "SAHLEP", qty: 1, revenue: 150 }]);
    assert.ok((await sales.matchLafposName({ month: "2026-12", posName: "SAHLEP", productId: ids.mocha, isService: false, current: { productId: null, isService: false } })).ok);
    await push("2026-12-07", 207, [{ posName: "SAHLEP", qty: 2, revenue: 300 }]);
    await push("2026-12-06", 206, [{ posName: "SAHLEP", qty: 1, revenue: 150 }]);
    assert.deepEqual((await rowsOf("SAHLEP")).map((x) => x.productId), [ids.mocha, ids.mocha]);
  });

  test("sonradan eşleştirme: POS adı (Satışlar'ın ModPOS satırı ya da LafPOS adı) ve site kalemi ürünsüz satırları yeniden gönderimsiz bağlar", async () => {
    await setSwitch(S);
    // ModPOS satırının eşleştirmesi: aynı adlı ürünsüz LafPOS satırları her ayda (deneme günü dahil) bağlanır
    await day("2026-11-07", 100, [{ posName: "Pumpkin  latte", qty: 1, revenue: 200 }]);
    const [line] = await db.select().from(s.salesLines).where(and(eq(s.salesLines.month, "2026-11"), eq(s.salesLines.posName, "PUMPKIN LATTE")));
    const r = await sales.setLineMatch(line.id, ids.mocha, false);
    assert.ok(r.ok);
    assert.deepEqual(
      (await rowsOf("PUMPKIN LATTE")).map((x) => x.productId),
      [ids.mocha, ids.mocha, ids.mocha],
    );
    assert.equal((await rowsOf("Pumpkin  latte"))[0].productId, ids.mocha, "büyük / küçük harf ve boşluk farkı yok");
    // Bağlı satırın ürünü değişmez
    assert.ok((await rowsOf("LATTE MEDIUM")).every((x) => x.productId === ids.latteM));

    // Satışlar'da LafPOS satırı: o ayın bu adlı satırları seçilene geçer, hafıza yazılır, başka aydaki ürünsüzler bağlanır
    await day("2026-12-04", 100, [{ posName: "CHAI", qty: 1, revenue: 100 }]);
    await day("2026-11-20", 100, [{ posName: "CHAI", qty: 1, revenue: 100 }]);
    const m = await sales.matchLafposName({ month: "2026-12", posName: "CHAI", productId: ids.latteL, isService: false, current: { productId: null, isService: false } });
    assert.deepEqual(m, { ok: true, data: { days: 1, others: 1 } });
    assert.deepEqual((await rowsOf("CHAI")).map((x) => x.productId), [ids.latteL, ids.latteL]);
    const [mapping] = await db.select().from(s.posMappings).where(eq(s.posMappings.posName, "CHAI"));
    assert.deepEqual([mapping.productId, mapping.isService], [ids.latteL, false]);
    // Eşleşmeyi kaldırmak: o ayın satırları ürünsüz, hafızadan silinir; öteki ayın satırı kalır
    const off = await sales.matchLafposName({ month: "2026-12", posName: "CHAI", productId: null, isService: false, current: { productId: ids.latteL, isService: false } });
    assert.ok(off.ok);
    assert.deepEqual((await rowsOf("CHAI")).map((x) => x.productId), [ids.latteL, null]);
    assert.equal((await db.select().from(s.posMappings).where(eq(s.posMappings.posName, "CHAI"))).length, 0);
    // Ayarlar kartının eşleşmeyen adı (ay yok): yalnız ürünsüzler, HİZMET de olur
    const card = await sales.matchLafposName({ month: null, posName: "chai", productId: null, isService: true });
    assert.deepEqual(card, { ok: true, data: { days: 0, others: 1 } });
    assert.deepEqual((await rowsOf("CHAI")).map((x) => [x.productId, x.isService]), [
      [ids.latteL, false],
      [null, true],
    ]);
    assert.equal((await sales.matchLafposName({ month: null, posName: "X", productId: null, isService: false })).ok, false, "ay yokken boş seçim");
    assert.equal((await sales.matchLafposName({ month: "2026-12", posName: "CHAI", productId: null, isService: false })).ok, false, "satırın eşleşmesi olmadan kaldırma");
    assert.equal(
      (await sales.matchLafposName({ month: "2026-12", posName: "YOK", productId: ids.mocha, isService: false, current: { productId: null, isService: false } })).ok,
      false,
      "o ayda satırı yok",
    );
    // Aynı ad ayın günlerinde iki ürüne bağlı (ör. eşleştirme ay içinde değişti): tıklanan ay toplamının satırları ve aynı
    // adlı ürünsüzler değişir, öteki ürüne bağlı günler değişmez (ModPOS satırının eşleştirmesi gibi)
    await day("2026-12-07", 100, [{ posName: "COLD BREW", productId: ids.latteM, qty: 1, revenue: 100 }]);
    await day("2026-12-08", 100, [{ posName: "COLD BREW", productId: ids.latteL, qty: 1, revenue: 100 }]);
    await day("2026-12-09", 100, [{ posName: "COLD BREW", qty: 1, revenue: 100 }]);
    await db.insert(s.posDailySales).values({ date: "2026-11-12", posName: "Cold  Brew", qty: 1, revenue: 100 });
    const cold = await sales.matchLafposName({ month: "2026-12", posName: "COLD BREW", productId: ids.mocha, isService: false, current: { productId: ids.latteM, isService: false } });
    assert.deepEqual(cold, { ok: true, data: { days: 2, others: 1 } });
    const coldOf = async () =>
      new Map(
        (await db.select({ date: s.posDailySales.date, posName: s.posDailySales.posName, productId: s.posDailySales.productId }).from(s.posDailySales))
          .filter((x) => posMatchKey(x.posName) === "COLD BREW")
          .map((x) => [x.date, x.productId]),
      );
    assert.deepEqual(Object.fromEntries(await coldOf()), { "2026-11-12": ids.mocha, "2026-12-07": ids.mocha, "2026-12-08": ids.latteL, "2026-12-09": ids.mocha });
    // Kaldırmak yalnız tıklanan ay toplamını ürünsüz bırakır; öteki ay ve öteki ürün kalır
    const coldOff = await sales.matchLafposName({ month: "2026-12", posName: "COLD BREW", productId: null, isService: false, current: { productId: ids.mocha, isService: false } });
    assert.deepEqual(coldOff, { ok: true, data: { days: 2, others: 0 } });
    assert.deepEqual(Object.fromEntries(await coldOf()), { "2026-11-12": ids.mocha, "2026-12-07": null, "2026-12-08": ids.latteL, "2026-12-09": null });
    const stale = await sales.matchLafposName({ month: "2026-12", posName: "COLD BREW", productId: ids.mocha, isService: false, current: { productId: ids.latteM, isService: false } });
    assert.deepEqual(stale, { ok: false, error: "Bu LafPOS satırı bu arada değişmiş; sayfayı yenileyin." });
    // Önerileri toplu uygulamak: yalnız hâlâ ürünsüz olan ad
    await day("2026-12-05", 100, [{ posName: "FLAT WHITE", qty: 2, revenue: 300 }]);
    const bulk = await sales.applyLafposMatches("2026-12", [
      { posName: "FLAT WHITE", productId: ids.mocha },
      { posName: "LATTE MEDIUM", productId: ids.mocha },
    ]);
    assert.deepEqual(bulk, { ok: true, data: { applied: 1, skipped: 1 } });
    assert.equal((await rowsOf("FLAT WHITE"))[0].productId, ids.mocha);
    assert.ok((await rowsOf("LATTE MEDIUM")).every((x) => x.productId === ids.latteM), "bağlı ad atlanır");

    // Site kalemi: gün sonu kalemi ve boyu saklar; ürün sonra o kaleme bağlanınca satır bağlanır
    const parsed = parsePosDay(
      JSON.stringify({ version: 1, source: "lafpos", date: "2026-12-06", z: z(300, 7), lines: [{ posName: "SALEP", siteMenuId: "mnu-0099", slot: "M", qty: 1, revenue: 150, isService: false }], ikram: [], payments: [] }),
      new Date(NOW),
    );
    assert.ok(parsed.ok);
    assert.deepEqual(await ingest.storePosDay(db, parsed.data, new Date(NOW)), { ok: true, lines: 1, matched: 0, unmatched: ["SALEP"] });
    assert.equal((await rowsOf("SALEP"))[0].productId, null);
    await db.update(s.products).set({ siteMenuId: "mnu-0099", siteMenuSlot: "M" }).where(eq(s.products.id, ids.only));
    assert.equal(await rematch.rematchPosSalesBySite(db, [{ productId: ids.only, siteMenuId: "mnu-0099", slot: "M" }]), 1);
    assert.equal((await rowsOf("SALEP"))[0].productId, ids.only);
    assert.equal(await rematch.rematchPosSalesBySite(db, [{ productId: ids.mocha, siteMenuId: "mnu-0099", slot: "M" }]), 0, "bağlı satır değişmez");
  });

  test("silme engeli: yalnız LafPOS günlük satırı olan ürün silinmez (bağ sessizce kopmaz)", async () => {
    await db.insert(s.posDailySales).values({ date: "2026-11-05", posName: "YALNIZ", productId: ids.only, qty: 1, revenue: 10 });
    const counts = await history.productHistoryCounts({ id: ids.only, siteMenuId: null, siteMenuSlot: null });
    assert.deepEqual(counts, { salesLines: 0, posDailySales: 1, waste: 0, priceChanges: 0, onlineMonths: 0 });
    const res = await products.deleteProduct(ids.only);
    assert.equal(res.ok, false);
    assert.match(!res.ok ? res.error : "", /^Bu ürünün 1 LafPOS günlük satış satırı kaydı var/);
    assert.equal((await db.select().from(s.products).where(eq(s.products.id, ids.only))).length, 1);
    assert.equal((await rowsOf("YALNIZ"))[0].productId, ids.only);
    // Geçmişi olmayan ürün silinir
    const [fresh] = await db.insert(s.products).values({ categoryId: ids.cat, name: "Yeni", size: "Tek", price: 1 }).returning({ id: s.products.id });
    assert.equal((await products.deleteProduct(fresh.id)).ok, true);
  });

  test("tahmin: geçiş gününden itibaren raporsuz günde LafPOS'un Z'si (rapor kazanır, deneme günü yok); tatlı payı LafPOS ayını okur", async () => {
    await setSwitch(S);
    const totals = new Map((await forecast.loadDailyTotals("2026-11-01", "2026-12-09")).map((x) => [x.date, x.total]));
    assert.equal(totals.get("2026-11-08"), undefined, "deneme günü (geçiş gününden önce)");
    assert.equal(totals.get("2026-11-10"), 1_000, "kasa raporu kazanır");
    assert.equal(totals.get("2026-11-11"), 2_500, "raporsuz LafPOS günü");
    assert.equal(totals.get("2026-12-02"), 1_800);
    assert.equal(totals.size, 9 + 2 + 3);
    // Tatlı payı: Aralık LafPOS'tan (Aralık'a yüklü ModPOS listesi sayılmaz), Kasım ve Ekim
    const { mix: m } = await mix.loadDessertMix({ dessertCategories: [] }, "2026-12-10");
    assert.deepEqual(m?.basis.months, ["2026-10", "2026-11", "2026-12"]);
    // Ciro: Ekim 22.000, Kasım 6.400 + LafPOS 7.800, Aralık 5.400 (ModPOS'un 199.800'ü yok); tatlı 10 + 12
    assert.equal(m?.basis.revenue, 22_000 + 14_200 + 5_400);
    assert.ok(Math.abs((m?.dessertsPerTL ?? 0) - 22 / 41_600) < 1e-12);
    // Geçiş günü boşken: Aralık'ın ModPOS listesi (tatlısız) sayılır, LafPOS'un tatlısı yok
    await setSwitch(null);
    const { mix: before } = await mix.loadDessertMix({ dessertCategories: [] }, "2026-12-10");
    assert.deepEqual(before?.basis.months, ["2026-10", "2026-11", "2026-12"]);
    assert.equal(before?.basis.revenue, 22_000 + 6_400 + 199_800);
    assert.ok(Math.abs((before?.dessertsPerTL ?? 0) - 10 / 228_200) < 1e-12);
  });
});
