// Genel bakış özet kartlarının dökümü (karta dokununca açılan pencere): her döküm kartın rakamını, aynı ay ve aynı
// hesapla tutar. Excel verisi (bugün = Ekim 2026): Eylül satış raporlu bitmiş ay, Ağustos raporsuz bitmiş ay, Ekim süren ay.
// Çalıştırma: npx tsx --test tests/genel-bakis-dokum.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  actualProfitBreakdown,
  breakEvenBreakdown,
  dailyAvgBreakdown,
  forecastBreakdown,
  grossProfitBreakdown,
  netProfitBreakdown,
  netSalesBreakdown,
  posRevenueBreakdown,
  withComparison,
  type CardBreakdown,
} from "../src/app/panel/dashboard-breakdowns";
import { prepareBreakdown, type BreakdownGroup } from "../src/lib/breakdown";
import { createModel } from "../src/lib/calc/engine";
import { dashboard } from "../src/lib/calc/insights";
import type { Dataset } from "../src/lib/calc/types";
import { tl } from "../src/lib/format";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const model = createModel(ds);

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const groupSum = (g: BreakdownGroup) => sum(g.rows.map((r) => r.amount));
const mainSum = (b: CardBreakdown) => sum(b.groups.filter((g) => !g.apart).map(groupSum));
const group = (b: CardBreakdown, key: string) => {
  const g = b.groups.find((x) => x.key === key);
  assert.ok(g, `${key} bölümü yok`);
  return g;
};
const close = (a: number | null | undefined, b: number | null | undefined, eps = 1e-6) => assert.ok(Math.abs((a ?? NaN) - (b ?? NaN)) < eps, `${a} ≠ ${b}`);

// ---------------------------------------------------------------- Satış raporlu ay (Eylül)

test("Net satış: kategori kategori ürün ürün, toplam kartın rakamı; eşleşmeyenler ve hizmetler ayrı bölüm", () => {
  const d = dashboard(model, "2026-09");
  const t = d.theoretical!;
  const b = netSalesBreakdown(model, d);
  close(mainSum(b), t.netSales);
  assert.equal(b.total, t.netSales);
  assert.equal(b.title, "Eylül 2026 net satış");
  // Kategori bölümleri + eşleşmeyen + hizmet; her satır listede bir kez
  const keys = b.groups.map((g) => g.key);
  assert.ok(keys.includes("eslesmeyen") && keys.includes("hizmet"));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(sum(b.groups.map((g) => g.rows.length)) <= d.sales.lines.length, true, "aynı ürünün POS satırları birleşir");
  const espresso = b.groups.find((g) => g.label === "Espresso Bazlı")!;
  const row = espresso.rows[0];
  assert.match(row.href!, /^\/panel\/urunler\/\d+\?ay=2026-09$/);
  assert.match(row.sub!, / adet$/);
  assert.equal(group(b, "eslesmeyen").rows[0].href, "/panel/satislar?ay=2026-09&durum=eslesmeyen#satirlar");
  close(groupSum(group(b, "eslesmeyen")), sum(d.sales.unmatched.map((l) => l.net)));
  close(groupSum(group(b, "hizmet")), sum(d.sales.services.map((l) => l.net)));
  // Pencerenin toplam satırı kartın rakamı
  assert.equal(prepareBreakdown(b.groups, { total: b.total }).total, t.netSales);
});

test("Brüt kâr: net satış − malzeme − komisyon; kategori dökümü toplama girmeden aynı kârı verir", () => {
  const d = dashboard(model, "2026-09");
  const t = d.theoretical!;
  const b = grossProfitBreakdown(model, d);
  close(mainSum(b), t.grossProfit);
  assert.deepEqual(
    group(b, "hesap").rows.map((r) => [r.key, r.amount]),
    [
      ["net", t.netSales],
      ["malzeme", -t.material],
      ["komisyon", -t.commission],
    ],
  );
  const cats = group(b, "kategori");
  assert.equal(cats.apart, true);
  close(groupSum(cats), t.grossProfit);
  assert.deepEqual(
    cats.rows.map((r) => r.amount),
    [...cats.rows.map((r) => r.amount)].sort((a, c) => c - a),
    "büyük kâr önce",
  );
  assert.equal(b.order, "given");
  assert.equal(b.shares, false);
});

test("Net kâr: brüt kâr − indirim − sabit giderler bölüm bölüm; her bölüm 'Para nereye gitti?' tutarını tutar", () => {
  const d = dashboard(model, "2026-09");
  const t = d.theoretical!;
  const b = netProfitBreakdown(model, d);
  close(mainSum(b), t.netProfit);
  assert.equal(b.total, t.netProfit);
  close(groupSum(group(b, "brut")), t.grossProfit);
  close(groupSum(group(b, "indirim")), -t.discountsNet);
  for (const fl of t.fixedFlow) close(groupSum(group(b, `sabit:${fl.key}`)), -fl.amount);
  // Kalemler girildikleri sayfaya gider
  const personel = group(b, "sabit:personel").rows;
  assert.ok(personel.some((r) => r.key === "personnel:net" && r.href === "/panel/personel"));
  assert.ok(group(b, "sabit:kira").rows.every((r) => r.href === "/panel/giderler"));
  // Kartın alt satırı: Excel temeli yalnızca farklıysa, faturaya göre sonuç Gelir-gider'e bağlı
  const cmp = group(b, "karsilastirma");
  assert.equal(cmp.apart, true);
  assert.deepEqual(cmp.rows.map((r) => r.key), ["fatura"], "tam ayda Excel temeli aynı");
  assert.equal(cmp.rows[0].display, tl(d.actual.profit));
  assert.equal(cmp.rows[0].href, "/panel/gelir-gider?yil=2026&ay=2026-09");
});

test("Net kâr: eksik açık günde Excel temeli de görünür, açık gün etkisi kalemin altında yazar", () => {
  const m = createModel({ ...ds, months: ds.months.map((x) => (x.month === "2026-09" ? { ...x, openDays: 24 } : x)) });
  const d = dashboard(m, "2026-09");
  const t = d.theoretical!;
  const b = netProfitBreakdown(m, d);
  close(mainSum(b), t.netProfit);
  for (const fl of t.fixedFlow) close(groupSum(group(b, `sabit:${fl.key}`)), -fl.amount);
  const cmp = group(b, "karsilastirma");
  assert.deepEqual(cmp.rows.map((r) => r.key), ["excel", "fatura"]);
  assert.equal(cmp.rows[0].display, tl(t.netProfitStandard));
  assert.ok(group(b, "sabit:personel").rows.some((r) => r.sub?.includes("24 / 30 gün açık")));
});

// ---------------------------------------------------------------- Satış raporsuz ay

test("POS cirosu (Ağustos): KDV hariç ciro + KDV = kartın rakamı; ay bilgileri toplama girmez", () => {
  const d = dashboard(model, "2026-08");
  const b = posRevenueBreakdown(model, d);
  close(mainSum(b), d.info!.posRevenue!);
  assert.equal(b.total, d.info!.posRevenue);
  const info = group(b, "bilgi");
  assert.equal(info.apart, true);
  assert.equal(info.rows.find((r) => r.key === "gun")?.display, "31 gün");
  // Ciro girilmemiş ay: döküm boş, ne yapılacağı yazar
  const empty = posRevenueBreakdown(model, dashboard(model, "2026-12"));
  assert.equal(empty.groups.length, 0);
  assert.match(empty.empty!, /POS cirosu girilmedi/);
});

test("Günlük ortalama (Ekim, süren ay): POS cirosu ve açık gün, toplam satırı kartın rakamı", () => {
  const d = dashboard(model, "2026-10");
  const b = dailyAvgBreakdown(d);
  assert.equal(b.totalDisplay, tl(d.dailyAvg));
  const rows = group(b, "hesap").rows;
  assert.deepEqual(rows.map((r) => r.display), [tl(293909), "16 gün"]);
  assert.equal(rows[1].label, "Açık gün (bugüne kadar)");
  close((d.info!.posRevenue as number) / d.info!.openDays!, d.dailyAvg);
  assert.equal(dailyAvgBreakdown(dashboard(model, "2026-12")).groups.length, 0, "açık gün yoksa döküm yok");
});

test("Kâr / zarar faturaya göre (Ağustos): Gelir-gider satırları bölüm bölüm kartın rakamını tutar", () => {
  const d = dashboard(model, "2026-08");
  const pm = model.pnlMonth("2026-08");
  const b = actualProfitBreakdown(model, d);
  close(mainSum(b), d.actual.profit);
  assert.equal(b.total, d.actual.profit);
  close(groupSum(group(b, "gelir")), pm.revenueNet!);
  close(groupSum(group(b, "cogs")), -pm.cogs);
  for (const k of ["personel", "faturalar", "kira", "genel", "komisyon"] as const) close(groupSum(group(b, k)), -pm.sections[k]);
  // Gelir önce, giderler büyükten küçüğe
  assert.equal(b.groups[0].key, "gelir");
  const costs = b.groups.slice(1).map(groupSum);
  assert.deepEqual(costs, [...costs].sort((a, c) => a - c));
  // Mal alışı tedarikçinin o ayki faturalarına gider
  const purchase = group(b, "cogs").rows.find((r) => r.key.startsWith("purchase:"));
  assert.ok(purchase?.href?.startsWith("/panel/faturalar?ay=2026-08&ara="));
  // Satır adları Gelir-gider tablosundaki gibi: tedarikçi girildiği gibi ("KALDİ" değil), diğerleri cümle düzeninde
  const label = (key: string) => b.groups.flatMap((g) => g.rows).find((r) => r.key === key)?.label;
  assert.equal(label("purchase:Kaldi"), "Kaldi");
  assert.equal(label("personnel:net"), "Personel maaş (net)");
  assert.equal(label("commission:pos"), "Banka POS komisyonu (%2,5)");
});

test("Ay sonu tahmini (Ekim): tahmini brüt kâr − standart sabit gider = kartın rakamı; ay başlamadıysa boş", () => {
  const d = dashboard(model, "2026-10");
  const fc = d.forecast!;
  const b = forecastBreakdown(d);
  close(mainSum(b), fc.projectedProfit);
  assert.equal(b.total, fc.projectedProfit);
  close(groupSum(group(b, "sabit")), -d.fixedStandardTotal);
  close(groupSum(group(b, "brut")), fc.projectedRevenue * d.grossRatio);
  assert.equal(group(b, "ciro").rows.find((r) => r.key === "gun")?.display, "16 / 31 gün");
  const future = forecastBreakdown(dashboard(model, "2026-11"));
  assert.equal(future.groups.length, 0);
  assert.equal(future.empty, "Ay başlamadı.");
});

test("Başabaş: sabit gider ÷ brüt kâr oranı ÷ açık gün; girdiler kartın bilgi notuyla aynı", () => {
  const d = dashboard(model, "2026-10");
  const b = breakEvenBreakdown(model, d);
  assert.equal(b.totalDisplay, tl(d.breakEvenDaily));
  close(groupSum(group(b, "sabit")), d.fixedStandardTotal);
  const hesap = group(b, "hesap").rows;
  assert.equal(hesap.find((r) => r.key === "aylik")?.display, tl(d.fixedStandardTotal / d.grossRatio));
  assert.equal(hesap.find((r) => r.key === "gun")?.display, `${model.settings.acikGun} gün`);
  close(d.fixedStandardTotal / d.grossRatio / model.settings.acikGun, d.breakEvenDaily);
  const tempo = group(b, "tempo");
  assert.equal(tempo.apart, true);
  // Ekim temposu başabaşın altında (18.369 ₺ / 19.165 ₺ ≈ %96): turuncu
  assert.equal(tempo.rows.find((r) => r.key === "ilerleme")?.tone, "warn");
});

// ---------------------------------------------------------------- Önceki ay ve sayfa

test("Önceki ayla karşılaştırma: rozet varsa toplamın altında, yoksa döküm aynen", () => {
  const d = dashboard(model, "2026-10");
  const b = posRevenueBreakdown(model, d);
  assert.equal(withComparison(b, { month: "2026-09", value: 429698, growth: null }), b);
  const c = withComparison(b, { month: "2026-09", value: 429698, growth: -0.316 });
  const g = c.groups.at(-1)!;
  assert.equal(g.apart, true);
  assert.deepEqual(g.rows.map((r) => r.display), [tl(429698), "-%31,6"]);
  assert.equal(g.rows[1].tone, "bad");
  assert.equal(mainSum(c), mainSum(b), "karşılaştırma toplama girmez");
});

test("Genel bakış: her özet kartı dökümüyle (StatBreakdown içinde)", () => {
  const src = readFileSync(join(root, "src/app/panel/page.tsx"), "utf8");
  const stats = src.match(/<Stat\s/g)?.length ?? 0;
  const wrapped = src.match(/<StatBreakdown\s/g)?.length ?? 0;
  assert.equal(stats, 8);
  assert.equal(wrapped, stats);
});
