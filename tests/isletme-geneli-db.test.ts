// İşletme geneli payı (Faz 5, sahibin kararı 4), gerçek Postgres'te (src/server/data/dataset.ts loadModel): Marina ve Tuzla
// görünümü işletme geneli giderleri (şubesi boş sabit gider, şubesi boş harcama, elle hücre, komisyon faturası) kârına
// katmaz; bilgi satırı Tümü'nün saydığı tutarı (işletmenin günüyle) gösterir; Marina kârı + Tuzla kârı − işletme geneli
// = Tümü kârı. Tuzla'nın şahsa kirası (resmi 100.000, stopaj 20.000) yalnız Tuzla'da.
//
// ISLETME_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Test kendi geçici
// veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: ISLETME_TEST_DATABASE_URL=postgres://ci:ci@localhost:5432/test npx tsx --test tests/isletme-geneli-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { branchBreakdown } from "../src/lib/branch-breakdown";
import { ALL_BRANCHES, DEFAULT_BRANCHES } from "../src/lib/branches";
import { stopajKey } from "../src/lib/calc/engine";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.ISLETME_TEST_DATABASE_URL;
const DB_NAME = `laffogato_isletme_${process.pid}`;
const close = (a: number, b: number, msg: string, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

describe("işletme geneli payı: veritabanında", { skip: !SERVER_URL && "ISLETME_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dataset: typeof import("../src/server/data/dataset");
  let kiraId = 0;
  let catId = 0;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "isletme-geneli-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    await db
      .insert(s.branches)
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b, active: true })))
      .onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    const [a] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const me = async () => ({ ...a, role: "admin" as const });
    stub(require.resolve("../src/server/auth/dal"), { getCurrentUser: me, requireUser: me, requireAdmin: me });
    dataset = await import("../src/server/data/dataset");

    // Ekim 2026 (kapanmış ay): Tuzla 31 gün açık, Marina 18 gün (açılış ayı gibi); ikisinin elle yazılan ay satırı
    await db.insert(s.months).values([
      { month: "2026-10", branchId: "tuzla", openDays: 31, posRevenue: 200_000 },
      { month: "2026-10", branchId: "marina", openDays: 18, posRevenue: 100_000 },
    ]);
    await db.insert(s.staff).values([
      { name: "Alper", netSalary: 35_000, extras: 0, mealCard: true, branchId: "marina" },
      { name: "Berkan", netSalary: 32_000, extras: 0, branchId: "tuzla" },
    ]);
    const [k] = await db
      .insert(s.fixedExpenses)
      .values({ name: "Kira", section: "kira", period: "aylik", amount: 160_000, branchId: "tuzla", landlordType: "sahis", officialAmount: 100_000, officialBasis: "brut", prorate: false })
      .returning();
    kiraId = k.id;
    await db.insert(s.fixedExpenses).values([
      // İşletme geneli (şubesi boş)
      { name: "Instagram reklamı", section: "genel", period: "aylik", amount: 30_000 },
      { name: "Muhasebeci", section: "personel", period: "aylik", amount: 10_000 },
      { name: "Paraşüt aboneliği", section: "genel", period: "aylik", amount: 840 },
      // Marina'nın kalemi
      { name: "Marina güvenlik", section: "faturalar", period: "aylik", amount: 2_500, branchId: "marina" },
    ]);
    const [cat] = await db.insert(s.expenseCategories).values({ name: "Reklam (test)", section: "genel", panelGroup: "reklam", invoiceCategory: "Reklam & Tabela" }).returning();
    catId = cat.id;
    await db.insert(s.expenseEntries).values([
      { date: "2026-10-10", categoryId: cat.id, amount: 3_000, branchId: "marina" },
      { date: "2026-10-11", categoryId: cat.id, amount: 4_000, branchId: null },
      { date: "2026-10-12", categoryId: cat.id, amount: 5_000, branchId: "tuzla" },
    ]);
    await db.insert(s.invoices).values([
      { date: "2026-10-15", supplier: "Pluxee", category: "Komisyon", amount: 1_000, payable: 1_200, vat: 200 },
      { date: "2026-10-16", supplier: "Tabelacı", category: "Reklam & Tabela", amount: 6_000, payable: 7_200, vat: 1_200 },
    ]);
    await db.insert(s.pnlEntries).values([
      { month: "2026-10", rowKey: "manual:su", amount: 2_000 },
      { month: "2026-10", rowKey: "manual:harici", amount: 1_500 },
    ]);
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  test("Marina + Tuzla − işletme geneli = Tümü; bilgi satırı işletmenin günüyle, şubede kâra girmez", async () => {
    const [all, marina, tuzla] = await Promise.all([dataset.loadModel({ scope: ALL_BRANCHES }), dataset.loadModel({ scope: "marina" }), dataset.loadModel({ scope: "tuzla" })]);
    const a = all.pnlMonth("2026-10");
    const m = marina.pnlMonth("2026-10");
    const t = tuzla.pnlMonth("2026-10");
    // İşletme geneli: üç sabit gider (tam ay, 31/31) + elle 3.500 + şubesiz harcama 4.000 + bağlı fatura 6.000 + komisyon 1.000
    close(a.shared.total, 30_000 + 10_000 + 840 + 3_500 + 4_000 + 6_000 + 1_000, "Tümü'nün işletme geneli");
    close(m.shared.total, a.shared.total, "Marina'nın bilgi satırı (Marina 18 gün açık olsa da işletmenin günüyle)");
    close(t.shared.total, a.shared.total, "Tuzla'nın bilgi satırı");
    close(m.profit + t.profit - a.shared.total, a.profit, "Marina + Tuzla − işletme geneli = Tümü");
    // Şubenin kalemleri: Marina'nın güvenliği 18/31, yemek kartı Marina'da; Tuzla'nın kirası ve stopajı yalnız Tuzla'da
    close(m.cells.get("personnel:meal")!.value!, (330 * 26 * 18) / 31, "Alper'in yemek kartı Marina'nın günüyle");
    close(t.cells.get(`fixed:${kiraId}`)!.value!, 160_000, "Tuzla kira");
    close(t.cells.get(stopajKey(kiraId))!.value!, 20_000, "Tuzla stopaj");
    assert.equal(m.cells.get(`fixed:${kiraId}`), undefined, "Marina'da Tuzla'nın kirası yok");
    assert.equal(m.cells.get(`expense:${catId}`)?.value, 3_000, "Marina'nın kendi harcaması");
    // Satırlar: Marina'da bilgi satırı var, işletme geneli kalemlerin satırı yok; Tümü'de bilgi satırı yok
    const rows = marina.pnlRowDefs(["2026-10"]).map((r) => r.key);
    assert.ok(rows.includes("shared:total"), "bilgi satırı");
    assert.ok(!rows.includes("manual:su"));
    assert.ok(!all.pnlRowDefs(["2026-10"]).some((r) => r.key === "shared:total"));
    // Tümü'nün şube kırılımı: fark yok
    const split = branchBreakdown(
      [
        { id: "tuzla", name: "Tuzla", months: [t] },
        { id: "marina", name: "Marina", months: [m] },
      ],
      [a],
    );
    assert.equal(split.residual, 0);
    close(split.columns.find((c) => c.key === "isletme")!.expenses, a.shared.total, "işletme geneli sütunu");
  });
});
