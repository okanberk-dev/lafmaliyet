// Şube seçiliyken işletme geneli kalan iki hesap (denetim 21 Kasım; docs/SUBE.md › Şube görünümünde maliyet):
// #4 su + buz litre fiyatı: SU GİDERİ işletmenin faturasıdır, bütün şubelerin ve laffogato.net'in litresine bölünür;
//    ürün ve reçete maliyeti seçili şubeye göre değişmez.
// #32 Ayarlar › Stok değerleme önizlemesi "Tümü"nün sayımlarıyla: ayar işletme genelinin kâr-zararını değiştirir.
// Veri: Excel'in Eylül verisi (calc.test.ts ile aynı tohum), satışlar iki şubeye bölünmüş.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { impactData, impactModel } from "../src/app/panel/ayarlar/impact";
import { waterBreakdown } from "../src/app/panel/hammaddeler/breakdowns";
import { createModel, type Model } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import type { SiteSalesLine, SiteSalesMonth } from "../src/lib/site-sales/schema";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const oku = (p: string) => readFileSync(join(root, p), "utf8");
const data: SeedData = JSON.parse(oku("tests/fixtures/baslangic/veri.json"));
const excel = datasetFromSeed(data);
const close = (a: number, b: number, msg: string, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

const M = "2026-09";
const none = { orders: 0, grossMinor: 0, discountMinor: 0, deliveryMinor: 0, refundedMinor: 0, netMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 };
function siteMonth(month: string, lines: SiteSalesLine[]): SiteSalesMonth {
  return {
    month,
    pulledAt: `${month}-28T06:00:00.000Z`,
    now: `${month}-28T06:00:00.000Z`,
    from: `${month}-01`,
    to: `${month}-30`,
    closed: true,
    cafe: { ...none, orders: 50, grossMinor: 1_500_000, netMinor: 1_500_000, kdvMinor: 136_364, lines },
    shop: { ...none },
    karaoke: { bookings: 0, collectedMinor: 0, refundedMinor: 0, netMinor: 0, refundPendingMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 },
    manual: { orders: 0, grossMinor: 0, netMinor: 0 },
  };
}

// "Tümü": Eylül'e 3.000 ₺ SU GİDERİ; Americano M siteye bağlı, 100 adet online satılmış (180 ml su = 18 L)
const americano = excel.products.find((p) => p.name === "Americano" && p.size === "M")!;
const tum: Dataset = {
  ...excel,
  currentMonth: "2026-10",
  wasteEntries: [],
  products: excel.products.map((p) => (p.id === americano.id ? { ...p, siteMenuId: "mnu-0010", siteMenuSlot: "M" as const } : p)),
  pnlEntries: [...excel.pnlEntries, { month: M, rowKey: "manual:su", amount: 3000, note: null }],
  siteSales: [siteMonth(M, [{ menuItemId: "mnu-0010", size: "M", name: "Americano", qty: 100, listMinor: 100 * 15_000 }])],
};

/**
 * Şube görünümü (veri yükleyicinin verdiği gibi): satış satırları şubenin payı kadar, online satış yok (fiziksel şube),
 * SU GİDERİ her şubede. `waterSales`: işletme genelinin satışı (dataset.ts companyWaterSales); verilmezse eski davranış
 */
function sube(id: string, name: string, share: number, company = true): Dataset {
  return {
    ...tum,
    branchView: { id, name, kind: "fiziksel" },
    salesLines: tum.salesLines.map((l) => ({ ...l, qty: l.qty * share, revenue: l.revenue * share })),
    siteSales: [],
    ...(company ? { waterSales: { salesLines: tum.salesLines.filter((l) => l.month === M), siteSales: tum.siteSales! } } : {}),
  };
}
const tumModel = createModel(tum);
const tuzla = createModel(sube("tuzla", "Tuzla", 2 / 3));
const marina = createModel(sube("marina", "Marina", 1 / 3));
const costs = (m: Model) => new Map(m.products.map((p) => [p.product.id, p.cost]));

test("#4: Tümü'de litre fiyatı faturanın bütün litreye (satış listesi + online) bölümü", () => {
  const w = tumModel.water;
  assert.equal(w.reason, "ok");
  assert.equal(w.month, M);
  close(w.onlineLiters, 18, "online litre");
  close(w.perLiter, 3000 / w.liters, "fatura ÷ litre");
  // Kurulumun sınaması: işletme geneli satış verilmeseydi Marina faturanın tamamını kendi litresine bölerdi (eski hata)
  const eski = createModel(sube("marina", "Marina", 1 / 3, false)).water;
  assert.equal(eski.onlineLiters, 0, "fiziksel şubede online satış yok");
  close(eski.perLiter, 3000 / ((w.liters - w.onlineLiters) / 3), "eski: fatura ÷ Marina'nın litresi", 1e-6);
  assert.ok(eski.perLiter > 3 * w.perLiter - 1e-9, "eski: litre fiyatı katlarca şişiyordu");
});

test("#4: şube seçiliyken litre fiyatı ve ürün maliyetleri Tümü'yle aynı", () => {
  for (const m of [tuzla, marina]) {
    const name = m.ds.branchView!.name;
    assert.deepEqual(m.water, tumModel.water, `${name}: su hesabı (ay, fatura, litre, online litre) işletme geneli`);
    const tc = costs(tumModel);
    for (const [id, cost] of costs(m)) close(cost, tc.get(id)!, `${name}: ürün ${id} maliyeti`);
    // Americano M (su) Tümü'yle aynı; önerilen fiyat ve durum da
    const a = m.products.find((p) => p.product.id === americano.id)!;
    const t = tumModel.products.find((p) => p.product.id === americano.id)!;
    close(a.suggestedPrice, t.suggestedPrice, `${name}: Americano önerilen fiyat`);
    assert.equal(a.status, t.status, `${name}: Americano durumu`);
  }
});

test("#4: şubelerin satış listesine göre malzeme maliyeti toplamı Tümü'nünkü; su faturası iki kez sayılmaz", () => {
  // Şube kâr-zararının mal maliyeti (yöntem "sube") bu maliyetten: cogsConsumption → monthSales.cost → ürün maliyeti
  const cost = (m: Model) => m.monthSales(M).cost;
  close(cost(tuzla) + cost(marina), cost(tumModel), "Tuzla + Marina = Tümü", 1e-6);
  close(tuzla.cogsConsumption(M).material, cost(tuzla), "şubenin mal tüketimi satış listesinden (online yok)", 1e-6);
  // Eski: her şube faturanın tamamını kendi litresine bölüyordu; iki şube birlikte suyu yaklaşık iki kez sayıyordu
  const eski = cost(createModel(sube("tuzla", "Tuzla", 2 / 3, false))) + cost(createModel(sube("marina", "Marina", 1 / 3, false)));
  // (fazlalık: iki fatura − Tümü'nün liste payı, ürün fire payıyla; bir faturadan çok)
  assert.ok(eski - cost(tumModel) > 3000, `eski fazlalık ${eski - cost(tumModel)}`);
  // Şubenin tüketimi kendi satışıyla kalır: litre fiyatı işletme geneli, harcanan su şubenin
  const su = tum.ingredients.find((i) => i.priceSource === "water" && /Su$/.test(i.name))!;
  close(marina.ingredientUsage(M).get(su.id)!, tumModel.ingredientUsage(M).get(su.id)! / 3, "Marina'nın harcadığı su");
});

test("#4: Hammaddeler dökümü kartla aynı litreyi gösterir (işletme genelinin satışı)", () => {
  const u = marina.waterUsage(M);
  const d = waterBreakdown(marina.water, marina.ds.ingredients, u.list, u.online);
  const litre = d.groups.find((g) => g.key === "litre")!;
  close(litre.rows.reduce((a, r) => a + r.amount, 0), marina.water.liters, "satırlar toplam litreyi tutar", 1e-6);
  assert.ok(litre.rows.some((r) => /laffogato\.net 18 L$/.test(r.sub ?? "")), "online litre de dökümde");
  // Tümü'de kendi satışı (eski yol): ingredientUsage / onlineUsage
  assert.equal(tumModel.waterUsage(M).list, tumModel.ingredientUsage(M));
  assert.equal(tumModel.waterUsage(M).online, tumModel.onlineUsage(M));
});

test("#4: elle girilen litre fiyatı önce gelir; Ayarlar önizlemesi şubede de işletme geneli litreyle hesaplar", () => {
  const elle = (ds: Dataset): Dataset => ({ ...ds, settings: { ...ds.settings, suBirimLTOverride: 0.5 } });
  const ov = createModel(elle(sube("marina", "Marina", 1 / 3)));
  assert.equal(ov.water.reason, "override");
  assert.equal(ov.water.perLiter, 0.5);

  // Önizleme verisi su ayının işletme geneli satışını taşır: litre fiyatı ve ürün maliyeti modelinkiyle aynı
  const slim = impactData(marina);
  assert.ok(slim.waterSales, "şubede işletme geneli satış gider");
  assert.deepEqual([...new Set(slim.waterSales!.salesLines.map((l) => l.month))], [M]);
  assert.equal(slim.waterSales!.siteSales.length, 1);
  const pre = impactModel(slim);
  close(pre.water.perLiter, tumModel.water.perLiter, "önizleme = Tümü");
  close(pre.products.find((p) => p.product.id === americano.id)!.cost, tumModel.products.find((p) => p.product.id === americano.id)!.cost, "Americano");
  // Elle fiyat kayıtlıyken önizlemede silinince de işletme geneli litre (satışı olan son fatura ayı)
  const ovSlim = impactData(ov);
  assert.deepEqual([...new Set(ovSlim.waterSales!.salesLines.map((l) => l.month))], [M]);
  close(impactModel(ovSlim, { ...ovSlim.settings, suBirimLTOverride: null }).water.perLiter, tumModel.water.perLiter, "elle fiyat silinince");
  // Tümü'de alan yok (veri kümesinin kendi satışı işletme geneli)
  assert.equal("waterSales" in impactData(tumModel), false);
});

test("#4 kaynak: yükleyici şube seçiliyken faturalı ayların satışını 'Tümü' kapsamında okur; döküm motorun litresini kullanır", () => {
  const d = oku("src/server/data/dataset.ts");
  assert.match(d, /const billMonths = new Set\(pnlEntries\.filter\(\(e\) => e\.rowKey === "manual:su" && e\.amount > 0\)/);
  assert.match(d, /branch && billMonths\.size\n\s+\? (?:\/\/[^\n]*\n\s+)?companyWaterSales\(db, \{ switchDays: allSwitchDays,/);
  // Su litresi "Tümü"nün satışıyla: geçiş günü görünümün şubesine göre kısılmaz (Marina seçiliyken Tuzla'nın AsilPOS'u da sayılır)
  assert.match(d, /\.\.\.\(waterSales \? \{ waterSales \} : \{\}\)/);
  const fn = d.slice(d.indexOf("async function companyWaterSales"));
  assert.match(fn, /return withBranchScope\(ALL_BRANCHES, async \(\) => \{/);
  // Bütün şubelerin satış satırları (şube süzgeci yok), AsilPOS'la aynı yoldan birleşir
  assert.match(fn, /db\.select\(\)\.from\(s\.salesLines\)\.where\(inArray\(s\.salesLines\.month, read\)\)/);
  assert.match(fn, /await mergeSales\(db, \{/);
  const engine = oku("src/lib/calc/engine.ts");
  assert.match(engine, /const usage = waterUsage\(m\);\n\s+const listLiters = waterLiters\(usage\.list\);/);
  assert.match(oku("src/app/panel/hammaddeler/page.tsx"), /model\.waterUsage\(model\.water\.month\)/);
});

test("#32 kaynak: Ayarlar › Stok değerleme önizlemesi şube seçiliyken Stok değeri alanının kipiyle (firma kipinde Tümü modeli)", () => {
  const p = oku("src/app/panel/ayarlar/page.tsx");
  // Şube ayrımı parça 5: firma kipinde "Tümü"nün modeli (#32), şube kipinde şubenin modeli (şubenin havuzu)
  assert.match(p, /const valuationScope = model\.ds\.branchView \? await areaScope\("stok_degeri"\) : ALL_BRANCHES;/);
  assert.match(p, /const company = model\.ds\.branchView && valuationScope === ALL_BRANCHES \? await loadModel\(\{ scope: valuationScope \}\) : model;/);
  assert.match(p, /fifoMonthOptions\(company\.countedMonths, company\.fifoStart, company\.ds\.currentMonth \?\? currentMonthTR\(\)\)/);
  assert.match(p, /start=\{company\.fifoStart\}/);
  assert.match(p, /rows=\{valuationRows\(company, fifoOptions\)\}/);
  assert.match(p, /openingOverrides=\{company\.ds\.pnlEntries\.filter\(\(e\) => e\.rowKey === "stock:opening"\)/);
  assert.doesNotMatch(p, /valuationRows\(model,/);
});

test("#32: şube modeli sayımı ve elle girilmiş devri görmez; önizleme bu yüzden Tümü'yle (motor)", () => {
  // Aynı ay iki şubede sayıldı, Eylül'ün kapanışı Gelir-giderde elle girildi (stock:* yalnız Tümü'de; branchPnlEntry)
  const esp = excel.ingredients.find((i) => i.name === "Espresso çekirdeği")!;
  const counts = [
    { month: M, ingredientId: esp.id, qty: 2, factor: 1000, branchId: "tuzla" },
    { month: M, ingredientId: esp.id, qty: 1, factor: 1000, branchId: "marina" },
  ];
  const stockClosing = { month: M, rowKey: "stock:closing", amount: 12_345, note: null };
  const all = createModel({ ...tum, stockCounts: counts, pnlEntries: [...tum.pnlEntries, stockClosing] });
  const mar = createModel({ ...sube("marina", "Marina", 1 / 3), stockCounts: counts.filter((c) => c.branchId === "marina") });
  assert.equal(all.closingStock(M).overridden, true, "Tümü elle girilmiş kapanışı görür");
  assert.equal(mar.closingStock(M).overridden, false, "şube görmez");
  assert.ok(all.valuationPreview(M).old > mar.valuationPreview(M).old, "şubenin stoğu kısmi");
});
