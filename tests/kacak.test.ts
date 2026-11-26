// Marina ay sonu kaçak raporu (src/lib/kacak.ts): ayın son günündeki tahmini stok (src/lib/stock-estimate.ts) ile ayın
// sayımı arasındaki fark, ay sonu birim maliyetiyle TL; en çok kaçanlar, fazla çıkanlar, rapora girmeyenler ve "kaçak
// olduğundan büyük görünür" uyarılarının dayanağı.
// Çalıştırma: npx tsx --test tests/kacak.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { leakReport } from "../src/lib/kacak";
import { estimateStock, type StockEstimateInput } from "../src/lib/stock-estimate";

const SUT = 1;
const KAHVE = 2;
const BARDAK = 3;
const SURUP = 4;
const LATTE = 10;

/** Aralık 2026'nın son günündeki tahmin: Kasım sonu sayımından başlar (Aralık sayımı başlangıç sayılmaz) */
function december(over: Partial<StockEstimateInput> = {}): StockEstimateInput {
  const days = Array.from({ length: 31 }, (_, i) => `2026-12-${String(i + 1).padStart(2, "0")}`);
  return {
    today: "2026-12-31",
    lafposFrom: "2026-11-22",
    // 15 Aralık gün sonu gelmedi
    receivedDays: days.filter((d) => d !== "2026-12-15"),
    closedDays: [],
    ingredients: [
      { id: SUT, name: "Süt", unit: "ml", countUnit: "LT", category: "Süt ürünleri", sortOrder: 1 },
      { id: KAHVE, name: "Espresso çekirdeği", unit: "gr", countUnit: "KG", category: "Kahve", sortOrder: 2 },
      { id: BARDAK, name: "Bardak M", unit: "adet", countUnit: "ADET", category: "Ambalaj", sortOrder: 3 },
      { id: SURUP, name: "Karamel şurubu", unit: "ml", countUnit: "LT", category: "Şurup", sortOrder: 4 },
    ],
    counts: [
      { month: "2026-11", ingredientId: SUT, qty: 10, factor: 1000 },
      { month: "2026-11", ingredientId: KAHVE, qty: 2, factor: 1000 },
      { month: "2026-11", ingredientId: BARDAK, qty: 100, factor: 1 },
      // Aralık'ın kendi sayımı tahminin başlangıcı değildir (rapor onu karşılaştırır)
      { month: "2026-12", ingredientId: SUT, qty: 1, factor: 1000 },
    ],
    purchases: [{ invoiceId: 1, ingredientId: SUT, date: "2026-12-05", qty: 20_000 }],
    sales: [{ date: "2026-12-10", posName: "LATTE M", productId: LATTE, productName: "Latte M", isService: false, qty: 100 }],
    panelWaste: [],
    lafposWaste: [{ date: "2026-12-11", kind: "zayi", posName: "COOKIE", productId: null, qty: 2 }],
    recipe: [
      { productId: LATTE, ingredientId: SUT, qty: 200 },
      { productId: LATTE, ingredientId: KAHVE, qty: 18 },
      { productId: LATTE, ingredientId: BARDAK, qty: 1 },
    ],
    fireRate: 0,
    thresholds: new Map(),
    ...over,
  };
}

const PRICES: Record<number, number> = { [SUT]: 0.04, [KAHVE]: 1.2, [BARDAK]: 0 };

test("fark = sayılan − tahmini, ay sonu birim maliyetiyle TL; eksi kaçak, artı fazla", () => {
  const est = estimateStock(december());
  const sut = est.lines.find((l) => l.ingredientId === SUT);
  assert.equal(sut?.countMonth, "2026-11", "Aralık sayımı başlangıç sayılmadı");
  assert.equal(sut?.estimate, 10_000 + 20_000 - 100 * 200, "10 LT + 20 LT alış − 100 Latte × 200 ml");
  const r = leakReport(
    "2026-12",
    est,
    [
      { ingredientId: SUT, qty: 7_000 },
      { ingredientId: KAHVE, qty: 500 },
      // 100 bardak − 100 Latte = 0 beklenirken 3 sayıldı
      { ingredientId: BARDAK, qty: 3 },
    ],
    (id) => PRICES[id] ?? null,
  );
  const line = (id: number) => r.lines.find((l) => l.ingredientId === id)!;
  assert.equal(line(SUT).diff, 7_000 - 10_000, "3 LT eksik");
  assert.equal(line(SUT).value, -120, "3000 ml × 0,04 ₺");
  assert.equal(line(SUT).share, 0.3);
  assert.equal(line(KAHVE).expected, 2000 - 1800);
  assert.equal(line(KAHVE).value, 360, "300 gr fazla × 1,2 ₺");
  assert.equal(line(BARDAK).value, null, "fiyatı olmayan kalem TL'ye çevrilmez");
  assert.deepEqual(r.unpriced, ["Bardak M"]);
  assert.equal(r.leakTotal, -120);
  assert.equal(r.surplusTotal, 360);
  assert.equal(r.net, 240);
  assert.deepEqual(
    r.leaks.map((l) => l.name),
    ["Süt"],
  );
  assert.deepEqual(
    r.surplus.map((l) => l.name),
    ["Espresso çekirdeği"],
  );
  // Satırlar en çok kaçandan
  assert.equal(r.lines[0].name, "Süt");
});

test("rapora girmeyenler sayılır; eksik gün sonu ve bağlanmamış satır uyarının dayanağı", () => {
  const est = estimateStock(december());
  const r = leakReport("2026-12", est, [{ ingredientId: SUT, qty: 10_000 }], (id) => PRICES[id] ?? null, { extraMissing: ["2026-12-31"] });
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].diff, 0, "tutan kalem");
  assert.equal(r.lines[0].value, 0);
  assert.equal(r.notCounted, 2, "Çekirdek ve bardak tahmini var ama Aralık'ta sayılmadı");
  assert.equal(r.noEstimate, 1, "Şurup hiç sayılmadı: tahmini yok");
  assert.deepEqual(r.missingDays, ["2026-12-15", "2026-12-31"], "tahminin bugün hariç saydığı ayın son günü de");
  assert.equal(r.skippedLines, 1, "ürüne bağlanmamış LafPOS zayisi");
  assert.deepEqual(r.skippedNames, ["COOKIE"]);
  assert.deepEqual(r.leaks, []);
});

test("LafPOS öncesi başlayan dönemde tahmin yok: kalem rapora girmez", () => {
  const est = estimateStock(december({ lafposFrom: "2026-12-10" }));
  const r = leakReport("2026-12", est, [{ ingredientId: SUT, qty: 1 }], () => 1);
  assert.equal(r.lines.length, 0);
  assert.equal(r.noEstimate, 4);
});

test("yükleyici: yalnız yönetici, ayın son günüyle tahmin, Marina'nın sayımı; sayfa requireAdmin", () => {
  const src = readFileSync(join(process.cwd(), "src/server/data/kacak.ts"), "utf8");
  assert.match(src, /await requireAdmin\(\);/);
  assert.match(src, /loadStockEstimate\(db, now, monthEnd\)/);
  assert.match(src, /eq\(s\.stockCounts\.branchId, STOCK_ESTIMATE_BRANCH\)/);
  assert.match(src, /model\.unitCostAtMonthEnd\(id, chosen\)/);
  const est = readFileSync(join(process.cwd(), "src/server/data/stock-estimate.ts"), "utf8");
  assert.match(est, /const today = asOf \?\? businessDate\(now\);/);
});
