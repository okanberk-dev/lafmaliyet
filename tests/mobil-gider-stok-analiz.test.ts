// Analiz sayfası (telefon ve tablet): kart görünümündeki sıralama seçimi tablo başlıklarının bütün yönlerini kapsar;
// senaryodaki "Aylık sabit gider değişimi" alanının ± düğmesi (iPhone sayı klavyesinde eksi yok).
// Çalıştırma: npx tsx --test tests/mobil-gider-stok-analiz.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseNumberTR } from "../src/lib/calc/expr";
import { CARD_SORTS, DEFAULT_SORT, flipSign, normalizeSign, parseSort, selectionAfterSign, SORT_SLUG, sortSlug, type SortDir, type SortKey } from "../src/app/panel/analiz/logic";

test("kart sıralaması: tablo başlıklarının her anahtarı iki yönde de seçilebilir", () => {
  const values = CARD_SORTS.map((o) => o.value);
  assert.equal(new Set(values).size, values.length, "aynı sıralama iki kez yok");
  for (const key of Object.keys(SORT_SLUG) as SortKey[]) {
    for (const dir of ["asc", "desc"] as SortDir[]) {
      assert.ok(values.includes(sortSlug(key, dir)), `${key} ${dir} seçenekte yok`);
    }
  }
  assert.equal(CARD_SORTS.length, Object.keys(SORT_SLUG).length * 2);
  // QA'nın eksik bulduğu sıralamalar
  for (const label of ["Birim kâr (düşükten)", "Fiyat (düşükten)", "Satış payı (yüksekten)", "Satış payı (düşükten)", "Gruba göre (Zayıf → Yıldız)"]) {
    assert.ok(
      CARD_SORTS.some((o) => o.label === label),
      label,
    );
  }
});

test("kart sıralaması: her seçenek adresten aynı anahtar ve yönle okunur", () => {
  for (const o of CARD_SORTS) {
    const { key, dir } = parseSort(o.value);
    assert.equal(sortSlug(key, dir), o.value);
  }
  assert.deepEqual(parseSort(DEFAULT_SORT), { key: "totalCm", dir: "desc" });
  assert.deepEqual(parseSort("bilinmeyen"), { key: "totalCm", dir: "desc" });
  assert.deepEqual(parseSort("birim-kar-artan"), { key: "cm", dir: "asc" });
  assert.equal(CARD_SORTS[0].value, DEFAULT_SORT, "varsayılan sıralama listenin başında");
});

test("± düğmesi: işaret çevrilir, Türkçe yazım korunur", () => {
  assert.equal(flipSign("30.000"), "-30.000");
  assert.equal(flipSign("-30.000"), "30.000");
  assert.equal(flipSign("12.500,50"), "-12.500,50");
  assert.equal(flipSign(" -12,5 "), "12,5");
  assert.equal(parseNumberTR(flipSign("30.000")), -30000);
  assert.equal(parseNumberTR(flipSign(flipSign("30.000"))), 30000);
});

test("± düğmesi: boş ya da sıfır alan '-' olur, ardından yazılan sayı eksi kalır", () => {
  for (const t of ["", "0", " 0 ", "0,00", "00"]) assert.equal(flipSign(t), "-", JSON.stringify(t));
  assert.equal(flipSign("-"), "");
  // Odaklanınca seçim işaretten sonra başlar: yazılan sayı eksinin yerine geçmez
  assert.deepEqual(selectionAfterSign("-"), [1, 1]);
  assert.deepEqual(selectionAfterSign("-30.000"), [1, 7]);
  assert.deepEqual(selectionAfterSign("25.000"), [0, 6]);
  assert.deepEqual(selectionAfterSign("0"), [0, 1]);
  const typed = "-" + "30000";
  assert.equal(parseNumberTR(typed), -30000);
});

test("eksi nerede yazılırsa yazılsın başa alınır (imleç sağa yaslı metnin başına düşünce)", () => {
  assert.equal(normalizeSign("5000-"), "-5000");
  assert.equal(normalizeSign("50-00"), "-5000");
  assert.equal(normalizeSign("-30.000"), "-30.000");
  assert.equal(normalizeSign("--12,5"), "-12,5");
  assert.equal(normalizeSign("−2.500"), "-2.500");
  assert.equal(normalizeSign("25.000"), "25.000");
  assert.equal(normalizeSign(""), "");
  assert.equal(normalizeSign("-"), "-");
  assert.equal(parseNumberTR(normalizeSign("5000-")), -5000);
});
