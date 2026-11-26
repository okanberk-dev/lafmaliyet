// Bugün › "Şubelerde gün" kartı (src/lib/branch-day.ts): hangi gün gösterilir, kaynak önceliği, ödenmez hariç ciro,
// geçen haftaya göre değişim ve ödeme dağılımı.
// Çalıştırma: npx tsx --test tests/branch-day.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { branchDaySummary, dailyTrend, diffMatters, paymentShares, pickDay, pickSource, type BranchDaySource } from "../src/lib/branch-day";

const TODAY = "2026-11-05";
const YESTERDAY = "2026-11-04";
const WEEK_AGO = "2026-10-28";

const branches = [
  { id: "tuzla", name: "Tuzla", openedOn: null },
  { id: "marina", name: "Marina", openedOn: "2026-11-01" },
];

function src(branchId: string, date: string, over: Partial<BranchDaySource> = {}): BranchDaySource {
  return { branchId, date, source: "rapor", zTotal: 1000, offRevenue: null, cash: 300, card: 700, mealCard: 0, online: 0, other: 0, receipts: 10, cashDiff: 0, ...over };
}

test("gün: bütün şubeler bugünü kapattıysa bugün, biri eksikse dün", () => {
  assert.equal(pickDay(branches, [src("tuzla", TODAY)], TODAY), YESTERDAY);
  assert.equal(pickDay(branches, [src("tuzla", TODAY), src("marina", TODAY)], TODAY), TODAY);
  // Henüz açılmamış şube beklenmez
  const later = [branches[0], { id: "yeni", name: "Yeni", openedOn: "2026-12-01" }];
  assert.equal(pickDay(later, [src("tuzla", TODAY)], TODAY), TODAY);
  assert.equal(pickDay([], [], TODAY), YESTERDAY);
});

test("kaynak: kasa raporu LafPOS gün sonunu, o da ModPOS föyünü ezer", () => {
  const rows = [src("tuzla", YESTERDAY, { source: "lafpos", zTotal: 900 }), src("tuzla", YESTERDAY, { zTotal: 1000 })];
  assert.equal(pickSource(rows, "tuzla", YESTERDAY)?.source, "rapor");
  assert.equal(pickSource([rows[0]], "tuzla", YESTERDAY)?.source, "lafpos");
  assert.equal(pickSource(rows, "marina", YESTERDAY), null);
  const foy = src("tuzla", YESTERDAY, { source: "modpos", zTotal: 800, cashDiff: null });
  assert.equal(pickSource([foy, ...rows], "tuzla", YESTERDAY)?.source, "rapor");
  assert.equal(pickSource([foy, rows[0]], "tuzla", YESTERDAY)?.source, "lafpos");
  assert.equal(pickSource([foy], "tuzla", YESTERDAY)?.source, "modpos");
});

test("ModPOS föyünden sayılan gün çizgide ve satırda: Genel bakış'ın günlük grafiğiyle aynı (denetim 13 Kasım HM-09)", () => {
  // 3 Kasım: Tuzla'nın raporu yok, kapanmış föyü var (ay rakamına yedek açık); Marina raporlu
  const rows = [src("tuzla", "2026-11-03", { source: "modpos", zTotal: 900, cash: 300, card: 600, cashDiff: null }), src("marina", "2026-11-03")];
  const trend = dailyTrend(branches, rows, "2026-11-03");
  assert.deepEqual(trend[7], { day: "2026-11-03", revenue: 1900, missing: 0 });
  const s = branchDaySummary(branches, rows, "2026-11-04");
  assert.equal(s.day, "2026-11-03");
  assert.deepEqual(
    s.rows.map((r) => [r.id, r.source, r.revenue]),
    [
      ["tuzla", "modpos", 900],
      ["marina", "rapor", 1000],
    ],
  );
  assert.equal(s.missing, 0);
  // Yükleyici föyü ay rakamının kuralıyla okur (anahtar kapalıyken okunmaz; bütün şubeler)
  const loader = readFileSync(join(process.cwd(), "src/server/data/branch-day.ts"), "utf8");
  assert.match(loader, /withBranchScope\(ALL_BRANCHES, \(\) => modposFallbackSheets\(db, from, today\)\)/);
  assert.match(loader, /const row = modposTillRow\(sh\);/);
  assert.match(readFileSync(join(process.cwd(), "src/app/panel/bugun/today-branches.tsx"), "utf8"), /row\.source === "modpos" \? "ModPOS API'den"/);
});

test("özet: ödenmez Z toplamının içindeyse ciroya girmez; eksik şube toplamı bozmaz", () => {
  // Z 1.100, ödemeler 1.000, ödenmez 100: ödenmez Z'nin içinde, ciro 1.000
  const s = branchDaySummary(branches, [src("tuzla", YESTERDAY, { zTotal: 1100, offRevenue: 100 }), src("tuzla", WEEK_AGO, { zTotal: 800, cash: 200, card: 600 })], TODAY);
  assert.equal(s.day, YESTERDAY);
  assert.equal(s.isToday, false);
  assert.equal(s.revenue, 1000);
  assert.equal(s.missing, 1);
  const [tuzla, marina] = s.rows;
  assert.equal(tuzla.revenue, 1000);
  assert.equal(tuzla.avgReceipt, 100);
  assert.equal(tuzla.lastWeek, 800);
  assert.ok(Math.abs((tuzla.change ?? 0) - 0.25) < 1e-9);
  assert.equal(marina.source, "yok");
  assert.equal(marina.revenue, null);
  // Marina geçen hafta açık değildi: toplamın değişimi yalnız iki günde de verisi olan şubeyle
  assert.ok(Math.abs((s.change ?? 0) - 0.25) < 1e-9);
});

test("özet: açılmadan önceki gün şube listede yok; geçen hafta yoksa değişim null", () => {
  const s = branchDaySummary(branches, [src("tuzla", "2026-10-30"), src("marina", "2026-10-30")], "2026-10-31");
  assert.deepEqual(s.rows.map((r) => r.id), ["tuzla"]);
  assert.equal(s.rows[0].change, null);
  assert.equal(s.change, null);
});

test("son sekiz gün: eskiden yeniye, satırlarla aynı ciro kuralı; gün sonu gelmeyen gün null, eksik şube sayılır", () => {
  const rows = [
    src("tuzla", WEEK_AGO, { zTotal: 800, cash: 200, card: 600 }),
    // Ödenmez Z'nin içinde: ciro 1.000 (özetteki gibi)
    src("tuzla", YESTERDAY, { zTotal: 1100, offRevenue: 100 }),
    src("tuzla", "2026-11-02", { source: "lafpos", zTotal: 900, cash: 300, card: 600 }),
    src("marina", "2026-11-02"),
  ];
  const trend = dailyTrend(branches, rows, YESTERDAY);
  assert.equal(trend.length, 8);
  assert.equal(trend[0].day, WEEK_AGO);
  assert.equal(trend[7].day, YESTERDAY);
  // Marina 1 Kasım'da açıldı: öncesinde beklenmez
  assert.deepEqual(trend[0], { day: WEEK_AGO, revenue: 800, missing: 0 });
  assert.deepEqual(trend[1], { day: "2026-10-29", revenue: null, missing: 1 });
  assert.deepEqual(trend[5], { day: "2026-11-02", revenue: 1900, missing: 0 });
  assert.deepEqual(trend[7], { day: YESTERDAY, revenue: 1000, missing: 1 });
  // Özet aynı diziyi taşır
  assert.deepEqual(branchDaySummary(branches, rows, TODAY).trend, trend);
});

test("ödeme dağılımı: sıfırlar düşer, büyükten küçüğe, pay ödemelerin toplamına göre", () => {
  const shares = paymentShares({ cash: 250, card: 700, mealCard: 50, online: 0, other: 0 });
  assert.deepEqual(shares.map((x) => x.label), ["Kart", "Nakit", "Yemek kartı"]);
  assert.ok(Math.abs(shares[0].share - 0.7) < 1e-9);
  assert.deepEqual(paymentShares({ cash: 0, card: 0, mealCard: 0, online: 0, other: 0 }), []);
});

test("kasa farkı: 1 ₺'den küçükse söylenmez", () => {
  assert.equal(diffMatters(null), false);
  assert.equal(diffMatters(0.4), false);
  assert.equal(diffMatters(-180), true);
});

test("kaynak: kart yalnız yöneticiye; yükleyici kapsam süzgecini değil şube kimliğini kullanır", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const page = read("src/app/panel/bugun/page.tsx");
  // Yönetici ve müdür (müdürde yalnız şubesinin satırı; docs/ROLLER.md)
  assert.match(page, /can\(user\.role, "rapor\.sube"\) \? safe\(loadBranchDay\(\)\) : Promise\.resolve\(null\)/);
  const loader = read("src/server/data/branch-day.ts");
  assert.match(loader, /await requireCan\("rapor\.sube"\)/);
  assert.match(loader, /lock === null \|\| b\.id === lock/);
  assert.doesNotMatch(loader, /currentBranchWhere/);
});
