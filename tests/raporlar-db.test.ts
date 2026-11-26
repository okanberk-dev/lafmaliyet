// Raporlar (docs/RAPORLAR.md) gerçek Postgres'te, oturum taklit edilerek: dört yükleyici canlı şemayla çalışır ve
// rakamlar başka ekranlarınkiyle aynıdır (Şube karşılaştırma ve İşçilik / ciro'nun ayı = Gelir-gider'in şube görünümü;
// fiş sayısı kasa raporlarından; kasa farkı kasayı sayana yazılır; LafPOS'a geçilmeden kaçak raporu yok).
//
// RAPOR_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı): test
// kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: RAPOR_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/raporlar-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { currentMonthTR, shiftMonth } from "../src/lib/calc/engine";
import * as s from "../src/server/db/schema";
import { dalCapabilities } from "./helpers/dal-stub";

const SERVER_URL = process.env.RAPOR_TEST_DATABASE_URL;
const DB_NAME = `laffogato_raporlar_${process.pid}`;
const PREV = shiftMonth(currentMonthTR(), -1);
const d = (n: number) => `${PREV}-${String(n).padStart(2, "0")}`;

describe("raporlar: veritabanında", { skip: !SERVER_URL && "RAPOR_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let loadModel: typeof import("../src/server/data/dataset").loadModel;
  let compare: typeof import("../src/server/data/sube-karsilastirma");
  let labor: typeof import("../src/server/data/iscilik");
  let leak: typeof import("../src/server/data/kacak");
  let loss: typeof import("../src/server/data/kayip-onleme");
  let aliId = 0;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "raporlar-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    const [ali] = await db.insert(s.users).values({ email: "ali@laffogato.net", name: "Ali", passwordHash: "x", role: "staff" }).returning();
    aliId = ali.id;
    const me = async () => ({ ...a, role: "admin" as const });
    stub(require.resolve("../src/server/auth/dal"), { requireUser: me, requireAdmin: me, ...dalCapabilities(me) });

    // Marina (LafPOS'a geçilmedi: geçiş günü yok); Tuzla migration'la gelir
    await db.insert(s.branches).values({ id: "marina", name: "Marina", kind: "fiziksel", posSource: "lafpos", sortOrder: 2 }).onConflictDoNothing();
    // Tuzla: tam zamanlı Ali (hesabıyla), part-time Can (Vardiya adıyla), iki gün çağrıldı
    await db.insert(s.staff).values([
      { name: "Ali", branchId: "tuzla", netSalary: 30_000, userId: ali.id, sortOrder: 1 },
      { name: "Can", branchId: "tuzla", kind: "part_time", dailyWage: 1_000, personRef: "n:can", sortOrder: 2 },
      // Ücreti yazılmamış part-time (uydurulmaz)
      { name: "Deniz", branchId: "tuzla", kind: "part_time", dailyWage: 0, personRef: "n:deniz", sortOrder: 3 },
    ]);
    await db.insert(s.shifts).values([
      { branchId: "tuzla", date: d(1), personRef: "n:can", personName: "Can", kind: "work", startMin: 540, endMin: 1020 },
      { branchId: "tuzla", date: d(2), personRef: "n:can", personName: "Can", kind: "work", startMin: 540, endMin: 1020 },
      { branchId: "tuzla", date: d(2), personRef: "n:deniz", personName: "Deniz", kind: "work", startMin: 540, endMin: 1020 },
      { branchId: "tuzla", date: d(3), personRef: `u:${ali.id}`, personName: "Ali", kind: "work", startMin: 540, endMin: 1020 },
    ]);
    // Üç kasa raporu: Ali saydı (-100, 0, +50), fiş 100'er
    for (const [day, diff] of [
      [1, -100],
      [2, 0],
      [3, 50],
    ] as const) {
      await db.insert(s.cashReports).values({
        date: d(day),
        branchId: "tuzla",
        receipts: 100,
        zTotal: 10_000,
        cash: 4_000,
        card: 6_000,
        countedCash: 4_000 + diff,
        cashDiff: diff,
        discounts: 100,
        offRevenue: 0,
        submittedBy: ali.id,
        submittedByName: "Ali",
        countedBy: ali.id,
        countedByName: "Ali",
      });
    }
    // Kör sayım: Ali 1. gün 3.850 ₺ kilitledi, farkı görünce 3.900 ₺'ye değiştirdi (rapordaki sayılan)
    await db.insert(s.cashCounts).values([
      { branchId: "tuzla", date: d(1), amount: 3_850, userId: ali.id, userName: "Ali", createdAt: new Date(`${d(1)}T17:00:00Z`) },
      { branchId: "tuzla", date: d(1), amount: 3_900, reason: "çekmecenin altında 50 ₺", userId: ali.id, userName: "Ali", createdAt: new Date(`${d(1)}T17:20:00Z`) },
    ]);
    loadModel = (await import("../src/server/data/dataset")).loadModel;
    compare = await import("../src/server/data/sube-karsilastirma");
    labor = await import("../src/server/data/iscilik");
    leak = await import("../src/server/data/kacak");
    loss = await import("../src/server/data/kayip-onleme");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  test("Şube karşılaştırma: ay rakamları Gelir-gider'in şube görünümüyle aynı; fiş ve kasa farkı kasa raporlarından", async () => {
    const data = await compare.loadBranchCompare(PREV, 1);
    assert.ok(data, "rapor var");
    assert.deepEqual(
      data.branches.map((b) => b.id),
      ["tuzla", "marina"],
    );
    const [p] = data.periods;
    assert.equal(p.key, PREV, "tek ayda toplam yok");
    const cell = (key: string, i = 0) => p.rows.find((r) => r.def.key === key)?.cells[i].value ?? null;
    const tuzla = (await loadModel({ scope: "tuzla" })).pnlMonth(PREV);
    assert.equal(cell("ciro"), tuzla.revenue, "ciro Gelir-gider'inki");
    assert.ok(Math.abs((cell("iscilik") ?? 0) - tuzla.sections.personel) < 0.01, "işçilik Gelir-gider'in personeli");
    assert.ok(Math.abs((cell("kar") ?? 0) - tuzla.profit) < 0.01, "kâr Gelir-gider'inki");
    assert.equal(cell("fis"), 300);
    assert.equal(cell("sepet"), 100, "30.000 ₺ ÷ 300 fiş");
    assert.equal(cell("kasa-farki"), -50);
    assert.equal(cell("indirim"), 300);
    assert.equal(cell("ciro", 1), null, "Marina'nın verisi yok: bilinmiyor, sıfır değil");
    assert.equal(cell("fis", 1), null);
  });

  test("İşçilik / ciro: ayın satırı Gelir-gider'in personeli; günlerin toplamı onu tutar; ücreti olmayan kişi yazılır", async () => {
    const data = await labor.loadLaborReport(PREV);
    assert.ok(data, "rapor var");
    const t = data.branches.find((b) => b.id === "tuzla")!;
    const tuzla = (await loadModel({ scope: "tuzla" })).pnlMonth(PREV);
    assert.ok(Math.abs(t.month.labor - tuzla.sections.personel) < 0.01, `ay: ${t.month.labor} ↔ ${tuzla.sections.personel}`);
    assert.ok(Math.abs(t.daysLabor - t.month.labor) < 1, `günlerin toplamı ${t.daysLabor} ↔ Gelir-gider ${t.month.labor}`);
    const day1 = t.days.find((r) => r.from === d(1))!;
    const day4 = t.days.find((r) => r.from === d(4))!;
    assert.ok(Math.abs(day1.labor - day4.labor - 1_000) < 0.01, "Can'ın günlük ücreti çalıştığı güne");
    assert.equal(day4.revenue, null, "raporu olmayan gün: veri yok");
    assert.ok(day1.ratio !== null && day1.ratio > 0, "raporlu günün oranı");
    assert.deepEqual(
      data.missing.map((m) => [m.name, m.reason]),
      [["Deniz", "ucret-yok"]],
    );
    assert.ok(data.total, "iki şube: toplam satırı");
  });

  test("Kaçak raporu: Marina LafPOS'a geçmeden rapor yok", async () => {
    const data = await leak.loadLeakReport(PREV);
    assert.equal(data.state, "lafpos-yok");
    assert.equal(data.report, null);
    assert.equal((await leak.loadLeakReport(currentMonthTR())).state, "ay-bitmedi");
  });

  test("Kayıp önleme: kasa farkı sayana; Vardiya'dan çalışanlar; ModPOS'ta iptal gelmiyor", async () => {
    const data = await loss.loadLossSummary(PREV, 1);
    assert.ok(data, "rapor var");
    const [row] = data.summary.cash.rows;
    assert.deepEqual([row.person.key, row.person.name, row.reports, row.total], [`u:${aliId}`, "Ali", 3, -50]);
    const days = data.summary.days.branches.find((b) => b.branchId === "tuzla")!;
    assert.equal(days.vardiyaDays, 3);
    assert.ok(days.missingMetrics.includes("iptal"), "ModPOS iptal göndermez");
    assert.ok(data.summary.days.rows.some((r) => r.person.name === "Can"), "Vardiya'daki ad");
    const [recount] = data.summary.recount.rows;
    assert.deepEqual([recount.person.key, recount.locks, recount.changes, recount.net], [`u:${aliId}`, 1, 1, 50], "kör sayımı kilitten sonra değiştiren");
    assert.deepEqual(data.summary.recount.branches, [{ branchId: "tuzla", days: 1, changedDays: 1 }]);
  });

  // En sonda: Marina'yı LafPOS'a geçirir (öteki testler geçişsiz Marina'yı bekler)
  test("Kaçak raporu: ayın sayımı − ay sonu tahmini (önceki ayın sayımından), ay sonu fiyatıyla TL", async () => {
    // Sabit aylar (geçiş günü LAFPOS_SWITCH_MIN'den önce olamaz): Marina 1 Kasım 2026'da LafPOS'a geçti, Kasım sonu sayımı
    // Aralık'ın kaçak raporunun başlangıcı; rapor Ocak'ta okunur
    const [K0, K1] = ["2026-11", "2026-12"];
    const NOW = new Date("2027-01-10T12:00:00+03:00");
    await db.insert(s.settings).values({ key: "lafposGecisGunu", value: `${K0}-01` });
    const [cat] = await db.insert(s.categories).values({ name: "Kahve" }).returning();
    // Süt: 1 LT 40 ₺ (0,04 ₺ / ml); Latte'de 200 ml
    const [sut] = await db.insert(s.ingredients).values({ name: "Süt", category: "Süt", unit: "ml", countUnit: "LT", packageSize: 1000, packagePrice: 40 }).returning();
    const [latte] = await db.insert(s.products).values({ categoryId: cat.id, name: "Latte", size: "Tek", price: 100 }).returning();
    await db.insert(s.recipeItems).values({ productId: latte.id, ingredientId: sut.id, qty: 200 });
    // Önceki ay sonu 10 LT, bu ay sonu 5 LT sayıldı; bu ay 20 Latte satıldı (4 LT, genel fireyle 4,2 LT)
    await db.insert(s.stockCounts).values([
      { month: K0, branchId: "marina", ingredientId: sut.id, qty: 10, factor: 1000 },
      { month: K1, branchId: "marina", ingredientId: sut.id, qty: 5, factor: 1000 },
    ]);
    await db.insert(s.posDailySales).values({ date: `${K1}-10`, branchId: "marina", posName: "LATTE", productId: latte.id, qty: 20, revenue: 2_000 });

    const data = await leak.loadLeakReport(K1, NOW);
    assert.equal(data.state, "ok", `durum: ${data.state}`);
    assert.ok(data.report, "rapor var");
    assert.deepEqual(data.months, [K0, K1], "Marina'nın sayıldığı bitmiş aylar");
    const [line] = data.report.lines;
    assert.equal(line.name, "Süt");
    assert.equal(line.countMonth, K0, "başlangıç önceki ayın sayımı (ayın kendi sayımı değil)");
    assert.ok(Math.abs(line.expected - 5_800) < 0.01, `tahmini 10.000 − 4.200 ml: ${line.expected}`);
    assert.equal(line.actual, 5_000);
    assert.ok(Math.abs(line.diff + 800) < 0.01, `fark −800 ml: ${line.diff}`);
    assert.equal(line.value, -32, "800 ml × 0,04 ₺");
    assert.equal(data.report.leakTotal, -32);
    assert.deepEqual(
      data.report.leaks.map((l) => l.name),
      ["Süt"],
    );
    assert.ok(data.report.missingDays.includes(`${K1}-31`), "gün sonu gelmeyen günler (ayın son günü dahil) uyarıda: kaçak büyük görünebilir");
    // Kasım'ın başlangıcı yok (Ekim sonu sayılmadı): Kasım sayımı karşılaştırılamaz, sıfır kaçak da yazılmaz
    const first = await leak.loadLeakReport(K0, NOW);
    assert.deepEqual([first.state, first.report?.lines.length, first.report?.noEstimate, first.report?.leakTotal], ["ok", 0, 1, 0]);
    // Ayın sayımı girilmemişse rapor değil "sayım yok"
    await db.delete(s.stockCounts).where(eq(s.stockCounts.month, K1));
    assert.equal((await leak.loadLeakReport(K1, NOW)).state, "sayim-yok");
  });
});
