// Telefon (Faturalar, Gelir-gider, Satışlar): Gelir-gider hücre sayfasındaki "Temizle"nin "Geri al"ı ve Satışlar
// içe aktarmasında "Yenisiyle değiştir" onayı.
// Çalıştırma: npx tsx --test tests/mobil-para-undo.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { planCellEdit, planCellRestore, type CellEditInput } from "../src/app/panel/gelir-gider/cell-rules";
import { replaceConfirm } from "../src/app/panel/satislar/sales-logic";

const manual: CellEditInput = { field: "pnl", kind: "manual", overridden: true, value: 4500, computed: null, prevNote: "kombi servisi", amountText: "", noteText: "" };

test("planCellRestore: elle girilen tutar ve notu aynen geri yazar", () => {
  assert.equal(planCellEdit(manual).action, "clear");
  assert.deepEqual(planCellRestore(manual), { action: "save", amount: 4500, note: "kombi servisi", freeze: false, message: "Hücre geri alındı" });
  // Notsuz hücrede not alanına dokunulmaz (undefined: var olanı korur)
  assert.deepEqual(planCellRestore({ ...manual, prevNote: null }), { action: "save", amount: 4500, note: undefined, freeze: false, message: "Hücre geri alındı" });
});

test("planCellRestore: kuruşlu tutar yuvarlanmadan geri gelir", () => {
  const p = planCellRestore({ ...manual, value: 12.5, prevNote: null });
  assert.equal(p?.amount, 12.5);
});

test("planCellRestore: hesaplananın üzerine yazılmış tutar yeniden üzerine yazılır (hesaplanana eşit olsa da)", () => {
  const over = { field: "pnl" as const, kind: "auto" as const, overridden: true, value: 700, prevNote: null };
  assert.deepEqual(planCellRestore(over), { action: "save", amount: 700, note: undefined, freeze: false, message: "Hücre geri alındı" });
  // Notla dondurulmuş (tutar hesaplananla aynı) hücre: tutar ve not birlikte döner
  assert.deepEqual(planCellRestore({ ...over, value: 516.13, prevNote: "bordro farkı" }), {
    action: "save",
    amount: 516.13,
    note: "bordro farkı",
    freeze: false,
    message: "Hücre geri alındı",
  });
});

test("planCellRestore: kayıtlı giriş yoksa geri alınacak bir şey yok", () => {
  assert.equal(planCellRestore({ field: "pnl", kind: "auto", overridden: false, value: 600, prevNote: null }), null);
  assert.equal(planCellRestore({ field: "pnl", kind: "manual", overridden: false, value: null, prevNote: null }), null);
  assert.equal(planCellRestore({ field: "revenue", kind: "manual", overridden: false, value: null, prevNote: null }), null);
});

test("planCellRestore: ay bilgileri (ciro, açık gün) not almadan geri yazılır", () => {
  assert.deepEqual(planCellRestore({ field: "revenue", kind: "manual", overridden: true, value: 429698.5, prevNote: null }), {
    action: "save",
    amount: 429698.5,
    note: undefined,
    freeze: false,
    message: "Aylık ciro geri alındı",
  });
  assert.deepEqual(planCellRestore({ field: "openDays", kind: "manual", overridden: true, value: 23, prevNote: null }), {
    action: "save",
    amount: 23,
    note: undefined,
    freeze: false,
    message: "Açık gün geri alındı",
  });
});

test("replaceConfirm: yalnızca dolu ayda 'Yenisiyle değiştir' sorulur", () => {
  assert.equal(replaceConfirm({ mode: "append", lineCount: 125, newCount: 79, label: "Eylül 2026" }), null);
  assert.equal(replaceConfirm({ mode: "replace", lineCount: 0, newCount: 79, label: "Eylül 2026" }), null);
  const c = replaceConfirm({ mode: "replace", lineCount: 1250, newCount: 79, label: "Eylül 2026" });
  assert.ok(c);
  assert.equal(c.title, "Eylül 2026: 1.250 satır değiştirilsin mi?");
  assert.equal(c.confirmLabel, "1.250 satırı değiştir");
  assert.match(c.description, /1\.250 satış satırı silinir, yerine okunan 79 satır yüklenir/);
  assert.match(c.description, /Koru, üstüne ekle/);
});
