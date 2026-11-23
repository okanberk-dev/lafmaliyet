// Hesap uyumu, Faz 1, gerçek Postgres'te (23 Kasım 2026; docs/hesap-sozlesmesi.md; saf kısım tests/hesap-uyumu-faz1.test.ts).
// Marina'nın Kasım 2026'sı (sözleşme §6): ModPOS listesi 13–21 Kasım (indirim öncesi 29.415,00, indirim 2.066,25,
// Z 27.348,75), LafPOS 22 Kasım (ciro 6.285,00, indirim 90, kart 5.030). Veri kümesinden:
// - Satışlar ve Gelir-gider'in banka POS komisyonu aynı: kart 24.774,25 × Marina'nın POS oranı (%2) = 495,49; oran
//   Şubeler'den (yalnız yönetici) değişir
// - Tutarlılık: liste − yalnız ModPOS günlerinin indirimi − POS = 0 (eskiden −90)
// - Komisyon & hakediş şube seçimine uyar
// - Bitmiş sabit gidere yeni ay değeri girilmez
//
// Test kendi geçici veritabanını açar (HESAP_UYUMU_TEST_DATABASE_URL'in sunucusunda), migration'ları uygular, sonunda
// siler. HESAP_UYUMU_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: HESAP_UYUMU_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/hesap-uyumu-faz1-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { consistency } from "../src/lib/calc/insights";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

import { LAFPOS_SUBE, MODPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.HESAP_UYUMU_TEST_DATABASE_URL;
const DB_NAME = `laffogato_hesap_uyumu_${process.pid}`;
/** Testin "şimdi"si: 10 Aralık 2026 öğlen (Kasım bitti) */
const NOW = "2026-12-10T12:00:00+03:00";
/** Marina'nın LafPOS'a geçiş günü */
const S = "2026-11-22";

/** ModPOS günleri (sözleşme §6): gün, ciro (Z), kart, nakit, indirim */
const MODPOS_DAYS: [string, number, number, number, number][] = [
  ["2026-11-13", 390, 195, 195, 0],
  ["2026-11-14", 3311, 2687.25, 623.75, 249],
  ["2026-11-15", 5753, 4146.5, 1606.5, 517],
  ["2026-11-16", 2670, 2140, 530, 0],
  ["2026-11-17", 1641.25, 1171.25, 470, 153.75],
  ["2026-11-18", 2419.25, 1814.5, 604.75, 315.75],
  ["2026-11-19", 2535.75, 1472.5, 1063.25, 204.25],
  ["2026-11-20", 4008, 2914.25, 1093.75, 397],
  ["2026-11-21", 4620.5, 3203, 1417.5, 229.5],
];

const round2 = (v: number) => Math.round(v * 100) / 100;

describe("hesap uyumu Faz 1: veritabanında", { skip: !SERVER_URL && "HESAP_UYUMU_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let dataset: typeof import("../src/server/data/dataset");
  let branches: typeof import("../src/server/actions/branches");
  let branchScope: typeof import("../src/server/branch-scope");

  before(async () => {
    mock.timers.enable({ apis: ["Date"], now: new Date(NOW) });
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "hesap-uyumu-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    branches = await import("../src/server/actions/branches");
    branchScope = await import("../src/server/branch-scope");

    // Marina: LafPOS'a 22 Kasım'da geçti; ModPOS listesi 13–21 Kasım (indirim öncesi), kasa raporları 13–22 Kasım
    await db.insert(s.settings).values({ key: "lafposGecisGunu", value: S });
    const [cat] = await db.insert(s.categories).values({ name: "Kahveler", sortOrder: 1 }).returning();
    const [latte] = await db.insert(s.products).values({ categoryId: cat.id, name: "Latte", size: "M", price: 190 }).returning();
    await db.insert(s.months).values({ month: "2026-11", branchId: LAFPOS_SUBE });
    await db.insert(s.salesLines).values([
      { month: "2026-11", branchId: LAFPOS_SUBE, posName: "LATTE MEDIUM", productId: latte.id, qty: 100, revenue: 20_000, isService: false, sortOrder: 1 },
      { month: "2026-11", branchId: LAFPOS_SUBE, posName: "TÜRK KAHVESİ", productId: null, qty: 47, revenue: 9_415, isService: false, sortOrder: 2 },
    ]);
    await db.insert(s.integrationState).values({ key: "sales.coverage", value: { "2026-11": "2026-11-21" } });
    for (const [date, zTotal, card, cash, discounts] of MODPOS_DAYS) {
      await db.insert(s.cashReports).values({ date, branchId: LAFPOS_SUBE, zTotal, card, cash, discounts, submittedByName: "Ayşe" });
    }
    await db.insert(s.cashReports).values({ date: S, branchId: LAFPOS_SUBE, zTotal: 6_285, card: 5_030, cash: 1_255, discounts: 90, submittedByName: "Ayşe" });
    // LafPOS 22 Kasım: satırlar indirimden sonra (Σ = Z)
    await db.insert(s.posDayReports).values({
      date: S,
      branchId: LAFPOS_SUBE,
      z: { zNo: 1, receipts: 26, zTotal: 6_285, cash: 1_255, card: 5_030, mealCard: 0, online: 0, other: 0, offRevenue: 1_065, discounts: 90, openingCash: 1_120, cashOut: 800, countedCash: 1_279.5, handedOver: 0, cashDiff: -295.5 },
      payments: [],
      ikram: [],
      source: "lafpos",
    });
    await db.insert(s.posDailySales).values([
      { date: S, branchId: LAFPOS_SUBE, posName: "LATTE M", productId: latte.id, qty: 3, revenue: 570, isService: false },
      { date: S, branchId: LAFPOS_SUBE, posName: "SYRUP", productId: null, qty: 2, revenue: 92.5, isService: false },
      { date: S, branchId: LAFPOS_SUBE, posName: "TÜRK KAHVESİ", productId: null, qty: 40, revenue: 5_622.5, isService: false },
    ]);
  });

  after(async () => {
    mock.timers.reset();
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const inMarina = <T>(fn: () => Promise<T>) => branchScope.withBranchScope(LAFPOS_SUBE, fn);

  test("banka POS komisyonu: Marina Kasım kart 24.774,25 × %2 = 495,49 Satışlar'da ve Gelir-gider'de; liste ↔ POS farkı 0", async () => {
    const model = await inMarina(() => dataset.loadModel());
    assert.equal(model.pnlMonth("2026-11").cells.get("commission:pos")?.value, 495.49, "Gelir-gider");
    assert.equal(round2(model.monthSales("2026-11").commission), 495.49, "Satışlar");
    // −90 ₺: LafPOS gününün indirimi satırlarda zaten düşülmüş
    const c = consistency(model, "2026-11");
    assert.deepEqual([c.sales.listTotal, c.sales.discounts, c.sales.pos, c.sales.diff], [35_700, 2_066.25, 33_633.75, 0]);
    // "Tümü" de aynı (yalnız Marina'nın kasa raporu var)
    const all = await branchScope.withBranchScope("hepsi", () => dataset.loadModel());
    assert.equal(all.pnlMonth("2026-11").cells.get("commission:pos")?.value, 495.49);
    assert.equal(round2(all.monthSales("2026-11").commission), 495.49);
  });

  test("şubenin POS oranı Şubeler'den (yalnız yönetici, %0–%10): değişince iki sayfa birlikte değişir", async () => {
    const [marina] = await db.select().from(s.branches).where(eq(s.branches.id, LAFPOS_SUBE));
    const base = { id: marina.id, name: marina.name, kind: marina.kind, posSource: marina.posSource, openedOn: marina.openedOn, active: marina.active };
    assert.equal(marina.posRate, 0.02, "migration'ın varsayılanı %2");
    const bad = await branches.updateBranch({ ...base, posRate: 0.2 });
    assert.deepEqual(bad, { ok: false, error: "POS oranı en çok %10 olabilir" });
    const ok = await branches.updateBranch({ ...base, posRate: 0.015 });
    assert.ok(ok.ok, JSON.stringify(ok));
    const model = await inMarina(() => dataset.loadModel());
    assert.equal(model.pnlMonth("2026-11").cells.get("commission:pos")?.value, round2(24_774.25 * 0.015));
    assert.equal(round2(model.monthSales("2026-11").commission), round2(24_774.25 * 0.015));
    const [log] = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Şube güncellendi"));
    assert.match(log?.detail ?? "", /POS oranı: %2 → %1,5/);
    // Oranı göndermeyen düzenleme eskisini korur
    assert.ok((await branches.updateBranch(base)).ok);
    const [after] = await db.select({ posRate: s.branches.posRate }).from(s.branches).where(eq(s.branches.id, LAFPOS_SUBE));
    assert.equal(after.posRate, 0.015);
    await db.update(s.branches).set({ posRate: 0.02 }).where(eq(s.branches.id, LAFPOS_SUBE));
    // Tuzla'nın oranı Marina'nın komisyonunu değiştirmez
    await db.update(s.branches).set({ posRate: 0.05 }).where(eq(s.branches.id, MODPOS_SUBE));
    const again = await inMarina(() => dataset.loadModel());
    assert.equal(again.pnlMonth("2026-11").cells.get("commission:pos")?.value, 495.49);
    await db.update(s.branches).set({ posRate: 0.02 }).where(eq(s.branches.id, MODPOS_SUBE));
  });
});
