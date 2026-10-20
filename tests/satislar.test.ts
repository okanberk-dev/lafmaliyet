// Satışlar ekranı: açık gün sınırı, kâr marjı renk ölçeği (Excel Satış Raporu J sütunu), içe aktarma
// önizlemesindeki hafıza eşleşmesi (I/İ ve büyük/küçük harf), toplam satırı ve eşleştirme önerileri.
// Çalıştırma: npx tsx --test tests/satislar.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  collectSuggestions,
  inMarginScale,
  marginColor,
  marginLevelLabel,
  marginPosition,
  marginScale,
  monthPhase,
  openDaysHint,
  openDaysProblem,
  percentileInc,
  previewMatches,
  suggestProduct,
} from "../src/app/panel/satislar/sales-logic";
import { createModel } from "../src/lib/calc/engine";
import { describeSkipped, parsePastedSales } from "../src/lib/calc/pos-paste";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const model = createModel(excelToDataset(data));

// ---------------------------------------------------------------- Açık gün

test("Açık gün en fazla ayın gün sayısı kadar (Eylül 30, Şubat 28/29)", () => {
  assert.equal(openDaysProblem("", "2026-09"), null);
  assert.equal(openDaysProblem("30", "2026-09"), null);
  assert.equal(openDaysProblem("31", "2026-09"), "En fazla 30 gün (Eylül 2026 30 gün çeker)");
  assert.equal(openDaysProblem("31", "2026-10"), null);
  assert.equal(openDaysProblem("29", "2027-02"), "En fazla 28 gün (Şubat 2027 28 gün çeker)");
  assert.equal(openDaysProblem("29", "2028-02"), null);
  assert.equal(openDaysProblem("0", "2026-07"), null);
  assert.equal(openDaysProblem("2,5", "2026-07"), "Tam sayı girin");
});

test("Açık gün açıklaması: devam eden ayda tahmin günü, kapanmış ayda yalnız sabit gider oranı", () => {
  assert.equal(monthPhase("2026-10", "2026-10"), "running");
  assert.equal(monthPhase("2026-07", "2026-10"), "closed");
  assert.equal(monthPhase("2030-01", "2026-10"), "future");
  // Excel: Ekim 1-16 (Panel B18 = 16 gün), Temmuz açılış ayı 23 gün ve tahmin yok
  assert.equal(openDaysHint("16", "2026-10", "2026-10"), "Ay sürüyor: 16/31 gün (tahmin bu sayıyla)");
  assert.equal(openDaysHint("30", "2026-09", "2026-10"), "Tüm ay açık (30/30 gün)");
  assert.equal(openDaysHint("23", "2026-07", "2026-10"), "23/31 gün · sabit gider oranı %74,2");
  assert.equal(openDaysHint("", "2026-09", "2026-10"), "Eylül 2026 30 gün çeker");
  assert.equal(openDaysHint("", "2026-10", "2026-10"), "Devam eden ay: bugüne kadar açık olunan gün (ay 31 gün)");
});

// ---------------------------------------------------------------- Kâr marjı renk ölçeği

test("Yüzdebirlik Excel PERCENTILE (dahil) gibi ara değer alır", () => {
  assert.equal(percentileInc([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentileInc([1, 2, 3], 0.5), 2);
  assert.equal(percentileInc([5], 0.5), 5);
  assert.equal(percentileInc([0, 10], 0.25), 2.5);
  assert.equal(marginScale([0.5]), null);
});

test("Renk ölçeği: en düşük kırmızı, ortanca sarı, en yüksek yeşil; aradaki değerler geçişli", () => {
  const s = marginScale([0.2, 0.4, 0.7, 0.8, 0.9])!;
  assert.deepEqual({ min: s.min, mid: s.mid, max: s.max }, { min: 0.2, mid: 0.7, max: 0.9 });
  assert.equal(marginPosition(0.2, s), 0);
  assert.equal(marginPosition(0.7, s), 0.5);
  assert.equal(marginPosition(0.9, s), 1);
  assert.ok(Math.abs(marginPosition(0.45, s) - 0.25) < 1e-12);
  assert.ok(Math.abs(marginPosition(0.8, s) - 0.75) < 1e-12);
  assert.equal(marginColor(0.2, s), "rgb(253 205 205)");
  assert.equal(marginColor(0.7, s), "rgb(254 238 166)");
  assert.equal(marginColor(0.9, s), "rgb(196 239 206)");
  assert.equal(marginColor(-1, s), "rgb(253 205 205)");
  assert.equal(marginLevelLabel(0.2, s), "Bu ayın en düşük marjı");
  assert.equal(marginLevelLabel(0.9, s), "Bu ayın en yüksek marjı");
  assert.equal(marginLevelLabel(0.7, s), null);
});

test("Eylül: ölçeğin en düşüğü Excel'deki gibi Kruvasan Hindi Füme (%19,7); HİZMET ölçeğe girmez", () => {
  const sales = model.monthSales("2026-09");
  const rows = sales.lines.map((l) => ({ name: l.line.posName, margin: l.margin, matched: l.matched, isService: l.line.isService, net: l.net }));
  const scaled = rows.filter(inMarginScale);
  assert.ok(scaled.length > 100);
  assert.ok(scaled.every((r) => !r.isService && r.matched));
  const s = marginScale(scaled.map((r) => r.margin))!;
  const byMargin = [...scaled].sort((a, b) => a.margin - b.margin);
  // Excel J sütununun en düşük üç değeri: 19,7 · 35,5 · 36,6
  assert.deepEqual(
    byMargin.slice(0, 3).map((r) => [r.name, Math.round(r.margin * 1000) / 10]),
    [
      ["KRUVASAN HİNDİ FÜMELİ SANDVİÇ", 19.7],
      ["LAFFO MANGO", 35.5],
      ["LAFFO CHEES FRM.", 36.6],
    ],
  );
  assert.ok(Math.abs(s.min - 0.19699458796) < 1e-9);
  // Karaoke (HİZMET, %97,6) Excel'de en yeşil; panelde ölçek reçeteli en yüksek ürüne göre kurulur
  assert.ok(s.max < 0.95 && s.max > 0.9);
  assert.equal(marginColor(byMargin[0].margin, s), "rgb(253 205 205)");
});

// ---------------------------------------------------------------- İçe aktarma

test("Yapıştırılan listede TOPLAM satırı ürün sayılmaz ve kaç tane atlandığı söylenir", () => {
  const r = parsePastedSales("Ürün Adı\tAdet\tTutar\nTEST LATTE MEDIUM\t3\t450\nTEST SIMIT\t2\t120\nTOPLAM\t5\t570");
  assert.deepEqual(
    r.rows.map((x) => x.posName),
    ["TEST LATTE MEDIUM", "TEST SIMIT"],
  );
  assert.equal(r.rows.reduce((a, x) => a + x.revenue, 0), 570);
  assert.equal(describeSkipped(r.skipped), "1 toplam satırı ve 1 başlık satırı atlandı");
});

test("Önizleme hafızayı büyük/küçük harf ve I/İ farkı olmadan bulur", () => {
  const products = [
    { id: 1, name: "Ice Americano", size: "M", active: true },
    { id: 2, name: "Caramel Latte", size: "M", active: true },
  ];
  const mappings = [
    { posName: "ICED AMERICANO MEDİUM", productId: 1, isService: false },
    { posName: "CARAMEL LATTE MEDIUM", productId: 2, isService: false },
    { posName: "KARAOKE KİŞİ BAŞI", productId: null, isService: true },
  ];
  const out = previewMatches(
    [{ posName: "Iced Americano Medium" }, { posName: "Caramel Latte Medium" }, { posName: "Karaoke Kişi başı" }, { posName: "Yeni Ürün" }],
    mappings,
    products,
  );
  assert.deepEqual(
    out.map((o) => [o.status, o.label]),
    [
      ["matched", "Ice Americano · M"],
      ["matched", "Caramel Latte · M"],
      ["service", "HİZMET"],
      ["new", null],
    ],
  );
});

test("Öneri: adı birebir tutan ürün, boy ekiyle; aynı ada tek öneri, eşleşmiş satır önerilmez", () => {
  const products = [
    { id: 1, name: "Ice Americano", size: "M", active: true },
    { id: 2, name: "Ice Americano", size: "L", active: true },
    { id: 3, name: "Türk Kahvesi", size: "M", active: true },
    { id: 4, name: "Simit", size: "Tek", active: false },
  ];
  assert.equal(suggestProduct("ICED AMERICANO MEDİUM", products)?.id, 1);
  assert.equal(suggestProduct("Iced Americano Large", products)?.id, 2);
  assert.equal(suggestProduct("TÜRK KAHVESI MEDİUM", products)?.id, 3);
  assert.equal(suggestProduct("SİMİT", products), null, "pasif ürün önerilmez");
  const rows = [
    { id: 10, posName: "ICED AMERICANO MEDİUM", matched: false, isService: false },
    { id: 11, posName: "Iced Americano Medium", matched: false, isService: false },
    { id: 12, posName: "ICED AMERICANO LARGE", matched: true, isService: false },
    { id: 13, posName: "KARAOKE", matched: false, isService: true },
  ];
  assert.deepEqual(
    collectSuggestions(rows, products).map((x) => [x.row.id, x.product.id]),
    [[10, 1]],
  );
});

test("Renk ölçeği ekrandaki duyarlıkla karşılaştırır: %78,5 ile %78,5 zıt renk almaz", () => {
  const a = 0.7851267333333334;
  const b = 0.7851267333333333;
  assert.equal(marginScale([a, b]), null, "aralık çökünce ölçek yok (renksiz)");
  const s = marginScale([a, b, 0.9])!;
  assert.equal(marginColor(a, s), marginColor(b, s));
  assert.equal(marginLevelLabel(a, s), marginLevelLabel(b, s));
  assert.equal(marginLevelLabel(b, s), "Bu ayın en düşük marjı");
});
