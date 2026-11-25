// Ürünler ve Hammaddeler CSV'si: Türkçe sütun adları, tek sayı biçimi (noktalı virgül, virgüllü ondalık, binlik ayraçsız,
// boş değer boş hücre), UTF-8 BOM ve formül koruması (src/lib/csv.ts, src/app/panel/urunler/csv.ts,
// src/app/panel/hammaddeler/csv.ts). Çalıştırma: npx tsx --test tests/csv.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { ingredientCsv, INGREDIENT_CSV_HEADER, type IngredientCsvRow } from "../src/app/panel/hammaddeler/csv";
import { productCsv, productCsvHeader, type ProductCsvRow } from "../src/app/panel/urunler/csv";
import { CSV_BOM, csvNumber, csvPercent, csvText, toCsv } from "../src/lib/csv";

test("sayı: virgüllü ondalık, binlik ayraç yok, sabit ondalık; değer yoksa boş", () => {
  assert.equal(csvNumber(1234.5), "1234,50");
  assert.equal(csvNumber(1234567.891, 2), "1234567,89");
  assert.equal(csvNumber(0.12345, 4), "0,1235");
  assert.equal(csvNumber(185, 0), "185");
  assert.equal(csvNumber(-12.5), "-12,50");
  assert.equal(csvNumber(-0.001), "0,00", "eksi sıfır yazılmaz");
  assert.equal(csvNumber(null), "");
  assert.equal(csvNumber(undefined), "");
  assert.equal(csvNumber(Number.NaN), "");
  assert.equal(csvNumber(Infinity), "");
  assert.equal(csvPercent(0.305), "30,5");
  assert.equal(csvPercent(0.01, 2), "1,00");
  assert.equal(csvPercent(null), "");
});

test("metin: formül gibi başlayan hücre çalışmaz (tek tırnak), öteki metin olduğu gibi", () => {
  assert.equal(csvText("=HYPERLINK(\"x\")"), "'=HYPERLINK(\"x\")");
  assert.equal(csvText("+90 555"), "'+90 555");
  assert.equal(csvText("-iade"), "'-iade");
  assert.equal(csvText("@etiket"), "'@etiket");
  assert.equal(csvText("Süt 1 L"), "Süt 1 L");
  assert.equal(csvText(null), "");
  assert.equal(csvText("  boşluklu  "), "boşluklu");
});

test("dosya: UTF-8 BOM, noktalı virgül, CRLF, tırnak ikilenir", () => {
  const csv = toCsv([
    ["Ürün", "Fiyat (₺)"],
    ['Latte "büyük"', "185,00"],
  ]);
  assert.ok(csv.startsWith(CSV_BOM));
  assert.equal(csv.slice(1), '"Ürün";"Fiyat (₺)"\r\n"Latte ""büyük""";"185,00"');
});

const product: ProductCsvRow = {
  name: "Latte",
  size: "M",
  category: "Kahve",
  active: true,
  price: 185,
  net: 168.1818,
  commission: 3.959,
  cost: 31.2345,
  totalCost: 35.19,
  unitProfit: 132.99,
  margin: 0.79076,
  costRatio: 0.18572,
  suggestedPrice: 115,
  status: "İyi",
  soldQty: 1234,
  monthProfit: 164109.66,
  monthNet: 207536.36,
  fireRate: 0.05,
  fireOverridden: true,
  note: "=1+1",
  hasEstimate: false,
  site: null,
};

test("Ürünler CSV'si: Türkçe sütun adları birimiyle, sayılar tek biçimde", () => {
  const [head, line] = productCsv([product], "Eylül 2026");
  assert.deepEqual(head, productCsvHeader("Eylül 2026"));
  assert.equal(head.length, line.length);
  const col = (name: string) => line[head.indexOf(name)];
  assert.equal(col("Ürün"), "Latte");
  assert.equal(col("Boy"), "Medium");
  assert.equal(col("Satışta"), "Evet");
  assert.equal(col("Satış fiyatı (KDV dahil, ₺)"), "185,00");
  assert.equal(col("Net satış (KDV hariç, ₺)"), "168,18");
  assert.equal(col("Kâr marjı (%)"), "79,1");
  assert.equal(col("Maliyet oranı (%)"), "18,6");
  assert.equal(col("Önerilen fiyat (KDV dahil, ₺)"), "115");
  assert.equal(col("Satış adedi (Eylül 2026)"), "1234", "binlik ayraç yok");
  assert.equal(col("Brüt kâr (Eylül 2026, ₺)"), "164109,66");
  assert.equal(col("Fire oranı (%)"), "5,0", "oran tek başına sayı");
  assert.equal(col("Fire oranı ürüne özel"), "Evet");
  assert.equal(col("Not"), "'=1+1", "formül çalışmaz");
  // Bütün sayı sütunları ya boş ya virgüllü sayı (tire, binlik nokta, "(özel)" yok)
  const numeric = head.filter((h) => /₺|%|adedi/.test(h));
  for (const h of numeric) assert.match(col(h), /^(-?\d+(,\d+)?)?$/, h);
  // Eski tablonun adı yok
  for (const h of head) assert.doesNotMatch(h, /excel/i);
});

test("Ürünler CSV'si: reçetesi boş üründe kâr, marj, oran ve önerilen fiyat boş (liste ve dışa aktarım gibi)", () => {
  const [head, line] = productCsv([{ ...product, status: "Reçete yok", cost: 0, totalCost: 0, unitProfit: 160, margin: 0.98, costRatio: 0 }], "Eylül 2026");
  for (const h of ["Birim kâr (₺)", "Kâr marjı (%)", "Maliyet oranı (%)", "Önerilen fiyat (KDV dahil, ₺)", "Brüt kâr (Eylül 2026, ₺)"]) assert.equal(line[head.indexOf(h)], "", h);
  assert.equal(line[head.indexOf("Net ciro (Eylül 2026, ₺)")], "207536,36");
});

const ingredient: IngredientCsvRow = {
  name: "Süt",
  category: "Süt",
  supplier: "Sütaş",
  packageDesc: "1 L × 12",
  packagePrice: 1234.5,
  packageSize: 12000,
  unit: "ml",
  unitCost: 0.102875,
  vatRate: 0.01,
  priceSource: "manual",
  usedIn: [
    { id: 1, label: "Latte", active: true },
    { id: 2, label: "Eski", active: false },
  ],
  monthUsage: 45000.5,
  isEstimate: true,
  active: true,
  note: null,
};

test("Hammaddeler CSV'si: Türkçe sütun adları, sayılar tek biçimde; su + buzun paket fiyatı boş", () => {
  const [head, line] = ingredientCsv([ingredient]);
  assert.deepEqual(head, INGREDIENT_CSV_HEADER);
  const col = (name: string) => line[head.indexOf(name)];
  assert.equal(col("Paket fiyatı (KDV hariç, ₺)"), "1234,50");
  assert.equal(col("Paket içeriği"), "12000,000");
  assert.equal(col("Birim maliyet (KDV hariç, ₺)"), "0,1029");
  assert.equal(col("Alış KDV (%)"), "1,00");
  assert.equal(col("Reçete sayısı (aktif ürün)"), "1");
  assert.equal(col("Son ay kullanım"), "45000,50");
  assert.equal(col("Tahmini fiyat"), "Evet");
  assert.equal(col("Not"), "");
  const [, water] = ingredientCsv([{ ...ingredient, priceSource: "water" }]);
  assert.equal(water[head.indexOf("Paket fiyatı (KDV hariç, ₺)")], "");
  assert.equal(water[head.indexOf("Fiyat kaynağı")], "Su faturası");
  for (const h of head) assert.doesNotMatch(h, /excel/i);
});
