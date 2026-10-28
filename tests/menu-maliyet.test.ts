// Menü maliyeti (denetim 26 Eki 2026, parti B13): reçetesi boş satılan ürün sıfır maliyet sayılmaz (E-47) ve su + buz
// litre maliyeti online siparişlerin suyunu da sayar (E-57). Excel verisi (Eylül 2026 satış listesi) üzerinde.
// Çalıştırma: npx tsx --test tests/menu-maliyet.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type ExcelJS from "exceljs";

import { waterSource } from "../src/app/panel/ayarlar/water-text";
import { impactData, impactModel } from "../src/app/panel/ayarlar/impact";
import { buildWorkbook, waterExplanation } from "../src/app/api/export/workbook";
import { monthTaskFacts, monthTasks } from "../src/app/panel/dashboard-tasks";
import { waterBreakdown } from "../src/app/panel/hammaddeler/breakdowns";
import { salesBreakdowns } from "../src/app/panel/satislar/breakdowns";
import { inMarginScale } from "../src/app/panel/satislar/sales-logic";
import { productBreakdowns, type BreakdownProduct } from "../src/app/panel/urunler/breakdowns";
import { NO_RECIPE_LAST_KEYS, soldProfit } from "../src/app/panel/urunler/logic";
import { createModel, type Model } from "../src/lib/calc/engine";
import { dashboard, menuEngineering, soldWithOnline } from "../src/lib/calc/insights";
import type { Dataset, Product, SalesLine } from "../src/lib/calc/types";
import { productProfitability } from "../src/lib/mcp/answers/products";
import { urunKarliligiInput } from "../src/lib/mcp/schemas";
import type { SiteSalesLine, SiteSalesMonth } from "../src/lib/site-sales/schema";
import { excelToDataset, investmentSeed, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const M = "2026-09";

function close(actual: number | null | undefined, expected: number, label: string, eps = 1e-6) {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < eps, `${label}: beklenen ${expected}, bulunan ${actual}`);
}

/** Eylül'de en çok malzeme maliyeti getiren üç ürün (denetimin senaryosu) */
const plain = createModel(base);
const top3 = (() => {
  const byProduct = new Map<number, number>();
  for (const l of plain.monthSales(M).lines) if (l.matched && l.product) byProduct.set(l.product.product.id, (byProduct.get(l.product.product.id) ?? 0) + l.cost);
  return [...byProduct].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
})();
const emptied = new Set(top3);

/** Üç ürünün reçetesi boşaltılmış veri */
const noRecipeDs: Dataset = { ...base, recipeItems: base.recipeItems.filter((r) => !emptied.has(r.productId)) };
/** Aynı satırlar hiçbir ürüne bağlanmamış veri (reçeteler yerinde) */
const unlinkedDs: Dataset = { ...base, salesLines: base.salesLines.map((l) => (l.month === M && l.productId !== null && emptied.has(l.productId) ? { ...l, productId: null } : l)) };

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

// ---------------------------------------------------------------- Yeni ürün: "Pumpkin Latte M", reçetesi henüz boş

const latte = base.products.find((p) => p.name === "Latte" && p.size === "M")!;
const PUMPKIN = 9001;
const pumpkin: Product = { ...latte, id: PUMPKIN, name: "Pumpkin Latte", size: "M", price: 220, siteMenuId: null, siteMenuSlot: null, sortOrder: 999 };
const pumpkinLine: SalesLine = { ...base.salesLines.find((l) => l.month === M)!, id: 990_001, posName: "PUMPKIN LATTE M", qty: 400, revenue: 88_000, productId: PUMPKIN, isService: false, note: null };
/** Eylül'de 400 Pumpkin Latte satılmış, reçetesi boş */
const withPumpkin = (ds: Dataset = base): Dataset => ({ ...ds, products: [...ds.products, pumpkin], salesLines: [...ds.salesLines, pumpkinLine] });

// ---------------------------------------------------------------- E-47: monthSales

test("E-47: reçetesi boşaltılan ürünün satışı, satır eşleşmemiş olsaydı nasıl maliyetlenecekse öyle maliyetlenir", () => {
  const a = createModel(noRecipeDs).monthSales(M);
  const b = createModel(unlinkedDs).monthSales(M);
  assert.equal(top3.length, 3);
  close(a.grossProfit, b.grossProfit, "brüt kâr eşleşmemiş satırlarınkiyle aynı", 1e-6);
  close(a.cost, b.cost, "malzeme maliyeti aynı");
  close(a.avgCostRatio, b.avgCostRatio, "ortalama oran reçetesiz satırlardan etkilenmez");
  close(a.matchedNet, b.matchedNet, "oranın dayanağı yalnız reçeteli satırlar");
  // Eski kural (sıfır maliyet) brüt kârı açıkça şişirirdi: düzeltilmiş kâr reçeteli hâlinden fazla değil, yakın
  const before = plain.monthSales(M);
  assert.ok(Math.abs(a.grossProfit - before.grossProfit) / before.grossProfit < 0.01, "reçeteli hâline ±%1 yakın");
  // Satır bağlı kalır (Satışlar'da "Eşleşmeyen" görünmez), maliyeti tahmini
  const lines = a.lines.filter((l) => l.line.productId !== null && emptied.has(l.line.productId));
  assert.ok(lines.length >= 3);
  for (const l of lines) {
    assert.equal(l.matched, true, `${l.line.posName} bağlı`);
    assert.equal(l.noRecipe, true);
    assert.equal(l.unitCost, null);
    close(l.cost, l.net * a.avgCostRatio, `${l.line.posName} net × ortalama oran`);
  }
  assert.deepEqual(
    a.noRecipe.map((l) => l.line.id).sort(),
    lines.map((l) => l.line.id).sort(),
  );
  assert.equal(a.unmatched.length, before.unmatched.length, "eşleşmeyen sayısı değişmez");
  // Reçeteli veri: hiçbir satır reçetesiz değil
  assert.equal(before.noRecipe.length, 0);
  assert.ok(before.lines.every((l) => !l.noRecipe));
});

test("E-47: Genel bakış'ın teorik brüt kârı ve Satışlar dökümü aynı kuralla", () => {
  const model = createModel(noRecipeDs);
  const t = dashboard(model, M).theoretical!;
  close(t.grossProfit, dashboard(createModel(unlinkedDs), M).theoretical!.grossProfit, "Genel bakış brüt kârı");
  const sales = model.monthSales(M);
  const b = salesBreakdowns(sales, model.settings, M, model.cardShareOf(M).rate);
  const material = b.grossProfit.find((g) => g.key === "malzeme")!;
  const row = (k: string) => material.rows.find((r) => r.key === k);
  close(row("no-recipe")?.amount, -sales.noRecipe.reduce((a, l) => a + l.cost, 0), "reçetesi boş satırın tahmini maliyeti");
  assert.match(row("no-recipe")!.sub ?? "", /3 POS kalemi|\d+ POS kalemi/);
  close(
    material.rows.reduce((a, r) => a + r.amount, 0),
    -sales.cost,
    "malzeme bölümü kartın maliyeti",
  );
  // Reçeteli veride satır yok
  const plainRows = salesBreakdowns(plain.monthSales(M), plain.settings, M).grossProfit.find((g) => g.key === "malzeme")!.rows;
  assert.equal(plainRows.some((r) => r.key === "no-recipe"), false);
  // Marj ölçeğine girmez
  assert.equal(inMarginScale({ matched: true, isService: false, net: 100, noRecipe: true }), false);
  assert.equal(inMarginScale({ matched: true, isService: false, net: 100, noRecipe: false }), true);
  assert.equal(inMarginScale({ matched: true, isService: false, net: 100 }), true);
});

// ---------------------------------------------------------------- E-47: online

test("E-47: online satılan reçetesiz ürün de ortalama oranla, satır bağlı olmasaydı nasılsa öyle", () => {
  const lines = (linked: boolean): SiteSalesLine[] => [
    { menuItemId: "mnu-0003", size: "M", name: "Latte", qty: 50, listMinor: 1_000_000 },
    { menuItemId: linked ? "mnu-0200" : "mnu-0999", size: "M", name: "Pumpkin Latte", qty: 40, listMinor: 880_000 },
  ];
  const ds = (linked: boolean): Dataset => {
    const d = withPumpkin();
    return {
      ...d,
      products: d.products.map((p) =>
        p.id === latte.id ? { ...p, siteMenuId: "mnu-0003", siteMenuSlot: "M" as const } : p.id === PUMPKIN ? { ...p, siteMenuId: "mnu-0200", siteMenuSlot: "M" as const } : p,
      ),
      siteSales: [siteMonth(M, lines(linked))],
    };
  };
  const linked = createModel(ds(true));
  const unlinked = createModel(ds(false));
  const o = linked.onlineMonth(M)!;
  const u = unlinked.onlineMonth(M)!;
  const kdv = linked.settings.kdv;
  assert.deepEqual(o.noRecipe.map((x) => ({ productId: x.productId, qty: x.qty })), [{ productId: PUMPKIN, qty: 40 }]);
  close(o.noRecipe[0].base, 8_800 / (1 + kdv), "dayanak satırın liste tutarı (KDV hariç)");
  close(o.mappedCost, 50 * linked.products.find((p) => p.product.id === latte.id)!.cost, "reçeteli kısım yalnız Latte");
  close(o.estimatedBase, u.estimatedBase, "tahmin dayanağı bağlı olmayan satırla aynı");
  close(o.material, u.material, "online malzeme aynı");
  close(o.grossProfit, u.grossProfit, "online brüt kâr aynı");
  assert.equal(o.mappedQty, 90, "eşlenen adet bağlı satırları sayar");
  assert.equal(dashboard(linked, M).theoretical!.online!.noRecipe, 1);
});

// ---------------------------------------------------------------- E-47: menü mühendisliği

test("E-47: menü mühendisliği reçetesiz ürünü sınıflamaz; Yıldız olmaz, eşiklere girmez", () => {
  const model = createModel(withPumpkin());
  const me = menuEngineering(model, M);
  assert.equal(me.items.some((i) => i.p.product.id === PUMPKIN), false, "gruplarda yok");
  assert.ok(me.items.every((i) => i.p.status !== "Reçete yok"));
  assert.deepEqual(me.noRecipe.map((x) => ({ id: x.p.product.id, qty: x.qty })), [{ id: PUMPKIN, qty: 400 }]);
  // Eşikler yalnız reçeteli ürünlerden: 400 adet totalQty'ye girmez, ortalama birim kâr ondan etkilenmez
  const sold = soldWithOnline(model, M);
  const reciped = model.activeProducts.filter((p) => p.status !== "Reçete yok");
  const totalQty = reciped.reduce((a, p) => a + (sold.get(p.product.id) ?? 0), 0);
  assert.equal(me.totalQty, totalQty);
  close(me.avgCm, reciped.reduce((a, p) => a + p.unitProfit * (sold.get(p.product.id) ?? 0), 0) / totalQty, "kâr eşiği");
  close(me.popThreshold, (1 / reciped.length) * 0.7, "popülerlik eşiği");
  const without = menuEngineering(createModel(base), M);
  close(me.avgCm, without.avgCm, "Pumpkin eklenince kâr eşiği değişmez");
  assert.deepEqual(
    me.items.map((i) => [i.p.product.id, i.cls]),
    without.items.map((i) => [i.p.product.id, i.cls]),
    "öteki ürünlerin sınıfı değişmez",
  );
  // Kategori içinde de
  const cat = menuEngineering(model, M, latte.categoryId);
  assert.equal(cat.items.some((i) => i.p.product.id === PUMPKIN), false);
  assert.equal(cat.noRecipe.length, 1);
  assert.equal(menuEngineering(model, M, latte.categoryId + 999).noRecipe.length, 0);
});

test("E-47: Claude'un ürün kârlılığı reçetesiz ürüne menü sınıfı vermez, adet sıralamasında gösterir", () => {
  const model = createModel(withPumpkin());
  const ctx = { base: "https://ladmin.laffogato.net" };
  const byQty = productProfitability(model, { ...urunKarliligiInput.parse({ siralama: "adet", limit: 5 }), ay: M }, ctx);
  const row = byQty.urunler.find((r) => r.ad === "Pumpkin Latte")!;
  assert.ok(row, "adet sıralamasında var");
  assert.equal(row.menuSinifi, null);
  assert.equal(row.durum, "Reçete yok");
  assert.ok(byQty.urunler.filter((r) => r.ad !== "Pumpkin Latte").every((r) => r.menuSinifi !== null), "ötekiler sınıflı");
  const byProfit = productProfitability(model, { ...urunKarliligiInput.parse({ limit: 50 }), ay: M }, ctx);
  assert.equal(byProfit.urunler.some((r) => r.ad === "Pumpkin Latte"), false, "kâr sıralamasında yok");
  assert.ok(byProfit.uyarilar.some((u) => /Reçetesi olmayan 1 ürün/.test(u)));
  assert.ok(byProfit.hesap.some((h) => /Reçetesi boş ürün sınıflanmaz/.test(h)));
});

// ---------------------------------------------------------------- E-47: Ürünler

/** Ürünler sayfasının satırı (page.tsx ile aynı alanlar) */
function rowsOf(model: Model): BreakdownProduct[] {
  const sold = soldWithOnline(model, M);
  return model.products.map((p) => {
    const qty = sold.get(p.product.id) ?? 0;
    return {
      id: p.product.id,
      name: p.product.name,
      size: p.product.size,
      categoryId: p.product.categoryId,
      category: p.category?.name ?? "—",
      active: p.product.active,
      price: p.price,
      net: p.net,
      cost: p.cost,
      costRatio: p.costRatio,
      margin: p.margin,
      unitProfit: p.unitProfit,
      status: p.status,
      soldQty: qty,
      monthProfit: p.unitProfit * qty,
      monthNet: p.net * qty,
    };
  });
}

test("E-47: Ürünler'in brüt kâr kartı ve dökümü reçetesiz ürünü kâra katmaz, ayrı gösterir", () => {
  const model = createModel(withPumpkin());
  const rows = rowsOf(model);
  const active = rows.filter((r) => r.active);
  const sp = soldProfit(active);
  const reference = soldProfit(rowsOf(createModel(base)).filter((r) => r.active));
  close(sp.profit, reference.profit, "kart Pumpkin'den önceki kârla aynı");
  close(sp.net, reference.net, "net satış da");
  assert.deepEqual(sp.noRecipe.map((r) => r.id), [PUMPKIN]);
  assert.equal(reference.noRecipe.length, 0);
  assert.ok(sp.counted.every((r) => r.status !== "Reçete yok" && r.soldQty > 0));

  const cats = model.categories.map((c) => ({ id: c.id, name: c.name }));
  const bd = productBreakdowns(rows, cats, M, model.settings.hedefMaliyet);
  const kar = bd.profit.filter((g) => g.key.startsWith("kat:")).flatMap((g) => g.rows);
  close(kar.reduce((a, r) => a + r.amount, 0), sp.profit, "kategoriler kartın kârını tutar");
  assert.equal(kar.some((r) => r.key === `urun:${PUMPKIN}`), false, "kategori satırlarında yok");
  const nr = bd.profit.find((g) => g.key === "recetesiz")!;
  assert.ok(nr.apart && nr.noSubtotal);
  assert.deepEqual(nr.rows.map((r) => [r.key, r.amount, r.display]), [[`urun:${PUMPKIN}`, 0, "400 adet"]]);
  assert.equal(nr.rows[0].href, `/panel/urunler/${PUMPKIN}?ay=${M}`);
  // Reçeteli veride bölüm boş (pencere boş bölümü göstermez)
  const plainBd = productBreakdowns(rowsOf(createModel(base)), cats, M, model.settings.hedefMaliyet);
  assert.equal(plainBd.profit.find((g) => g.key === "recetesiz")!.rows.length, 0);
  // Tablo: kârı ve oranı anlamsız sütunlarda sona kalır
  assert.deepEqual([...NO_RECIPE_LAST_KEYS], ["unitProfit", "monthProfit", "margin", "costRatio"]);
});

test("E-47: Excel'e aktar: reçetesiz ürünün aylık brüt kârı boş, satış satırı 'reçete boş' der", () => {
  const model = createModel(withPumpkin());
  const wb = buildWorkbook(model, M, { investments: data.investments.map(investmentSeed), findings: data.findings, now: new Date("2026-10-20T10:00:00Z") });
  const uk = wb.getWorksheet("Ürün Kârlılık")!;
  const header = uk.getRow(1);
  const col = (name: RegExp) => (header.values as unknown[]).findIndex((v) => typeof v === "string" && name.test(v));
  const mp = col(/brüt kâr$/);
  const qty = col(/satış adedi$/);
  assert.ok(mp > 0 && qty > 0);
  assert.match(String(header.getCell(mp).note ?? ""), /Reçetesi boş/);
  let pumpkinRow: ExcelJS.Row | null = null;
  let latteRow: ExcelJS.Row | null = null;
  uk.eachRow((r) => {
    if (r.getCell(2).value === "Pumpkin Latte") pumpkinRow = r;
    if (r.getCell(2).value === "Latte" && r.getCell(3).value === "M") latteRow = r;
  });
  assert.ok(pumpkinRow && latteRow);
  assert.equal((pumpkinRow as ExcelJS.Row).getCell(qty).value, 400);
  assert.equal((pumpkinRow as ExcelJS.Row).getCell(mp).value, null, "kârı boş");
  assert.equal(typeof (latteRow as ExcelJS.Row).getCell(mp).value, "number", "reçeteli üründe dolu");
  // Satış raporu sekmesi: satır eşleşti ama reçete boş, oran uygulandı
  let status = "";
  wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => {
    if (typeof c.value === "string" && c.value.startsWith("Eşleşti, reçete boş")) status = c.value;
  })));
  assert.match(status, /^Eşleşti, reçete boş – ortalama maliyet oranı \(%[\d,]+\) uygulandı$/);
});

// ---------------------------------------------------------------- E-47: Bu ayın işleri

test("E-47: Bu ayın işleri satılan reçetesiz ürünü söyler, 'hepsi eşleşti' demez", () => {
  // Eşleşmeyen satırlar kaldırılınca (hepsi bağlı) eskiden "hepsi reçeteyle eşleşti" denirdi
  const linkedOnly = (ds: Dataset): Dataset => ({ ...ds, salesLines: ds.salesLines.filter((l) => l.month !== M || l.productId !== null || l.isService) });
  const tasks = (ds: Dataset) => {
    const m = createModel(ds);
    const d = dashboard(m, M);
    return monthTasks(monthTaskFacts(m, M, d.monthState, d.refMonth, { payments: null, parasut: null }));
  };
  const done = tasks(linkedOnly(base)).find((t) => t.key === "satis")!;
  assert.equal(done.status, "done");
  assert.match(done.detail, /hepsi reçeteyle eşleşti/);

  const t = tasks(linkedOnly(withPumpkin())).find((x) => x.key === "satis")!;
  assert.equal(t.status, "todo");
  assert.match(t.detail, /1 satılan ürünün reçetesi boş \(Pumpkin Latte · M\): maliyetleri ortalama maliyet oranıyla tahmin ediliyor\. Reçetelerini girin\./);
  assert.doesNotMatch(t.detail, /hepsi/);
  assert.equal(t.href, "/panel/urunler?durum=Re%C3%A7ete+yok&ay=2026-09");
  assert.equal(t.action, "Reçete gir");

  // Eşleşmeyen satır da varsa eşleştirme önce, reçetesiz ürün ek cümle
  const both = tasks(withPumpkin()).find((x) => x.key === "satis")!;
  assert.equal(both.action, "Eşleştir");
  assert.match(both.detail, /Ayrıca 1 satılan ürünün reçetesi boş \(Pumpkin Latte · M\)\.$/);

  // Reçetesi var ama malzemesi fiyatsız (maliyet yine 0): "ya da malzemesi fiyatsız"
  const free = { ...base.ingredients[0], id: 9101, name: "Kabak püresi", packagePrice: 0, packageSize: 1000 };
  const unpriced: Dataset = {
    ...linkedOnly(withPumpkin()),
    ingredients: [...base.ingredients, free],
    recipeItems: [...base.recipeItems, { id: 990_101, productId: PUMPKIN, ingredientId: free.id, qty: 30, qtyExpr: null, note: null, sortOrder: 1 }],
  };
  const u = tasks(unpriced).find((x) => x.key === "satis")!;
  assert.match(u.detail, /1 satılan ürünün reçetesi boş ya da malzemesi fiyatsız \(Pumpkin Latte · M\)/);
  assert.match(u.detail, /Reçetelerini ve malzeme fiyatlarını girin\.$/);

  // Yalnız online satılan reçetesiz ürün de sayılır
  const onlineOnly: Dataset = {
    ...linkedOnly(base),
    products: [...base.products, { ...pumpkin, siteMenuId: "mnu-0200", siteMenuSlot: "M" }],
    siteSales: [siteMonth(M, [{ menuItemId: "mnu-0200", size: "M", name: "Pumpkin Latte", qty: 12, listMinor: 264_000 }])],
  };
  assert.match(tasks(onlineOnly).find((x) => x.key === "satis")!.detail, /1 satılan ürünün reçetesi boş \(Pumpkin Latte · M\)/);
});

// ---------------------------------------------------------------- E-57: su + buz

/** Eylül'e 3.000 ₺ SU GİDERİ; Americano M siteye bağlı ve online satılmış (180 ml su) */
const americano = base.products.find((p) => p.name === "Americano" && p.size === "M")!;
const waterIds = base.ingredients.filter((i) => i.priceSource === "water").map((i) => i.id);
const withBill = (ds: Dataset, month = M): Dataset => ({ ...ds, pnlEntries: [...ds.pnlEntries, { month, rowKey: "manual:su", amount: 3000 }] });
const withOnlineAmericano = (ds: Dataset, qty: number, month = M): Dataset => ({
  ...ds,
  products: ds.products.map((p) => (p.id === americano.id ? { ...p, siteMenuId: "mnu-0010", siteMenuSlot: "M" as const } : p)),
  siteSales: [siteMonth(month, [{ menuItemId: "mnu-0010", size: "M", name: "Americano", qty, listMinor: qty * 15_000 }])],
});
const litersOf = (u: ReadonlyMap<number, number>) => waterIds.reduce((a, id) => a + (u.get(id) ?? 0), 0) / 1000;

test("E-57: online satılan su kullanan ürün litreyi artırır, litre fiyatı orantılı düşer", () => {
  const before = createModel(withBill(base));
  const after = createModel(withOnlineAmericano(withBill(base), 100));
  const listLiters = litersOf(before.ingredientUsage(M));
  assert.equal(before.water.reason, "ok");
  close(before.water.liters, listLiters, "satış listesinin litresi");
  assert.equal(before.water.onlineLiters, 0);
  // 100 Americano × 180 ml su = 18 L
  close(after.water.onlineLiters, 18, "online litre", 1e-9);
  close(after.water.liters, listLiters + 18, "toplam litre");
  close(after.water.perLiter, 3000 / (listLiters + 18), "fatura ÷ (liste + online)");
  close(after.water.perLiter, before.water.perLiter * (listLiters / (listLiters + 18)), "orantılı düşüş");
  assert.ok(after.water.perLiter < before.water.perLiter);
  // Su kullanan ürünün maliyeti düşer, kullanmayanınki değişmez
  const cost = (m: Model, id: number) => m.products.find((p) => p.product.id === id)!.cost;
  assert.ok(cost(after, americano.id) < cost(before, americano.id));
  close(cost(after, latte.id), cost(before, latte.id), "suyu olmayan Latte aynı");
  // LafPOS'un satırları satış listesinin içinde (ingredientUsage): ayrıca eklenmez
  close(litersOf(after.ingredientUsage(M)) + litersOf(after.onlineUsage(M)), after.water.liters, "iki kaynak");
});

test("E-57: satış listesi olmayan ayın faturası yalnız online litreye bölünmez", () => {
  // Ekim'e fatura ve online satış var, Ekim'in satış listesi yok: litre fiyatı Eylül faturasından kalır
  const both = createModel(withOnlineAmericano(withBill(withBill(base), "2026-10"), 100, "2026-10"));
  assert.equal(both.water.month, M);
  assert.equal(both.water.latestBillMonth, "2026-10");
  assert.equal(both.water.onlineLiters, 0, "Eylül'ün online satışı yok");
  // Yalnız Ekim faturası: hesaplanamaz (eskisi gibi no-usage), 2.500 ₺ ÷ 18 L olmaz
  const only = createModel(withOnlineAmericano(withBill(base, "2026-10"), 100, "2026-10"));
  assert.equal(only.water.reason, "no-usage");
  assert.equal(only.water.perLiter, 0);
  assert.equal(only.water.onlineLiters, 0);
});

test("E-57: Hammaddeler dökümü, Ayarlar ve Excel online litreyi ayrı söyler; önizleme aynı litre fiyatını bulur", () => {
  const model = createModel(withOnlineAmericano(withBill(base), 100));
  const w = model.water;
  const d = waterBreakdown(w, model.ds.ingredients, model.ingredientUsage(M), model.onlineUsage(M));
  const liters = d.groups.find((g) => g.key === "litre")!;
  close(liters.rows.reduce((a, r) => a + r.amount, 0), w.liters, "satırlar toplam litreyi tutar");
  const su = liters.rows.find((r) => /Su$/.test(r.label))!;
  assert.match(su.sub ?? "", /^Satış listesi .+ L \+ laffogato\.net 18 L$/);
  assert.match(d.description, /laffogato\.net online siparişleri/);
  // Online yoksa eski alt yazı
  const plainW = createModel(withBill(base));
  const p = waterBreakdown(plainW.water, plainW.ds.ingredients, plainW.ingredientUsage(M), plainW.onlineUsage(M));
  assert.ok(p.groups.find((g) => g.key === "litre")!.rows.every((r) => r.sub === "Satış adedi × reçetedeki miktar"));

  assert.match(waterSource(w), /L su \+ buz \(18 L laffogato\.net dahil\)/);
  assert.doesNotMatch(waterSource(plainW.water), /laffogato/);
  assert.match(waterExplanation(w), /\(18 L laffogato\.net siparişlerinden\)\.$/);

  // Ayarlar önizlemesi: su ayının online satışı veride, litre fiyatı modelinkiyle aynı
  const data = impactData(model);
  assert.equal(data.siteSales?.length, 1);
  close(impactModel(data).water.perLiter, w.perLiter, "önizleme = model", 1e-12);
  assert.equal(impactData(createModel(base)).siteSales?.length, 0, "su ayı yoksa online veri gitmez");
});
