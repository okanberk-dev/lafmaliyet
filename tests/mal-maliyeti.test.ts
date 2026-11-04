// Gelir-gider'in mal maliyeti: sayım aralığına dağıtım ve sayımsız ayın reçeteye göre tahmini (sahibin kararı, 4 Kasım
// 2026; engine.ts stockFlow / cogsConsumption). Excel verisi (Temmuz–Ekim faturaları, Eylül satış listesi) + Ekim'de
// sayım; Kasım süren ay, Eylül listesinin bir kısmı Kasım'a kopyalanır.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { COGS_METHOD_LABELS, createModel, uncountedCogsSummary, uncountedCogsText } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const excel: Dataset = excelToDataset(data);
const esp = excel.ingredients.find((i) => i.name === "Espresso çekirdeği")!;
const close = (a: number, b: number, msg: string, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Ekim'de sayım (100 KG espresso), Kasım süren ay; Kasım'a Eylül listesinin her satırının onda biri */
const sep = excel.salesLines.filter((l) => l.month === "2026-09");
const ds: Dataset = {
  ...excel,
  currentMonth: "2026-11",
  stockCounts: [{ month: "2026-10", ingredientId: esp.id, qty: 100, factor: 1000 }],
  salesLines: [...excel.salesLines, ...sep.map((l, i) => ({ ...l, id: 900_000 + i, month: "2026-11", qty: l.qty / 10, revenue: l.revenue / 10 }))],
};
const model = createModel(ds);
const JUL_OCT = ["2026-07", "2026-08", "2026-09", "2026-10"];

test("sayım aralığı: Temmuz–Ekim toplam mal maliyeti = açılış (0) + aralıktaki alınan − Ekim sayımı; tüketim oranında dağıtılır", () => {
  const pms = JUL_OCT.map((m) => model.pnlMonth(m));
  const count = model.closingStock("2026-10").value;
  assert.ok(count > 0, "Ekim sayımı");
  const total = sum(pms.map((p) => p.purchases)) - count;
  close(sum(pms.map((p) => p.cogs)), total, "Temmuz–Ekim toplamı korunur");
  // Dağıtım: her ayın payı tüketimi oranında (Excel'de yalnız Eylül'ün listesi var: öteki aylar ciroya göre)
  const w = JUL_OCT.map((m) => model.cogsConsumption(m).total);
  pms.forEach((p, i) => close(p.cogs, (total * w[i]) / sum(w), `${p.month} payı`, 0.05));
  // Devir zinciri: ara ayların kapanışı tahmini (açılış + alınan − dağıtılan), Ekim'in kapanışı sayım
  for (let i = 1; i < pms.length; i++) close(pms[i].opening, pms[i - 1].closing, `${pms[i].month} açılışı`);
  close(pms[3].closing, count, "Ekim kapanışı sayım");
  for (const p of pms) {
    assert.equal(p.cogsMethod, "dagitim", p.month);
    close(p.cogs, p.opening + p.purchases - p.closing, `${p.month} devir + alınan − devreden`);
  }
  // Tablo: yöntem ay sütununda (mal maliyeti hücresinin altında), açıklaması ipucunda
  const cell = model.pnlValue(pms[0], "total:cogs");
  assert.equal(cell.tag, COGS_METHOD_LABELS.dagitim);
  assert.match(cell.info!, /^Sayım aralığına dağıtıldı \(tahmini\): Temmuz 2026 – Ekim 2026 toplam mal maliyeti/);
  assert.equal(model.pnlValue(pms[0], "stock:closing").tag, "tahmini");
  assert.equal(model.pnlValue(pms[3], "stock:closing").tag, "sayım");
});

test("açık ay (Kasım): reçeteye göre tüketim, fire bir kez (× 1,05) + ödenmezler; açılış Ekim sayımı, tahmini kapanış", () => {
  const nov = model.pnlMonth("2026-11");
  const c = model.cogsConsumption("2026-11");
  assert.equal(nov.cogsMethod, "tahmin");
  close(nov.opening, model.closingStock("2026-10").value, "Kasım açılışı Ekim sayımı");
  // Satışlar'daki malzeme + ambalaj ürün fire payını içerir: fire hariç tüketim × (1 + %5)
  assert.ok(c.material > 0 && c.fireFree < c.material, "ürün fire payı çıkarıldı");
  close(c.recipe, c.fireFree * 1.05, "× (1 + genel fire)");
  close(nov.cogs, c.recipe + c.offCost, "Kasım tahmini mal maliyeti");
  // Bütün ürünler genel fireyle (%5) ve fire ambalaja da uygulanıyorsa tahmin malzeme + ambalaja eşit: fire iki kez sayılmaz
  const plain = createModel({ ...ds, settings: { ...ds.settings, fireExcludesPackaging: false }, products: ds.products.map((p) => ({ ...p, fireOverride: null })) });
  const pc = plain.cogsConsumption("2026-11");
  close(pc.recipe, pc.material, "fire bir kez", 0.05);
  close(nov.closing, nov.opening + nov.purchases - nov.cogs, "tahmini kapanış");
  assert.equal(model.pnlValue(nov, "total:cogs").tag, "reçeteye göre tahmini");
  assert.match(model.pnlValue(nov, "total:cogs").info!, /^Reçeteye göre tahmini: reçeteye göre tüketim \(fire hariç\)/);
});

test("ödenmezler ciroya girmez: yalnız mal maliyeti tahminine malzeme maliyeti olarak", () => {
  const off = createModel({ ...ds, months: ds.months.map((m) => (m.month === "2026-11" ? { ...m, offRevenue: 11_000 } : m)) });
  const withMonth = ds.months.some((m) => m.month === "2026-11")
    ? off
    : createModel({ ...ds, months: [...ds.months, { month: "2026-11", openDays: 3, posRevenue: 9_000, discounts: 0, offRevenue: 11_000, note: null }] });
  const base = ds.months.some((m) => m.month === "2026-11") ? model : createModel({ ...ds, months: [...ds.months, { month: "2026-11", openDays: 3, posRevenue: 9_000, discounts: 0, offRevenue: 0, note: null }] });
  const a = base.pnlMonth("2026-11");
  const b = withMonth.pnlMonth("2026-11");
  assert.equal(b.revenue, a.revenue, "ciro aynı");
  close(b.revenueTotalNet ?? 0, a.revenueTotalNet ?? 0, "KDV hariç ciro aynı");
  const ratio = withMonth.monthSales("2026-11").avgCostRatio;
  close(b.cogs - a.cogs, (11_000 / (1 + ds.settings.kdv)) * ratio, "ödenmez ÷ (1 + KDV) × maliyet oranı");
});

test("Kasım'ın sayımı girilince gerçek hesaba döner; ardışık sayımlı ayda eski sonuç aynen", () => {
  const counted = createModel({ ...ds, stockCounts: [...ds.stockCounts, { month: "2026-11", ingredientId: esp.id, qty: 80, factor: 1000 }] });
  const nov = counted.pnlMonth("2026-11");
  assert.equal(nov.cogsMethod, "sayim");
  close(nov.cogs, nov.opening + nov.purchases - counted.closingStock("2026-11").value, "Kasım: Ekim sayımı + alınan − Kasım sayımı");
  close(nov.cogs, nov.countOpening + nov.purchases - nov.countClosing, "eski kural");
  // Ekim de Eylül de sayılıysa Ekim eski hesapla
  const both = createModel({ ...ds, stockCounts: [...ds.stockCounts, { month: "2026-09", ingredientId: esp.id, qty: 50, factor: 1000 }] });
  const oct = both.pnlMonth("2026-10");
  assert.equal(oct.cogsMethod, "sayim");
  close(oct.cogs, both.closingStock("2026-09").value + oct.purchases - both.closingStock("2026-10").value, "Ekim eski sonuç");
  // Temmuz–Eylül aralığı Eylül sayımıyla kapanır
  close(sum(["2026-07", "2026-08", "2026-09"].map((m) => both.pnlMonth(m).cogs)), sum(["2026-07", "2026-08", "2026-09"].map((m) => both.pnlMonth(m).purchases)) - both.closingStock("2026-09").value, "Temmuz–Eylül");
});

test("hiç sayım yokken eski kural (Excel'den aktarılan veri): kapanış 0, yöntem yok; vergi her zaman yalnız sayımla", () => {
  const plain = createModel({ ...excel, currentMonth: "2026-11" });
  for (const m of JUL_OCT) {
    const p = plain.pnlMonth(m);
    assert.equal(p.cogsMethod, null, m);
    close(p.cogs, p.purchases, `${m}: alınanın tamamı`);
  }
  // Vergi hesabının girdisi sayımla (tahmini devir değil)
  for (const m of [...JUL_OCT, "2026-11"]) {
    const p = model.pnlMonth(m);
    close(p.countClosing, m === "2026-10" ? model.closingStock(m).value : 0, `${m} vergi kapanışı`);
  }
  assert.equal(uncountedCogsText(null), "kapanış stoğu 0 sayıldı, alınan malın tamamı maliyet");
  assert.equal(
    uncountedCogsSummary((m) => model.pnlMonth(m).cogsMethod, ["2026-07", "2026-08", "2026-11"]),
    "Temmuz 2026, Ağustos 2026: mal maliyeti sayım aralığına reçeteye göre tüketim oranında dağıtıldı (tahmini); Kasım 2026: mal maliyeti reçeteye göre tahmini; ay sonu sayımı girilince gerçek hesaba döner",
  );
});

test("elle yazılan devreden mal sayım gibi aralığı kapatır; gelecek ay eski kural", () => {
  const manual = createModel({ ...ds, pnlEntries: [...ds.pnlEntries, { month: "2026-08", rowKey: "stock:closing", amount: 40_000 }] });
  const aug = manual.pnlMonth("2026-08");
  close(aug.closing, 40_000, "Ağustos kapanışı elle");
  close(manual.pnlMonth("2026-07").cogs + aug.cogs, manual.pnlMonth("2026-07").purchases + aug.purchases - 40_000, "Temmuz–Ağustos aralığı");
  assert.equal(manual.pnlMonth("2026-09").opening, 40_000);
  assert.equal(model.pnlMonth("2026-12").cogsMethod, null, "Aralık başlamadı");
});
