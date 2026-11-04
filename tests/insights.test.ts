// Genel bakış (Panel), tutarlılık, sayım KDV'si ve fatura bakiyesi hesaplarının testleri.
// Excel'in Eylül değerleri tests/golden.json'dan; diğer senaryolar Excel verisinin üzerine küçük değişikliklerle.
// Çalıştırma: npx tsx --test tests/insights.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel, priceProduct } from "../src/lib/calc/engine";
import {
  alerts,
  categoryStats,
  consistency,
  dailyChange,
  dashboard,
  defaultMonthOf,
  fixedCostsForMonth,
  forecastMonthOf,
  isPartiallyPaid,
  latestSalesMonth,
  nameList,
  openBalance,
  panelGroupOf,
  referenceSalesMonth,
  resolveCurrentMonth,
  runningMonth,
  stockVatSummary,
  unpaidSummary,
  yearTrend,
} from "../src/lib/calc/insights";
import type { Dataset, PnlEntry } from "../src/lib/calc/types";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const golden = JSON.parse(readFileSync(join(root, "tests/golden.json"), "utf8"));
// Excel bütün satışa tek KDV oranı uyguluyordu (karaoke dahil %10): Excel'le karşılaştırma onun varsayımıyla (calc.test.ts)
const seed = excelToDataset(data);
const ds = { ...seed, settings: { ...seed.settings, kdvHizmet: seed.settings.kdv } };
const model = createModel(ds);

function close(actual: number | null | undefined, expected: number, label: string, tol = 1e-6) {
  assert.ok(actual !== null && actual !== undefined, `${label}: değer yok`);
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tol * Math.max(1, Math.abs(expected)), `${label}: beklenen ${expected}, bulunan ${actual} (fark ${diff})`);
}

const withPnl = (entries: PnlEntry[], extra: Partial<Dataset> = {}) => createModel({ ...ds, ...extra, pnlEntries: [...ds.pnlEntries, ...entries] });
const withMonth = (month: string, patch: Partial<Dataset["months"][number]>) =>
  createModel({ ...ds, months: ds.months.map((m) => (m.month === month ? { ...m, ...patch } : m)) });
const ingId = (name: string) => {
  const i = ds.ingredients.find((x) => x.name === name);
  assert.ok(i, `hammadde yok: ${name}`);
  return i.id;
};

// ---------------------------------------------------------------- Sabit giderler

test("Para nereye gitti: Excel Panel'in Kira / Personel / Reklam / Diğer satırları", () => {
  const d = dashboard(model, "2026-09");
  const flow = d.theoretical!.fixedFlow;
  const by = Object.fromEntries(flow.map((l) => [l.key, l]));
  close(by.kira.amount, -golden.panel.rent, "Kira (B9)");
  close(by.personel.amount, -golden.panel.personnel, "Personel (B10)");
  close(by.reklam.amount, -golden.panel.advertising, "Reklam (B11)");
  close(by.diger.amount, -golden.panel.otherFixed, "Diğer sabit giderler (B12)");
  assert.equal(flow.length, 4, "Eylül'de bu aya özel gider satırı yok");
  close(
    flow.reduce((a, l) => a + l.amount, 0),
    d.theoretical!.fixedTotal,
    "satırların toplamı = sabit gider toplamı",
  );
  assert.deepEqual(by.reklam.items.sort(), ["Influencer", "Instagram reklamı"]);
});

test("Panel grubu sınıflandırması (ad + Gelir-gider bölümü)", () => {
  assert.equal(panelGroupOf({ name: "Kira", section: "kira" }), "kira");
  assert.equal(panelGroupOf({ name: "Ortak gider avansı (Opera)", section: "kira" }), "diger");
  assert.equal(panelGroupOf({ name: "Muhasebeci", section: "personel" }), "diger");
  assert.equal(panelGroupOf({ name: "Mali Müşavir", section: "personel" }), "diger");
  assert.equal(panelGroupOf({ name: "Part-time çalışan", section: "personel" }), "personel");
  assert.equal(panelGroupOf({ name: "INSTAGRAM REKLAMI", section: "genel" }), "reklam");
  assert.equal(panelGroupOf({ name: "İlaçlama (Kılavuz IPM)", section: "genel" }), "diger");
  assert.equal(panelGroupOf({ name: "Elektrik", section: "faturalar", panelGroup: "kira" }), "kira", "kayıttaki panelGroup önceliklidir");
});

test("Sabit gider ayrımı: Eylül tam ay, standart = Excel SabitGiderToplam", () => {
  const f = fixedCostsForMonth(model, "2026-09");
  assert.equal(f.basis, "month");
  close(f.standard, golden.fixedTotal, "standart");
  close(f.total, golden.fixedTotal, "toplam");
  assert.equal(f.proration, 0);
  assert.equal(f.overrides, 0);
  assert.equal(f.manual, 0);
  assert.equal(f.waterExcluded, 0);
});

test("Açık gün ≠ ayın günü: ay temeli korunur, fark açık gün etkisi olarak ayrılır", () => {
  const m = withMonth("2026-09", { openDays: 28 });
  const d = dashboard(m, "2026-09");
  const t = d.theoretical!;
  const f = t.fixedBreakdown;
  const pm = m.pnlMonth("2026-09");
  const sections = pm.sections.personel + pm.sections.faturalar + pm.sections.kira + pm.sections.genel;
  close(t.fixedTotal, sections, "Gelir-gider ile aynı temel");
  close(f.standard + f.proration + f.overrides + f.manual, f.total, "standart + açık gün etkisi + bu aya özel = toplam");
  assert.ok(f.proration < 0, "28/30 gün açık: sabit gider azalır");
  close(f.standard, golden.fixedTotal, "standart değişmez");
  // Excel Panel!B13 temeli (standart SabitGiderToplam) ayrıca verilir
  close(t.netProfitStandard, golden.panel.netProfit, "Excel B13 temelinde net kâr");
  close(t.netProfit, t.netProfitStandard - f.proration, "fark yalnızca açık gün etkisi");
  close(
    t.fixedFlow.reduce((a, l) => a + l.amount, 0),
    t.fixedTotal,
    "akış satırları toplamı",
  );
});

test("Gelir-gider düzeltmesi ve o aya özel satır ayrı ayrı görünür", () => {
  const elektrik = ds.fixedExpenses.find((f) => f.name === "Elektrik (ana fatura)")!;
  const m = withPnl([
    { month: "2026-09", rowKey: `fixed:${elektrik.id}`, amount: 18000 },
    { month: "2026-09", rowKey: "manual:dogalgaz", amount: 5000 },
  ]);
  const base = dashboard(model, "2026-09").theoretical!;
  const t = dashboard(m, "2026-09").theoretical!;
  const f = t.fixedBreakdown;
  close(f.overrides, 6000, "düzeltme farkı");
  close(f.manual, 5000, "o aya özel satır");
  close(f.extras, 11000, "bu aya özel giderler");
  close(t.netProfit, base.netProfit - 11000, "net kâr");
  close(t.netProfitStandard, base.netProfitStandard, "Excel temeli değişmez");
  assert.deepEqual(
    f.overrideRows.map((r) => [r.key, r.delta]),
    [[`fixed:${elektrik.id}`, 6000]],
  );
  assert.deepEqual(
    f.manualRows.map((r) => [r.key, r.amount]),
    [["manual:dogalgaz", 5000]],
  );
  const extras = t.fixedFlow.find((l) => l.key === "extras");
  assert.ok(extras, "bu aya özel giderler satırı");
  close(extras!.amount, 5000, "akışta yalnızca elle satırlar (düzeltme kendi grubunda)");
  assert.ok(t.fixedFlow.find((l) => l.key === "diger")!.overridden);
});

test("SU GİDERİ reçetelerde sayılınca sabit giderde ikinci kez sayılmaz", () => {
  const m = withPnl([{ month: "2026-09", rowKey: "manual:su", amount: 3000 }]);
  assert.ok(m.water.perLiter > 0, "su litre maliyeti hesaplandı");
  const b = dashboard(model, "2026-09").theoretical!;
  const a = dashboard(m, "2026-09").theoretical!;
  const dMaterial = a.material - b.material;
  assert.ok(dMaterial > 0);
  close(a.netProfit - b.netProfit, -dMaterial, "net kâr yalnızca malzeme artışı kadar düşer (Excel B13)");
  close(a.fixed.faturalar, b.fixed.faturalar, "Faturalar bölümü değişmez");
  close(a.fixedBreakdown.waterExcluded, 3000, "düşülen su faturası");
  assert.equal(a.fixedBreakdown.waterInRecipes, true);
  // Faturaya göre (Gelir-gider) hesapta su bir kez, gider olarak sayılır
  const pa = dashboard(m, "2026-09").actual;
  const pb = dashboard(model, "2026-09").actual;
  close(pa.faturalar - pb.faturalar, 3000, "Gelir-gider faturalar");
});

test("Su için elle birim maliyet varken de SU GİDERİ ikinci kez sayılmaz; 0 ₺/L ise sabit giderde kalır", () => {
  const ov = withPnl([{ month: "2026-09", rowKey: "manual:su", amount: 3000 }], { settings: { ...ds.settings, suBirimLTOverride: 10 } });
  const f = dashboard(ov, "2026-09").theoretical!.fixedBreakdown;
  close(f.waterExcluded, 3000, "elle birim maliyet");
  const zero = withPnl([{ month: "2026-09", rowKey: "manual:su", amount: 3000 }], { settings: { ...ds.settings, suBirimLTOverride: 0 } });
  const z = dashboard(zero, "2026-09").theoretical!.fixedBreakdown;
  assert.equal(z.waterInRecipes, false);
  assert.equal(z.waterExcluded, 0);
  close(z.manual, 3000, "reçetelerde su maliyeti yoksa fatura sabit gider sayılır");
});

test("Açık gün sayısı girilmemiş ayda standart sabit gider kullanılır", () => {
  const m = withMonth("2026-09", { openDays: null });
  const t = dashboard(m, "2026-09").theoretical!;
  assert.equal(t.fixedBreakdown.basis, "standard");
  close(t.fixedTotal, golden.fixedTotal, "standart toplam");
  close(t.netProfit, golden.panel.netProfit, "Excel B13");
});

// ---------------------------------------------------------------- Ay sonu tahmini

test("Ay sonu tahmini yalnızca devam eden ay için", () => {
  const today = "2026-10-20";
  const jul = dashboard(model, "2026-07", { today });
  assert.equal(jul.monthState, "closed");
  assert.equal(jul.forecast, null, "Temmuz bitti (23 açık gün olsa da)");
  const oct = dashboard(model, "2026-10", { today });
  assert.equal(oct.monthState, "running");
  assert.ok(oct.forecast);
  const sep = model.monthSales("2026-09");
  close(oct.forecast!.projectedProfit, (293909 / 16) * 31 * (sep.grossProfit / sep.revenue) - golden.fixedTotal, "Excel B19");
  assert.equal(dashboard(model, "2026-10", { today: "2026-11-02" }).forecast, null, "Kasım'da Ekim tamamlanmış sayılır");
  assert.equal(dashboard(model, "2026-10", { today: new Date("2026-10-31T21:30:00Z") }).forecast, null, "Türkiye saatiyle 1 Kasım");
  assert.equal(runningMonth(new Date("2026-10-31T20:30:00Z")), "2026-10");
  assert.equal(forecastMonthOf(model, { today }), "2026-10");
  assert.equal(forecastMonthOf(model, { today: "2026-07-15" }), "2026-07", "Temmuz sürerken Temmuz tahmin edilir");
});

test("Tarih verilmezse veri kümesinin ayı, o da yoksa en son veri ayı devam eden ay sayılır", () => {
  assert.equal(resolveCurrentMonth(model), "2026-10");
  assert.equal(dashboard(model, "2026-07").forecast, null);
  assert.ok(dashboard(model, "2026-10").forecast);
  const m = createModel({ ...ds, currentMonth: "2026-11" });
  assert.equal(resolveCurrentMonth(m), "2026-11");
  assert.equal(dashboard(m, "2026-10").forecast, null);
  assert.equal(dashboard(m, "2026-10").monthState, "closed");
});

// ---------------------------------------------------------------- Günlük ortalama ve kategoriler

test("Günlük ortalama rozeti iki ayda da POS cirosu ÷ açık gün ile karşılaştırır", () => {
  const oct = dashboard(model, "2026-10");
  const sep = dashboard(model, "2026-09");
  close(sep.dailyAvg, golden.panel.dailyAvg, "Excel B17 gösterimi değişmez");
  const c = dailyChange(oct, sep);
  assert.equal(c.basis, "pos");
  close(c.growth, 293909 / 16 / (429698 / 30) - 1, "aynı temelde değişim");
  // POS cirosu olmayan ayla liste temelli ay karşılaştırılmaz
  const noPos = withMonth("2026-08", { posRevenue: null });
  const aug = dashboard(noPos, "2026-08");
  assert.equal(dailyChange(dashboard(noPos, "2026-09"), aug).growth, null);
});

test("Kategori adetleri başka aydan geliyorsa ay belirtilir", () => {
  const jul = dashboard(model, "2026-07");
  assert.equal(jul.categoryMonth, "2026-09");
  assert.equal(jul.categoryMonthIsOther, true);
  const sep = dashboard(model, "2026-09");
  assert.equal(sep.categoryMonth, "2026-09");
  assert.equal(sep.categoryMonthIsOther, false);
});

// ---------------------------------------------------------------- Tutarlılık

test("Sayım sapması yalnızca alım miktarı girilmiş satırlarda; reçetesiz tüketim listelenir", () => {
  const m = createModel({
    ...ds,
    stockCounts: [
      { month: "2026-08", ingredientId: ingId("Espresso çekirdeği"), qty: 10 },
      { month: "2026-09", ingredientId: ingId("Espresso çekirdeği"), qty: 12.5 },
      { month: "2026-08", ingredientId: ingId("Plastik bardak 12oz"), qty: 500 },
      { month: "2026-09", ingredientId: ingId("Plastik bardak 12oz"), qty: 1500 },
      { month: "2026-08", ingredientId: ingId("Callei waffle sos sütlü"), qty: 4 },
      { month: "2026-09", ingredientId: ingId("Callei waffle sos sütlü"), qty: 2 },
    ],
  });
  const c = consistency(m, "2026-09");
  const row = (n: string) => c.rows.find((r) => r.ingredient.name === n);
  const esp = row("Espresso çekirdeği")!;
  assert.equal(esp.stock, "complete");
  close(esp.actualUsage, 10000 + esp.purchased! - 12500, "gerçek tüketim");
  const cup = row("Plastik bardak 12oz")!;
  assert.equal(cup.stock, "needsPurchase");
  assert.equal(cup.actualUsage, null, "alım girilmeden gerçek tüketim hesaplanmaz");
  assert.equal(cup.varianceAmount, null);
  assert.equal(cup.stockDrop, -1000);
  const waffle = row("Callei waffle sos sütlü");
  assert.ok(waffle, "iki ayı sayılan reçetesiz hammadde listede");
  assert.equal(waffle!.inRecipe, false);
  assert.equal(waffle!.stockDrop, 2000);
  assert.equal(c.unreciped.count, 1);
  close(c.unreciped.amount, 2000 * waffle!.unitCost, "reçetesiz tüketim tutarı");
  // Stat ve tablo altı aynı satırları toplar
  const visible = c.rows.filter((r) => r.purchased !== null).reduce((a, r) => a + (r.varianceAmount ?? 0), 0);
  close(c.totalVariance, visible, "toplam sapma = alımı girilmiş satırlar");
  close(c.totalVariance, esp.varianceAmount!, "yalnızca Espresso tamam");
  assert.equal(c.needsPurchaseCount, 2);
  assert.equal(c.hasStockComparison, true);
  // Excel'in Tutarlılık değerleri değişmez
  close(c.totalDiff, golden.consistency.totalDiff, "toplam fark");
});

// ---------------------------------------------------------------- Sayım KDV'si

test("Sayım: grup bazında KDV dahil tutar ve Excel grup oranından ayrılan malzeme", () => {
  const counts = ds.ingredients.filter((i) => i.countUnit && i.active).map((i) => ({ month: "2026-09", ingredientId: i.id, qty: 1 }));
  const m = createModel({ ...ds, stockCounts: counts });
  const v = stockVatSummary(m.stockSheet("2026-09"));
  const amb = v.groups.find((g) => g.name === "AMBALAJ MALZEMELERİ")!;
  assert.equal(amb.excelRate, 0.2);
  assert.deepEqual(
    amb.mismatches.map((x) => x.ingredient.name),
    ["Yenilebilir bardak"],
  );
  for (const g of v.groups) close(g.totalVatIncl - g.total, g.vat, `${g.name} KDV`);
  assert.ok(v.excelTotalVatIncl > v.totalVatIncl, "Excel grup oranı Yenilebilir bardakta daha yüksek");
  close(v.total, m.stockSheet("2026-09").total, "KDV hariç toplam aynı");
});

// ---------------------------------------------------------------- Faturalar

test("Ödenmemiş faturanın kalan borcu: kısmi ödemede kalan, yoksa Ödenecek", () => {
  const partial = { payable: 10000, unpaid: true, outstanding: 6000 };
  const plain = { payable: 11516.77, unpaid: true, outstanding: null };
  const zero = { payable: 500, unpaid: true, outstanding: 0 };
  const paid = { payable: 2000, unpaid: false, outstanding: 2000 };
  assert.equal(openBalance(partial), 6000);
  assert.equal(openBalance(plain), 11516.77);
  assert.equal(openBalance(zero), 500, "kalan 0 ama ödenmedi işaretli: hatırlatıcılarla aynı kural");
  assert.equal(openBalance(paid), 0);
  assert.equal(isPartiallyPaid(partial), true);
  assert.equal(isPartiallyPaid(plain), false);
  assert.deepEqual(unpaidSummary([partial, plain, paid]), { count: 2, total: 17516.77, payableTotal: 21516.77, partialCount: 1 });
});

test("Uyarılar: toplam satırı ürün gibi yüklenmişse kırmızı uyarı; ödenmemiş fatura kalan borçla", () => {
  const sep = ds.salesLines.filter((l) => l.month === "2026-09");
  const total = { ...sep[0], id: 999999, posName: "TOPLAM", qty: 2543, revenue: 441955, productId: null };
  const m = createModel({
    ...ds,
    salesLines: [...ds.salesLines, total],
    invoices: ds.invoices.map((i) => (i.unpaid ? { ...i, outstanding: 1000 } : i)),
  });
  const a = alerts(m, "2026-09");
  const t = a.find((x) => x.title === "Satış listesinde toplam satırı var");
  assert.ok(t, "toplam satırı uyarısı");
  assert.equal(t!.level, "danger");
  const unmatched = a.find((x) => x.title.endsWith("POS ürününün reçetesi yok"));
  assert.ok(!unmatched || !unmatched.detail.includes("TOPLAM"), "toplam satırı eşleşmeyenlerde sayılmaz");
  const inv = a.find((x) => x.title.includes("fatura ödenmemiş"));
  assert.ok(inv && /1\.000 ₺ kalan/.test(inv.detail), inv?.detail);
});

// ---------------------------------------------------------------- Varsayılan ay, kâr oranı ayı, su uyarısı

test("Varsayılan ay: bu aya kadarki son satış ayı; ileri tarihli deneme verisi varsayılan olmaz", () => {
  assert.equal(defaultMonthOf(["2026-07", "2026-08", "2026-09", "2031-02"], [], "2026-10"), "2026-09");
  assert.equal(defaultMonthOf(["2031-02"], [], "2026-10"), "2031-02", "başka satış ayı yoksa en son");
  assert.equal(defaultMonthOf([], ["2026-07", "2030-01"], "2026-10"), "2026-07", "satış yoksa ay bilgisi olan aylar, aynı kural");
  assert.equal(defaultMonthOf([], [], "2026-10"), "2026-10");
  const future: Dataset = {
    ...ds,
    currentMonth: "2026-10",
    months: [...ds.months, { month: "2031-02", openDays: 28, posRevenue: 1000, discounts: 0, offRevenue: 0, note: null }],
    salesLines: [...ds.salesLines, { id: 999999, month: "2031-02", posName: "TEST LATTE", qty: 1, revenue: 100, productId: null, isService: false, note: null }],
  };
  const m = createModel(future);
  assert.equal(latestSalesMonth(m), "2026-09");
  assert.equal(referenceSalesMonth(m, "2026-10"), "2026-09", "önceki satış ayı");
});

test("Kâr oranı ayı: önce önceki satış ayı, yoksa sonraki ilk ay (bu aydan sonrakiler en son)", () => {
  const extra = (month: string, id: number) => ({ id, month, posName: "TEST X", qty: 1, revenue: 100, productId: null, isService: false, note: null });
  const m = createModel({ ...ds, currentMonth: "2026-10", salesLines: [...ds.salesLines, extra("2030-01", 999998)] });
  // Tohum verisinde satış listesi yalnızca Eylül'de
  assert.equal(referenceSalesMonth(m, "2026-06"), "2026-09", "Haziran'dan sonraki ilk satış ayı, 2030 değil");
  const onlyFuture = createModel({ ...ds, currentMonth: "2026-10", salesLines: [extra("2030-01", 1)] });
  assert.equal(referenceSalesMonth(onlyFuture, "2026-06"), "2030-01", "başka satış ayı yoksa");
});

test("Su uyarısı: fatura girilmiş ama o ayın satış listesi yoksa 'SU GİDERİ girilmedi' denmez", () => {
  const withBill = createModel({ ...ds, pnlEntries: [...ds.pnlEntries, { month: "2026-10", rowKey: "manual:su", amount: 2500 }] });
  assert.equal(withBill.water.reason, "no-usage");
  const a = alerts(withBill, "2026-10").find((x) => x.title.startsWith("Su ve buz"));
  assert.ok(a, "su uyarısı var");
  assert.equal(a!.title, "Su ve buz maliyeti hesaplanamadı");
  assert.match(a!.detail, /Ekim 2026 su faturası girildi ama Ekim 2026 ürün satış listesi yok/);
  assert.ok(!a!.detail.includes("girilmediği için"), a!.detail);
  assert.equal(a!.href, "/panel/satislar?ay=2026-10");
  const none = alerts(model, "2026-09").find((x) => x.title.startsWith("Su ve buz"));
  if (model.water.reason === "no-bill" && none) assert.match(none.detail, /SU GİDERİ girilmediği için/);
});

// ---------------------------------------------------------------- Yıl şeridi, kategori ortalamaları, ürün durumu, uyarı listeleri

test("Yıl şeridi: POS cirosu girilmemiş ay (sayım devri, fatura) kâr/zarar sayılmaz, 'ciro girilmedi' diye işaretlenir", () => {
  // Ekim sayılır, Kasım'da satış yok: devreden stok Kasım'a devreder (satış yokken tahmini mal maliyeti 0); Kasım'a elle
  // bir gider yazılır, ciro yok
  const counts = ds.ingredients.filter((i) => i.active).map((i) => ({ month: "2026-10", ingredientId: i.id, qty: 1 }));
  const m = createModel({
    ...ds,
    currentMonth: "2026-11",
    stockCounts: [...ds.stockCounts, ...counts],
    pnlEntries: [...ds.pnlEntries, { month: "2026-11", rowKey: "manual:harici", amount: 2_500 }],
  });
  assert.equal(m.pnlMonth("2026-11").cogs, 0, "satış yokken stok devreder");
  assert.ok(m.pnlMonth("2026-11").expenses > 0, "Kasım'da gider var");
  const yt = yearTrend(m, 2026);
  const nov = yt.find((x) => x.month === "2026-11")!;
  assert.deepEqual({ active: nov.active, missingRevenue: nov.missingRevenue, profit: nov.profit }, { active: false, missingRevenue: true, profit: 0 });
  const dec = yt.find((x) => x.month === "2026-12")!;
  assert.deepEqual({ active: dec.active, missingRevenue: dec.missingRevenue }, { active: false, missingRevenue: false });
  // Cirosu girilmiş aylar aynen (Gelir-gider kârı)
  for (const x of yearTrend(model, 2026).filter((y) => y.active)) close(x.profit, model.pnlMonth(x.month).profit, x.month);
  assert.deepEqual(
    yearTrend(model, 2026).filter((x) => x.active).map((x) => x.month),
    ["2026-07", "2026-08", "2026-09", "2026-10"],
  );
});

test("Kategori ortalamaları ve en kârlı ürünler: reçetesiz ürün katılmaz (Bütün menü satırıyla aynı kural)", () => {
  const best = dashboard(model, "2026-09").bestProduct!.p;
  const id = best.product.id;
  const noRecipe = createModel({ ...ds, recipeItems: ds.recipeItems.filter((r) => r.productId !== id) });
  assert.equal(noRecipe.products.find((p) => p.product.id === id)!.status, "Reçete yok");
  // Reçetesiz ürünün ortalamaya etkisi, ürün hiç yokmuş gibi; ürün sayısı ve satış adedi aynı
  const inactive = createModel({ ...ds, products: ds.products.map((p) => (p.id === id ? { ...p, active: false } : p)) });
  const cat = (m: typeof model) => categoryStats(m, "2026-09").find((c) => c.categoryId === best.product.categoryId)!;
  const a = cat(noRecipe);
  const b = cat(inactive);
  close(a.avgMargin, b.avgMargin, "ort. marj");
  close(a.avgUnitProfit, b.avgUnitProfit, "ort. birim kâr");
  close(a.avgCostRatio, b.avgCostRatio, "ort. maliyet oranı");
  close(a.weightedMargin, b.weightedMargin, "satış ağırlıklı marj");
  assert.equal(a.count, cat(model).count);
  assert.equal(a.soldQty, cat(model).soldQty);
  // En kârlı / en az kârlı listelerinde yok, en çok satanlarda kalır
  const d = dashboard(noRecipe, "2026-09");
  assert.ok(!d.topProducts.some((x) => x.p.product.id === id));
  assert.ok(!d.weakest.some((x) => x.p.product.id === id));
  assert.notEqual(d.bestProduct?.p.product.id, id);
  assert.equal(
    d.bestSellers.some((x) => x.p.product.id === id),
    dashboard(model, "2026-09").bestSellers.some((x) => x.p.product.id === id),
  );
});

test("Reçeteli ürünün fiyatı 0: 'İyi' değil 'Düşük kâr' (zararına satış); fiyatlı ürünlerde durum değişmez", () => {
  const lines = [{ qty: 1, unitCost: 45, vatRate: 0.01, isPackaging: false }];
  const zero = priceProduct({ price: 0, fireOverride: null }, lines, ds.settings);
  assert.ok(zero.unitProfit < 0);
  assert.equal(zero.status, "Düşük kâr");
  assert.equal(priceProduct({ price: 0, fireOverride: null }, [], ds.settings).status, "Reçete yok");
  assert.equal(priceProduct({ price: 1000, fireOverride: null }, lines, ds.settings).status, "İyi");
  // Genel bakıştaki "Düşük kâr" sayısına girer
  const target = model.activeProducts.find((p) => p.status === "İyi")!;
  const m = createModel({ ...ds, products: ds.products.map((p) => (p.id === target.product.id ? { ...p, price: 0 } : p)) });
  assert.equal(dashboard(m, "2026-09").lowProfitCount, dashboard(model, "2026-09").lowProfitCount + 1);
});

test("Uyarı listeleri: kesilen adların kaçının kaldığı yazılır", () => {
  assert.equal(nameList(["A", "B"], 5, "ürün"), "A, B");
  assert.equal(nameList(["A", "B", "C", "D", "E"], 5, "ürün"), "A, B, C, D, E");
  assert.equal(nameList(["A", "B", "C", "D", "E", "F", "G", "H"], 5, "ürün"), "A, B, C, D, E ve 3 ürün daha");
  assert.equal(nameList(["A", "B", "C", "D", "E", "F"], 4, "hammadde"), "A, B, C, D ve 2 hammadde daha");
  // Reçetesi boş 7 ürün: ilk 5'i ve "ve 2 ürün daha"
  const ids = model.activeProducts.slice(0, 7).map((p) => p.product.id);
  const m = createModel({ ...ds, recipeItems: ds.recipeItems.filter((r) => !ids.includes(r.productId)) });
  const a = alerts(m, "2026-09").find((x) => x.title.includes("reçetesi boş"))!;
  assert.equal(a.title, "7 ürünün reçetesi boş");
  assert.match(a.detail, / ve 2 ürün daha$/);
  // Hiçbir reçetede olmayan hammaddeler: ilk 4'ü ve kalanı sayıyla
  const some = ds.ingredients.find((i) => i.active && i.priceSource !== "water")!;
  const extra = Array.from({ length: 5 }, (_, k) => ({ ...some, id: 900_000 + k, name: `Deneme hammadde ${k + 1}` }));
  const before = Number(alerts(model, "2026-09").find((x) => x.title.includes("hiçbir reçetede yok"))?.title.split(" ")[0] ?? 0);
  const unused = alerts(createModel({ ...ds, ingredients: [...ds.ingredients, ...extra] }), "2026-09").find((x) => x.title.includes("hiçbir reçetede yok"))!;
  assert.equal(unused.title, `${before + 5} hammadde hiçbir reçetede yok`);
  assert.ok(unused.detail.endsWith(` ve ${before + 1} hammadde daha. Hangi üründe kullanılıyorsa reçeteye ekleyin.`), unused.detail);
});
