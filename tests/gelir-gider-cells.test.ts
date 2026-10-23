// Gelir-gider giriş kuralları: açık gün sınırı, not penceresinin etkisi ve kasa raporlarından gelen ciro / açık gün.
// Çalıştırma: npx tsx --test tests/gelir-gider-cells.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanNote, enterProblem, noteSaveEffect, noteSaveMessage, openDaysError, planCellEdit, planCellRestore, type CellEditInput } from "../src/app/panel/gelir-gider/cell-rules";

test("openDaysError: en fazla ayın gün sayısı (Eylül 30, Şubat 28/29, Ekim 31)", () => {
  assert.equal(openDaysError("2026-09", 30), null);
  assert.equal(openDaysError("2026-09", 31), "En fazla 30 gün (Eylül 2026 30 gün çeker)");
  assert.equal(openDaysError("2027-02", 29), "En fazla 28 gün (Şubat 2027 28 gün çeker)");
  assert.equal(openDaysError("2028-02", 29), null);
  assert.equal(openDaysError("2026-10", 31), null);
  assert.equal(openDaysError("2026-10", 16), null);
  assert.equal(openDaysError("2026-10", 0), null);
  assert.equal(openDaysError("2026-10", null), null);
  assert.equal(openDaysError("2026-10", -1), "Açık gün negatif olamaz");
  assert.equal(openDaysError("2026-10", 15.5), "Açık gün tam sayı olmalı");
});

test("noteSaveEffect: boş tutar siler, hesaplanana yalnızca not eklemek tutarı dondurur", () => {
  assert.equal(noteSaveEffect({ kind: "auto", overridden: true, amount: null, computed: 100 }), "clear");
  assert.equal(noteSaveEffect({ kind: "manual", overridden: true, amount: null, computed: null }), "clear");
  assert.equal(noteSaveEffect({ kind: "auto", overridden: false, amount: 516.13, computed: 516.129 }), "freeze");
  assert.equal(noteSaveEffect({ kind: "auto", overridden: false, amount: 600, computed: 516.13 }), "save");
  assert.equal(noteSaveEffect({ kind: "auto", overridden: true, amount: 516.13, computed: 516.13 }), "save");
  assert.equal(noteSaveEffect({ kind: "manual", overridden: false, amount: 4500, computed: null }), "save");
});

test("cleanNote: boşluk kırpılır, boş metin notu siler", () => {
  assert.equal(cleanNote("  servis  "), "servis");
  assert.equal(cleanNote("   "), null);
  assert.equal(cleanNote(""), null);
});

test("enterProblem: kabul edilmeyen değerde Enter hücrede bırakır (açık gün > ayın gün sayısı, sayı olmayan metin)", () => {
  const days = (v: number | null) => openDaysError("2026-09", v);
  assert.equal(enterProblem("31", days), "En fazla 30 gün (Eylül 2026 30 gün çeker)");
  assert.match(enterProblem("abc", days) ?? "", /Geçerli bir sayı/);
  assert.equal(enterProblem("30", days), null);
  assert.equal(enterProblem("", days), null, "boş = hücreyi boşalt, engel değil");
  assert.equal(enterProblem("1.250,50"), null);
});

test("noteSaveMessage: tutar da değiştiyse ileti onu da söyler", () => {
  assert.equal(noteSaveMessage({ prevValue: 600, amount: 700, prevNote: null, note: "zam" }), "Tutar 700\u00a0₺ oldu, not eklendi");
  assert.equal(noteSaveMessage({ prevValue: 700, amount: 700, prevNote: null, note: "zam" }), "Not eklendi");
  assert.equal(noteSaveMessage({ prevValue: 700, amount: 700, prevNote: "eski", note: "yeni" }), "Not güncellendi");
  assert.equal(noteSaveMessage({ prevValue: 700, amount: 750.5, prevNote: "x", note: null }), "Tutar 750,50\u00a0₺ oldu, not silindi");
  assert.equal(noteSaveMessage({ prevValue: 700, amount: 700, prevNote: "x", note: "x" }), "Kaydedildi");
  assert.equal(
    noteSaveMessage({ prevValue: 1200, amount: 1200, prevNote: null, note: "fatura", freeze: true }),
    "Not eklendi, hesaplanan tutar artık elle girilmiş sayılır",
  );
  assert.match(noteSaveMessage({ prevValue: null, amount: 5000, prevNote: null, note: null }), /^Tutar 5\.000/);
});

test("kasa raporlarından gelen ciro ve açık gün: boşaltmak kasaya döndürür, kasanın değeri hiç dondurulmaz", () => {
  const rev: CellEditInput = { field: "revenue", kind: "auto", overridden: true, value: 310_000, computed: 300_000, prevNote: null, amountText: "", noteText: "" };
  // Elle yazılanı boşaltmak kasaya döner
  assert.deepEqual(planCellEdit(rev), { action: "clear", message: "Aylık ciro kasa raporlarına döndü" });
  assert.deepEqual(planCellEdit({ ...rev, field: "openDays", value: 29, computed: 30 }), { action: "clear", message: "Açık gün kasa raporlarına döndü" });
  // Kasadan gelen değeri boşaltmak bir şey değiştirmez; aynısını yazmak da elle girmek sayılmaz
  const following = { ...rev, overridden: false, value: 300_000 };
  assert.deepEqual(planCellEdit(following), { action: "none" });
  assert.deepEqual(planCellEdit({ ...following, amountText: "300.000" }), { action: "none" });
  assert.equal(planCellEdit({ ...following, amountText: "305.000" }).action, "save");
  // Kasa yoksa bugünkü gibi: elle yazılan boşalır
  assert.deepEqual(planCellEdit({ ...rev, kind: "manual", computed: null }), { action: "clear", message: "Aylık ciro boşaltıldı" });
  // Geri al: elle yazılan geri yazılır; kasanın değeri asla (yazılsa elle girilmiş sayılırdı)
  assert.deepEqual(planCellRestore({ field: "revenue", kind: "auto", overridden: true, value: 310_000, prevNote: null }), {
    action: "save",
    amount: 310_000,
    note: undefined,
    freeze: false,
    message: "Aylık ciro geri alındı",
  });
  assert.equal(planCellRestore({ field: "revenue", kind: "auto", overridden: false, value: 300_000, prevNote: null }), null);
  assert.equal(planCellRestore({ field: "openDays", kind: "auto", overridden: false, value: 30, prevNote: null }), null);
});
