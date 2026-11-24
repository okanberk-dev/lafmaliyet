// Kabul: Marina'nın Kasım 2026'sı gerçek Postgres'te, gerçek yükleyiciler ve motorla (hesap sözleşmesi §6; 23 Kasım 2026).
// - 13–21 Kasım ModPOS günleri Marina'nın kasa raporlarıdır (sözleşmenin tablosu), ModPOS ürün listesi 31 satır, 240 adet,
//   29.415,00 (indirimden önce)
// - 22 Kasım LafPOS günü imzalı uçtan gelir: tests/fixtures/kabul-gunu-2026-11-22.json (LafPOS'taki aynı adlı dosyanın
//   bayt bayt kopyası); kasa raporu gün sonundan kendiliğinden yazılır
// Ayın rakamları: ciro 33.633,75 · kart 24.774,25 · nakit 8.859,50 · yemek 0 · indirim 2.156,25 · ödenmez + ikram
// 2.565,00 · fiş 161 · KDV hariç (gün gün) 30.576,15 · banka POS komisyonu 495,49 Satışlar'da ve Gelir-gider'de; 22 Kasım:
// yazarkasadan geçmeyen, ödeme iptalleri, 12 iptal parçası (2.395,00), kasa açılış / olması gereken / sayılan / fark.
//
// Test kendi geçici veritabanını açar (KABUL_TEST_DATABASE_URL'in sunucusunda), migration'ları uygular, sonunda siler.
// KABUL_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: KABUL_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/kabul-gunu-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, mock, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { lafposMonthNotes } from "../src/lib/lafpos/sales";
import { computeCash } from "../src/lib/cash-report";
import { money } from "../src/lib/format";
import { signedHeaders } from "../src/lib/karaoke/signature";
import { vatMonthInputs } from "../src/lib/kdv";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

import { LAFPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.KABUL_TEST_DATABASE_URL;
const DB_NAME = `laffogato_kabul_${process.pid}`;
const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const GUN = new URL("https://ladmin.laffogato.net/api/pos/gun");
/** Marina'nın LafPOS'a geçiş günü */
const S = "2026-11-22";
/** Gün sonunun geldiği an (22 Kasım gecesi kapandı, 23 Kasım sabahı gönderildi) */
const PUSHED = new Date("2026-11-23T01:00:00+03:00");
/** Ayın rakamlarının okunduğu an: 10 Aralık 2026 öğlen (Kasım bitti) */
const NOW = "2026-12-10T12:00:00+03:00";

/** ModPOS günleri (sözleşme §6): gün, ciro, kart, nakit, indirim, ödenmez, fiş, ModPOS Z */
const MODPOS_DAYS: [string, number, number, number, number, number, number, string][] = [
  ["2026-11-13", 390, 195, 195, 0, 0, 2, "Z-2026-002"],
  ["2026-11-14", 3311, 2687.25, 623.75, 249, 0, 14, "Z-2026-003"],
  ["2026-11-15", 5753, 4146.5, 1606.5, 517, 190, 27, "Z-2026-004"],
  ["2026-11-16", 2670, 2140, 530, 0, 0, 9, "Z-2026-005"],
  ["2026-11-17", 1641.25, 1171.25, 470, 153.75, 455, 12, "Z-2026-006"],
  ["2026-11-18", 2419.25, 1814.5, 604.75, 315.75, 400, 16, "Z-2026-007"],
  ["2026-11-19", 2535.75, 1472.5, 1063.25, 204.25, 200, 19, "Z-2026-008"],
  ["2026-11-20", 4008, 2914.25, 1093.75, 397, 255, 19, "Z-2026-009"],
  ["2026-11-21", 4620.5, 3203, 1417.5, 229.5, 0, 17, "Z-2026-010"],
];

const r2 = (v: number) => Math.round(v * 100) / 100;
const kabul = () => readFileSync(join(process.cwd(), "tests/fixtures/kabul-gunu-2026-11-22.json"), "utf8");

describe("kabul: Marina Kasım 2026 (ModPOS 13–21 + LafPOS 22 Kasım)", { skip: !SERVER_URL && "KABUL_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let dataset: typeof import("../src/server/data/dataset");
  let branchScope: typeof import("../src/server/branch-scope");

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "kabul-testi-icin-en-az-otuz-iki-karakterlik-bir-anahtar" });
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
    const [u] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const me = async () => ({ ...u, role: "admin" as const });
    stub(require.resolve("../src/server/auth/dal"), { requireAdmin: me, requireUser: me });
    dataset = await import("../src/server/data/dataset");
    branchScope = await import("../src/server/branch-scope");

    await db.insert(s.settings).values({ key: "lafposGecisGunu", value: S });
    // ModPOS ürün listesi (Marina, 13–21 Kasım; indirimden önce): 31 satır, 240 adet, 29.415,00
    await db.insert(s.months).values({ month: "2026-11", branchId: LAFPOS_SUBE });
    await db.insert(s.salesLines).values(
      Array.from({ length: 31 }, (_, i) => ({
        month: "2026-11",
        branchId: LAFPOS_SUBE,
        posName: `MODPOS ÜRÜN ${i + 1}`,
        productId: null,
        qty: i < 23 ? 8 : 7,
        revenue: i < 30 ? 950 : 915,
        isService: false,
        sortOrder: i + 1,
      })),
    );
    await db.insert(s.integrationState).values({ key: "sales.coverage", value: { "2026-11": "2026-11-21" } });
    // ModPOS günleri Marina'nın kasa raporları (Z = ciro, indirimden sonra; ödenmez Z'nin dışında). 21 Kasım'ın devri
    // 22 Kasım'ın açılışı (1.120,00)
    for (const [date, zTotal, card, cash, discounts, offRevenue, receipts, zNo] of MODPOS_DAYS) {
      await db.insert(s.cashReports).values({
        date,
        branchId: LAFPOS_SUBE,
        zNo,
        receipts,
        zTotal,
        card,
        cash,
        discounts,
        offRevenue,
        openingCash: 0,
        countedCash: date === "2026-11-21" ? 1_120 : cash,
        submittedByName: "Alper",
      });
    }
    // 22 Kasım: LafPOS'un gün sonu imzalı uçtan, kasa raporu gün sonundan kendiliğinden
    const ingest = await import("../src/server/lafpos/ingest");
    const raw = kabul();
    const h = signedHeaders(SECRET, "POST", GUN, raw, PUSHED.getTime());
    const res = await ingest.receivePosDay(db, { secret: SECRET, url: GUN, body: raw, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"] }, PUSHED);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const gunSonu = await import("../src/server/lafpos/gun-sonu");
    assert.equal(await gunSonu.writeAutoReport(db, S, PUSHED), "written");
    mock.timers.enable({ apis: ["Date"], now: new Date(NOW) });
  });

  after(async () => {
    mock.timers.reset();
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const inMarina = <T>(fn: () => Promise<T>) => branchScope.withBranchScope(LAFPOS_SUBE, fn);

  test("ayın kasası: ciro 33.633,75 · kart 24.774,25 · nakit 8.859,50 · yemek 0 · indirim 2.156,25 · ödenmez + ikram 2.565,00 · fiş 161", async () => {
    const model = await inMarina(() => dataset.loadModel());
    const nov = model.monthInfo.get("2026-11");
    assert.ok(nov?.kasa, "ayın kasası");
    assert.deepEqual(
      [nov.posRevenue, nov.kasa.till.card, nov.kasa.till.mealCard, nov.discounts, nov.offRevenue],
      [33_633.75, 24_774.25, 0, 2_156.25, 2_565],
    );
    assert.deepEqual([nov.sources?.posRevenue, nov.sources?.discounts, nov.sources?.offRevenue], ["kasa", "kasa", "kasa"]);
    const [t] = await db
      .select({ cash: sql<string>`sum(${s.cashReports.cash})`, receipts: sql<string>`sum(${s.cashReports.receipts})`, n: sql<string>`count(*)` })
      .from(s.cashReports)
      .where(and(eq(s.cashReports.branchId, LAFPOS_SUBE), sql`${s.cashReports.date} like '2026-11-%'`));
    assert.deepEqual([r2(Number(t.cash)), Number(t.receipts), Number(t.n)], [8_859.5, 161, 10]);
  });

  test("KDV hariç ciro 30.576,15 (gün gün: LafPOS gününün kendi dökümü + ModPOS günleri %10'la), KDV 3.057,60; Satışlar ve Gelir-gider'de banka POS komisyonu 495,49", async () => {
    for (const scope of [LAFPOS_SUBE, "hepsi"] as const) {
      const model = await branchScope.withBranchScope(scope, () => dataset.loadModel());
      const pm = model.pnlMonth("2026-11");
      assert.equal(pm.revenueNet, 30_576.15, `${scope}: KDV hariç (ay toplamından 30.576,14 olurdu)`);
      assert.deepEqual(model.posNet("2026-11"), { net: 30_576.15, vat: 3_057.6, byDay: true }, scope);
      assert.equal(vatMonthInputs(model, "2026-12-10").months.find((m) => m.month === "2026-11")?.pos?.vat, 3_057.6, `${scope}: KDV tahmini`);
      assert.equal(pm.cells.get("commission:pos")?.value, 495.49, `${scope}: Gelir-gider`);
      assert.equal(r2(model.monthSales("2026-11").commission), 495.49, `${scope}: Satışlar`);
    }
  });

  test("Satışlar: ModPOS listesi − indirim = Z (29.415,00 − 2.066,25 = 27.348,75), LafPOS gününün satırları Z'yi tutuyor; LafPOS satırı brütle", async () => {
    const model = await inMarina(() => dataset.loadModel());
    const st = model.ds.lafposSales?.months.find((m) => m.month === "2026-11");
    assert.ok(st, "geçiş ayının özeti");
    assert.deepEqual([st.modpos?.revenue, st.modposZ, st.modposDiscounts, st.modpos?.from], [29_415, 27_348.75, 2_066.25, "2026-11-13"]);
    assert.deepEqual(st.zCheck, { days: 1, off: [] });
    const notes = lafposMonthNotes(st, S);
    assert.deepEqual(notes.warnings, []);
    assert.deepEqual(
      notes.checks.map((c) => c.ok),
      [true, true],
    );
    const sales = model.monthSales("2026-11");
    const laf = sales.lines.filter((l) => l.line.lafpos);
    assert.equal(r2(laf.reduce((a, l) => a + l.line.revenue, 0)), 6_285, "LafPOS satırları indirimden sonra = Z");
    assert.equal(r2(laf.reduce((a, l) => a + (l.line.gross ?? 0), 0)), 6_375, "brüt: ciro + indirim 90");
    assert.equal(laf.find((l) => l.line.posName === "SYRUP")?.line.revenue, 92.5);
    assert.equal(laf.find((l) => l.line.posName === "LATTE MEDIUM")?.line.revenue, 570);
    const qty = (addon: boolean) => laf.filter((l) => Boolean(l.line.isAddon) === addon).reduce((a, l) => a + l.line.qty, 0);
    assert.deepEqual([qty(false), qty(true)], [58, 2], "satılan ürün 58, ek 2");
    const modpos = sales.lines.filter((l) => !l.line.lafpos);
    assert.deepEqual([modpos.length, modpos.reduce((a, l) => a + l.line.qty, 0), r2(modpos.reduce((a, l) => a + l.line.revenue, 0))], [31, 240, 29_415]);
  });

  test("22 Kasım: kasa raporu gün sonundan (açılış 1.120 · olması gereken 1.575 · sayılan 1.279,50 · fark −295,50 · devir 1.279,50), yazarkasa Z no 11", async () => {
    const [rep] = await db.select().from(s.cashReports).where(and(eq(s.cashReports.date, S), eq(s.cashReports.branchId, LAFPOS_SUBE)));
    assert.ok(rep, "otomatik rapor");
    const c = computeCash(rep);
    assert.deepEqual(
      [rep.openingCash, rep.cash, rep.cashOut, c.expectedCash, rep.countedCash, rep.cashDiff, c.carryOver, rep.handedOver],
      [1_120, 1_255, 800, 1_575, 1_279.5, -295.5, 1_279.5, 0],
    );
    assert.deepEqual([rep.zNo, rep.okcZNo, rep.zTotal, rep.card, rep.receipts, rep.discounts, rep.offRevenue], ["11", "11", 6_285, 5_030, 26, 90, 1_065]);
    // Gün sonu tam (24 Kasım 2026): Banka POS Pavo'nun gün sonundan (Σ batch = 5.030 − 870 = 4.160), yazarkasa alanları
    // LafPOS'un cihaz belgelerinden; not eksik söylemez (cihazların rakamı tam)
    const body = JSON.parse(kabul()) as { okc: { docs: number; total: number; cash: number; card: number; mealCard: number; other: number } };
    assert.equal(rep.bankPos, 4_160);
    assert.deepEqual(
      [rep.okcReceipts, rep.okcTotal, rep.okcCash, rep.okcCard, rep.okcMealCard, rep.okcOther],
      [body.okc.docs, body.okc.total, body.okc.cash, body.okc.card, body.okc.mealCard, body.okc.other],
    );
    assert.deepEqual([rep.okcTotal, rep.okcCash, rep.okcCard], [5_215, 1_055, 4_160], "Z − yazarkasadan geçmeyen");
    assert.equal(rep.note, "LafPOS gün sonundan otomatik yazıldı.");
  });

  test("22 Kasım: yazarkasadan geçmeyen kart 870 / nakit 200, iki ödeme iptali (50 + 45), 12 iptal parçası 2.395,00; hazırlanmışlar zayi tüketimi", async () => {
    const [day] = await db.select().from(s.posDayReports).where(and(eq(s.posDayReports.date, S), eq(s.posDayReports.branchId, LAFPOS_SUBE)));
    assert.ok(day, "gün sonu");
    assert.deepEqual(day.offDevice, { card: 870, cash: 200, cardTips: 0 });
    assert.deepEqual(
      day.refunds?.map((x) => x.amount),
      [50, 45],
    );
    assert.equal(day.iptal?.length, 12);
    assert.equal(r2(day.iptal!.reduce((a, l) => a + l.listValue, 0)), 2_395);
    assert.deepEqual([day.revision, day.correction], [1, null]);
    assert.equal((await db.select().from(s.posDayRevisions).where(eq(s.posDayRevisions.date, S))).length, 1, "sürüm geçmişi");
    // Hazırlanmış iptaller (6 parça, 1.270,00) zayi olarak tüketime; hazırlanmamışlar (6 parça, 1.125,00) bilgi
    const ikram = await import("../src/server/data/lafpos-ikram");
    const data = await ikram.loadLafposIkram(db, S, { from: S, to: S }, LAFPOS_SUBE);
    const iptal = data.lines.filter((l) => l.iptal);
    assert.deepEqual([iptal.length, r2(iptal.reduce((a, l) => a + l.menuValue, 0)), iptal.every((l) => l.kind === "zayi")], [6, 1_270, true]);
    const model = await inMarina(() => dataset.loadModel());
    const counted = model.countedWaste.filter((w) => w.source === "lafpos" && w.date === S);
    assert.equal(r2(counted.filter((w) => w.kind === "zayi").reduce((a, w) => a + (w.menuValue ?? 0), 0)), 1_270, "motorun zayisi: yalnız hazırlanmış iptaller");
    assert.equal(r2(counted.filter((w) => w.kind === "ikram").reduce((a, w) => a + (w.menuValue ?? 0), 0)), 1_065, "ikram + ödenmez");
    const waste = await import("../src/server/data/waste");
    const dw = await inMarina(() => waste.dayWaste(S, LAFPOS_SUBE));
    assert.ok(dw.lafpos, "LafPOS günü");
    assert.deepEqual(
      [dw.lafpos.offRevenue, dw.lafpos.listValue, dw.lafpos.iptalValue, dw.lafpos.unprepared, dw.lafpos.byKind?.z],
      [1_065, 1_065, 1_270, { count: 6, value: 1_125 }, { ikram: 130, odenmez: 935, zayi: 0, sale: { listValue: 7_440, discounts: 90, zTotal: 6_285 } }],
    );
    const { lafposIkramCheck } = await import("../src/lib/lafpos/ikram");
    assert.equal(lafposIkramCheck(dw.lafpos.offRevenue!, dw.lafpos.listValue, dw.lafpos.byKind), null, "LafPOS'un toplamları listeyi ve Z'nin eşitliğini tutuyor (7.440 − 90 − 130 − 935 = 6.285)");
    // Gün görünümünün ayrıntısı
    const kasa = await import("../src/server/data/lafpos-day");
    const detail = await kasa.loadLafposDayDetail(S, db, LAFPOS_SUBE);
    assert.ok(detail, "ayrıntı");
    const rows = Object.fromEntries(detail.sections.flatMap((x) => x.rows));
    assert.equal(rows["Yazarkasa Z no"], "11");
    assert.equal(detail.sends, 1);
    // Pavo'nun batch'i yazarkasadan geçmeyen kartı (870) beklemez: LafPOS'un kıyası 5.030 − 870 = 4.160, uyumlu
    const bank = await kasa.loadLafposBankPos(S, db, LAFPOS_SUBE);
    assert.ok(bank, "Pavo karşılaştırması");
    const { pavoView } = await import("../src/lib/lafpos/bank-pos");
    assert.deepEqual([bank.pavoCard, bank.lafposCard, r2(day.z.card - day.offDevice!.card), pavoView(bank).state], [4_160, 4_160, 4_160, "uyumlu"]);
    // Kasa raporunun kart karşılaştırması da aynı kuralla: yazarkasa kartı ve banka gün sonu 4.160 yazılınca fark yok
    const laf = await kasa.loadLafposDay(S, db, LAFPOS_SUBE);
    // okcCard: LafPOS'un cihaz belgelerinin kartı (okc.card; otomatik raporun yazarkasa kartı bununla aynıysa bahşiş düşülmez)
    assert.deepEqual(laf?.offDevice, { card: 870, cash: 200, okcCard: 4_160 });
    const [saved] = await db.select().from(s.cashReports).where(and(eq(s.cashReports.date, S), eq(s.cashReports.branchId, LAFPOS_SUBE)));
    const { withCardExtra } = await import("../src/lib/cash-report");
    const report = { ...saved, bankPos: 4_160, okcCard: 4_160 };
    assert.equal(computeCash(withCardExtra(report, laf!.cardExtra, laf!.offDevice)).cardDiff, 0, "Kart'tan 870 eksik demez");
    const days = await inMarina(() => kasa.loadKasaLafposDays(S, S, db));
    assert.deepEqual(days(S, LAFPOS_SUBE).day?.offDevice, { card: 870, cash: 200, okcCard: 4_160 }, "ay görünümünün okuyucusu da");
  });

  test("22 Kasım kasa zinciri (Faz 3): 23 Kasım'ın beklenen açılışı 1.279,50 (gün sonu yanıtı ve devir ucu); 800,00 'Diğer fatura dışı' fişsiz harcama Kasadan çıkanlar'da bir kez", async () => {
    const devir = await import("../src/server/lafpos/devir");
    const status = await import("../src/server/lafpos/status");
    const kasa = await import("../src/server/data/lafpos-day");
    assert.deepEqual(await devir.lafposNextOpening(db, S), { amount: 1_279.5, source: "kasa_raporu" }, "otomatik rapor: sayılan − teslim");
    // Aynı gün yeniden gelir (ör. Pavo sonucu): yanıt aynı devri söyler, harcama ikinci kez yazılmaz
    const raw = kabul();
    const h = signedHeaders(SECRET, "POST", GUN, raw, PUSHED.getTime());
    const again = await status.handlePosDay(db, { secret: SECRET, url: GUN, body: raw, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"] }, PUSHED);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual([again.body.counted, again.body.nextOpening], [true, { amount: 1_279.5, source: "kasa_raporu" }]);
    const devirUrl = new URL(`https://ladmin.laffogato.net/api/panel/pos/devir?date=${S}`);
    const g = signedHeaders(SECRET, "GET", devirUrl, "", PUSHED.getTime());
    assert.deepEqual(await devir.servePosDevir(db, { secret: SECRET, url: devirUrl, timestamp: g["x-laf-timestamp"], signature: g["x-laf-signature"], now: PUSHED }), {
      status: 200,
      body: { version: 1, date: S, nextOpening: { amount: 1_279.5, source: "kasa_raporu" } },
    });
    const outs = await db.select().from(s.cashOuts).where(and(eq(s.cashOuts.date, S), eq(s.cashOuts.branchId, LAFPOS_SUBE)));
    assert.equal(outs.length, 1, "tek satır");
    assert.deepEqual(
      [outs[0].kind, outs[0].amount, outs[0].lafposId, outs[0].docType, outs[0].photoId, outs[0].description, outs[0].createdByName],
      ["harcama", 800, "01M81R1GV0K7Q2W9X4Y6Z8A0B2", "yok", null, "Fişsiz", "LafPOS"],
    );
    const expenses = await db
      .select({ amount: s.expenseEntries.amount, category: s.expenseCategories.name, branchId: s.expenseEntries.branchId })
      .from(s.expenseEntries)
      .innerJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
      .where(eq(s.expenseEntries.cashOutId, outs[0].id));
    assert.deepEqual(expenses, [{ amount: 800, category: "Diğer fatura dışı", branchId: LAFPOS_SUBE }], "Aylık harcamalar'da bir kez");
    const [rep] = await db.select().from(s.cashReports).where(and(eq(s.cashReports.date, S), eq(s.cashReports.branchId, LAFPOS_SUBE)));
    assert.equal(rep.cashOut, 800, "Gün içinde çıkan satırlardan, iki kez değil");
    const detail = await kasa.loadLafposDayDetail(S, db, LAFPOS_SUBE);
    const rows = Object.fromEntries(detail?.sections.flatMap((x) => x.rows) ?? []);
    assert.deepEqual([rows["Beklenen açılış"], rows.Harcama, rows.Teslim], ["bilinmiyor", `1 · ${money(800)}`, "yok"]);
  });
});
