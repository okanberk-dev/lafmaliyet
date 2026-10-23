// Yüzde alanı, satış listesi yapıştırma / dosya ayrıştırma ve POS adı eşleştirme anahtarı testleri.
// Çalıştırma: npx tsx --test tests/parse.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizePosName } from "../src/lib/calc/engine";
import { formatPercentInput, parseNumberTR, parsePercentInput } from "../src/lib/calc/expr";
import {
  createPosMappingIndex,
  describeSkipped,
  extractSalesRows,
  isSummaryRow,
  parsePastedSales,
  posMatchKey,
  samePosName,
} from "../src/lib/calc/pos-paste";

const near = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-12, `beklenen ${b}, bulunan ${a}`);

// ---------------------------------------------------------------- Yüzde alanı

test("Yüzde alanı: yazılan değer yüzde puanıdır, % işareti ikinci kez bölmez", () => {
  near(parsePercentInput("10"), 0.1);
  near(parsePercentInput("10,5"), 0.105);
  near(parsePercentInput("85.6"), 0.856);
  near(parsePercentInput("%10"), 0.1);
  near(parsePercentInput("10%"), 0.1);
  near(parsePercentInput("% 2,5"), 0.025);
  near(parsePercentInput("%20"), 0.2);
  near(parsePercentInput("0,1"), 0.001);
  near(parsePercentInput(" 15,75 "), 0.1575);
  near(parsePercentInput(10), 0.1);
  near(parsePercentInput("0"), 0);
  assert.equal(parsePercentInput(""), null);
  assert.equal(parsePercentInput("%"), null);
  assert.equal(parsePercentInput("abc"), null);
  assert.equal(parsePercentInput(null), null);
  // parseNumberTR genel sayı alanları için eskisi gibi
  assert.equal(parseNumberTR("%10"), 0.1);
});

test("Yüzde alanı metni: oran → puan, gidiş-dönüş aynı", () => {
  assert.equal(formatPercentInput(0.856), "85,6");
  assert.equal(formatPercentInput(0.1), "10");
  assert.equal(formatPercentInput(0.025), "2,5");
  assert.equal(formatPercentInput(0.1575), "15,75");
  assert.equal(formatPercentInput(null), "");
  for (const v of [0.1, 0.025, 0.856, 0.3, 0.05, 0.14, 0.01, 0.1575, 0.02]) near(parsePercentInput(formatPercentInput(v)), v);
});

// ---------------------------------------------------------------- Satış listesi

test("Yapıştır: başlık ve TOPLAM satırı ürün sayılmaz, kaç satır atlandığı söylenir", () => {
  const text = ["Ürün Adı\tAdet\tTutar", "LATTE MEDİUM\t300\t54.000", "ESPRESSO\t137\t55.270", "TOPLAM\t437\t109.270"].join("\n");
  const r = parsePastedSales(text);
  assert.deepEqual(r.rows, [
    { posName: "LATTE MEDİUM", qty: 300, revenue: 54000 },
    { posName: "ESPRESSO", qty: 137, revenue: 55270 },
  ]);
  assert.deepEqual(r.skipped, { summary: 1, header: 1, invalid: 0 });
  assert.equal(r.skippedRows.find((s) => s.reason === "summary")?.line, 4);
  assert.equal(describeSkipped(r.skipped), "1 toplam satırı ve 1 başlık satırı atlandı");
});

test("Toplam satırının farklı yazımları", () => {
  for (const n of ["TOPLAM", "Toplam:", "GENEL TOPLAM", "Genel Toplam (KDV dahil)", "ARA TOPLAM", "Ara toplam:", "Toplamlar", "TOPLAMI", "Grand Total", "Subtotal"]) {
    assert.equal(isSummaryRow(n), true, n);
  }
  for (const n of ["Toplama Kahve", "Latte", "Total Black", "Affogato"]) assert.equal(isSummaryRow(n), false, n);
});

test("Yapıştır: farklı ayraçlar ve sayı biçimleri", () => {
  const r = parsePastedSales(
    [
      "Iced Latte Large;12;2.400",
      "Su 0,5 lt  10  200",
      "Caramel Latte Medium 5 1.250,50",
      "Chai Tea Latte, 3, 450,5",
      "\"Cookie\"\t2\t180 ₺",
      "ESPRESSO BAZLI",
      "",
      "Iade Latte\t-1\t-180",
    ].join("\r\n"),
  );
  assert.deepEqual(r.rows, [
    { posName: "Iced Latte Large", qty: 12, revenue: 2400 },
    { posName: "Su 0,5 lt", qty: 10, revenue: 200 },
    { posName: "Caramel Latte Medium", qty: 5, revenue: 1250.5 },
    { posName: "Chai Tea Latte", qty: 3, revenue: 450.5 },
    { posName: "Cookie", qty: 2, revenue: 180 },
    { posName: "Iade Latte", qty: -1, revenue: -180 },
  ]);
  assert.deepEqual(r.skipped, { summary: 0, header: 0, invalid: 1 });
  assert.equal(describeSkipped(r.skipped), "1 satırda adet ve ciro okunamadı");
});

test("Yapıştır: adı TOPLAM olmayan toplam satırı şüpheli olarak işaretlenir, silinmez", () => {
  const r = parsePastedSales(["A\t1\t100", "B\t2\t200", "C\t3\t300", "Hepsi\t6\t600"].join("\n"));
  assert.equal(r.rows.length, 4);
  assert.deepEqual(r.suspectTotals, [3]);
  assert.deepEqual(parsePastedSales(["A\t1\t100", "B\t2\t200", "C\t3\t300", "D\t1\t50"].join("\n")).suspectTotals, []);
});

test("Dosya tablosu: sayı hücreleri, sıra numarası ve TOPLAM: satırı", () => {
  const r = extractSalesRows([
    ["Ürün adı", "Adet", "Ciro"],
    [1, "Latte Medium", 265, "", 79500],
    [null, "Espresso", "137", "55.270,00"],
    ["TOPLAM:", "", 402, "", 134770],
    ["Genel Toplam (KDV dahil)", 402, 134770],
    [],
    ["Rapor tarihi", new Date("2026-10-01")],
  ]);
  assert.deepEqual(r.rows, [
    { posName: "Latte Medium", qty: 265, revenue: 79500 },
    { posName: "Espresso", qty: 137, revenue: 55270 },
  ]);
  assert.deepEqual(r.skipped, { summary: 2, header: 1, invalid: 1 });
});

// ---------------------------------------------------------------- POS adı anahtarı

test("Eşleştirme anahtarı I / İ / ı / i ve büyük-küçük harf farkını yok sayar", () => {
  assert.equal(posMatchKey("Caramel Latte Medium"), posMatchKey("CARAMEL LATTE MEDIUM"));
  assert.equal(posMatchKey("ICED AMERICANO MEDİUM"), posMatchKey("Iced Americano Medium"));
  assert.equal(posMatchKey("ılık süt"), posMatchKey("ILIK SÜT"));
  assert.equal(posMatchKey("  Latte   medium "), "LATTE MEDIUM");
  assert.equal(posMatchKey("L’Affogato"), posMatchKey("L'AFFOGATO"));
  // Eski kayıtlar (normalizePosName) da aynı anahtara düşer
  for (const n of ["Latte Medium", "damla soda", "Protein Shake Medium", "SURPRİSE MEDİUM"]) {
    assert.equal(posMatchKey(normalizePosName(n)), posMatchKey(n), n);
  }
  // Farklı ürünler ayrı kalır
  assert.equal(samePosName("Süt", "Sut"), false);
  assert.equal(samePosName("Latte Medium", "Latte Large"), false);
});

test("Eşleştirme tablosu: iki tarafta da anahtar, çakışmada en son güncellenen", () => {
  const idx = createPosMappingIndex([
    { posName: "ICED AMERICANO MEDİUM", productId: 1, updatedAt: new Date("2026-08-01") },
    { posName: "ICED AMERICANO MEDIUM", productId: 2, updatedAt: new Date("2026-09-01") },
    { posName: "CARAMEL LATTE MEDIUM", productId: 3, updatedAt: null },
  ]);
  assert.equal(idx.get("Iced Americano Medium")?.productId, 2);
  assert.equal(idx.get("caramel latte medium")?.productId, 3);
  assert.equal(idx.get("Caramel Latte Large"), undefined);
  assert.deepEqual(idx.storedNames("iced americano medium"), ["ICED AMERICANO MEDİUM", "ICED AMERICANO MEDIUM"]);
  assert.equal(idx.size, 2);
});

// ---------------------------------------------------------------- Bitirme düzeltmeleri

test("parseNumberTR: 0 ile başlayan noktalı sayı ondalıktır (0.125 → 0,125), 1.250 bin ayıracı", () => {
  assert.equal(parseNumberTR("0.125"), 0.125);
  assert.equal(parseNumberTR("-0.125"), -0.125);
  assert.equal(parseNumberTR("1.250"), 1250);
  assert.equal(parseNumberTR("12.500"), 12500);
  assert.ok(Math.abs((parsePercentInput("0.075") ?? 0) - 0.00075) < 1e-12, "%0,075, %75 değil");
});

test("parseNumberTR: virgül ve nokta birlikteyse sonuncusu ondalık; bozuk gruplama okunmaz", () => {
  // İngilizce döküm ve banka POS fişi: "1,250.00" bin değil 1,25 okunuyordu
  assert.equal(parseNumberTR("1,250.00"), 1250);
  assert.equal(parseNumberTR("12,345.67"), 12345.67);
  assert.equal(parseNumberTR("12,975.50 TL"), 12975.5);
  assert.equal(parseNumberTR("-1,250.50"), -1250.5);
  // Türkçe yazım eskisi gibi
  assert.equal(parseNumberTR("1.234,56"), 1234.56);
  assert.equal(parseNumberTR("1.000.000,50"), 1000000.5);
  assert.equal(parseNumberTR("51,85"), 51.85);
  assert.equal(parseNumberTR("1,250"), 1.25, "tek virgül ondalıktır");
  assert.equal(parseNumberTR("1.250.000"), 1250000);
  assert.equal(parseNumberTR("1,234,567"), 1234567, "birden çok virgül bin ayıracıdır");
  // Grupları üçer hane olmayan sayı yanlış okunmaz, okunamaz
  for (const bad of ["2.000.50", "1,5,6", "1,2.5", "12,5.0", "1.234,5.6"]) assert.equal(parseNumberTR(bad), null, bad);
});

test("Toplam ile başlayan gerçek ürün adı özet satırı sayılmaz", () => {
  for (const n of ["Toplam Kahve Paketi", "Toplama Kahve"]) assert.equal(isSummaryRow(n), false, n);
  for (const n of ["TOPLAM", "Toplam KDV Dahil", "TOPLAM TUTAR", "Toplam: 437", "Alt Toplam", "Genel Toplam Satış"]) assert.equal(isSummaryRow(n), true, n);
});

test("Dosya: başlıkta birim fiyat sütunu varsa ciro Tutar sütunundan okunur", () => {
  const r = extractSalesRows([
    ["Ürün", "Kategori", "Adet", "Birim fiyat", "Tutar"],
    ["L'AFFOGATO LARGE", "Kahve", 265, 300, 79500],
    ["TOPLAM", "", 265, "", 79500],
  ]);
  assert.deepEqual(r.rows, [{ posName: "L'AFFOGATO LARGE", qty: 265, revenue: 79500 }]);
  const p = parsePastedSales("Ürün Adı\tAdet\tBirim Fiyat\tKDV Tutarı\tKDV Dahil Tutar\nLATTE\t3\t150\t75\t450");
  assert.deepEqual(p.rows, [{ posName: "LATTE", qty: 3, revenue: 450 }]);
  // Başlığa uymayan satırda (sayı adedi farklı) eski kural: ad sonrası ilk iki sayı
  assert.deepEqual(extractSalesRows([["Ürün", "Adet", "Birim fiyat", "Tutar"], ["Latte", 2, 300]]).rows, [{ posName: "Latte", qty: 2, revenue: 300 }]);
});
