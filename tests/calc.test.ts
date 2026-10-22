// Hesaplama motorunun Excel ile birebir aynı sonucu verdiğini doğrular.
// golden.json, scripts/excel-import/extract.py tarafından Excel'in hesapladığı değerlerden üretilir.
// Çalıştırma: npm test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import { evaluateExpression, parseNumberTR } from "../src/lib/calc/expr";
import { consistency, dashboard } from "../src/lib/calc/insights";
import { DEFAULT_SETTINGS } from "../src/lib/constants";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const golden = JSON.parse(readFileSync(join(root, "tests/golden.json"), "utf8"));
// Excel bütün satışa tek KDV oranı uyguluyordu (karaoke dahil %10). Panel hizmet satışını (Satışlar'da HİZMET işaretli
// satırlar: karaoke odası) kendi oranıyla ayırır (Ayarlar › Hizmet satışı KDV, varsayılan %20). Excel'le birebir
// karşılaştırma Excel'in varsayımıyla yapılır; ayrımın kendisi en alttaki testte.
const ds = excelToDataset(data);
const model = createModel({ ...ds, settings: { ...ds.settings, kdvHizmet: ds.settings.kdv } });

function close(actual: number | null | undefined, expected: number | null | undefined, label: string, tol = 1e-6) {
  assert.ok(actual !== null && actual !== undefined, `${label}: değer yok`);
  const e = Number(expected ?? 0);
  const diff = Math.abs((actual as number) - e);
  assert.ok(diff <= tol * Math.max(1, Math.abs(e)), `${label}: beklenen ${e}, bulunan ${actual} (fark ${diff})`);
}

test("129 ürün kartının maliyet, fiyat ve kârı Excel ile aynı", () => {
  assert.equal(model.products.length, Object.keys(golden.products).length);
  const sold = model.soldByProduct("2026-09");
  for (const p of model.products) {
    const g = golden.products[p.key];
    assert.ok(g, `Excel'de yok: ${p.key}`);
    close(p.price, g.price, `${p.key} fiyat`);
    close(p.net, g.net, `${p.key} net`);
    close(p.commission, g.commission, `${p.key} komisyon`);
    close(p.cost, g.cost, `${p.key} maliyet`);
    close(p.unitProfit, g.unitProfit, `${p.key} birim kâr`);
    close(p.margin, g.margin, `${p.key} marj`);
    close(p.costRatio, g.costRatio, `${p.key} maliyet oranı`);
    close(p.suggestedPrice, g.suggestedPrice, `${p.key} önerilen fiyat`);
    assert.equal(p.status, g.status, `${p.key} durum`);
    close(sold.get(p.product.id) ?? 0, g.soldQty, `${p.key} Eylül adedi`);
  }
});

test("Satış Raporu: 125 satırın maliyeti, komisyonu ve brüt kârı aynı", () => {
  const s = model.monthSales("2026-09");
  assert.equal(s.lines.length, golden.salesLines.length);
  s.lines.forEach((l, i) => {
    const g = golden.salesLines[i];
    assert.equal(l.line.posName, g.posName);
    if (g.unitCost !== null) close(l.unitCost, g.unitCost, `${g.posName} birim maliyet`);
    close(l.net, g.net, `${g.posName} net`);
    close(l.cost, g.cost, `${g.posName} maliyet`);
    close(l.commission, g.commission, `${g.posName} komisyon`);
    close(l.grossProfit, g.grossProfit, `${g.posName} brüt kâr`);
  });
  const t = golden.salesTotals;
  close(s.qty, t.qty, "toplam adet");
  close(s.revenue, t.revenue, "toplam ciro");
  close(s.net, t.net, "net ciro");
  close(s.cost, t.cost, "malzeme maliyeti");
  close(s.commission, t.commission, "komisyon");
  close(s.grossProfit, t.grossProfit, "brüt kâr");
  close(s.avgCostRatio, t.avgCostRatio, "ortalama maliyet oranı");
});

test("Panel: Eylül kâr/zarar, başabaş ve oranlar aynı", () => {
  const d = dashboard(model, "2026-09");
  const g = golden.panel;
  assert.ok(d.theoretical);
  close(d.theoretical!.netSales, g.netSales, "net satış");
  close(-d.theoretical!.discountsNet, g.discounts, "indirim");
  close(-d.theoretical!.material, g.material, "malzeme");
  close(-d.theoretical!.commission, g.commission, "komisyon");
  close(d.theoretical!.fixedTotal, golden.fixedTotal, "sabit gider toplamı");
  close(d.theoretical!.netProfit, g.netProfit, "Eylül net kâr/zarar");
  close(d.breakEvenDaily, g.breakEvenDaily, "başabaş günlük ciro");
  close(d.dailyAvg, g.dailyAvg, "günlük ortalama ciro");
  close(d.recipeCostRatio, g.recipeCostRatio, "reçeteye göre maliyet oranı");
  close(d.invoiceCostRatio, g.invoiceCostRatio, "faturaya göre maliyet oranı");
  assert.equal(d.bestProduct?.p.key, g.bestProduct);
  assert.equal(d.lowProfitCount, g.lowProfitCount);
  for (const c of d.categories) {
    const gc = golden.categories[c.name];
    assert.ok(gc, `kategori yok: ${c.name}`);
    assert.equal(c.count, gc.count, `${c.name} ürün sayısı`);
    close(c.avgMargin, gc.avgMargin, `${c.name} ort. marj`);
    close(c.avgUnitProfit, gc.avgUnitProfit, `${c.name} ort. birim kâr`);
    close(c.avgCostRatio, gc.avgCostRatio, `${c.name} ort. maliyet oranı`);
  }
});

test("Ekim tahmini Excel formülüyle hesaplanıyor", () => {
  const d = dashboard(model, "2026-10");
  assert.ok(d.forecast);
  const sep = model.monthSales("2026-09");
  const expected = (293909 / 16) * 31 * (sep.grossProfit / sep.revenue) - golden.fixedTotal;
  close(d.forecast!.projectedProfit, expected, "Ekim tahmini");
});

test("Genel Maliyet: Temmuz–Ekim gelir-gider tablosu aynı", () => {
  for (const month of ["2026-07", "2026-08", "2026-09", "2026-10"]) {
    const g = golden.pnl[month];
    const pm = model.pnlMonth(month);
    close(pm.purchases, g.purchases, `${month} mal alımı`);
    close(pm.cogs, g.cogs, `${month} SMM`);
    close(pm.sections.personel, g.personnel, `${month} personel`);
    close(pm.sections.faturalar, g.bills, `${month} faturalar`);
    close(pm.sections.kira, g.rent, `${month} kira`);
    close(pm.sections.genel, g.general, `${month} genel`);
    close(pm.cells.get("commission:pos")!.value, g.posCommission, `${month} POS komisyonu`);
    close(pm.sections.komisyon, g.commission, `${month} komisyon toplamı`);
    close(pm.expenses, g.expenses, `${month} giderler`);
    close(pm.revenueNet, g.revenueNet, `${month} ciro (KDV hariç)`);
    close(pm.profit, g.profit, `${month} kâr/zarar`);
  }
});

test("Personel ve sabit gider toplamları aynı", () => {
  close(model.personnel.net, golden.personnel.net, "net maaş");
  close(model.personnel.gross, golden.personnel.gross, "brüt maaş");
  close(model.personnel.total, golden.personnel.total, "işveren maliyeti");
  close(model.fixedStandardTotal, golden.fixedTotal, "sabit gider toplamı");
});

test("Tutarlılık Kontrolü: reçeteye göre kullanım ve fark tutarı aynı", () => {
  const c = consistency(model, "2026-09");
  for (const [name, usage] of Object.entries(golden.consistency.usage as Record<string, number>)) {
    const row = c.rows.find((r) => r.ingredient.name === name);
    assert.ok(row, `satır yok: ${name}`);
    close(row!.usage, usage, `${name} kullanım`);
  }
  close(c.totalDiff, golden.consistency.totalDiff, "toplam fark");
  close(c.sales.diff, golden.consistency.salesDiff, "satış farkı");
  close(c.sales.offRevenueCost, golden.consistency.offRevenueCost, "ödenmez maliyeti");
});

test("Fatura özetleri aynı (Komisyon kategorisi Diğer'den ayrıldı)", () => {
  for (const [label, byMonth] of Object.entries(golden.invoiceSummary as Record<string, Record<string, number>>)) {
    if (label === "TOPLAM" || label.startsWith("Mal maliyeti")) continue;
    for (const [month, expected] of Object.entries(byMonth)) {
      const cats = label === "Diğer" ? ["Diğer", "Komisyon"] : [label];
      const actual = ds.invoices
        .filter((i) => i.date.startsWith(month) && cats.includes(i.category))
        .reduce((a, i) => a + i.amount - i.discount, 0);
      close(actual, expected, `${label} ${month}`);
    }
  }
  for (const [month, expected] of Object.entries(golden.invoiceSummary["Mal maliyeti (ilk 3 satır)"] as Record<string, number>)) {
    close(model.goodsPurchases(month), expected, `mal maliyeti ${month}`);
  }
});

test("Formül ve sayı çözümleyici", () => {
  const st = DEFAULT_SETTINGS;
  assert.equal(evaluateExpression("2*ShotCift", st), 36);
  assert.equal(evaluateExpression("=200*PotGr/PotMl", st), (200 * 105) / 1800);
  assert.equal(evaluateExpression("1,5 × pompa", st), 15);
  assert.throws(() => evaluateExpression("2*Bilinmeyen", st));
  assert.equal(parseNumberTR("1.234,56"), 1234.56);
  assert.equal(parseNumberTR("51,85"), 51.85);
  assert.equal(parseNumberTR("1.022"), 1022);
  assert.equal(parseNumberTR("0.5"), 0.5);
  assert.equal(parseNumberTR("%2,5"), 0.025);
  assert.equal(parseNumberTR(""), null);
});

test("Ayar değişince bağlı reçeteler güncellenir", () => {
  const m2 = createModel({ ...ds, settings: { ...ds.settings, shotTek: 12 } });
  const esp = m2.products.find((p) => p.key === "Espresso|M")!;
  const before = model.products.find((p) => p.key === "Espresso|M")!;
  assert.ok(esp.cost > before.cost);
  close(esp.lines[0].qty, 12, "yeni shot gramajı");
});

test("Fire ambalaj hariç seçeneği maliyeti düşürür", () => {
  const m2 = createModel({ ...ds, settings: { ...ds.settings, fireExcludesPackaging: true } });
  const a = m2.products.find((p) => p.key === "Latte|M")!;
  const b = model.products.find((p) => p.key === "Latte|M")!;
  assert.ok(a.cost < b.cost);
});

test("Hizmet satışı (karaoke) kendi KDV oranıyla: satış raporu ve gelir-gider ayrılır, diğer aylar Excel'le aynı", () => {
  assert.equal(ds.settings.kdvHizmet, 0.2, "varsayılan %20");
  const split = createModel(ds);
  // Satış raporu: yalnız HİZMET satırlarının neti değişir, malzeme ve komisyon aynı
  const a = split.monthSales("2026-09");
  const b = model.monthSales("2026-09");
  assert.equal(a.services.length, 2);
  close(a.serviceRevenue, 1050 + 1000, "Eylül karaoke cirosu (KDV dahil)");
  a.lines.forEach((l, i) => {
    const excel = b.lines[i];
    close(l.net, l.line.isService ? l.line.revenue / 1.2 : excel.net, `${l.line.posName} net`);
    close(l.cost, excel.cost, `${l.line.posName} maliyet`);
    close(l.commission, excel.commission, `${l.line.posName} komisyon`);
  });
  close(a.net, b.net - 2050 / 1.1 + 2050 / 1.2, "net ciro");
  close(a.revenue, b.revenue, "ciro (KDV dahil) değişmez");
  close(a.avgCostRatio, b.avgCostRatio, "ortalama maliyet oranı (hizmet satırları girmez)");
  // Gelir-gider: POS cirosunun karaoke payı %20 ile, kalanı %10 ile; giderler aynı
  const pm = split.pnlMonth("2026-09");
  close(pm.serviceRevenue, 2050, "hizmet payı");
  close(pm.revenueNet, (429698 - 2050) / 1.1 + 2050 / 1.2, "Eylül ciro (KDV hariç)");
  close(pm.expenses, model.pnlMonth("2026-09").expenses, "giderler");
  close(pm.profit, model.pnlMonth("2026-09").profit - (2050 / 1.1 - 2050 / 1.2), "kâr karaoke KDV farkı kadar düşer");
  close(split.pnlValue(pm, "revenueNet").value, pm.revenueNet, "tablodaki AYLIK CİRO (KDV hariç)");
  assert.match(split.pnlRowDefs(["2026-09"]).find((r) => r.key === "revenueNet")?.hint ?? "", /HİZMET .*%20/);
  // Satış listesi olmayan aylar (Temmuz, Ağustos, Ekim): bütün ciro %10, Excel'le aynı
  for (const month of ["2026-07", "2026-08", "2026-10"]) {
    const p = split.pnlMonth(month);
    assert.equal(p.serviceRevenue, 0, month);
    close(p.revenueNet, golden.pnl[month].revenueNet, `${month} ciro (KDV hariç)`);
    close(p.profit, golden.pnl[month].profit, `${month} kâr/zarar`);
  }
  // Hizmet oranı satış oranına eşitse Excel'in tek oranlı hesabı
  const same = createModel({ ...ds, settings: { ...ds.settings, kdvHizmet: 0.1 } });
  close(same.pnlMonth("2026-09").revenueNet, golden.pnl["2026-09"].revenueNet, "tek oran");
  // Hizmet payı ay cirosundan büyük olamaz (ciro yanlış girildiyse eksi KDV hariç ciro çıkmasın)
  const tiny = createModel({ ...ds, months: ds.months.map((m) => (m.month === "2026-09" ? { ...m, posRevenue: 1000 } : m)) });
  close(tiny.pnlMonth("2026-09").serviceRevenue, 1000, "ciroyla sınırlı");
  close(tiny.pnlMonth("2026-09").revenueNet, 1000 / 1.2, "ciro tamamen hizmet");
});
