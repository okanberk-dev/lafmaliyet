// Arama kutusu ile adresteki ?ara= değerinin eşitlenmesi (ui/filters.tsx useQueryText → ui/query-text.ts).
// Çalıştırma: npx tsx --test tests/query-text.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { initialQueryText, markQueryTextWritten, syncQueryText, typeQueryText, type QueryTextState } from "../src/components/ui/query-text";

/** Kullanıcı yazar, 250 ms sonra kutu adrese yazar ve yansıma gelir */
function typeAndCommit(s: QueryTextState, value: string): QueryTextState {
  return syncQueryText(markQueryTextWritten(typeQueryText(s, value), value), value);
}

test("Adres değişmediyse durum aynı nesne kalır (çizimde döngü yok)", () => {
  const s = initialQueryText("mocha");
  assert.equal(syncQueryText(s, "mocha"), s);
  assert.equal(s.text, "mocha");
});

test("Kendi yazdığımızın yansıması kutuyu ezmez ve bir kez tüketilir", () => {
  let s = initialQueryText("");
  s = typeQueryText(s, "moc");
  s = markQueryTextWritten(s, "moc");
  // Kullanıcı yazmayı sürdürdü, sonra eski değerin yansıması geldi
  s = typeQueryText(s, "mocha");
  s = syncQueryText(s, "moc");
  assert.equal(s.text, "mocha");
  assert.equal(s.written, null);
  assert.equal(s.seen, "moc");
});

test("Ürün kartından dönünce (gizli liste kartın adresini gördü) arama geri gelir", () => {
  // Liste aramasız açıldı, "mocha" yazıldı ve adrese yazıldı
  let s = typeAndCommit(initialQueryText(""), "mocha");
  assert.equal(s.text, "mocha");
  // Kart açıkken gizli liste kartın adresini görür: ?ara yok
  s = syncQueryText(s, "");
  assert.equal(s.text, "");
  // "← Ürünler" ya da geri tuşu: /panel/urunler?ara=mocha
  s = syncQueryText(s, "mocha");
  assert.equal(s.text, "mocha");
});

test("Kart açıkken gizli liste hiç çizilmediyse de dönüşte arama yerinde kalır", () => {
  let s = typeAndCommit(initialQueryText(""), "mocha");
  s = syncQueryText(s, "mocha");
  assert.equal(s.text, "mocha");
});

test("İkinci tur: dönüşten sonra yeni arama yazılıp yine karta gidilip dönülür", () => {
  let s = typeAndCommit(initialQueryText(""), "mocha");
  s = syncQueryText(syncQueryText(s, ""), "mocha");
  s = typeAndCommit(s, "latte");
  assert.equal(s.text, "latte");
  s = syncQueryText(syncQueryText(s, ""), "latte");
  assert.equal(s.text, "latte");
});

test("Geri tuşu ve 'Temizle' gibi dış değişiklikler kutuya yansır, bekleyen yazma düşer", () => {
  let s = typeAndCommit(initialQueryText(""), "süt");
  s = syncQueryText(s, "");
  assert.equal(s.text, "");
  // Yazma bekliyorken adres dışarıdan başka bir değere döndü: dış değer kazanır
  s = markQueryTextWritten(typeQueryText(s, "kahve"), "kahve");
  s = syncQueryText(s, "çay");
  assert.equal(s.text, "çay");
  assert.equal(s.written, null);
  // Sonradan gelen eski yansıma artık dış değişiklik sayılır
  s = syncQueryText(s, "kahve");
  assert.equal(s.text, "kahve");
});
