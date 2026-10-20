// Ürünler sayfasındaki özet kartlarının dökümü (karta dokununca açılan pencere): menüdeki ürünler, hedefin
// dışındakiler, ayın satılan çeşitleri ve brüt kârı. Döküm her zaman kartın rakamını tutmalı.
// Çalıştırma: npx tsx --test tests/urunler-dokum.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { listLink, productBreakdowns, productLabel, type BreakdownProduct } from "../src/app/panel/urunler/breakdowns";
import { menuAverages } from "../src/app/panel/urunler/logic";
import { prepareBreakdown, type BreakdownGroup } from "../src/lib/breakdown";
import { createModel } from "../src/lib/calc/engine";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const data: ExcelData = JSON.parse(readFileSync(join(__dirname, "..", "src/server/db/seed/excel-data.json"), "utf8"));
const model = createModel({ ...excelToDataset(data), currentMonth: "2026-10" });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const inTotal = (gs: BreakdownGroup[]) => gs.filter((g) => !g.apart).flatMap((g) => g.rows);
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

/** Sayfadaki satırlar (page.tsx ile aynı alanlar) */
function pageRows(month: string): BreakdownProduct[] {
  const sold = model.soldByProduct(month);
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

const categories = model.categories.map((c) => ({ id: c.id, name: c.name }));
const month = model.salesMonths.at(-1)!;
const target = model.settings.hedefMaliyet;

test("Excel verisi: dört kartın dökümü kartın rakamını tutar", () => {
  const rows = pageRows(month);
  const active = rows.filter((r) => r.active);
  const soldRows = active.filter((r) => r.soldQty > 0);
  assert.ok(soldRows.length > 0, "Excel'in satış ayında eşleşen ürün olmalı");
  const bd = productBreakdowns(rows, categories, month, target);

  // Menüdeki ürün: kategori kategori adet, toplam menüdeki ürün; dökümdeki kategoriler kartın kategori sayısı
  assert.equal(sum(inTotal(bd.menu).map((r) => r.amount)), active.length);
  const shownCats = new Set([...bd.menu.find((g) => g.key === "menu")!.rows, ...bd.menu.find((g) => g.key === "bos")!.rows].map((r) => r.key.split(":")[1]));
  assert.equal(shownCats.size, model.categories.length);
  assert.equal(sum(bd.menu.find((g) => g.key === "pasif")!.rows.map((r) => r.amount)), rows.length - active.length);
  assert.equal(prepareBreakdown(bd.menu, { total: active.length }).base, active.length);

  // Hedefin dışında: Düşük kâr + Dikkat; diğer durumlar ayrı; hepsi menünün tamamı
  const count = (s: string) => active.filter((r) => r.status === s).length;
  const off = inTotal(bd.offTarget);
  assert.equal(sum(off.map((r) => r.amount)), count("Dikkat") + count("Düşük kâr"));
  assert.deepEqual(
    bd.offTarget.find((g) => g.key === "diger")!.rows.map((r) => r.amount),
    [count("İyi"), count("Reçete yok")],
  );
  const dikkat = bd.offTarget.find((g) => g.key === "dikkat")!.rows;
  assert.ok(dikkat.every((r) => r.tone === "warn" && r.href?.startsWith("/panel/urunler/")));
  const ratios = dikkat.map((r) => active.find((p) => `urun:${p.id}` === r.key)!.costRatio);
  assert.deepEqual(ratios, [...ratios].sort((a, b) => b - a), "en yüksek oran önce");
  // Menü ortalaması kartın alt satırıyla aynı
  const avg = menuAverages(active);
  const avgRow = bd.offTarget[0].rows.find((r) => r.key === "ort-oran")!;
  assert.equal(avgRow.display, `%${(avg.costRatio! * 100).toFixed(1).replace(".", ",")}`);

  // Satılan çeşit: bölümler çeşit sayısını, toplam satırı çeşit ve adedi verir
  assert.equal(sum(inTotal(bd.sold).map((r) => r.amount)), soldRows.length);
  const qty = sum(soldRows.map((r) => r.soldQty));
  assert.equal(bd.soldTotal, `${soldRows.length} çeşit · ${new Intl.NumberFormat("tr-TR").format(qty)} adet`);
  const unsold = bd.sold.find((g) => g.key === "satilmayan")!;
  assert.equal(unsold.rows.length, active.length - soldRows.length);
  assert.ok(unsold.apart);

  // Brüt kâr: ürün ürün birim kâr × adet, kartın rakamı
  const totalProfit = sum(soldRows.map((r) => r.monthProfit));
  close(sum(inTotal(bd.profit).map((r) => r.amount)), totalProfit);
  close(prepareBreakdown(bd.profit, { order: "given" }).base, totalProfit);
  const cats = bd.profit.filter((g) => !g.apart).map((g) => sum(g.rows.map((r) => r.amount)));
  assert.deepEqual(cats, [...cats].sort((a, b) => b - a), "kategoriler kârı büyükten küçüğe");
  assert.equal(bd.profitHasLoss, soldRows.some((r) => r.monthProfit < 0));
});

test("Bağlantılar listenin süzgeç adlarını kullanır, ay korunur", () => {
  const href = listLink("2026-09", { durum: "Düşük kâr" });
  const sp = new URL(href, "http://x").searchParams;
  assert.equal(sp.get("durum"), "Düşük kâr");
  assert.equal(sp.get("ay"), "2026-09");
  const bd = productBreakdowns(pageRows(month), categories, month, target);
  const first = bd.menu[0].rows[0];
  const q = new URL(first.href!, "http://x").searchParams;
  assert.equal(q.get("kategori"), first.key.split(":")[1]);
  assert.equal(q.get("ay"), month);
  assert.ok(bd.menu.find((g) => g.key === "pasif")!.rows.every((r) => new URL(r.href!, "http://x").searchParams.get("pasif") === "1"));
});

// ---------------------------------------------------------------- Uç durumlar

const p = (o: Partial<BreakdownProduct> & Pick<BreakdownProduct, "id" | "name">): BreakdownProduct => ({
  size: "M",
  categoryId: 1,
  category: "Kahveler",
  active: true,
  price: 100,
  net: 90,
  cost: 20,
  costRatio: 20 / 90,
  margin: 0.5,
  unitProfit: 45,
  status: "İyi",
  soldQty: 0,
  monthProfit: 0,
  monthNet: 0,
  ...o,
});

test("Fiyatsız ürün en üstte 'Fiyat yok'; pasif ama satılan ürün kartta sayılmaz, ayrı bölümde", () => {
  const rows = [
    p({ id: 1, name: "Latte", status: "Düşük kâr", costRatio: 0.6 }),
    p({ id: 2, name: "Mocha", status: "Düşük kâr", price: 0, net: 0, costRatio: 0 }),
    p({ id: 3, name: "Americano", status: "Dikkat", costRatio: 0.35, soldQty: 10, monthProfit: 450, monthNet: 900 }),
    p({ id: 4, name: "Eski", active: false, soldQty: 5, monthProfit: -20, monthNet: 450, unitProfit: -4 }),
    p({ id: 5, name: "Cheesecake", size: "Tek", categoryId: 2, category: "Tatlılar", soldQty: 2, monthProfit: -30, monthNet: 160, unitProfit: -15 }),
  ];
  const cats = [
    { id: 1, name: "Kahveler" },
    { id: 2, name: "Tatlılar" },
    { id: 3, name: "Boş" },
  ];
  const bd = productBreakdowns(rows, cats, "2026-09", 0.3);
  const low = bd.offTarget.find((g) => g.key === "dusuk")!.rows;
  assert.deepEqual(low.map((r) => r.display), ["Fiyat yok", "%60,0"]);
  assert.equal(productLabel(rows[4]), "Cheesecake");
  assert.equal(productLabel(rows[0]), "Latte · Medium");

  // Pasif ürün: menüde ve kârda toplama girmez
  assert.equal(sum(inTotal(bd.menu).map((r) => r.amount)), 4);
  assert.deepEqual(bd.menu.find((g) => g.key === "bos")!.rows.map((r) => r.display), ["Ürün yok"]);
  assert.equal(sum(inTotal(bd.sold).map((r) => r.amount)), 2);
  assert.equal(bd.sold.find((g) => g.key === "pasif")!.rows.length, 1);
  close(sum(inTotal(bd.profit).map((r) => r.amount)), 420);
  assert.ok(bd.profitHasLoss, "zararına satılan ürün varken pay sütunu kapanır");
  // Zarardaki kategori sonda
  assert.deepEqual(bd.profit.filter((g) => !g.apart).map((g) => g.label), ["Kahveler", "Tatlılar"]);
});

test("Satış olmayan ayda satılan çeşit ve brüt kâr dökümü boş", () => {
  const bd = productBreakdowns([p({ id: 1, name: "Latte" })], [{ id: 1, name: "Kahveler" }], "2030-01", 0.3);
  assert.deepEqual(bd.sold, []);
  assert.deepEqual(bd.profit, []);
  assert.equal(bd.soldTotal, "0 çeşit · 0 adet");
});
