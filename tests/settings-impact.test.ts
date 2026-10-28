// Ayarlar önizlemesi (kaydetmeden önce etki), ayar alanlarının yüzde okuması, su mesajları ve hammadde formu
// yardımcıları. Veri: Excel'in Eylül verisi (calc.test.ts ile aynı tohum).
// Çalıştırma: npx tsx --test tests/settings-impact.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ALL_FIELDS, isClean, parseField, problemOf, textsOf, toText } from "../src/app/panel/ayarlar/fields";
import { changed, impactData, impactModel, settingsImpact } from "../src/app/panel/ayarlar/impact";
import { waterSource } from "../src/app/panel/ayarlar/water-text";
import { countUnitHint, groupForCategory, historyText, nearMatch, vatForGroup } from "../src/app/panel/hammaddeler/form-helpers";
import { createModel, type WaterCost } from "../src/lib/calc/engine";
import { parsePercentInput } from "../src/lib/calc/expr";
import type { Settings } from "../src/lib/calc/types";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const ds = excelToDataset(data);
const full = createModel(ds);
const slim = impactData(full);
const base = impactModel(slim);
const field = (key: string) => ALL_FIELDS.find((f) => f.key === key)!;
const withSettings = (patch: Partial<Settings>) => settingsImpact(base, impactModel(slim, { ...slim.settings, ...patch }));

test("önizleme verisi tam modelle aynı ürün maliyetini, durumunu ve Eylül brüt kârını verir", () => {
  assert.equal(base.products.length, full.products.length);
  const byId = new Map(full.products.map((p) => [p.product.id, p]));
  for (const p of base.products) {
    const f = byId.get(p.product.id)!;
    assert.ok(Math.abs(p.cost - f.cost) < 1e-9, `${p.key} maliyet`);
    assert.equal(p.status, f.status, `${p.key} durum`);
    assert.ok(Math.abs(p.suggestedPrice - f.suggestedPrice) < 1e-9, `${p.key} önerilen fiyat`);
  }
  const m = full.salesMonths.at(-1)!;
  assert.ok(Math.abs(base.monthSales(m).grossProfit - full.monthSales(m).grossProfit) < 1e-6);
  assert.ok(Math.abs(base.water.perLiter - full.water.perLiter) < 1e-12);
  assert.ok(Math.abs(base.fixedStandardTotal - full.fixedStandardTotal) < 1e-6);
  // İstemciye giden veri küçük: sayımlar ve SU GİDERİ dışındaki gelir-gider satırları yok; faturalardan yalnız her ay
  // girilen harcamaya bağlı kategoriler (başabaş, E-13), geçen aydan
  assert.ok(!("stockCounts" in slim));
  assert.deepEqual(slim.invoices, []);
  assert.ok(slim.pnlEntries.every((e) => e.rowKey === "manual:su"));
});

test("değişiklik yoksa etki yok; '%10' kayıtlı %10 ile aynı sayılır", () => {
  const same = withSettings({});
  assert.equal(same.any, false);
  assert.equal(same.statusChanges.length, 0);
  assert.equal(same.costChanged, 0);
  const typed = withSettings({ kdv: parseField("%10", "pct")! });
  assert.equal(typed.any, false);
});

test("hedef maliyet %30 → %25: maliyet değişmez, bazı ürünlerin durumu kötüleşir, önerilen fiyatlar artar", () => {
  const i = withSettings({ hedefMaliyet: parsePercentInput("25")! });
  assert.equal(i.any, true);
  assert.equal(i.costChanged, 0);
  assert.ok(!changed(i.avgCostRatio), "maliyet oranı aynı kalır");
  assert.ok(i.statusChanges.length > 0, "durumu değişen ürün olmalı");
  assert.ok(i.statusChanges.every((c) => c.worse), "daha sıkı hedefte hiçbir ürün iyileşmez");
  assert.ok(i.suggestedChanged > 0);
  // Brüt kâr hedef orandan bağımsız
  assert.ok(!changed(i.grossProfit, 0.005));
});

test("çift shot 18 → 17 gr: kahveli ürünlerin maliyeti düşer, ortalama oran düşer, Eylül brüt kârı artar", () => {
  const i = withSettings({ shotCift: 17 });
  assert.ok(i.costChanged > 0);
  assert.ok(i.avgCostRatio.after < i.avgCostRatio.before);
  assert.ok(i.grossProfit && i.grossProfit.after > i.grossProfit.before);
  assert.ok(i.breakEvenDaily && i.breakEvenDaily.after <= i.breakEvenDaily.before);
  assert.ok(i.statusChanges.every((c) => !c.worse), "maliyet düşünce hiçbir ürün kötüleşmez");
});

test("'0,1' yazılan KDV binde bir okunur ve alan hatası verir (Excel'de %0,1); '%10' ve '10' %10 okunur", () => {
  assert.equal(parseField("%10", "pct"), 0.1);
  assert.equal(parseField("10%", "pct"), 0.1);
  assert.equal(parseField("10", "pct"), 0.1);
  assert.equal(parseField("0,1", "pct"), 0.001);
  assert.match(problemOf(field("kdv"), "0,1")!, /yüzde olarak yazın/);
  assert.equal(problemOf(field("kdv"), "%10"), null);
  assert.equal(problemOf(field("kdv"), "0"), null, "0 geçerli (KDV'siz)");
  assert.match(problemOf(field("hedefMaliyet"), "0")!, /0'dan büyük/);
  assert.match(problemOf(field("kdv"), "120")!, /%100/);
  // Fire binde bir olabilir: kısıt yok
  assert.equal(problemOf(field("fire"), "0,4"), null);
  assert.match(problemOf(field("acikGun"), "30,5")!, /Tam sayı/);
  assert.match(problemOf(field("acikGun"), "32")!, /En fazla 31/);
  assert.match(problemOf(field("potMl"), "0")!, /0'dan büyük/);
  assert.match(problemOf(field("shotTek"), "abc")!, /sayı/);
});

test("yuvarlanmış gösterim kayıtlı değeri bozmaz: dokunulmayan alan temiz sayılır", () => {
  const precise = 367917 / 429698; // Excel B6 notundaki kartlı oran (0,856221…)
  const text = toText(precise, "pct");
  assert.equal(text, "85,62");
  assert.equal(isClean(text, text, precise, "pct"), true);
  assert.equal(isClean("85,620", text, precise, "pct"), true, "biçim farkı değişiklik sayılmaz");
  assert.equal(isClean("85,7", text, precise, "pct"), false);
  assert.equal(isClean("%10", toText(0.1, "pct"), 0.1, "pct"), true);
  assert.equal(isClean("10,00", toText(0.1, "pct"), 0.1, "pct"), true);
  const texts = textsOf(slim.settings);
  for (const f of ALL_FIELDS) assert.equal(isClean(texts[f.key], texts[f.key], Number(slim.settings[f.key]), f.kind), true, f.key);
});

test("açık gün 30 → 26: standart sabit gider (günlük kalemler) ve başabaş değişir", () => {
  const i = withSettings({ acikGun: 26 });
  assert.ok(i.breakEvenDaily && i.breakEvenDaily.after > i.breakEvenDaily.before, "daha az gün → günlük başabaş artar");
  assert.equal(i.costChanged, 0);
});

test("elle su birim maliyeti: su ve buz kullanan ürünlerin maliyeti değişir", () => {
  const i = withSettings({ suBirimLTOverride: 5 });
  assert.ok(changed(i.waterPerLiter));
  assert.equal(i.waterPerLiter.after, 5);
  assert.ok(i.costChanged > 0);
});

test("su mesajı nedeni söyler: fatura girildi ama satış listesi yoksa 'girilmedi' denmez", () => {
  const w = (p: Partial<WaterCost>): WaterCost => ({ perLiter: 0, month: null, bill: 0, liters: 0, onlineLiters: 0, reason: "no-bill", latestBillMonth: null, ...p });
  const noUsage = waterSource(w({ reason: "no-usage", latestBillMonth: "2026-10" }));
  assert.match(noUsage, /Ekim 2026 su faturası girildi ama Ekim 2026 ürün satış listesi yok; litre hesaplanamadı/);
  assert.doesNotMatch(noUsage, /girilmedi/);
  assert.equal(waterSource(w({ reason: "no-usage", latestBillMonth: "2026-10" }), true), "Ekim 2026 faturası var, satış listesi yok");
  assert.match(waterSource(w({ reason: "no-bill" })), /SU GİDERİ girilmedi/);
  assert.equal(waterSource(w({ reason: "ok", month: "2026-09", bill: 1500, liters: 600, perLiter: 2.5, latestBillMonth: "2026-09" }), true), "Eylül 2026 su faturasından");
  const skipped = waterSource(w({ reason: "ok", month: "2026-09", bill: 1500, liters: 600, perLiter: 2.5, latestBillMonth: "2026-10" }));
  assert.match(skipped, /Eylül 2026 su faturası 1\.500 ₺ ÷ 600 L/);
  assert.match(skipped, /Ekim 2026 faturası o ayın satış listesi olmadığı için kullanılmadı/);
  assert.equal(waterSource(w({ reason: "override", perLiter: 3 }), true), "Ayarlar'dan elle");
});

test("hammadde formu: yazım farkı yakalanır, kategori rafı ve KDV önerilir, silmeyi engelleyen geçmiş yazılır", () => {
  const suppliers = ["AEM / Mipak", "Kaldi", "Sütaş"];
  assert.equal(nearMatch("AEM/Mipak", suppliers), "AEM / Mipak");
  assert.equal(nearMatch("kaldı", suppliers), "Kaldi");
  assert.equal(nearMatch("SUTAS", suppliers), "Sütaş");
  assert.equal(nearMatch("Kaldi", suppliers), undefined, "aynı yazım öneri gerektirmez");
  assert.equal(nearMatch("Yeni Tedarikçi", suppliers), undefined);

  const rows = ds.ingredients;
  assert.equal(groupForCategory(rows, "Sos & Şurup"), "SOS / ŞURUP / PÜRE");
  assert.equal(groupForCategory(rows, "Ambalaj"), "AMBALAJ MALZEMELERİ");
  assert.equal(groupForCategory(rows, "Meyve"), "DİĞER GIDA ÜRÜNLERİ", "yeni kategori");
  assert.equal(vatForGroup("AMBALAJ MALZEMELERİ"), 0.2);
  assert.equal(vatForGroup("SOS / ŞURUP / PÜRE"), 0.01);
  // Dialogdaki KDV alanı: "%20" → 0,2 (eskiden 0,002 kaydediliyordu)
  assert.equal(parsePercentInput("%20"), 0.2);

  assert.equal(historyText({ counts: 0, purchases: 0, links: 0, waste: 0 }), null);
  assert.equal(historyText({ counts: 2, purchases: 1, links: 0, waste: 0 }), "2 sayım, 1 alım miktarı");
  // Zayi / ikram kaydı da silmeyi engeller (denetim E-28)
  assert.equal(historyText({ counts: 0, purchases: 0, links: 0, waste: 3 }), "3 zayi / ikram");
  assert.equal(countUnitHint("KG", "gr"), "Sayımda 1 KG = 1.000 gr");
  assert.equal(countUnitHint("DİLİM", "dilim"), "Sayımda 1 DİLİM = 1 dilim");
  assert.equal(countUnitHint("", "gr"), "Sayım listesinde görünmez");
});
