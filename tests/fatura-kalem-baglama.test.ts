import assert from "node:assert/strict";
import { test } from "node:test";

import { COMMISSION_CATEGORY, GOODS_CATEGORIES, INVOICE_CATEGORIES, SEPARATE_CATEGORIES } from "../src/lib/constants";
import { crossesSeparate, isLinkableCategory, LINKABLE_CATEGORIES, separateMoveMonths } from "../src/lib/invoice-linking";

test("hammaddeye bağlanabilen kategoriler: mal alışları ve Diğer; kafe dışı, komisyon, kira bağlanmaz", () => {
  assert.deepEqual(LINKABLE_CATEGORIES, [...GOODS_CATEGORIES, "Diğer"]);
  for (const c of LINKABLE_CATEGORIES) assert.ok(INVOICE_CATEGORIES.includes(c), c);
  for (const c of GOODS_CATEGORIES) assert.equal(isLinkableCategory(c), true, c);
  assert.equal(isLinkableCategory("Diğer"), true);
  for (const c of SEPARATE_CATEGORIES) assert.equal(isLinkableCategory(c), false, c);
  assert.equal(isLinkableCategory(COMMISSION_CATEGORY), false);
  assert.equal(isLinkableCategory("Kira & AVM"), false);
});

test("kategori değişikliği: yalnız kafe içi ↔ kafe dışı geçiş alınan miktarı değiştirir", () => {
  assert.equal(crossesSeparate("Hammadde & İçecek", "Alp Koç"), true);
  assert.equal(crossesSeparate("Alp Koç", "Hammadde & İçecek"), true);
  assert.equal(crossesSeparate("Karaoke box", "Diğer"), true);
  // Kafe içi kategoriler arası ve iki kafe dışı kategori arası: applyProductLinks'in saydıkları değişmez
  assert.equal(crossesSeparate("Hammadde & İçecek", "Diğer"), false);
  assert.equal(crossesSeparate("Hammadde & İçecek", "Kira & AVM"), false);
  assert.equal(crossesSeparate("Karaoke box", "Alp Koç"), false);
  assert.equal(crossesSeparate("Alp Koç", "Alp Koç"), false);
});

test("yeniden hesaplanacak aylar: sınırı geçen ve kalemi okunmuş faturaların ayları, tekrarsız", () => {
  const moves = [
    // Pruva e-faturası (Damla su kalemi okunmuş) Alp Koç'a taşındı
    { id: 1, date: "2026-09-12", from: "Hammadde & İçecek", to: "Alp Koç" },
    // Aynı ay, Alp Koç'tan kafeye geri
    { id: 2, date: "2026-09-28", from: "Alp Koç", to: "Hammadde & İçecek" },
    // Kalemi okunmamış (elle girilmiş) fatura: hesaplanacak kalem yok
    { id: 3, date: "2026-08-03", from: "Hammadde & İçecek", to: "Karaoke box" },
    // Kafe içi geçiş: miktar değişmez
    { id: 4, date: "2026-07-15", from: "Hammadde & İçecek", to: "Diğer" },
    { id: 5, date: "2026-06-30", from: "Karaoke box", to: "Tatlı & Hazır Ürün" },
  ];
  assert.deepEqual(separateMoveMonths(moves, new Set([1, 2, 4, 5])), ["2026-09", "2026-06"]);
  assert.deepEqual(separateMoveMonths(moves, new Set()), []);
  assert.deepEqual(separateMoveMonths([], new Set([1])), []);
});
