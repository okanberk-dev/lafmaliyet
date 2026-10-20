// Gelir-gider telefon görünümü: tek hücre düzenleme sayfasının kararı, ay seçimi ve bölüm toplamı.
// Çalıştırma: npx tsx --test tests/gelir-gider-month-view.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultMonth, openDaysError, planCellEdit, sectionTotalKey, shiftMonth, type CellEditInput } from "../src/app/panel/gelir-gider/cell-rules";

const base: CellEditInput = { field: "pnl", kind: "auto", overridden: false, value: 516.129, computed: 516.129, prevNote: null, amountText: "516,13", noteText: "" };

test("planCellEdit: değişmeyen (yuvarlanmış) tutar yeniden yazılmaz", () => {
  assert.deepEqual(planCellEdit(base), { action: "none" });
  assert.deepEqual(planCellEdit({ ...base, kind: "manual", overridden: true, value: 4500, computed: null, amountText: "4.500" }), { action: "none" });
});

test("planCellEdit: okunamayan sayı ve açık gün sınırı kaydı engeller", () => {
  assert.deepEqual(planCellEdit({ ...base, amountText: "abc" }), { action: "error", message: "Geçerli bir sayı girin, ör. 1.250,50" });
  const days: CellEditInput = { ...base, field: "openDays", kind: "manual", value: 23, computed: null, amountText: "31", validate: (v) => openDaysError("2026-09", v) };
  assert.deepEqual(planCellEdit(days), { action: "error", message: "En fazla 30 gün (Eylül 2026 30 gün çeker)" });
  assert.deepEqual(planCellEdit({ ...days, amountText: "30" }), { action: "save", amount: 30, note: undefined, freeze: false, message: "Açık gün 30 gün oldu" });
  assert.deepEqual(planCellEdit({ ...days, amountText: "" }), { action: "clear", message: "Açık gün boşaltıldı" });
  assert.deepEqual(planCellEdit({ ...days, value: null, amountText: "" }), { action: "none" });
});

test("planCellEdit: ciro ay bilgisidir, not almaz", () => {
  const rev: CellEditInput = { ...base, field: "revenue", kind: "manual", value: 429698, computed: null, amountText: "450.000", noteText: "yok sayılır" };
  const plan = planCellEdit(rev);
  assert.equal(plan.action, "save");
  if (plan.action === "save") {
    assert.equal(plan.amount, 450000);
    assert.equal(plan.note, undefined);
    assert.match(plan.message, /^Aylık ciro 450\.000/);
  }
});

test("planCellEdit: yeni tutar notu korur (note undefined), not değişince yazılır", () => {
  const manual: CellEditInput = { ...base, kind: "manual", overridden: true, value: 4500, computed: null, prevNote: "kombi servisi", amountText: "4.800", noteText: "kombi servisi" };
  const p1 = planCellEdit(manual);
  assert.equal(p1.action, "save");
  if (p1.action === "save") {
    assert.equal(p1.note, undefined);
    assert.equal(p1.message, "Tutar 4.800 ₺ oldu");
  }
  const p2 = planCellEdit({ ...manual, amountText: "4.500", noteText: "  " });
  assert.equal(p2.action, "save");
  if (p2.action === "save") {
    assert.equal(p2.note, null);
    assert.equal(p2.message, "Not silindi");
  }
});

test("planCellEdit: hesaplanan hücreye yalnızca not eklemek tutarı dondurur", () => {
  const p = planCellEdit({ ...base, noteText: "bordro farkı" });
  assert.equal(p.action, "save");
  if (p.action === "save") {
    assert.equal(p.freeze, true);
    assert.equal(p.amount, 516.13);
    assert.equal(p.note, "bordro farkı");
    assert.equal(p.message, "Not eklendi, hesaplanan tutar artık elle girilmiş sayılır");
  }
});

test("planCellEdit: boş tutar kaydı siler; kayıt yoksa bir şey yapmaz, not tek başına saklanmaz", () => {
  assert.deepEqual(planCellEdit({ ...base, amountText: "" }), { action: "none" });
  assert.deepEqual(planCellEdit({ ...base, amountText: "", noteText: "not" }), { action: "error", message: "Not, bir tutarla birlikte saklanır. Tutar yazın." });
  assert.deepEqual(planCellEdit({ ...base, overridden: true, value: 600, amountText: "" }), { action: "clear", message: "Hücre hesaplanan değere döndü" });
  assert.deepEqual(planCellEdit({ ...base, kind: "manual", overridden: true, value: 120, computed: null, prevNote: "TEST", amountText: "" }), {
    action: "clear",
    message: "Hücre boşaltıldı; not silindi",
  });
  assert.deepEqual(planCellEdit({ ...base, kind: "manual", overridden: false, value: null, computed: null, amountText: "" }), { action: "none" });
});

test("planCellEdit: boş elle girilen hücreye tutar yazılır", () => {
  const p = planCellEdit({ ...base, kind: "manual", overridden: false, value: null, computed: null, amountText: "1.250,50" });
  assert.equal(p.action, "save");
  if (p.action === "save") {
    assert.equal(p.amount, 1250.5);
    assert.equal(p.freeze, false);
    assert.equal(p.message, "Tutar 1.250,50 ₺ oldu");
  }
});

test("defaultMonth ve shiftMonth: adres > bu ay > son veri ayı > ocak; yıl sınırı geçilir", () => {
  const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
  assert.equal(defaultMonth(months, "2026-03", "2026-10", "2026-09"), "2026-03");
  assert.equal(defaultMonth(months, "2025-03", "2026-10", "2026-09"), "2026-10");
  const future = months.map((m) => m.replace("2026", "2030"));
  assert.equal(defaultMonth(future, "", "2026-10"), "2030-01");
  assert.equal(defaultMonth(future, "", "2026-10", "2030-05"), "2030-05");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-06", 1), "2026-07");
});

test("sectionTotalKey: bölümü kapatan kalın toplam satırı; sonuç ve oran bölümlerinde yok", () => {
  assert.equal(sectionTotalKey([{ def: { key: "purchase:Kaldi" } }, { def: { key: "total:mal", strong: true } }]), "total:mal");
  assert.equal(sectionTotalKey([{ def: { key: "revenue" } }, { def: { key: "profit", strong: true } }, { def: { key: "ratio:expenses" } }]), null);
  assert.equal(sectionTotalKey([{ def: { key: "ratio:cogs" } }, { def: { key: "ratio:profit", strong: true } }]), null);
  assert.equal(sectionTotalKey([]), null);
});
