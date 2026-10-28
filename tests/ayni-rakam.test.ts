// Aynı rakam her yerde (denetim 26 Eki 2026, B15): Analiz senaryosu yarım listede Genel bakış'la aynı tabanı kullanır
// (E-12); aylık girişe çevrilen gider başabaşta, ay sonu tahmininde ve nakit planında kalır (E-13); başabaş tek
// yardımcıdan (E-59); kafe kapalı günler ay sonu öngörüsüne girmez (E-41).
// Çalıştırma: npx tsx --test tests/ayni-rakam.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { breakEvenNeeds, scenarioBreakEvenItems, scenarioFixedItems } from "../src/app/panel/analiz/breakdowns";
import { createModel } from "../src/lib/calc/engine";
import { applyScenario, breakEvenOf, dashboard, requiredDailyRevenue, scenarioBase } from "../src/lib/calc/insights";
import type { Dataset, ExpenseCategory, ExpenseEntry, SalesLine } from "../src/lib/calc/types";
import { resolveMonth, tillMonths, type TillRow } from "../src/lib/cash-month";
import { addDays } from "../src/lib/reminders";
import type { SiteSalesMonth } from "../src/lib/site-sales/schema";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const ZERO = { priceChangePct: 0, costChangePct: 0, volumeChangePct: 0, extraFixed: 0 };

function close(actual: number | null | undefined, expected: number | null | undefined, label: string, eps = 1e-6) {
  assert.ok(
    actual !== null && actual !== undefined && expected !== null && expected !== undefined && Math.abs(actual - expected) < eps,
    `${label}: beklenen ${expected}, bulunan ${actual}`,
  );
}

const cat = (p: Partial<ExpenseCategory> & Pick<ExpenseCategory, "id" | "name">): ExpenseCategory => ({
  section: "genel",
  panelGroup: "reklam",
  invoiceCategory: null,
  monthly: true,
  active: true,
  sortOrder: p.id,
  ...p,
});
const entry = (id: number, categoryId: number, date: string, amount: number): ExpenseEntry => ({ id, date, categoryId, amount, description: null, paymentMethod: null, note: null });

const influencer = base.fixedExpenses.find((f) => f.name === "Influencer")!;

/** Influencer sabit gideri Ekim'den aylık girişe çevrildi (convertFixedToMonthly): Eylül'de biter, Ekim'e 50.000 ₺ */
function converted(entries: ExpenseEntry[] = [entry(1, 1, "2026-10-01", 50_000)], over: Partial<ExpenseCategory> = {}): Dataset {
  return {
    ...base,
    fixedExpenses: base.fixedExpenses.map((f) => (f.id === influencer.id ? { ...f, endMonth: "2026-09", active: false } : f)),
    expenseCategories: [cat({ id: 1, name: "Influencer", ...over })],
    expenseEntries: entries,
  };
}

// ---------------------------------------------------------------- E-13: aylık girişe çevrilen gider

test("E-13: sabit gideri aynı tutarlı aylık girişe çevirmek başabaşı ve ay sonu tahminini değiştirmez", () => {
  const before = dashboard(createModel(base), "2026-10");
  const model = createModel(converted());
  const after = dashboard(model, "2026-10");
  // Excel temeli (standart) çevrilen kalemi artık saymaz; başabaşın sabit gideri sayar
  close(before.fixedStandardTotal - after.fixedStandardTotal, 50_000, "Excel temeli 50.000 düştü");
  close(after.breakEven.fixed, before.breakEven.fixed, "başabaşın sabit gideri aynı", 1);
  close(after.breakEvenDaily, before.breakEvenDaily, "başabaş günlük ciro (±1 ₺)", 1);
  close(after.forecast!.projectedProfit, before.forecast!.projectedProfit, "ay sonu tahmini (±1 ₺)", 1);
  assert.deepEqual(
    after.breakEven.expenses.map((x) => ({ name: x.cat.name, amount: x.amount, source: x.source, from: x.from })),
    [{ name: "Influencer", amount: 50_000, source: "entered", from: "2026-10" }],
  );
  // Gelecek ay girilmedi: Ekim'in tutarı taşınır (nakit planı, Sabit giderler'in "gelecek ay"ı)
  const nov = model.monthlyExpensePlan("2026-11");
  assert.deepEqual(nov.map((x) => [x.amount, x.source, x.from]), [[50_000, "carried", "2026-10"]]);
  close(model.breakEvenFixedFor("2026-11"), createModel(base).breakEvenFixedFor("2026-11"), "Kasım aynı");
  // Ayarlar'daki etki ve Analiz aynı kuraldan
  close(requiredDailyRevenue(model, "2026-10", 0), after.breakEvenDaily, "Ayarlar etkisi = Genel bakış");
  // "En büyük giderler": toplam başabaşın sabit gideri, aylık harcama da kalem
  assert.ok(after.topExpenses.some((e) => e.name === "Influencer (Aylık harcamalar)" && e.amount === 50_000));
});

test("E-13: kural: biten ay kendi tutarı; süren ay geçen aydan azsa geçen ayın gerçekleşeni; pasif, mal ve tek seferlik sayılmaz", () => {
  const m = createModel(
    converted(
      [entry(1, 1, "2026-09-05", 40_000), entry(2, 1, "2026-10-02", 10_000), entry(3, 2, "2026-10-03", 9_000), entry(4, 3, "2026-09-10", 7_000), entry(5, 4, "2026-10-04", 3_000)],
      {},
    ),
  );
  const ds = m.ds;
  const model = createModel({
    ...ds,
    expenseCategories: [
      ...ds.expenseCategories!,
      cat({ id: 2, name: "Nakit malzeme", section: "mal", panelGroup: "diger" }),
      cat({ id: 3, name: "Eski reklam", active: false }),
      cat({ id: 4, name: "Tek seferlik", monthly: false, panelGroup: "diger" }),
    ],
  });
  // Eylül (biten ay): kendi tutarı; pasif kategori de kendi ayında sayılır
  assert.deepEqual(
    model.monthlyExpensePlan("2026-09").map((x) => [x.cat.name, x.amount, x.source]),
    [
      ["Influencer", 40_000, "entered"],
      ["Eski reklam", 7_000, "entered"],
    ],
  );
  // Ekim (süren ay): girilen 10.000 < Eylül 40.000 → Eylül taşınır; pasif kategori taşınmaz, mal ve tek seferlik yok
  assert.deepEqual(model.monthlyExpensePlan("2026-10").map((x) => [x.cat.name, x.amount, x.source, x.from]), [["Influencer", 40_000, "carried", "2026-09"]]);
  // Kasım (gelecek): geçen aydan beri en büyüğü
  assert.deepEqual(model.monthlyExpensePlan("2026-11").map((x) => [x.amount, x.from]), [[40_000, "2026-09"]]);
  // Ağustos: kayıt yok
  assert.deepEqual(model.monthlyExpensePlan("2026-08"), []);
  // Kategori yokken başabaşın sabit gideri Excel temeliyle aynı (Excel uyumu)
  const plain = createModel(base);
  close(plain.breakEvenFixedFor("2026-10"), plain.fixedStandardTotalFor("2026-10"), "kategori yok");
});

// ---------------------------------------------------------------- E-59: tek başabaş

const none = { orders: 0, grossMinor: 0, discountMinor: 0, deliveryMinor: 0, refundedMinor: 0, netMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 };
function siteMonth(month: string, closed = true): SiteSalesMonth {
  return {
    month,
    pulledAt: `${month}-28T06:00:00.000Z`,
    now: `${month}-28T06:00:00.000Z`,
    from: `${month}-01`,
    to: `${month}-30`,
    closed,
    cafe: { ...none, orders: 120, grossMinor: 5_500_000, netMinor: 5_500_000, kdvMinor: 500_000, lines: [] },
    shop: { ...none },
    karaoke: { bookings: 0, collectedMinor: 0, refundedMinor: 0, netMinor: 0, refundPendingMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 },
    manual: { orders: 0, grossMinor: 0, netMinor: 0 },
  };
}

test("E-59: kapanmış site ayında Genel bakış, Sabit giderler, Analiz ve Ayarlar başabaşı aynı", () => {
  // Eylül'ün online ayı kapandı; seçili ay Eylül (satış listesi olan ay)
  const model = createModel({ ...base, siteSales: [siteMonth("2026-09")] });
  const M = "2026-09";
  const d = dashboard(model, M);
  const be = breakEvenOf(model, M);
  assert.ok(be.onlineCover && be.onlineCover.grossProfit > 0, "online örtü var");
  close(be.daily, d.breakEvenDaily, "Genel bakış");
  close(applyScenario(scenarioBase(model, M), ZERO, model.settings.acikGun).base.breakEvenDaily, d.breakEvenDaily, "Analiz › Şu an");
  close(requiredDailyRevenue(model, M, 0), d.breakEvenDaily, "Ayarlar etkisi");
  // Eski Giderler formülü (online düşülmeden) daha yüksekti
  assert.ok(be.fixed / be.grossRatio / be.acikGun > d.breakEvenDaily! + 1);
  // Sabit giderler sayfası aynı yardımcıyı çağırır, kartın alt satırı online örtüyü söyler
  const page = read("src/app/panel/giderler/page.tsx");
  assert.match(page, /const be = breakEvenOf\(model, cur\);/);
  assert.match(page, /breakEvenDaily=\{be\.daily\}/);
  assert.match(read("src/app/panel/giderler/expenses-client.tsx"), /online brüt kârı \(\$\{tl\(breakEvenOnline\.amount\)\}\) düşüldü/);
  // Başabaş kalemleri (Analiz dökümü) başabaşın sabit giderini tutar
  close(
    scenarioBreakEvenItems(model, M).reduce((a, r) => a + r.amount, 0),
    be.fixed,
    "kalemler",
    0.5,
  );
});

// ---------------------------------------------------------------- E-12: yarım ayın listesi

/** 1–22 Kasım her gün 15.000 ₺ Z, 100 ₺ indirim (bugün 23 Kasım) */
function kasa(upto = "2026-11-22"): TillRow[] {
  const out: TillRow[] = [];
  for (let d = "2026-11-01"; d <= upto; d = addDays(d, 1)) out.push({ date: d, zTotal: 15_000, card: 10_000, mealCard: 1_000, discounts: 100, offRevenue: null });
  return out;
}
/** Eylül listesi, 1–15 Kasım'ın cirosuna ölçekli */
function novemberList(): SalesLine[] {
  const sep = base.salesLines.filter((l) => l.month === "2026-09");
  const total = sep.reduce((a, l) => a + l.revenue, 0);
  const k = 226_500 / total;
  return sep.map((l, i) => ({ ...l, id: 900_000 + i, month: "2026-11", qty: l.qty * k, revenue: l.revenue * k }));
}
function november(extra: Partial<Dataset> = {}): Dataset {
  const [till] = tillMonths(kasa(), "2026-11-22");
  return {
    ...base,
    currentMonth: "2026-11",
    months: [...base.months, resolveMonth("2026-11", undefined, till)],
    salesLines: [...base.salesLines, ...novemberList()],
    salesCoverage: [{ month: "2026-11", through: "2026-11-15", till: tillMonths(kasa("2026-11-15"), "2026-11-15")[0] ?? null }],
    ...extra,
  };
}

test("E-12: yarım ayın satış listesinde senaryonun 'Şu an'ı Genel bakış'taki net kârla aynı; zam ihtiyacı makul", () => {
  const model = createModel(november());
  const M = "2026-11";
  const d = dashboard(model, M);
  const t = d.theoretical!;
  assert.ok(t.listPeriod, "liste kasa raporlarından kısa");
  const b = scenarioBase(model, M);
  assert.equal(b.listPeriod, "1–15 Kasım");
  const r = applyScenario(b, ZERO, model.settings.acikGun);
  close(r.base.profit, t.netProfit, "Şu an = Genel bakış net kârı", 1);
  close(b.fixed, t.fixedTotal, "sabit gider liste döneminin payı");
  close(b.discountsNet, t.discountsNet, "indirim listenin döneminden");
  close(r.base.breakEvenDaily, d.breakEvenDaily, "başabaş Genel bakış'la aynı");
  // Eski taban: tam ayın sabit gideri ve kasa raporlarının bütün indirimi → dev sahte zarar ve %100'ü aşan zam
  const old = { ...b, fixed: model.fixedStandardTotalFor(M), discountsNet: (model.monthInfo.get(M)?.discounts ?? 0) / (1 + model.settings.kdv), online: 0 };
  const oldNeed = breakEvenNeeds(old);
  const need = breakEvenNeeds(b);
  assert.ok(old.fixed > b.fixed * 1.4, "eski taban tam ayın sabit gideri");
  assert.ok(need.price! < oldNeed.price!, `zam ihtiyacı küçüldü: ${need.price} < ${oldNeed.price}`);
  // Net kâr kartının kalemleri sabit gideri tutar ve listenin payını söyler
  const items = scenarioFixedItems(model, M);
  close(
    items.reduce((a, x) => a + x.amount, 0),
    b.fixed,
    "kalemler",
    0.5,
  );
  assert.ok(items.some((x) => x.sub?.includes("1–15 Kasım payı")));
});

test("E-12: online brüt kâr senaryoda ayrı satır; kaydırıcılar değiştirmez", () => {
  const model = createModel({ ...base, siteSales: [siteMonth("2026-09")] });
  const M = "2026-09";
  const d = dashboard(model, M);
  const b = scenarioBase(model, M);
  assert.ok(b.online > 0);
  close(b.online, d.theoretical!.online!.grossProfit, "online brüt kâr");
  const r = applyScenario(b, { priceChangePct: 0.1, costChangePct: 0.2, volumeChangePct: 0.3, extraFixed: 5_000 }, model.settings.acikGun);
  close(r.scenario.online, b.online, "senaryo online'ı değiştirmez");
  close(r.base.profit, d.theoretical!.netProfit, "Şu an = Genel bakış", 1);
  // Zarar etmemek için: online brüt kâr sabit giderin bir kısmını karşılar
  const n = breakEvenNeeds(b);
  close(n.fixedNet, b.fixed - b.online, "satışın karşılayacağı sabit gider");
});

// ---------------------------------------------------------------- E-41: kapalı günler

test("E-41: süren ayda kapalı işaretli gün ay sonu öngörüsünü orantılı düşürür; Genel bakış ve KDV tahmini aynı kural", async () => {
  const plain = dashboard(createModel(base), "2026-10");
  // Ekim 2026: 16 açık gün girildi (Excel); 30 ve 31 Ekim kapalı işaretli (ileri tarihli)
  const closedModel = createModel({ ...base, closedDays: ["2026-10-30", "2026-10-31", "2026-11-02"] });
  const d = dashboard(closedModel, "2026-10");
  const f = d.forecast!;
  assert.equal(f.closedDays, 2, "yalnız ayın günleri");
  assert.equal(f.monthDays, 29);
  close(f.projectedRevenue, (293_909 / 16) * 29, "29 açık gün");
  close(plain.forecast!.projectedRevenue, (293_909 / 16) * 31, "kapalı gün yokken 31");
  close(f.projectedProfit, f.projectedRevenue * d.grossRatio - d.breakEven.fixed, "tahmini kâr aynı tabanla");
  // KDV tahmini: süren ayın kasa KDV'si aynı gün sayısıyla tamamlanır
  const { vatMonthInputs, vatEstimates } = await import("../src/lib/kdv");
  const est = (m: ReturnType<typeof createModel>) => {
    const inp = vatMonthInputs(m, "2026-10-20");
    return vatEstimates({ today: "2026-10-20", months: inp.months, firstSalesMonth: inp.firstSalesMonth, anchor: null, known: new Map(), periods: ["2026-10"], hasSite: false }).get("2026-10")!;
  };
  const a = est(createModel(base));
  const b = est(closedModel);
  close(b.basis.posRevenue, (a.basis.posRevenue! / 31) * 29, "KDV tahmininin cirosu 29 günle");
  assert.ok(b.pos < a.pos, "KDV tahmini düştü");
});
