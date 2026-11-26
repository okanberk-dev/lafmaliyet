// Şube karşılaştırma (src/lib/sube-karsilastirma.ts): toplamlar, oranlar ve "bilinmiyor sıfır değildir".
// Çalıştırma: npx tsx --test tests/sube-karsilastirma.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  branchCompare,
  cashDiffByMonth,
  COMPARE_ROWS,
  EMPTY_FIGURES,
  monthDays,
  monthsEnding,
  receiptFigures,
  spanParam,
  sumFigures,
  type BranchMonthFigures,
} from "../src/lib/sube-karsilastirma";

const fig = (o: Partial<BranchMonthFigures>): BranchMonthFigures => ({ ...EMPTY_FIGURES, ...o });

test("monthsEnding yıl sınırını geçer; spanParam yalnız bilinen süreleri alır", () => {
  assert.deepEqual(monthsEnding("2026-11", 3), ["2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(monthsEnding("2026-02", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.equal(spanParam("6"), 6);
  assert.equal(spanParam(["12", "1"]), 12);
  assert.equal(spanParam("5"), 3);
  assert.equal(spanParam(undefined), 3);
});

test("toplamda bilinmeyen sıfır sayılmaz; hepsi bilinmiyorsa null kalır", () => {
  const t = sumFigures([fig({ revenue: 100, cashDiff: -20, cashDiffDays: 2 }), fig({ revenue: null, cashDiff: null }), fig({ revenue: 50, receipts: 10, receiptRevenue: 50 })]);
  assert.equal(t.revenue, 150);
  assert.equal(t.cashDiff, -20);
  assert.equal(t.cashDiffDays, 2);
  assert.equal(t.receipts, 10);
  assert.equal(t.offRevenue, null, "hiç girilmemiş ödenmez toplamda da bilinmiyor");
  assert.equal(sumFigures([]).revenue, null);
});

test("oranlar toplamların oranı; sepet yalnız fişi bilinen günlerin cirosundan", () => {
  const a = fig({ revenue: 1200, revenueNet: 1000, labor: 300, cogs: 250, expenses: 700, profit: 300, receipts: 20, receiptRevenue: 600, openDays: 10 });
  const b = fig({ revenue: 600, revenueNet: 500, labor: 100, cogs: 200, expenses: 450, profit: 50, receipts: null, openDays: 5 });
  const [total, last, first] = branchCompare([{ id: "x", name: "X", months: { "2026-10": a, "2026-11": b } }], ["2026-10", "2026-11"]);
  assert.equal(total.key, "toplam");
  assert.equal(last.key, "2026-11", "aylar yeniden eskiye");
  assert.equal(first.key, "2026-10");
  const v = (p: typeof total, key: string) => p.rows.find((r) => r.def.key === key)?.cells[0].value;
  assert.equal(v(total, "ciro"), 1800);
  assert.equal(v(total, "iscilik-oran"), 400 / 1500);
  assert.equal(v(total, "mal-oran"), 450 / 1500);
  assert.equal(v(total, "sepet"), 30, "600 ₺ ÷ 20 fiş; fişi bilinmeyen ayın cirosu bölünmez");
  assert.equal(v(total, "gunluk"), 120);
  assert.equal(v(last, "sepet"), null);
  assert.equal(v(last, "fis"), null);
});

test("cirosu girilmemiş ayda kâr ve oran yazılmaz", () => {
  const [p] = branchCompare([{ id: "x", name: "X", months: { "2026-11": fig({ expenses: 500, profit: -500, labor: 200 }) } }], ["2026-11"]);
  const v = (key: string) => p.rows.find((r) => r.def.key === key)?.cells[0].value;
  assert.equal(p.key, "2026-11", "tek ayda toplam sütunu yok");
  assert.equal(v("kar"), null);
  assert.equal(v("kar-oran"), null);
  assert.equal(v("iscilik-oran"), null);
  assert.equal(v("iscilik"), 200);
});

test("en iyi şube: ciroda büyük, giderde küçük, kasa farkında sıfıra yakın; tek rakamda işaret yok", () => {
  const m = "2026-11";
  const [p] = branchCompare(
    [
      { id: "a", name: "A", months: { [m]: fig({ revenue: 1000, revenueNet: 900, labor: 300, cashDiff: -50, cashDiffDays: 3 }) } },
      { id: "b", name: "B", months: { [m]: fig({ revenue: 800, revenueNet: 700, labor: 200, cashDiff: 10, cashDiffDays: 3 }) } },
      { id: "c", name: "C", months: {} },
    ],
    [m],
  );
  const best = (key: string) => p.rows.find((r) => r.def.key === key)?.cells.map((c) => c.best);
  assert.deepEqual(best("ciro"), [true, false, false]);
  assert.deepEqual(best("iscilik"), [false, false, true], "ayı olmayan şubenin işçiliği 0: en düşük");
  assert.deepEqual(best("kasa-farki"), [false, true, false]);
  assert.deepEqual(best("acik-gun"), [false, false, false], "yönü olmayan satır");
  assert.deepEqual(best("fis"), [false, false, false], "hiçbirinde fiş yok");
  assert.ok(COMPARE_ROWS.every((r) => r.hint.length > 0), "her satırın kaynağı yazılı");
});

test("fiş ve sepet Kıyas'ın hücresinden: fişi bilinmeyen günün cirosu sepete girmez; kasa farkı ay ay", () => {
  assert.equal(monthDays("2026-02", "2026-12-31").length, 28);
  assert.deepEqual(monthDays("2026-11", "2026-11-03"), ["2026-11-01", "2026-11-02", "2026-11-03"]);
  assert.deepEqual(monthDays("2026-12", "2026-11-30"), [], "aydan önce biten aralık boş");
  const r = receiptFigures([
    { kind: "satis", revenue: 1000, receipts: 40 },
    { kind: "satis", revenue: 500, receipts: null },
    { kind: "bos", closed: true },
    { kind: "yok" },
    { kind: "satis", revenue: 200, receipts: 10 },
  ]);
  assert.deepEqual(r, { receipts: 50, receiptRevenue: 1200 });
  assert.deepEqual(receiptFigures([{ kind: "satis", revenue: 500, receipts: null }]), { receipts: null, receiptRevenue: 0 }, "hiç fiş yok: bilinmiyor");
  const d = cashDiffByMonth([
    { branchId: "tuzla", date: "2026-11-01", cashDiff: -20.5 },
    { branchId: "tuzla", date: "2026-11-02", cashDiff: 5 },
    { branchId: "marina", date: "2026-11-02", cashDiff: 0 },
    { branchId: "tuzla", date: "2026-10-31", cashDiff: -1 },
  ]);
  assert.deepEqual(d.get("tuzla|2026-11"), { sum: -15.5, days: 2 });
  assert.deepEqual(d.get("marina|2026-11"), { sum: 0, days: 1 }, "farkı sıfır rapor da gün sayılır");
  assert.deepEqual(d.get("tuzla|2026-10"), { sum: -1, days: 1 });
});
