// Satışlar özet kartlarının dökümü (karta dokununca açılan pencere): ciro, brüt kâr, satılan ürün ve eşleşmeyen
// ürün. Döküm her zaman kartın rakamını tutmalı (Excel Eylül 2026 satış raporu ve küçük örnek ay).
// Çalıştırma: npx tsx --test tests/satislar-dokum.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { salesBreakdowns, salesListHref, type SalesMonth } from "../src/app/panel/satislar/breakdowns";
import { prepareBreakdown, type BreakdownGroup } from "../src/lib/breakdown";
import type { SalesLineCalc } from "../src/lib/calc/engine";
import { createModel } from "../src/lib/calc/engine";
import { pct, tl } from "../src/lib/format";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const data: SeedData = JSON.parse(readFileSync(join(__dirname, "..", "tests/fixtures/baslangic/veri.json"), "utf8"));
const model = createModel(datasetFromSeed(data));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const inTotal = (gs: BreakdownGroup[]) => gs.filter((g) => !g.apart);
const groupsSum = (gs: BreakdownGroup[]) => sum(inTotal(gs).flatMap((g) => g.rows.map((r) => r.amount)));
const group = (gs: BreakdownGroup[], key: string) => {
  const g = gs.find((x) => x.key === key);
  assert.ok(g, `${key} bölümü yok`);
  return g;
};

// ---------------------------------------------------------------- Excel Eylül 2026

const SEP = "2026-09";
const sales = model.monthSales(SEP);
const b = salesBreakdowns(sales, model.settings, SEP);

test("Ciro dökümü kartın cirosunu tutar: kategori kategori ürün ürün, eşleşmeyen ve HİZMET ayrı bölümde", () => {
  assert.ok(sales.lines.length > 100, "Excel Eylül satış raporu yüklü");
  close(groupsSum(b.revenue), sales.revenue);
  close(prepareBreakdown(b.revenue, { total: sales.revenue }).base, sales.revenue);
  // Her reçeteli ürünün kategorisi bir bölüm; eşleşmeyen ve HİZMET satırları satır satır
  const cats = new Set(sales.lines.filter((l) => l.matched).map((l) => `kat:${l.product?.category?.name ?? ""}`));
  for (const c of cats) assert.ok(b.revenue.some((g) => g.key === c), `${c} bölümü`);
  assert.equal(group(b.revenue, "eslesmeyen").rows.length, sales.unmatched.length);
  assert.equal(group(b.revenue, "hizmet").rows.length, sales.services.length);
  close(sum(group(b.revenue, "hizmet").rows.map((r) => r.amount)), sum(sales.services.map((l) => l.line.revenue)));
  // Ürün kalemi tabloda açılır (eşleşen süzgeci + POS adı); eşleşmeyen kalem eşleşmeyen süzgeciyle
  const espresso = group(b.revenue, "kat:Espresso Bazlı");
  assert.ok(espresso.rows.every((r) => r.href?.startsWith(`/panel/satislar?ay=${SEP}&durum=eslesen&ara=`) && r.href.endsWith("#satirlar")));
  assert.ok(espresso.rows.every((r) => r.label.includes(" · ")), "menü adı · boy");
  const citir = group(b.revenue, "eslesmeyen").rows.find((r) => r.label === "ÇITIR LATTE");
  assert.equal(citir?.amount, 8000);
  assert.equal(citir?.href, `/panel/satislar?ay=${SEP}&durum=eslesmeyen&ara=%C3%87ITIR%20LATTE#satirlar`);
});

test("Ciro dökümünde KDV ve POS komisyonu toplama girmeyen bilgi bölümünde (kartın alt satırı)", () => {
  const g = group(b.revenue, "kdv-komisyon");
  assert.equal(g.apart, true);
  assert.equal(g.noSubtotal, true);
  const [net, kdv, commission] = g.rows;
  close(net.amount, sales.net);
  close(net.amount + kdv.amount, sales.revenue);
  close(commission.amount, sales.commission);
  // Eylül'de karaoke HİZMET satırları var: kendi oranıyla (Ayarlar › Hizmet satışı KDV)
  assert.equal(net.sub, "Ürünler ÷ (1 + %10 KDV), hizmet (karaoke) ÷ (1 + %20 KDV)");
  assert.equal(kdv.sub, "%10 ve %20 (hizmet), ciro − net ciro");
  assert.match(commission.sub ?? "", /kartlı satış %85,6 × komisyon %2,5/);
});

test("Satılan ürün dökümü kartın adedini tutar, ciro dökümüyle aynı bölümler", () => {
  close(groupsSum(b.qty), sales.qty);
  assert.deepEqual(
    b.qty.map((g) => g.key),
    inTotal(b.revenue).map((g) => g.key),
  );
  assert.equal(sum(b.qty.map((g) => g.rows.length)), sum(inTotal(b.revenue).map((g) => g.rows.length)));
});

test("Brüt kâr dökümü: net ciro − malzeme + ambalaj − komisyon = kart; malzeme bölümü karttaki maliyet", () => {
  close(groupsSum(b.grossProfit), sales.grossProfit);
  close(sum(group(b.grossProfit, "malzeme").rows.map((r) => r.amount)), -sales.cost);
  close(group(b.grossProfit, "malzeme").rows[0].amount, -sales.matchedCost);
  close(group(b.grossProfit, "gelir").rows[0].amount, sales.net);
  close(group(b.grossProfit, "komisyon").rows[0].amount, -sales.commission);
  // Kategori kategori kâr: toplama girmez, toplamı yine kartın kârı; büyükten küçüğe
  const cat = group(b.grossProfit, "kategori");
  assert.equal(cat.apart, true);
  close(sum(cat.rows.map((r) => r.amount)), sales.grossProfit);
  const amounts = cat.rows.map((r) => r.amount);
  assert.deepEqual(amounts, [...amounts].sort((x, y) => y - x));
  // Verilen sıra korunur: önce gelir, sonra giderler
  const p = prepareBreakdown(b.grossProfit, { total: sales.grossProfit, order: "given" });
  assert.deepEqual(p.groups.map((g) => g.key), ["gelir", "malzeme", "komisyon", "kategori"]);
});

test("Eşleşmeyen ürün dökümü: kalem sayısı kartın sayısı, ciroya göre; bütün kalemler ve maliyet tahmini ayrı", () => {
  const main = group(b.unmatched, "eslesmeyen");
  assert.equal(groupsSum(b.unmatched), sales.unmatched.length);
  assert.equal(main.rows.length, 13);
  assert.equal(main.rows[0].label, "ÇITIR LATTE", "en çok ciro getiren önce");
  assert.equal(main.rows[0].display, tl(8000));
  assert.equal(main.display, tl(sum(sales.unmatched.map((l) => l.line.revenue))));
  // Bütün POS kalemleri: eşleşen + HİZMET + eşleşmeyen = karttaki "N POS kalemi"
  const all = group(b.unmatched, "durum");
  assert.equal(sum(all.rows.map((r) => r.amount)), sales.lines.length);
  assert.equal(all.rows.find((r) => r.key === "service")?.amount, 2);
  assert.equal(all.rows.find((r) => r.key === "matched")?.href, salesListHref(SEP, "matched"));
  // Kartın çubuğu ve ortalama oranı aynı rakamla
  const est = group(b.unmatched, "tahmin");
  const assigned = sum(sales.lines.filter((l) => l.matched || l.line.isService).map((l) => l.line.revenue));
  assert.equal(est.rows.find((r) => r.key === "coverage")?.display, pct(assigned / sales.revenue, 0));
  assert.equal(est.rows.find((r) => r.key === "avg")?.display, pct(sales.avgCostRatio));
  assert.equal(est.rows.find((r) => r.key === "estimate")?.display, tl(sum(sales.unmatched.map((l) => l.cost))));
  // Bilgi satırları tutarı 0 olsa da pencerede kalır
  const p = prepareBreakdown(b.unmatched, { total: sales.unmatched.length, order: "given" });
  assert.equal(p.groups.find((g) => g.key === "tahmin")?.rows.length, 3);
  assert.equal(p.total, 13);
});

// ---------------------------------------------------------------- Küçük örnek ay

const product = (id: number, name: string, size: string, category: string | undefined) =>
  ({ product: { id, name, size }, category: category ? { name: category } : undefined }) as unknown as SalesLineCalc["product"];

let nextId = 1;
const line = (posName: string, qty: number, revenue: number, o: { product?: SalesLineCalc["product"]; service?: boolean; cost?: number; noRecipe?: boolean } = {}): SalesLineCalc => {
  const net = revenue / (o.service ? 1.2 : 1.1);
  const cost = o.cost ?? 0;
  const commission = revenue * 0.025 * 0.856;
  return {
    line: { id: nextId++, posName, qty, revenue, isService: !!o.service, productId: o.product ? 1 : null } as SalesLineCalc["line"],
    product: o.product,
    matched: !!o.product && !o.service,
    noRecipe: !!o.noRecipe,
    unitCost: null,
    net,
    cost,
    commission,
    grossProfit: net - cost - commission,
    margin: net ? (net - cost - commission) / net : 0,
  };
};

function monthOf(lines: SalesLineCalc[]): SalesMonth {
  const matched = lines.filter((l) => l.matched);
  const matchedNet = sum(matched.map((l) => l.net));
  const matchedCost = sum(matched.map((l) => l.cost));
  return {
    lines,
    qty: sum(lines.map((l) => l.line.qty)),
    revenue: sum(lines.map((l) => l.line.revenue)),
    net: sum(lines.map((l) => l.net)),
    cost: sum(lines.map((l) => l.cost)),
    commission: sum(lines.map((l) => l.commission)),
    grossProfit: sum(lines.map((l) => l.grossProfit)),
    matchedNet,
    matchedCost,
    avgCostRatio: matchedNet ? matchedCost / matchedNet : 0,
    serviceRevenue: sum(lines.filter((l) => l.line.isService).map((l) => l.line.revenue)),
  };
}

test("Aynı ürüne bağlı iki POS adı tek kalem; kategorisiz ürün ayrı bölüm; boş ayda döküm yok", () => {
  const latte = product(10, "Latte", "M", "Espresso Bazlı");
  const m = monthOf([
    line("LATTE MEDIUM", 10, 1100, { product: latte, cost: 300 }),
    line("Latte M", 5, 550, { product: latte, cost: 150 }),
    line("Kurabiye", 4, 400, { product: product(11, "Kurabiye", "Tek", undefined), cost: 100 }),
    line("Karaoke", 1, 500, { service: true }),
  ]);
  const r = salesBreakdowns(m, { kdv: 0.1, kdvHizmet: 0.2, komisyon: 0.025, kartOrani: 0.856 }, "2026-10");
  const esp = group(r.revenue, "kat:Espresso Bazlı");
  assert.equal(esp.rows.length, 1);
  assert.equal(esp.rows[0].label, "Latte · M");
  assert.equal(esp.rows[0].amount, 1650);
  assert.equal(esp.rows[0].sub, "15 adet · 2 POS kalemi");
  // İki POS adı varsa tabloda ürün adıyla aranır
  assert.equal(esp.rows[0].href, "/panel/satislar?ay=2026-10&durum=eslesen&ara=Latte#satirlar");
  assert.equal(group(r.revenue, "kat:").label, "Kategorisiz");
  assert.equal(group(r.revenue, "hizmet").rows[0].href, "/panel/satislar?ay=2026-10&durum=hizmet&ara=Karaoke#satirlar");
  close(groupsSum(r.revenue), 2550);
  assert.equal(groupsSum(r.qty), 20);
  close(groupsSum(r.grossProfit), m.grossProfit);
  // Eşleşmeyen yoksa ana bölüm boş kalır, toplam 0; bilgi bölümleri durur
  assert.equal(groupsSum(r.unmatched), 0);
  const p = prepareBreakdown(r.unmatched, { total: 0, order: "given" });
  assert.deepEqual(p.groups.map((g) => g.key), ["durum", "tahmin"]);
  assert.equal(group(r.unmatched, "tahmin").rows[0].display, "%100");

  const empty = salesBreakdowns(monthOf([]), { kdv: 0.1, kdvHizmet: 0.2, komisyon: 0.025, kartOrani: 0.856 }, "2026-10");
  assert.deepEqual(empty, { revenue: [], grossProfit: [], qty: [], unmatched: [] });
});
