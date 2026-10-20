// Telefondaki "Süzgeç" penceresinin metinleri: belirtme hâli eki, "84 ürünü göster" düğmesi, etkin süzgeç özeti.
// Çalıştırma: npx tsx --test tests/filter-text.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { accusative, filterSummary, showLabel } from "../src/app/panel/urunler/filter-text";

test("Belirtme hâli: ünsüzle biten sözcük son ünlüye uyar", () => {
  assert.equal(accusative("ürün"), "ürünü");
  assert.equal(accusative("kart"), "kartı");
  assert.equal(accusative("kalem"), "kalemi");
  assert.equal(accusative("gün"), "günü");
  assert.equal(accusative("sipariş"), "siparişi");
  assert.equal(accusative("ödül"), "ödülü");
  assert.equal(accusative("sayım"), "sayımı");
});

test("Belirtme hâli: ünlüyle biten sözcükte 'y' kaynaştırması", () => {
  assert.equal(accusative("malzeme"), "malzemeyi");
  assert.equal(accusative("pasif malzeme"), "pasif malzemeyi");
  assert.equal(accusative("reçete"), "reçeteyi");
  assert.equal(accusative("kasa"), "kasayı");
  assert.equal(accusative("ütü"), "ütüyü");
  assert.equal(accusative("palto"), "paltoyu");
});

test("Belirtme hâli: baştaki/sondaki boşluk atılır, büyük harf korunur, boş metin boş kalır", () => {
  assert.equal(accusative("  ürün "), "ürünü");
  assert.equal(accusative("Ürün"), "Ürünü");
  assert.equal(accusative(""), "");
});

test("Göster düğmesi: sayı Türkçe biçimli, sonuç yoksa 'Sonuç yok'", () => {
  assert.equal(showLabel(84, "ürün"), "84 ürünü göster");
  assert.equal(showLabel(1, "malzeme"), "1 malzemeyi göster");
  assert.equal(showLabel(1250, "ürün"), "1.250 ürünü göster");
  assert.equal(showLabel(3, "pasif malzeme"), "3 pasif malzemeyi göster");
  assert.equal(showLabel(0, "ürün"), "Sonuç yok");
});

test("Süzgeç özeti: boş, false ve null parçalar sayılmaz; aynı ad bir kez yazılır", () => {
  assert.deepEqual(filterSummary([]), { count: 0, text: "" });
  assert.deepEqual(filterSummary([null, undefined, false, "", "  "]), { count: 0, text: "" });
  assert.deepEqual(filterSummary(["Dikkat", "Düşük kâr", "Espresso Bazlı", null, "Large", false]), {
    count: 4,
    text: "Dikkat · Düşük kâr · Espresso Bazlı · Large",
  });
  assert.deepEqual(filterSummary(["Tahmini", " Tahmini ", "Süt"]), { count: 2, text: "Tahmini · Süt" });
});
