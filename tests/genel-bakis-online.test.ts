// Genel bakış ve laffogato.net online satışı (docs/SITE-SATIS.md "Genel bakış"): reçeteye göre net satış, brüt kâr,
// "Para nereye gitti?" ve başlıktaki net kâr Gelir-gider'deki gibi ModPOS + online ile; başabaş online brüt kârı sabit
// giderden düşer, ay sonu tahmini online brüt kârını ekler; kategoriler, menü mühendisliği, en çok satanlar ve zam
// etkisi online adetleri sayar; ekstra shot gibi seçenekler panelin "Extra Shot" ürününe gider.
// Çalıştırma: npx tsx --test tests/genel-bakis-online.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import { categoryStats, dashboard, menuEngineering, onlineCoverFor, soldWithOnline } from "../src/lib/calc/insights";
import { priceLoss } from "../src/lib/calc/price-loss";
import type { Dataset } from "../src/lib/calc/types";
import { siteRevenue } from "../src/lib/site-sales/calc";
import type { SiteSalesLine, SiteSalesMonth } from "../src/lib/site-sales/schema";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };

function close(actual: number | null | undefined, expected: number, label: string, eps = 1e-6) {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < eps, `${label}: beklenen ${expected}, bulunan ${actual}`);
}

const none = { orders: 0, grossMinor: 0, discountMinor: 0, deliveryMinor: 0, refundedMinor: 0, netMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 };

/** Bir ayın online satışı: kafe 55.000 ₺ (KDV 5.000), mağaza 6.000 ₺ (600 ₺ kargo dahil), karaoke 12.000 ₺ (KDV 2.000) */
function siteMonth(month: string, lines: SiteSalesLine[], closed = true): SiteSalesMonth {
  return {
    month,
    pulledAt: `${month}-28T06:00:00.000Z`,
    now: `${month}-28T06:00:00.000Z`,
    from: `${month}-01`,
    to: `${month}-30`,
    closed,
    cafe: { ...none, orders: 120, grossMinor: 5_500_000, netMinor: 5_500_000, kdvMinor: 500_000, lines },
    shop: { ...none, orders: 4, grossMinor: 600_000, deliveryMinor: 60_000, netMinor: 600_000, kdvMinor: 60_000 },
    karaoke: { bookings: 6, collectedMinor: 1_200_000, refundedMinor: 0, netMinor: 1_200_000, refundPendingMinor: 0, kdvMinor: 200_000, unknownKdvNetMinor: 0 },
    manual: { orders: 0, grossMinor: 0, netMinor: 0 },
  };
}

const latte = base.products.find((p) => p.name === "Latte" && p.size === "M")!;
const extraShot = base.products.find((p) => p.name === "Extra Shot")!;
const altMilk = base.products.find((p) => p.name === "Alternatif Süt")!;

/** Latte M siteye bağlı; Eylül'ün online satışı çekilmiş (100 Latte, 30 ekstra shot, bağlı olmayan 10 içecek) */
function withOnline(over: { closed?: boolean; month?: string; extraShots?: number } = {}): Dataset {
  const month = over.month ?? "2026-09";
  const lines: SiteSalesLine[] = [
    { menuItemId: "mnu-0003", size: "M", name: "Latte", qty: 100, listMinor: 2_000_000, extraShots: over.extraShots ?? 30, milks: { normal: 60, oat: 25 } },
    { menuItemId: "mnu-0099", size: "M", name: "Yeni İçecek", qty: 10, listMinor: 220_000 },
  ];
  return {
    ...base,
    products: base.products.map((p) => (p.id === latte.id ? { ...p, siteMenuId: "mnu-0003", siteMenuSlot: "M" as const } : p)),
    siteSales: [siteMonth(month, lines, over.closed ?? true)],
  };
}

test("Genel bakış: net satış, malzeme, brüt kâr ve başlıktaki net kâr online satışı içerir (Gelir-gider'deki gibi)", () => {
  const plain = createModel(base);
  const model = createModel(withOnline());
  const st = model.settings;
  const p = dashboard(plain, "2026-09").theoretical!;
  const t = dashboard(model, "2026-09").theoretical!;
  const o = model.onlineMonth("2026-09")!;
  const r = siteRevenue(model.ds.siteSales![0], st.kdv, st.kdvHizmet);
  close(o.revenue.total, r.total, "online gelir = Gelir-gider'deki üç satır");
  close(model.pnlMonth("2026-09").site!.total, o.revenue.total, "kâr-zararla aynı");
  // Malzeme: 100 Latte, 30 ekstra shot ve 25 alternatif süt (normal süt sayılmaz) reçetesiyle; bağlı olmayan satır ve
  // mağaza (kargo hariç) ortalama oranla
  const costOf = (id: number) => model.products.find((x) => x.product.id === id)!.cost;
  close(o.mappedCost, 100 * costOf(latte.id) + 30 * costOf(extraShot.id) + 25 * costOf(altMilk.id), "reçeteli kısım");
  const shopGoods = r.shop - 600 / (1 + st.kdvHizmet);
  close(o.estimatedBase, 2_200 / (1 + st.kdv) + shopGoods, "tahmin dayanağı");
  close(o.avgCostRatio, model.monthSales("2026-09").avgCostRatio, "Eylül'ün ortalama maliyet oranı");
  close(o.material, o.mappedCost + o.estimatedBase * o.avgCostRatio, "online malzeme");
  // Teorik görünüm
  close(t.posNetSales, p.netSales, "ModPOS net satışı değişmez");
  close(t.netSales, p.netSales + o.revenue.total, "net satış");
  close(t.material, p.material + o.material, "malzeme");
  close(t.commission, p.commission, "POS komisyonu yalnız ModPOS'tan");
  close(t.grossProfit, p.grossProfit + o.grossProfit, "brüt kâr");
  close(t.netProfit, p.netProfit + o.grossProfit, "başlıktaki net kâr online brüt kârı kadar artar");
  close(t.netProfitStandard, p.netProfitStandard + o.grossProfit, "Excel temeli de");
  close(t.fixedTotal, p.fixedTotal, "sabit gider aynı");
  // Maliyet oranları kartta yazan tutarlarla: ModPOS + online
  const d = dashboard(model, "2026-09");
  close(d.recipeCostRatio, t.material / t.netSales, "reçeteye göre maliyet oranı");
  close(d.invoiceCostRatio, model.goodsPurchases("2026-09") / t.netSales, "faturaya göre maliyet oranı");
  assert.equal(t.online?.share, 1);
  // Çekilmemiş ay: eskisi gibi
  assert.equal(dashboard(model, "2026-08").theoretical, null);
  assert.equal(createModel(base).onlineMonth("2026-09"), null);
});

test("başabaş: kapanmış ayın online brüt kârı sabit giderden düşer; süren ayın yarım online satışı düşmez", () => {
  const plain = dashboard(createModel(base), "2026-09");
  const model = createModel(withOnline());
  const d = dashboard(model, "2026-09");
  const o = model.onlineMonth("2026-09")!;
  assert.deepEqual(d.onlineCover, { month: "2026-09", grossProfit: o.grossProfit });
  close(d.breakEvenDaily, (d.fixedStandardTotal - o.grossProfit) / d.grossRatio / model.settings.acikGun, "başabaş");
  assert.ok(d.breakEvenDaily! < plain.breakEvenDaily!);
  // Ay kapanmadı: online düşülmez (önceki kapanmış online ay yok)
  const open = createModel(withOnline({ closed: false }));
  assert.equal(onlineCoverFor(open, "2026-09"), null);
  close(dashboard(open, "2026-09").breakEvenDaily, plain.breakEvenDaily!, "eskisi gibi");
});

test("ay sonu tahmini: online satışın bugüne kadarki brüt kârı aynı tempoyla eklenir", () => {
  // Ekim süren ay (POS cirosu ve açık gün girilmiş, ay bitmedi); Ekim'in online satışı çekilmiş
  const months = base.months.map((m) => (m.month === "2026-10" ? { ...m, openDays: 16, posRevenue: 240_000 } : m));
  const plain = createModel({ ...base, months });
  const model = createModel({ ...withOnline({ month: "2026-10", closed: false }), months });
  const f0 = dashboard(plain, "2026-10", { currentMonth: "2026-10" }).forecast!;
  const f = dashboard(model, "2026-10", { currentMonth: "2026-10" }).forecast!;
  assert.equal(f0.projectedOnline, null);
  const o = model.onlineMonth("2026-10")!;
  close(f.projectedOnline, (o.grossProfit / 16) * 31, "online ay sonu");
  close(f.projectedProfit, f0.projectedProfit + f.projectedOnline!, "tahmini kâr");
  // Ekim'in satış listesi yok: online malzemenin tahmini Eylül'ün oranıyla
  close(o.avgCostRatio, model.monthSales("2026-09").avgCostRatio, "son satış ayının oranı");
});

test("kategoriler, menü mühendisliği, en çok satanlar ve zam etkisi online adetleri sayar", () => {
  const plain = createModel(base);
  const model = createModel(withOnline());
  const sold = soldWithOnline(model, "2026-09");
  assert.equal(sold.get(latte.id), (plain.soldByProduct("2026-09").get(latte.id) ?? 0) + 100);
  assert.equal(sold.get(extraShot.id), (plain.soldByProduct("2026-09").get(extraShot.id) ?? 0) + 30, "ekstra shot Extra Shot ürünü");
  const cat = (m: typeof model) => categoryStats(m, "2026-09").find((c) => c.categoryId === latte.categoryId)!;
  assert.equal(cat(model).soldQty, cat(plain).soldQty + 100);
  const me = (m: typeof model) => menuEngineering(m, "2026-09").items.find((i) => i.p.product.id === latte.id)!;
  assert.equal(me(model).qty, me(plain).qty + 100);
  const best = dashboard(model, "2026-09").bestSellers.find((x) => x.p.product.id === latte.id);
  assert.equal(best?.qty, sold.get(latte.id));
  // Zam etkisinin "brüt kârın %X'i" paydası online brüt kârı da içerir
  const loss = priceLoss(model, [], "2026-09");
  close(loss.grossProfit, model.monthSales("2026-09").grossProfit * loss.basis!.scale + model.onlineMonth("2026-09")!.grossProfit * loss.basis!.onlineScale, "zam etkisinin paydası");
});

test("seçenekler: ekstra shot Extra Shot ürününün reçetesiyle tüketime girer; normal süt sayılmaz, ürünü olmayan seçenek listelenir", () => {
  const model = createModel(withOnline());
  const options = model.siteLines("2026-09").options;
  assert.deepEqual(
    options.map((x) => [x.kind, x.qty, x.product?.id ?? null]),
    [
      ["extraShots", 30, extraShot.id],
      ["milks", 25, altMilk.id],
    ],
  );
  const noShots = createModel(withOnline({ extraShots: 0 }));
  const usage = model.onlineUsage("2026-09");
  const before = noShots.onlineUsage("2026-09");
  for (const it of model.itemsByProduct.get(extraShot.id) ?? []) {
    close((usage.get(it.ingredientId) ?? 0) - (before.get(it.ingredientId) ?? 0), model.evalQty(it).qty * 30, "ekstra shot tüketimi");
  }
  // Panelde ürünü olmayan seçenek: ürünsüz listelenir, tüketime girmez
  const noProduct = createModel({ ...withOnline(), products: withOnline().products.filter((p) => p.name !== "Extra Shot") });
  const shot = noProduct.siteLines("2026-09").options.find((x) => x.kind === "extraShots")!;
  assert.equal(shot.product, null);
  assert.ok(!noProduct.onlineSold("2026-09").has(extraShot.id));
});

test("ekranlar: Genel bakış, döküm, Excel ve Claude aracı online satırını gösterir; belge cümlesi doğru", () => {
  const page = read("src/app/panel/page.tsx");
  assert.match(page, /ModPOS \$\{tl\(t\.posNetSales\)\} \+ online \$\{tl\(t\.online\.revenue\)\}/);
  const breakdowns = read("src/app/panel/dashboard-breakdowns.ts");
  assert.match(breakdowns, /label: "Online satış \(laffogato\.net\)"/);
  assert.match(breakdowns, /label: "Online satışın brüt kârı"/);
  assert.match(read("src/app/api/export/workbook.ts"), /laffogato\.net online \(kafe, mağaza, karaoke\)/);
  assert.match(read("src/lib/mcp/answers/month.ts"), /onlineNetSatis/);
  assert.match(read("docs/SITE-SATIS.md"), /## Genel bakış/);
});
