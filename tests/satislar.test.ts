// Satışlar ekranı: açık gün sınırı, kâr marjı renk ölçeği (Excel Satış Raporu J sütunu), içe aktarma
// önizlemesindeki hafıza eşleşmesi (I/İ ve büyük/küçük harf), toplam satırı ve eşleştirme önerileri.
// Çalıştırma: npx tsx --test tests/satislar.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  cardShareProblem,
  collectSuggestions,
  effectiveValue,
  fieldPayload,
  fieldText,
  fieldValue,
  initialModes,
  inMarginScale,
  kasaHint,
  marginColor,
  marginLevelLabel,
  marginPosition,
  marginScale,
  monthPhase,
  monthSavedToast,
  openDaysHint,
  openDaysProblem,
  percentileInc,
  previewMatches,
  suggestProduct,
} from "../src/app/panel/satislar/sales-logic";
import { createModel } from "../src/lib/calc/engine";
import { describeSkipped, parsePastedSales } from "../src/lib/calc/pos-paste";
import { tillMonths } from "../src/lib/cash-month";
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

// ---------------------------------------------------------------- Ay bilgisi: kasa raporlarından

test("ay bilgisi kipleri: kasadan uygulanan ve elle yazılmamış alan 'kasa'da açılır; ötekiler 'elle'", () => {
  const manual = { openDays: null, posRevenue: 310_000, discounts: null, offRevenue: 0, cardShare: null };
  const kasa = { openDays: 18, posRevenue: 245_300, discounts: 3_200, offRevenue: null, cardShare: 0.832 };
  assert.deepEqual(initialModes(manual, kasa), { openDays: "kasa", posRevenue: "elle", discounts: "kasa", offRevenue: "elle", cardShare: "kasa" });
  assert.deepEqual(initialModes(manual, null), { openDays: "elle", posRevenue: "elle", discounts: "elle", offRevenue: "elle", cardShare: "elle" });
});

test("ay bilgisi metni ve değeri: oran yüzde, açık gün tam sayı; okunamayan boş", () => {
  assert.equal(fieldText("cardShare", 0.832), "83,2");
  assert.equal(fieldText("cardShare", 0.8346), "83,46");
  assert.equal(fieldText("posRevenue", 245_300.5), "245.300,5");
  assert.equal(fieldText("openDays", 18), "18");
  assert.equal(fieldText("discounts", null), "");
  assert.equal(fieldValue("cardShare", "83,2"), 0.832);
  assert.equal(fieldValue("cardShare", "%85,6"), 0.856);
  assert.equal(fieldValue("posRevenue", "245.300,50"), 245_300.5);
  assert.equal(fieldValue("openDays", "18"), 18);
  assert.equal(fieldValue("openDays", "1,5"), null);
  assert.equal(fieldValue("discounts", "  "), null);
  assert.equal(cardShareProblem(""), null);
  assert.equal(cardShareProblem("83,2"), null);
  assert.equal(cardShareProblem("120"), "Oran 0 ile 100 arasında olmalı");
  assert.equal(cardShareProblem("abc"), "Oranı yüzde olarak yazın (ör. 83,2)");
});

test("kaydedilecek değer: kasa kipinde ve boşta null; kasadakine dokunup değiştirmemek elle yazmak sayılmaz", () => {
  assert.equal(fieldPayload("posRevenue", { mode: "kasa", text: "999", kasa: 245_300, manualBefore: false }), null);
  assert.equal(fieldPayload("posRevenue", { mode: "elle", text: "", kasa: 245_300, manualBefore: true }), null, "boşaltılan elle değer kasaya döner");
  assert.equal(fieldPayload("posRevenue", { mode: "elle", text: "245.300", kasa: 245_300, manualBefore: false }), null, "dokunuldu ama değişmedi");
  assert.equal(fieldPayload("posRevenue", { mode: "elle", text: "245.300", kasa: 245_300, manualBefore: true }), 245_300, "önceden elle yazılmış aynı değer elle kalır");
  assert.equal(fieldPayload("posRevenue", { mode: "elle", text: "250.000", kasa: 245_300, manualBefore: false }), 250_000);
  assert.equal(fieldPayload("discounts", { mode: "elle", text: "0", kasa: null, manualBefore: false }), 0, "elle yazılan 0");
  assert.equal(fieldPayload("cardShare", { mode: "elle", text: "83,2", kasa: 0.832, manualBefore: false }), null);
  assert.equal(fieldPayload("cardShare", { mode: "elle", text: "85", kasa: 0.832, manualBefore: false }), 0.85);
});

test("geçerli değer: kasadakine dokunup değiştirmemek kasadakini korur (tutarlılık kutusu ve 'Bunu yaz' kaybolmaz)", () => {
  assert.equal(effectiveValue("posRevenue", { mode: "kasa", text: "", kasa: 245_300, payload: null }), 245_300);
  assert.equal(effectiveValue("posRevenue", { mode: "elle", text: " ", kasa: 245_300, payload: null }), 245_300, "boş elle alan kasaya döner");
  // Kasadan gelen alana dokunuldu (Elle kipi, kasadaki yazılı): gidecek değer boş, geçerli değer yine kasadaki
  const touched = { mode: "elle" as const, text: fieldText("posRevenue", 245_300.5), kasa: 245_300.5 };
  assert.equal(fieldPayload("posRevenue", { ...touched, manualBefore: false }), null);
  assert.equal(effectiveValue("posRevenue", { ...touched, payload: null }), 245_300.5);
  assert.equal(effectiveValue("offRevenue", { mode: "elle", text: fieldText("offRevenue", 1_250), kasa: 1_250, payload: null }), 1_250);
  assert.equal(effectiveValue("cardShare", { mode: "elle", text: fieldText("cardShare", 0.8346), kasa: 0.8346, payload: null }), 0.8346);
  // Yazılan değer (0 dahil) geçerli; okunamayan metin ve kasanın uygulanmadığı boş alan değersiz
  assert.equal(effectiveValue("posRevenue", { mode: "elle", text: "250.000", kasa: 245_300, payload: 250_000 }), 250_000);
  assert.equal(effectiveValue("discounts", { mode: "elle", text: "0", kasa: 3_200, payload: 0 }), 0);
  assert.equal(effectiveValue("posRevenue", { mode: "elle", text: "abc", kasa: 245_300, payload: null }), null);
  assert.equal(effectiveValue("posRevenue", { mode: "elle", text: "", kasa: null, payload: null }), null);
  // Ekran bu kuralı kullanır
  const client = readFileSync(join(root, "src/app/panel/satislar/sales-client.tsx"), "utf8");
  assert.match(client, /const effective = \(f: MonthField\) => effectiveValue\(f, \{ mode: modes\[f\], text: texts\[f\], kasa: kasaOf\(f\), payload: payloads\[f\] \}\);/);
});

test("ay bilgisi kaydedildi: bütün alanlar boşalınca kasa raporu olan ay 'boşaltıldı' sayılmaz (bilgiler kasadan gelir)", () => {
  assert.deepEqual(monthSavedToast({ removed: false, kasa: true }, "Kasım 2026"), { title: "Ay bilgileri kaydedildi" });
  assert.deepEqual(monthSavedToast({ removed: true, kasa: true }, "Kasım 2026"), {
    title: "Ay bilgileri kaydedildi",
    description: "Elle yazılan kalmadı; boş alanlar kasa raporlarından gelir.",
  });
  assert.deepEqual(monthSavedToast({ removed: true, kasa: false }, "Kasım 2026"), { title: "Ay bilgileri boşaltıldı", description: "Kasım 2026 için kayıtlı bilgi kalmadı." });
  const action = readFileSync(join(root, "src/server/actions/sales.ts"), "utf8");
  // Kasadan gelen satır: kasa raporu ya da (açıksa) LafPOS gün sonu veya sayılan ModPOS föyü (hasTillRowsIn)
  assert.match(action, /const kasa = await hasTillRowsIn\(data\.month, db\);[\s\S]*?return \{ removed, kasa \};/);
});

test("kasa açıklaması: kaç günlük rapordan; indirim ve ödenmezde kaç günde girildi; elle kipinde kasadaki", () => {
  const rows = Array.from({ length: 18 }, (_, i) => ({
    date: `2026-11-${String(i + 1).padStart(2, "0")}`,
    zTotal: 10_000,
    card: 8_000,
    mealCard: 320,
    discounts: i < 12 ? 100 : null,
    offRevenue: i < 15 ? 50 : null,
  }));
  const [till] = tillMonths(rows, "2026-11-18");
  const kasa = { values: { openDays: 18, posRevenue: 180_000, discounts: 1_200, offRevenue: 750, cardShare: till.cardShare }, till };
  assert.equal(kasaHint("posRevenue", kasa, "kasa", ""), "Kasa raporlarından (18 gün). Değiştirmek için dokunun.");
  assert.equal(kasaHint("discounts", kasa, "kasa", ""), "Kasa raporlarından (12 / 18 günde girildi). Değiştirmek için dokunun.");
  assert.equal(kasaHint("offRevenue", kasa, "kasa", ""), "Kasa raporlarından (15 / 18 günde girildi). Değiştirmek için dokunun.");
  assert.equal(kasaHint("posRevenue", kasa, "elle", "190.000")?.replace(/\u00a0/g, " "), "Elle girildi · kasada 180.000 ₺");
  assert.equal(kasaHint("openDays", kasa, "elle", "20"), "Elle girildi · kasada 18 gün");
  assert.equal(kasaHint("cardShare", kasa, "elle", "85"), "Elle girildi · kasada %83,2");
  assert.equal(kasaHint("posRevenue", kasa, "elle", "")?.replace(/\u00a0/g, " "), "Boş bırakırsanız kasadaki kullanılır (180.000 ₺)");
  // Kasa bu alana uygulanmıyorsa (ya da ayın raporu yoksa) açıklama yok
  assert.equal(kasaHint("posRevenue", { ...kasa, values: { ...kasa.values, posRevenue: null } }, "elle", ""), null);
  assert.equal(kasaHint("posRevenue", null, "elle", ""), null);
});
