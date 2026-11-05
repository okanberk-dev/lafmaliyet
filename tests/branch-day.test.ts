// Bugün › "Şubelerde gün" kartı (src/lib/branch-day.ts): hangi gün gösterilir, kaynak önceliği, ödenmez hariç ciro,
// geçen haftaya göre değişim ve ödeme dağılımı.
// Çalıştırma: npx tsx --test tests/branch-day.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { branchDaySummary, diffMatters, paymentShares, pickDay, pickSource, type BranchDaySource } from "../src/lib/branch-day";

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

test("kaynak: kasa raporu LafPOS gün sonunu ezer", () => {
  const rows = [src("tuzla", YESTERDAY, { source: "lafpos", zTotal: 900 }), src("tuzla", YESTERDAY, { zTotal: 1000 })];
  assert.equal(pickSource(rows, "tuzla", YESTERDAY)?.source, "rapor");
  assert.equal(pickSource([rows[0]], "tuzla", YESTERDAY)?.source, "lafpos");
  assert.equal(pickSource(rows, "marina", YESTERDAY), null);
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
  assert.match(page, /user\.role === "admin" \? safe\(loadBranchDay\(\)\) : Promise\.resolve\(null\)/);
  const loader = read("src/server/data/branch-day.ts");
  assert.match(loader, /await requireAdmin\(\)/);
  assert.doesNotMatch(loader, /currentBranchWhere/);
});
