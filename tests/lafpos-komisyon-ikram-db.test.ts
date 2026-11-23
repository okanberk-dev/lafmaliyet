// LafPOS'un ödeme kanalları komisyona ve ikramı tüketime, gerçek Postgres'te (denetim B10: E-37, E-38; docs/LAFPOS.md ›
// Komisyon ve İkram): geçiş günü boşken LafPOS'un gün sonu ne komisyona, ne veri kümesine, ne zayi kaydına, ne kasa
// özetine girer (veri kümesi bayt bayt aynı); geçiş günü seçilince ödeme türleri kanal kanal satış olur (deneme günü
// hariç), ikram satırları ürüne bağlanıp kayıtlı tüketime bir kez girer, gün sonu gelen günde paneldeki ürün ikramı
// sayılmaz, yeni ürün ikramı (doğrudan, geç kayıt isteği ve onayı) reddedilir, kasa özeti ve e-postası LafPOS'un
// ikramını yazar.
//
// Kasa ve Zayi & ikram LafPOS'un şubesinin (Marina, LAFPOS_BRANCH_ID) ekranlarıdır: testler o şubenin seçiminde çalışır
// (withBranchScope; panelde seçiciden Marina seçilmiş gibi), paneldeki ikram kayıtları o şubenindir. ModPOS'ta kalan
// şubede (Tuzla) ürün ikramı panele girilir ve sayılır.
//
// Ayarlar (geçiş günü, kasa e-postası) veritabanında tektir: test kendi geçici veritabanını açar
// (LAFPOS_TEST_DATABASE_URL'in sunucusunda), migration'ları uygular, sonunda siler; öteki testlerin verisine dokunmaz.
//
// LAFPOS_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: LAFPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/lafpos-komisyon-ikram-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { createModel } from "../src/lib/calc/engine";
import type { CashReportFields } from "../src/lib/cash-report";
import { buildCommissionReport, groupOf, rowOf } from "../src/lib/commission/report";
import { parsePosDay } from "../src/lib/lafpos/day";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

import { LAFPOS_SUBE, MODPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.LAFPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_lafpos_komisyon_ikram_${process.pid}`;
/** Testin "şimdi"si: 12 Kasım 2026 öğlen (iş günü 12 Kasım, dün 11 Kasım) */
const NOW_ISO = "2026-11-12T12:00:00+03:00";
const NOW = new Date(NOW_ISO);
const S = "2026-11-10";
const plain = (v: string) => v.replace(/[  ]/g, " ").replace(/&#39;/g, "'");

describe("LafPOS'un kanalları komisyona, ikramı tüketime: veritabanında", { skip: !SERVER_URL && "LAFPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let ingest: typeof import("../src/server/lafpos/ingest");
  let commission: typeof import("../src/server/data/commission");
  let dataset: typeof import("../src/server/data/dataset");
  let waste: typeof import("../src/server/data/waste");
  let lafposIkram: typeof import("../src/server/data/lafpos-ikram");
  let core: typeof import("../src/server/waste/core");
  let store: typeof import("../src/server/cash/report-store");
  let email: typeof import("../src/server/cash/report-email");
  let reports: typeof import("../src/server/data/cash-reports");
  let wasteRequests: typeof import("../src/server/data/waste-requests");
  let status: typeof import("../src/server/lafpos/status");
  let scope: typeof import("../src/server/branch-scope");
  /** LafPOS'un şubesinin (Marina) seçiminde: okuma ve yazmalar o şubeye bakar */
  const lafposTest = (name: string, fn: () => Promise<void>) => test(name, () => scope.withBranchScope(LAFPOS_SUBE, fn));
  /** Aynı iş ModPOS'ta kalan şubenin (Tuzla) seçiminde */
  const inTuzla = <T>(fn: () => Promise<T>) => scope.withBranchScope(MODPOS_SUBE, fn);
  const users = {
    ali: { id: 0, name: "Ali", role: "admin" as const, email: "lafpos-ki-ali@ornek.com" },
    ayse: { id: 0, name: "Ayşe", role: "staff" as const, email: "lafpos-ki-ayse@ornek.com" },
  };
  const ids = { latteM: 0, mocha: 0, milk: 0 };
  const sent: { html: string; text: string }[] = [];
  const realFetch = globalThis.fetch;

  const setSwitch = async (day: string | null) => {
    await db.delete(s.settings).where(eq(s.settings.key, "lafposGecisGunu"));
    if (day) await db.insert(s.settings).values({ key: "lafposGecisGunu", value: day });
  };
  type Pay = { name: string; zField: "cash" | "card" | "meal_card" | "online" | "other"; channel: string | null; amount: number };
  type Ikram = { posName: string; siteMenuId: string | null; slot: "M" | "L" | null; qty: number; menuValue: number; reason: string | null };
  /** Günün ödemeleri: Pluxee 1.550, Multinet 800, tanınmayan "Ticket" 150 (yemek kartı), Yemeksepeti 1.000, nakit */
  const PAYMENTS: Pay[] = [
    { name: "Nakit", zField: "cash", channel: null, amount: 5_000 },
    { name: "Pluxee", zField: "meal_card", channel: "pluxee", amount: 1_550 },
    { name: "Multinet", zField: "meal_card", channel: "Multinet", amount: 800 },
    { name: "Ticket kart", zField: "meal_card", channel: "Ticket", amount: 150 },
    { name: "Yemeksepeti", zField: "online", channel: "yemeksepeti", amount: 1_000 },
  ];
  /** Günün ikramı: Latte M (sitenin kalemiyle) 2 adet 340 ₺, Mocha (POS adı eşleştirmesiyle) 1 adet, bilinmeyen ürün 1 adet */
  const IKRAM: Ikram[] = [
    { posName: "LATTE MEDIUM", siteMenuId: "mnu-0003", slot: "M", qty: 2, menuValue: 340, reason: "Müşteri" },
    { posName: "MOCHA", siteMenuId: null, slot: null, qty: 1, menuValue: 180, reason: "Personel" },
    { posName: "PUMPKIN CHAI", siteMenuId: null, slot: null, qty: 1, menuValue: 200, reason: null },
  ];
  const push = async (date: string, zNo: number, o: { payments?: Pay[]; ikram?: Ikram[]; offRevenue?: number } = {}) => {
    const payments = o.payments ?? PAYMENTS;
    const sum = (f: Pay["zField"]) => payments.filter((p) => p.zField === f).reduce((a, p) => a + p.amount, 0);
    const ikram = o.ikram ?? IKRAM;
    const body = {
      version: 1,
      source: "lafpos",
      date,
      z: {
        zNo,
        receipts: 40,
        zTotal: payments.reduce((a, p) => a + p.amount, 0),
        cash: sum("cash"),
        card: sum("card"),
        mealCard: sum("meal_card"),
        online: sum("online"),
        other: sum("other"),
        offRevenue: o.offRevenue ?? ikram.reduce((a, i) => a + i.menuValue, 0),
        discounts: 0,
        openingCash: 1_000,
        cashOut: 0,
        countedCash: 6_000,
        handedOver: 0,
        cashDiff: 0,
      },
      lines: [{ posName: "LATTE MEDIUM", siteMenuId: "mnu-0003", slot: "M", qty: 20, revenue: 3_400, isService: false }],
      ikram,
      payments: payments.map((p) => ({ ...p, count: 1 })),
    };
    const parsed = parsePosDay(JSON.stringify(body), NOW);
    assert.ok(parsed.ok, "gövde geçerli");
    const r = await ingest.storePosDay(db, parsed.data, NOW);
    assert.equal(r.ok, true);
  };
  /** Paneldeki zayi / ikram kaydı; şube verilmezse LafPOS'un şubesinde (Marina) */
  const panelEntry = (date: string, kind: "zayi" | "ikram", productId: number | null, ingredientId: number | null, qty: number, branchId: string = LAFPOS_SUBE) =>
    db
      .insert(s.wasteEntries)
      .values({ date, branchId, kind, productId, ingredientId, name: productId === ids.latteM ? "Latte M" : productId === ids.mocha ? "Mocha" : "Süt", unit: productId ? "adet" : "LT", factor: productId ? 1 : 1000, qty, createdByName: "Ayşe" })
      .returning({ id: s.wasteEntries.id });
  const refused = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: unknown) => e instanceof UserError && re.test(plain(e.message)));
  const PRODUCT_IKRAM = /^Ürün ikramı 10 Kasım'dan beri LafPOS'ta işaretlenir, panele girilmez\. Burada hammadde ikramı ve zayi girilir\./;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "lafpos-komisyon-ikram-testi-icin-en-az-otuz-iki-karakter", RESEND_API_KEY: "re_test_lafpos_ki" });
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
    for (const k of ["ali", "ayse"] as const) {
      const [u] = await db.insert(s.users).values({ email: users[k].email, name: users[k].name, passwordHash: "x", role: users[k].role }).returning({ id: s.users.id });
      users[k].id = u.id;
    }
    ingest = await import("../src/server/lafpos/ingest");
    commission = await import("../src/server/data/commission");
    dataset = await import("../src/server/data/dataset");
    waste = await import("../src/server/data/waste");
    lafposIkram = await import("../src/server/data/lafpos-ikram");
    core = await import("../src/server/waste/core");
    store = await import("../src/server/cash/report-store");
    email = await import("../src/server/cash/report-email");
    reports = await import("../src/server/data/cash-reports");
    wasteRequests = await import("../src/server/data/waste-requests");
    status = await import("../src/server/lafpos/status");
    scope = await import("../src/server/branch-scope");
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).startsWith("https://api.resend.com/")) return realFetch(input, init);
      const body = JSON.parse(String(init?.body)) as { html: string; text: string };
      sent.push({ html: body.html, text: body.text });
      return new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
  });

  after(async () => {
    mock.timers.reset();
    globalThis.fetch = realFetch;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    mock.timers.reset();
    mock.timers.enable({ apis: ["Date"], now: NOW });
    await db.execute(
      sql`TRUNCATE pos_daily_sales, pos_day_reports, pos_mappings, waste_entries, staff_requests, invoices, commission_months, cash_reports, cash_outs, photos, notification_log, integration_state, activity_log RESTART IDENTITY CASCADE`,
    );
    await db.execute(sql`DELETE FROM recipe_items`);
    await db.execute(sql`DELETE FROM products`);
    await db.execute(sql`DELETE FROM categories`);
    await db.execute(sql`DELETE FROM ingredients`);
    await setSwitch(null);
    const [c] = await db.insert(s.categories).values({ name: "Kahveler", sortOrder: 1 }).returning();
    ids.latteM = (await db.insert(s.products).values({ categoryId: c.id, name: "Latte", size: "M", price: 170, siteMenuId: "mnu-0003", siteMenuSlot: "M" }).returning())[0].id;
    ids.mocha = (await db.insert(s.products).values({ categoryId: c.id, name: "Mocha", size: "Tek", price: 180 }).returning())[0].id;
    const [milk] = await db.insert(s.ingredients).values({ name: "Süt", category: "Süt", unit: "ml", countUnit: "LT", packagePrice: 100, packageSize: 1000, vatRate: 0.01 }).returning();
    ids.milk = milk.id;
    await db.insert(s.recipeItems).values([
      { productId: ids.latteM, ingredientId: milk.id, qty: 200 },
      { productId: ids.mocha, ingredientId: milk.id, qty: 150 },
    ]);
    await db.insert(s.posMappings).values({ posName: "MOCHA", productId: ids.mocha, isService: false });
    await reports.saveCashSettings({ recipients: ["sahip@ornek.com"], emailEnabled: true, whatsapp: null });
    sent.length = 0;
  });
  afterEach(() => mock.timers.reset());

  lafposTest("geçiş günü boşken LafPOS'un ödemeleri ve ikramı hiçbir yere girmez: komisyon, veri kümesi, kasa özeti, zayi kaydı", async () => {
    await panelEntry("2026-11-11", "ikram", ids.latteM, null, 3);
    const before = JSON.stringify(await dataset.loadDataset());
    await push("2026-11-11", 13);
    // Komisyon: LafPOS tablosu okunmaz
    const input = await commission.loadCommissionInput({ resolveNames: false, today: "2026-11-12" });
    assert.equal(input.lafpos, null);
    // Veri kümesi bayt bayt aynı (lafposIkram yok)
    const ds = await dataset.loadDataset();
    assert.equal("lafposIkram" in ds, false);
    assert.equal(JSON.stringify(ds), before);
    // Kasa özeti ve Zayi'nin günü bugünkü gibi
    assert.equal(await lafposIkram.loadDayLafposIkram("2026-11-11"), null);
    const day = await waste.dayWaste("2026-11-11");
    assert.equal(day.lafpos, null);
    assert.equal(day.ikram, "3× Latte M");
    assert.equal(day.ikramValue, 510);
    // Ürün ikramı panele girilir
    const added = await core.addWaste(db, users.ayse, { date: "2026-11-11", kind: "ikram", productId: ids.latteM, ingredientId: null, qty: 1, reason: null, note: null }, NOW);
    assert.ok(added.id > 0);
  });

  lafposTest("E-37: geçiş günü seçilince ödeme türleri kanal kanal komisyonun satışı (deneme günü hariç)", async () => {
    // Geçiş günü 1 Kasım (Kasım'ın tamamı LafPOS'tan): 31 Ekim deneme, 10 ve 11 Kasım sayılır
    await push("2026-10-31", 11, { payments: [{ name: "Pluxee", zField: "meal_card", channel: "pluxee", amount: 9_999 }] });
    await push("2026-11-10", 12);
    await push("2026-11-11", 13);
    await db.insert(s.invoices).values({ date: "2026-11-11", supplier: "Pluxee Türkiye", category: "Komisyon", amount: 60, payable: 72 });
    const none = await commission.loadCommissionInput({ resolveNames: false, today: "2026-11-12" });
    assert.equal(none.lafpos, null, "geçiş günü boş");
    await setSwitch("2026-11-01");
    const input = await commission.loadCommissionInput({ resolveNames: false, today: "2026-11-12" });
    assert.equal(input.lafpos?.switchDay, "2026-11-01");
    assert.deepEqual(
      input.lafpos?.days.map((d) => d.date),
      ["2026-11-10", "2026-11-11"],
    );
    const day = input.lafpos!.days[0];
    assert.equal(day.mealCard, 2_500);
    assert.equal(day.online, 1_000);
    assert.deepEqual(
      day.payments.map((p) => [p.name, p.channel, p.rawChannel, p.amount]),
      [
        ["Nakit", null, null, 5_000],
        ["Pluxee", "pluxee", "pluxee", 1_550],
        ["Multinet", "multinet", "Multinet", 800],
        ["Ticket kart", null, "Ticket", 150],
        ["Yemeksepeti", "yemeksepeti", "yemeksepeti", 1_000],
      ],
    );
    const report = buildCommissionReport(input);
    // 1–9 Kasım'ın gün sonu yok: satış kanalın ödemeleri, eksik günler uyarılır
    const pluxee = rowOf(report, "pluxee", "2026-11")!;
    assert.deepEqual(pluxee.sales, { amount: 3_100, source: "lafpos" });
    assert.equal(plain(pluxee.flags.find((f) => f.key === "kasa-eksik")!.text), "9 gün LafPOS gün sonu yok ve kanalı seçilmemiş 300 ₺ ödeme var; satış eksik kaldıysa oran yüksek görünür.");
    // Multinet'in faturası yok ama LafPOS'ta satışı var: kartı çıkar
    assert.deepEqual(rowOf(report, "multinet", "2026-11")?.sales, { amount: 1_600, source: "lafpos" });
    assert.deepEqual(rowOf(report, "yemeksepeti", "2026-11")?.sales, { amount: 2_000, source: "lafpos" });
    const g = groupOf(report, "meal", "2026-11")!;
    assert.equal(g.zTotal, 5_000);
    assert.equal(g.lafposFrom, "2026-11-01");
    assert.equal(g.missing.length, 9);
    // Ekim (geçiş gününden önce) LafPOS'tan hiçbir şey almaz: deneme günü yok
    assert.equal(groupOf(report, "meal", "2026-10"), null);
    assert.match(plain(g.flags.find((f) => f.key === "lafpos-kanal")!.text), /“Ticket kart” \(kanal “Ticket”\) 300 ₺/);
    // Zil ve ekranın hafif yolu da aynı girdiyi okur
    assert.deepEqual(
      (await commission.loadOverduePayouts()).map((x) => x.label),
      [],
    );
  });

  lafposTest("E-38: LafPOS ikramı ürüne bağlanır, kayıtlı tüketime bir kez girer; gün sonu gelen günde paneldeki ürün ikramı sayılmaz", async () => {
    await setSwitch(S);
    // 9 Kasım (geçişten önce) ürün ikramı sayılır; 11 Kasım'ınki (LafPOS'un gün sonu geldi) sayılmaz; hammadde ikramı sayılır
    await panelEntry("2026-11-09", "ikram", ids.latteM, null, 1);
    const [notCounted] = await panelEntry("2026-11-11", "ikram", ids.latteM, null, 3);
    await panelEntry("2026-11-11", "ikram", null, ids.milk, 0.5);
    // 12 Kasım LafPOS günü ama gün sonu gelmedi: paneldeki ürün ikramı sayılır
    await panelEntry("2026-11-12", "ikram", ids.mocha, null, 1);
    await push("2026-11-11", 13);
    const ds = await dataset.loadDataset();
    assert.deepEqual(ds.lafposIkram?.days, ["2026-11-11"]);
    assert.deepEqual(
      ds.lafposIkram?.lines.map((l) => [l.kind, l.posName, l.productId, l.qty, l.menuValue, l.reason]),
      [
        ["ikram", "LATTE MEDIUM", ids.latteM, 2, 340, "Müşteri"],
        ["ikram", "MOCHA", ids.mocha, 1, 180, "Personel"],
        ["ikram", "PUMPKIN CHAI", null, 1, 200, null],
      ],
    );
    const model = createModel(ds);
    // Süt: 9 Kasım 1 × 200 + LafPOS (2 × 200 + 1 × 150) + 12 Kasım Mocha 150 + hammadde 0,5 LT = 500 ml
    assert.equal(model.recordedUsage("2026-11").get(ids.milk)?.ikram, 200 + 550 + 150 + 500);
    const sum = model.wasteSummary("2026-11");
    assert.equal(sum.ikram.lafpos, 3);
    assert.equal(sum.notCounted, 1);
    assert.equal(sum.ikram.count, 6);
    assert.equal(sum.ikram.menuValue, 170 + 720 + 180);
    // Kasa özeti: 11 Kasım'ın ikramı LafPOS'tan
    const day = await waste.dayWaste("2026-11-11");
    assert.deepEqual(day.lafpos, { received: true, offRevenue: 720, ikramValue: 720, zayiValue: 0, listValue: 720, notCounted: 1 });
    assert.equal(day.ikram, "Süt 0,5 LT, 2× Latte M, 1× Mocha, 1× PUMPKIN CHAI");
    assert.equal(day.ikramValue, 720);
    const pending = await waste.dayWaste("2026-11-12");
    assert.deepEqual(pending.lafpos, { received: false, offRevenue: null, ikramValue: 0, zayiValue: 0, listValue: 0, notCounted: 0 });
    assert.equal(pending.ikram, "1× Mocha");
    // Zayi'nin günü: adlar paneldeki ürünle, bağlanamayan LafPOS'taki adıyla
    const view = await lafposIkram.loadDayLafposIkram("2026-11-11");
    assert.deepEqual(
      view?.lines.map((l) => [l.name, l.qty]),
      [
        ["Latte M", 2],
        ["Mocha", 1],
        ["PUMPKIN CHAI", 1],
      ],
    );
    assert.ok(notCounted.id > 0);
    // ModPOS'ta kalan şube (Tuzla): Marina'nın gün sonu geldiği günde de paneldeki ürün ikramı sayılır, LafPOS hiç okunmaz
    await panelEntry("2026-11-11", "ikram", ids.latteM, null, 1, MODPOS_SUBE);
    const tuzlaDs = await inTuzla(() => dataset.loadDataset());
    assert.equal("lafposIkram" in tuzlaDs, false);
    const tuzlaSum = createModel(tuzlaDs).wasteSummary("2026-11");
    assert.deepEqual([tuzlaSum.ikram.count, tuzlaSum.ikram.lafpos, tuzlaSum.notCounted, tuzlaSum.ikram.menuValue], [1, 0, 0, 170]);
    const tuzla = await inTuzla(() => waste.dayWaste("2026-11-11"));
    assert.equal(tuzla.lafpos, null);
    assert.equal(tuzla.ikram, "1× Latte M");
    assert.equal(tuzla.ikramValue, 170);
    // Marina'nın günü değişmedi (Tuzla'nın kaydı ona karışmaz)
    assert.equal((await waste.dayWaste("2026-11-11")).ikram, "Süt 0,5 LT, 2× Latte M, 1× Mocha, 1× PUMPKIN CHAI");
  });

  lafposTest("E-38: LafPOS'ta zayi yazılan satır zayi olarak girer (ikram değil); panelin aynı ürün zayisi sayılır ve işaretlenir", async () => {
    await setSwitch(S);
    await panelEntry("2026-11-11", "zayi", ids.latteM, null, 1);
    await push("2026-11-11", 13, { ikram: [...IKRAM, { posName: "LATTE MEDIUM", siteMenuId: "mnu-0003", slot: "M", qty: 1, menuValue: 170, reason: "Zayi: Döküldü" }] });
    const ds = await dataset.loadDataset();
    assert.deepEqual(
      ds.lafposIkram?.lines.filter((l) => l.kind === "zayi").map((l) => [l.posName, l.productId, l.qty, l.reason]),
      [["LATTE MEDIUM", ids.latteM, 1, "Döküldü"]],
    );
    const model = createModel(ds);
    // Süt: zayi = panelin 1 Latte'si + LafPOS'un 1 Latte'si (ikisi de sayılır); ikram = LafPOS'un ikramı (2 × 200 + 150)
    assert.deepEqual(model.recordedUsage("2026-11").get(ids.milk), { zayi: 400, ikram: 550 });
    const sum = model.wasteSummary("2026-11");
    assert.deepEqual([sum.zayi.count, sum.zayi.lafpos, sum.ikram.count, sum.ikram.lafpos, sum.ikram.menuValue], [2, 1, 3, 3, 720]);
    // Kasa özeti: LafPOS'un zayisi zayi satırında; Z'nin ödenmez tutarı (890) listenin tamamıyla tutar
    const day = await waste.dayWaste("2026-11-11");
    assert.equal(day.zayi, "2× Latte M");
    assert.equal(day.ikram, "2× Latte M, 1× Mocha, 1× PUMPKIN CHAI");
    assert.deepEqual(day.lafpos, { received: true, offRevenue: 890, ikramValue: 720, zayiValue: 170, listValue: 890, notCounted: 0 });
  });

  lafposTest("E-38: ürün ikramı LafPOS'un gün sonu gelen günde ve bugün reddedilir (iki rol, geç kayıt isteği ve onayı); gün sonu gelmeyen geçmiş günde girilir", async () => {
    // Geçiş gününden önce açılmış iki geç kayıt isteği (ürün ikramı): 8 Kasım'ın gün sonu sonra gelir, 7 Kasım'ınki hiç
    const ask = (date: string, key: string) =>
      core.proposeLateWaste(db, users.ayse, { date, kind: "ikram", productId: ids.latteM, ingredientId: null, qty: 1, reason: null, note: null, message: "Unuttum", clientKey: key }, NOW);
    const asked = await ask("2026-11-08", "k-ikram-1");
    const open = await ask("2026-11-07", "k-ikram-3");
    await setSwitch(S);
    await push("2026-11-10", 12);
    await push("2026-11-11", 13);
    const item = { kind: "ikram" as const, productId: ids.latteM, ingredientId: null, qty: 1, reason: null, note: null };
    // Bugün (12 Kasım, gün sonu bekleniyor) ve gün sonu gelen günler
    await refused(core.addWaste(db, users.ayse, { ...item, date: "2026-11-12" }, NOW), PRODUCT_IKRAM);
    await refused(core.addWaste(db, users.ali, { ...item, date: "2026-11-12" }, NOW), PRODUCT_IKRAM);
    await refused(core.addWaste(db, users.ali, { ...item, date: "2026-11-11" }, NOW), PRODUCT_IKRAM);
    await refused(core.proposeLateWaste(db, users.ayse, { ...item, date: "2026-11-10", message: "Unuttum", clientKey: "k-ikram-2" }, NOW), PRODUCT_IKRAM);
    // Ret yalnız LafPOS'un şubesinde: Tuzla'nın kasası ModPOS'ta, ürün ikramı bugün de gün sonu gelen günde de panele girilir
    const tuzlaToday = await inTuzla(() => core.addWaste(db, users.ayse, { ...item, date: "2026-11-12" }, NOW));
    const tuzlaPast = await inTuzla(() => core.addWaste(db, users.ali, { ...item, date: "2026-11-11" }, NOW));
    assert.deepEqual(
      (await db.select({ id: s.wasteEntries.id, branchId: s.wasteEntries.branchId }).from(s.wasteEntries).where(eq(s.wasteEntries.branchId, MODPOS_SUBE))).map((w) => w.id).sort(),
      [tuzlaToday.id, tuzlaPast.id].sort(),
    );
    // Hammadde ikramı, ürün zayisi ve geçişten önceki günün ürün ikramı girilir
    assert.ok((await core.addWaste(db, users.ayse, { ...item, productId: null, ingredientId: ids.milk, date: "2026-11-12" }, NOW)).id > 0);
    assert.ok((await core.addWaste(db, users.ayse, { ...item, kind: "zayi", date: "2026-11-12" }, NOW)).id > 0);
    assert.ok((await core.addWaste(db, users.ali, { ...item, date: "2026-11-09" }, NOW)).id > 0);
    // Geçiş günü 1 Kasım'a alınınca: 8 Kasım'ın gün sonu geldiyse isteği onaylanmaz, reddedilir (Onaylar'ın kartı da
    // söyler); 7 Kasım'ın gün sonu hiç gelmedi: onaylanır, yönetici o güne doğrudan da girer
    await push("2026-11-08", 9);
    const cardOf = async (id: number) => (await wasteRequests.loadWasteRequestQueue(async (b) => createModel(await dataset.loadDataset({ scope: b })), NOW)).find((c) => c.id === id);
    const before = await cardOf(asked.row.id);
    assert.equal(before?.kind === "zayi-gec" ? before.lafposRefusal : "?", null);
    await setSwitch("2026-11-01");
    const after = await cardOf(asked.row.id);
    assert.equal(
      plain(after?.kind === "zayi-gec" ? (after.lafposRefusal ?? "") : ""),
      "Ürün ikramı 1 Kasım'dan beri LafPOS'ta işaretlenir, panele girilmez. Hammadde ikramı ve zayi Zayi & ikram'da girilir.",
    );
    // Kartın Z karşılaştırması o günün LafPOS listesiyle (gün sonu geldi)
    assert.equal(after?.kind === "zayi-gec" ? after.ikramFromLafpos : "?", true);
    await refused(
      core.reviewWasteRequestCore(db, users.ali, { id: asked.row.id, seenVersion: asked.row.version, decision: "approve", note: null }, NOW),
      /^Ürün ikramı 1 Kasım'dan beri LafPOS'ta işaretlenir, panele girilmez\. Hammadde ikramı ve zayi Zayi & ikram'da girilir\. İsteği reddedin\.$/,
    );
    const rejected = await core.reviewWasteRequestCore(db, users.ali, { id: asked.row.id, seenVersion: asked.row.version, decision: "reject", note: null }, NOW);
    assert.equal(rejected.status, "rejected");
    assert.equal((await db.select().from(s.wasteEntries).where(eq(s.wasteEntries.date, "2026-11-08"))).length, 0);
    const openCard = await cardOf(open.row.id);
    assert.equal(openCard?.kind === "zayi-gec" ? openCard.lafposRefusal : "?", null, "gün sonu gelmeyen gün");
    const approved = await core.reviewWasteRequestCore(db, users.ali, { id: open.row.id, seenVersion: open.row.version, decision: "approve", note: null }, NOW);
    assert.equal(approved.status, "approved");
    assert.ok((await core.addWaste(db, users.ali, { ...item, date: "2026-11-06" }, NOW)).id > 0);
    // Bu kayıtlar sayılır (o günlerin ikramı panelden)
    const model = createModel(await dataset.loadDataset());
    assert.equal(model.countedWaste.filter((w) => w.kind === "ikram" && w.productId === ids.latteM && (w.date === "2026-11-07" || w.date === "2026-11-06")).length, 2);
  });

  lafposTest("E-38: Onaylar'daki geç hammadde ikramı kartı LafPOS gününde Z'yi LafPOS'un listesiyle karşılaştırır", async () => {
    await setSwitch(S);
    await push("2026-11-10", 12);
    // 10 Kasım'a geç hammadde ikramı isteği (personelin 10 Kasım'ı istek kipinde: bugün 12 Kasım)
    const asked = await core.proposeLateWaste(
      db,
      users.ayse,
      { date: "2026-11-10", kind: "ikram", productId: null, ingredientId: ids.milk, qty: 0.2, reason: "Personel", note: null, message: "Unuttum", clientKey: "k-ham-1" },
      NOW,
    );
    const card = (await wasteRequests.loadWasteRequestQueue(async (b) => createModel(await dataset.loadDataset({ scope: b })), NOW)).find((c) => c.id === asked.row.id);
    assert.equal(card?.kind, "zayi-gec");
    if (card?.kind !== "zayi-gec") return;
    assert.equal(card.lafposRefusal, null);
    assert.equal(card.ikramFromLafpos, true);
    // LafPOS'un listesi 720 (ödenmez tutarıyla aynı); panelde ürün ikramı yok ama 0 yazmaz
    assert.equal(card.ikramRecorded, 720);
  });

  lafposTest("E-38: ikramda ürüne bağlanamayan ad Ayarlar › LafPOS'ta listelenir (geçiş gününden itibaren); bağlanınca düşer", async () => {
    await push("2026-11-11", 13);
    // Geçiş günü boşken ikram hiçbir hesaba girmez: liste de boş
    const none = await status.loadLafposCard(db, NOW);
    assert.deepEqual([none.unmatchedIkram, none.unmatchedIkramCount], [[], 0]);
    await setSwitch(S);
    const card = await status.loadLafposCard(db, NOW);
    assert.deepEqual(card.unmatched, [], "satış satırının hepsi bağlı");
    assert.deepEqual(card.unmatchedIkram, [{ posName: "PUMPKIN CHAI", qty: 1, days: 1 }]);
    // Bağlanınca (POS adı hafızası) okuma anında çözülür: listeden düşer, ikram tüketime girer
    await db.insert(s.posMappings).values({ posName: "PUMPKIN CHAI", productId: ids.mocha, isService: false });
    assert.equal((await status.loadLafposCard(db, NOW)).unmatchedIkramCount, 0);
    assert.equal((await dataset.loadDataset()).lafposIkram?.lines.find((l) => l.posName === "PUMPKIN CHAI")?.productId, ids.mocha);
  });

  lafposTest("E-38: kasa e-postası LafPOS gününde LafPOS'un ikramını yazar ve iki rakamını karşılaştırır", async () => {
    await setSwitch(S);
    await panelEntry("2026-11-11", "ikram", ids.latteM, null, 3);
    // LafPOS'un Z'sinde ödenmez 900, ikram listesi 720: fark bilgi satırı
    await push("2026-11-11", 13, { offRevenue: 900 });
    const f: CashReportFields & { discounts: number | null } = {
      date: "2026-11-11",
      zNo: "13",
      receipts: 40,
      zTotal: 8_500,
      cash: 5_000,
      card: 0,
      mealCard: 2_500,
      online: 1_000,
      other: 0,
      openingCash: 1_000,
      cashIn: 0,
      cashOut: 0,
      cashOutNote: null,
      countedCash: 6_000,
      handedOver: 0,
      bankPos: null,
      offRevenue: 900,
      note: null,
      discounts: 0,
    };
    const saved = await store.saveCashReport(db, users.ali, { ...f, countedBy: null, revision: 0, photos: [] }, new Date("2026-11-11T22:00:00+03:00"));
    assert.equal(saved.kind, "saved");
    if (saved.kind !== "saved") return;
    assert.equal((await email.emailReport(saved.row.id, { site: Promise.resolve(null) })).status, "sent");
    const html = plain(sent[0].html);
    assert.match(html, /LafPOS'taki ikram/);
    assert.doesNotMatch(html, /Panelde kayıtlı ikram/);
    assert.doesNotMatch(html, /panelde kayıtlı ikramdan/);
    assert.match(html, /LafPOS'un ödenmez tutarı \(Z\) ikram ve zayi listesinden 180 ₺ fazla: LafPOS'ta ödenmez işaretlenen ama listeye girmeyen satır olabilir\./);
    assert.match(html, /Panele bu güne girilen 1 ürün ikramı sayılmadı: ikram LafPOS'tan geliyor\./);
    assert.match(plain(sent[0].text), /İkram: 2× Latte M, 1× Mocha, 1× PUMPKIN CHAI/);
  });
});
