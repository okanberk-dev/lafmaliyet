// Telefonda stok sayımı: grup çiplerinin ilerlemesi, kaydırdıkça etkin grup ve "sıradaki boş kalem" araması.
// Çalıştırma: npx tsx --test tests/mobil-sayim.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { activeGroupIndex, groupProgress, nextEmptyIndex } from "../src/app/panel/sayim/logic";

type Line = { id: number; archived: boolean; qty: number | null };

const groups: { name: string; lines: Line[] }[] = [
  {
    name: "AMBALAJ",
    lines: [
      { id: 1, archived: false, qty: 3 },
      { id: 2, archived: false, qty: null },
      // Arşiv satırı (pasif / Sayılmaz) kayıtlı miktarıyla gelir ama ilerlemeye girmez
      { id: 3, archived: true, qty: 5 },
    ],
  },
  {
    name: "KAHVE & ÇAY",
    lines: [
      { id: 4, archived: false, qty: 1 },
      { id: 5, archived: false, qty: 0 },
    ],
  },
  { name: "ARŞİV", lines: [{ id: 6, archived: true, qty: 2 }] },
];

test("groupProgress: sayılan / toplam, arşiv satırları hariç; 0 da sayılmış sayılır", () => {
  const p = groupProgress(groups, (l) => l.qty !== null);
  assert.deepEqual(p, [
    { name: "AMBALAJ", counted: 1, total: 2, done: false },
    { name: "KAHVE & ÇAY", counted: 2, total: 2, done: true },
    // Sayılacak kalemi olmayan grup "tamam" değildir (0 / 0)
    { name: "ARŞİV", counted: 0, total: 0, done: false },
  ]);
});

test("groupProgress: formda yazılan miktarla (kayıtlı değer değil) hesaplanır", () => {
  const typed = new Map<number, number | null>([[2, 4]]);
  const p = groupProgress(groups, (l) => (typed.has(l.id) ? typed.get(l.id) : l.qty) !== null);
  assert.equal(p[0].counted, 2);
  assert.equal(p[0].done, true);
});

test("activeGroupIndex: çizgiyi geçen son grup, hiçbiri geçmediyse ilki, sonda son grup", () => {
  // Çubuğun alt çizgisi 170 px: kartların üst kenarları
  assert.equal(activeGroupIndex([400, 900, 1500], 170), 0);
  assert.equal(activeGroupIndex([170, 900, 1500], 170), 0);
  assert.equal(activeGroupIndex([-600, 120, 700], 170), 1);
  assert.equal(activeGroupIndex([-2000, -900, 60], 170), 2);
  // Kısa son grup çizgiye hiç ulaşamaz: sayfanın sonundaysak o etkin
  assert.equal(activeGroupIndex([-2000, -900, 400], 170, true), 2);
  assert.equal(activeGroupIndex([], 170), -1);
  assert.equal(activeGroupIndex([], 170, true), -1);
});

test("nextEmptyIndex: başlangıçtan (dahil) ilk boş, sonda başa sarar, boş yoksa -1", () => {
  const empty = [false, true, false, false, true];
  assert.equal(nextEmptyIndex(empty, 0), 1);
  assert.equal(nextEmptyIndex(empty, 1), 1);
  assert.equal(nextEmptyIndex(empty, 2), 4);
  // Son boştan sonra baştan
  assert.equal(nextEmptyIndex(empty, 5), 1);
  assert.equal(nextEmptyIndex([false, false], 0), -1);
  assert.equal(nextEmptyIndex([], 0), -1);
});

test("nextEmptyIndex: liste dışı ya da kesirli başlangıç sarılır", () => {
  const empty = [true, false, false];
  assert.equal(nextEmptyIndex(empty, -1), 0);
  assert.equal(nextEmptyIndex(empty, 7), 0);
  assert.equal(nextEmptyIndex([false, false, true], 1.9), 2);
});
