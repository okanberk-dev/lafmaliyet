// Aynı rakam her yerde (denetim 26 Eki 2026, B15): Analiz senaryosu yarım listede Genel bakış'la aynı tabanı kullanır
// (E-12); aylık girişe çevrilen gider başabaşta, ay sonu tahmininde ve nakit planında kalır (E-13); başabaş tek
// yardımcıdan (E-59); kafe kapalı günler ay sonu öngörüsüne girmez (E-41).
// Çalıştırma: npx tsx --test tests/ayni-rakam.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { breakEvenNeeds, profitGroups, scenarioBreakEvenItems, scenarioFixedItems } from "../src/app/panel/analiz/breakdowns";
import { impactData, impactModel, settingsImpact } from "../src/app/panel/ayarlar/impact";
import { createModel } from "../src/lib/calc/engine";
import { applyScenario, breakEvenOf, dashboard, expensePlanSub, requiredDailyRevenue, scenarioBase } from "../src/lib/calc/insights";
import type { Dataset, ExpenseCategory, ExpenseEntry, Invoice, SalesLine } from "../src/lib/calc/types";
import { FIXED_ESTIMATE_DESCRIPTION } from "../src/lib/constants";
import { buildCashPlan, EXCLUDABLE_KEY, fixedReminderDrifts, planInputFromModel, planNotes, reminderDriftText, type CashPlan, type CashPlanInput } from "../src/lib/cash-plan";
import { resolveMonth, tillMonths, type TillRow } from "../src/lib/cash-month";
import { addDays, fixedReminderFollow, fixedReminderFollows, fixedReminderNextAmount, type ReminderRow } from "../src/lib/reminders";
import type { SiteSalesMonth } from "../src/lib/site-sales/schema";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
const base: Dataset = { ...datasetFromSeed(data), currentMonth: "2026-10" };
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
  // Ayarlar'daki etki tarayıcıdaki küçük modelle (impactModel(impactData)) aynı kuraldan
  close(requiredDailyRevenue(impactModel(impactData(model)), "2026-10", 0), after.breakEvenDaily, "Ayarlar etkisi = Genel bakış");
  close(settingsImpact(impactModel(impactData(model)), impactModel(impactData(model))).breakEvenDaily!.before, after.breakEvenDaily, "Ayarlar önizlemesi");
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
  // Döküm alt satırı: Ekim'de 10.000 girildi (daha az), Kasım'da hiç girilmedi
  assert.equal(expensePlanSub(model.monthlyExpensePlan("2026-10")[0]), "Eylül 2026 tutarı taşındı (bu ay girilen daha az)");
  assert.equal(expensePlanSub(model.monthlyExpensePlan("2026-11")[0]), "Eylül 2026 tutarı taşındı (bu ay girilmedi)");
  assert.equal(expensePlanSub(model.monthlyExpensePlan("2026-09")[0]), "Eylül 2026 girişi");
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
  // Ayarlar tarayıcıda küçük modelle hesaplar: süren ayın listesi varken de son kapanmış online ay düşülür
  const cur = createModel({ ...base, currentMonth: M, siteSales: [siteMonth("2026-08"), siteMonth("2026-09", false)] });
  const curBe = breakEvenOf(cur, M);
  assert.equal(curBe.onlineCover?.month, "2026-08", "son kapanmış online ay");
  close(requiredDailyRevenue(impactModel(impactData(cur)), M, 0), curBe.daily, "Ayarlar = Genel bakış (online örtü)");
  // Eski Giderler formülü (online düşülmeden) daha yüksekti
  assert.ok(be.fixed / be.grossRatio / be.acikGun > d.breakEvenDaily! + 1);
  // Genel bakış'ın bilgi ipucu formülü paranteze alır: (A + B − C) ÷ oran ÷ gün (döküm gibi)
  assert.match(read("src/app/panel/page.tsx"), /d\.breakEven\.expensesTotal \|\| d\.onlineCover \? "\(" : ""\}standart aylık sabit gider/);
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

test("E-12: aylık sabit gider değişimi net kâra tabanın dönemine düşen payıyla, başabaşa tamamıyla girer", () => {
  const model = createModel(november());
  const M = "2026-11";
  const b = scenarioBase(model, M);
  // Kasım 1–22 kasa raporu (22 ÷ 30 gün), liste 1–15 (15 ÷ 22): tam ayın yarısı
  close(b.fixedShare, 0.5, "pay");
  assert.equal(b.period, "1–15 Kasım");
  close(model.pnlMonth(M).ratio, 22 / 30, "süren ayın açık gün oranı");
  const r = applyScenario(b, { ...ZERO, extraFixed: -30_000 }, model.settings.acikGun);
  close(r.scenario.profit - r.base.profit, 15_000, "net kâra 30.000'in yarısı");
  close(r.scenario.breakEvenFixed - r.base.breakEvenFixed, -30_000, "başabaşa tamamı");
  // Döküm satırı aynı payı gösterir
  const gs = profitGroups({ b: r.base, s: r.scenario, dirty: true, extraFixed: -30_000, fixedItems: scenarioFixedItems(model, M), month: M });
  const extra = gs.find((g) => g.key === "sabit")!.rows.find((x) => x.key === "extra")!;
  close(extra.amount, 15_000, "döküm satırı");
  assert.match(extra.sub ?? "", /1–15 Kasım payı \(%50\)/);
  close(
    gs.flatMap((g) => g.rows).reduce((a, x) => a + x.amount, 0),
    r.scenario.profit,
    "döküm net kârı tutar",
    1,
  );
  // Kapanmış tam ayda pay 1, dönem yazılmaz
  const sep = scenarioBase(createModel(base), "2026-09");
  assert.equal(sep.fixedShare, 1);
  assert.equal(sep.period, null);
  // Excel'den 16 açık günlü süren Ekim: oran 16 ÷ 31
  const oct = scenarioBase(createModel(base), "2026-10");
  close(oct.fixedShare, 16 / 31, "Ekim payı");
  assert.equal(oct.period, "Ekim 2026, 16 gün");
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
  // Cirosu henüz girilmemiş ay (ilk kasa raporundan önce): önceki ayın günlük ortalaması × açık gün (kapalılar hariç)
  const fallback = (closed: string[]) => {
    const m = createModel({ ...base, currentMonth: "2026-11", closedDays: closed });
    const inp = vatMonthInputs(m, "2026-11-03");
    return vatEstimates({ today: "2026-11-03", months: inp.months, firstSalesMonth: inp.firstSalesMonth, anchor: null, known: new Map(), periods: ["2026-11"], hasSite: false }).get("2026-11")!;
  };
  const open30 = fallback([]);
  const open27 = fallback(["2026-11-01", "2026-11-02", "2026-11-03"]);
  assert.ok(open30.basis.posFrom, "önceki ayın ortalaması");
  close(open27.basis.posRevenue, (open30.basis.posRevenue! / 30) * 27, "kapalı 3 gün düşüldü");
});

// ---------------------------------------------------------------- Nakit planı (E-13, E-41, E-46)

const TODAY = "2026-10-22";
const PAYROLL0 = { net: 0, sgk: 0, people: 0 };
function planInput(over: Partial<CashPlanInput> = {}): CashPlanInput {
  return {
    today: TODAY,
    opening: null,
    excluded: [],
    settings: { komisyon: 0.025, kartOrani: 0.8, acikGun: 30, kdv: 0.1, kdvHizmet: 0.2 },
    invoiceTermDays: 30,
    cashReports: [],
    posMonth: null,
    online: null,
    invoices: [],
    reminders: [],
    goods: [],
    goodsSpanDays: 0,
    months: Object.fromEntries(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"].map((m) => [m, { payroll: PAYROLL0, fixed: [] }])),
    fixedNames: [],
    vat: { months: [], firstSalesMonth: null, hasSite: false },
    vatAnchor: null,
    ...over,
  };
}
const planLines = (p: CashPlan) => p.weeks.flatMap((w) => w.lines);
let remId = 500;
const reminder = (over: Partial<ReminderRow>): ReminderRow => ({
  id: remId++,
  title: "Kira",
  kind: "kira",
  amount: 5_000,
  dueDate: "2026-11-01",
  anchorDate: over.dueDate ?? "2026-11-01",
  repeat: "monthly",
  remindDaysBefore: 3,
  note: null,
  active: true,
  ...over,
});

test("E-13 nakit planı: aylık girişe çevrilen gider her ay yayılır; bu ay ödenen düşülür; hatırlatıcı varsa onun gününde", () => {
  const model = createModel(converted());
  const inp = planInputFromModel(model, TODAY);
  assert.deepEqual(inp.months["2026-10"].expenses, [{ id: 1, name: "Influencer", amount: 50_000, paid: 50_000, from: "2026-10" }]);
  assert.deepEqual(inp.months["2026-11"].expenses, [{ id: 1, name: "Influencer", amount: 50_000, paid: 0, from: "2026-10" }]);
  const plan = buildCashPlan(planInput({ months: inp.months, fixedNames: inp.fixedNames }));
  const exp = planLines(plan).filter((l) => l.key === "expense");
  const total = exp.reduce((a, l) => a + l.amount, 0);
  // Ekim ödendi (kalan 0); Kasım'ın tamamı + 1–2 Aralık
  close(total, 50_000 + (50_000 / 31) * 2, "Kasım + 2 gün Aralık", 1e-3);
  assert.match(exp[1].detail ?? "", /Influencer/);
  assert.equal(exp[1].kind, "expense");
  const row = plan.estimates.find((r) => r.key === "expense:1")!;
  assert.equal(row.status, "on");
  assert.equal(row.monthly, 50_000);
  const note = planNotes(plan, { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 }).find((n) => n.key === "expense")!.text;
  assert.match(note, /her ay girilen 1 kategori/);
  // Not, belge ve kural aynı şeyi söyler: o ay girilen, daha azsa geçen ayınki (girilmediyse değil)
  assert.match(note, /o ay girilen tutar, daha azsa geçen ayınki/);
  const doc = read("docs/NAKIT-PLANI.md");
  assert.match(doc, /Aylık harcamalar'da her ay\s+girilmeyen \(tek seferlik\) ödemeler/);
  assert.match(doc, /her ay girilen her harcama kategorisi tek tek kapatılabilir/);
  assert.doesNotMatch(doc, /Aylık harcamalar'daki fatura dışı\s+ödemeler \(cari/);
  // Tahmine katılanlar'dan kapatılır
  assert.ok(EXCLUDABLE_KEY.test("expense:1"));
  const off = buildCashPlan(planInput({ months: inp.months, excluded: ["expense:1"] }));
  assert.equal(planLines(off).some((l) => l.key === "expense"), false);
  // Adı aynı tutarsız hatırlatıcı: onun gününde Aylık harcamalar'daki tutar, yayılmaz (iki kez sayılmaz)
  const rem = reminder({ title: "Influencer", kind: "odeme", amount: null, dueDate: "2026-11-05", note: "Sabit giderlerden" });
  const withRem = buildCashPlan(planInput({ months: inp.months, fixedNames: inp.fixedNames, reminders: [rem] }));
  assert.equal(planLines(withRem).some((l) => l.key === "expense"), false);
  const remLines = planLines(withRem).filter((l) => l.key.startsWith(`reminder:${rem.id}@`));
  assert.deepEqual(remLines.map((l) => [l.date, l.amount, l.kind]), [["2026-11-05", 50_000, "expense"]]);
  assert.equal(withRem.estimates.find((r) => r.key === "expense:1")!.status, "covered");
});

test("E-13 nakit planı: süren ayda geçen aydan az girildiyse kalanı ayın kalan günlerine yayılır", () => {
  const model = createModel(converted([entry(1, 1, "2026-09-05", 40_000), entry(2, 1, "2026-10-02", 10_000)]));
  const inp = planInputFromModel(model, TODAY);
  assert.deepEqual(inp.months["2026-10"].expenses, [{ id: 1, name: "Influencer", amount: 40_000, paid: 10_000, from: "2026-09" }]);
  const plan = buildCashPlan(planInput({ months: inp.months }));
  const oct = plan.weeks[0].lines.find((l) => l.key === "expense")!;
  // 23–28 Ekim (ilk haftanın yarından sonraki 6 günü) ÷ 9 kalan gün × 30.000
  close(oct.amount, (30_000 / 9) * 6, "ilk hafta", 1e-6);
});

test("E-41 nakit planı: kapalı işaretli günde satış ve online girişi yok; not ve girdi", () => {
  const reports = Array.from({ length: 10 }, (_, i) => ({ date: addDays(TODAY, -1 - i), zTotal: 10_000, card: 6_000, mealCard: 2_000 }));
  const online = { month: "2026-09", perDay: 1_000 };
  const open = buildCashPlan(planInput({ cashReports: reports, online }));
  const shut = buildCashPlan(planInput({ cashReports: reports, online, closedDays: ["2026-10-25", "2026-10-22"] }));
  const sum = (p: CashPlan, key: string) => p.weeks[0].lines.filter((l) => l.key === key).reduce((a, l) => a + l.amount, 0);
  const perDay = 10_000 * (1 - 0.025 * 0.8);
  close(sum(open, "sales") - sum(shut, "sales"), perDay, "bir günlük satış düştü (bugün zaten yok)");
  close(sum(open, "online") - sum(shut, "online"), 1_000, "bir günlük online düştü");
  assert.deepEqual(shut.basis.closedDays, ["2026-10-25"]);
  assert.match(planNotes(shut, { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 }).find((n) => n.key === "closed")!.text, /1 günde \(25 Eki\)/);
  // Modelden: ufuktaki kapalı günler
  const m = createModel({ ...base, closedDays: ["2026-10-20", "2026-10-25", "2027-01-01"] });
  assert.deepEqual(planInputFromModel(m, TODAY).closedDays, ["2026-10-25"]);
});

test("E-46 nakit planı: tutarlı sabit gider hatırlatıcısı sonraki sürümle farklıysa satırda ve uyarıda söylenir", () => {
  const months = planInput().months;
  const kira = (amount: number) => ({ payroll: PAYROLL0, fixed: [{ id: 1, name: "Kira", period: "aylik" as const, amount, vatRate: 0.2 }] });
  const plan = buildCashPlan(
    planInput({
      months: { ...months, "2026-10": kira(160_000), "2026-11": kira(200_000), "2026-12": kira(200_000) },
      fixedNames: [{ id: 1, name: "Kira", period: "aylik" }],
      reminders: [reminder({ title: "Kira", amount: 192_000, dueDate: "2026-11-01", note: "Sabit giderlerden" })],
    }),
  );
  const line = planLines(plan).find((l) => l.key.startsWith("reminder:") && l.date === "2026-11-01")!;
  assert.equal(line.amount, 192_000, "plan hatırlatıcının tutarını öder");
  assert.match(line.detail ?? "", /Sabit giderde Kasım 2026 tutarı 240\.000/);
  assert.deepEqual(
    plan.reminderDrift.map((d) => [d.month, d.reminderAmount, d.fixedAmount]),
    [["2026-11", 192_000, 240_000]],
  );
  // Tutar aynıysa uyarı yok
  const same = buildCashPlan(
    planInput({
      months: { ...months, "2026-11": kira(160_000), "2026-12": kira(160_000) },
      fixedNames: [{ id: 1, name: "Kira", period: "aylik" }],
      reminders: [reminder({ title: "Kira", amount: 192_000, dueDate: "2026-11-01" })],
    }),
  );
  assert.deepEqual(same.reminderDrift, []);
});

test("E-46 Ödemeler: hatırlatıcı tutarı bir yıl içindeki sürümle karşılaştırılır; bitmiş ve farklı dönemli kalem karşılaştırılmaz", () => {
  const fixed = [
    { id: 1, name: "Kira", period: "aylik" as const, amount: 160_000, section: "kira" as const, vatRate: null, startMonth: null, endMonth: null },
    { id: 2, name: "Eski reklam", period: "aylik" as const, amount: 10_000, section: "genel" as const, vatRate: null, startMonth: null, endMonth: "2026-09" },
    { id: 3, name: "Sigorta", period: "yillik" as const, amount: 12_000, section: "genel" as const, vatRate: 0, startMonth: null, endMonth: null },
  ];
  const versions = [{ fixedExpenseId: 1, fromMonth: "2027-01", period: "aylik" as const, amount: 200_000 }];
  const rems = [
    reminder({ id: 1, title: "Kira", amount: 192_000, dueDate: "2026-11-01" }),
    reminder({ id: 2, title: "eski reklam", amount: 12_000, dueDate: "2026-11-01" }),
    reminder({ id: 3, title: "Sigorta", amount: 1_000, dueDate: "2026-11-01", repeat: "monthly" }),
    reminder({ id: 4, title: "Kira", amount: 192_000, dueDate: "2026-11-01", active: false }),
  ];
  const drifts = fixedReminderDrifts(rems, fixed, versions, TODAY);
  // Bitmiş kalemin tutarlı hatırlatıcısı bitişten sonraki ilk dönemde söylenir (E-62)
  assert.deepEqual(drifts, [
    { reminderId: 1, title: "Kira", month: "2027-01", reminderAmount: 192_000, fixedAmount: 240_000 },
    { reminderId: 2, title: "eski reklam", month: "2026-11", reminderAmount: 12_000, fixedAmount: 0, ended: "2026-09" },
  ]);
  assert.equal(reminderDriftText(drifts[0]).replace(/\s/g, " "), "Kira: Ocak 2027 döneminde sabit giderde 240.000 ₺ (KDV dahil); hatırlatıcıda 192.000 ₺");
  assert.equal(reminderDriftText(drifts[1]).replace(/\s/g, " "), "eski reklam: sabit gider Eylül 2026 ayında bitti; hatırlatıcı Kasım 2026 döneminde hâlâ 12.000 ₺");
  // Aylık girişe çevrilmiş gider (aynı adlı her ay girilen harcama) bitmiş sayılmaz
  assert.deepEqual(
    fixedReminderDrifts(rems, fixed, versions, TODAY, undefined, ["Eski Reklam"]).map((d) => d.reminderId),
    [1],
  );
  // Zam bir yıldan sonraysa henüz söylenmez
  assert.deepEqual(
    fixedReminderDrifts(rems, fixed, [{ ...versions[0], fromMonth: "2028-01" }], TODAY).map((d) => d.reminderId),
    [2],
  );
  // "Sabit giderlerden ekle" ile açılmış, tutarı sıradaki dönemin sürümü olan hatırlatıcı gideri izler: uyarı yok
  const follows = reminder({ id: 1, title: "Kira", amount: 192_000, dueDate: "2026-11-01", note: "Sabit giderlerden" });
  assert.deepEqual(fixedReminderDrifts([follows], fixed, versions, TODAY), []);
});

test("E-46: sabit gider değişince otomatik tutarlı hatırlatıcı yeni sürümü izler; elle yazılmışa dokunulmaz", () => {
  const kira = { amount: 160_000, period: "aylik" as const, section: "kira" as const, vatRate: null };
  const r = { amount: 192_000, dueDate: "2026-11-01", repeat: "monthly" as const };
  // Kasım'dan zam: yeni tutar
  assert.deepEqual(fixedReminderFollow(r, kira, [], kira, [{ fromMonth: "2026-11", period: "aylik", amount: 200_000 }]), { kind: "update", amount: 240_000 });
  // Ocak'tan zam: Kasım'ın tutarı kalır, hatırlatıcı gideri izler (Ocak'tan 240.000; nakit planı da öyle öder)
  assert.deepEqual(fixedReminderFollow(r, kira, [], kira, [{ fromMonth: "2027-01", period: "aylik", amount: 200_000 }]), {
    kind: "same",
    later: { month: "2027-01", amount: 240_000 },
  });
  // Kasım'dan zam ve Ocak'tan bir zam daha: Kasım'ın yeni tutarı, Ocak'ınki söylenir
  assert.deepEqual(
    fixedReminderFollow(r, kira, [], kira, [
      { fromMonth: "2026-11", period: "aylik", amount: 170_000 },
      { fromMonth: "2027-01", period: "aylik", amount: 200_000 },
    ]),
    { kind: "update", amount: 204_000, later: { month: "2027-01", amount: 240_000 } },
  );
  // KDV oranı değişti (bütün aylar): yeni brüt
  assert.deepEqual(fixedReminderFollow(r, kira, [], { ...kira, vatRate: 0.1 }, []), { kind: "update", amount: 176_000 });
  // Değişiklik yok
  assert.deepEqual(fixedReminderFollow(r, kira, [], kira, []), { kind: "same" });
  // Elle yazılmış tutar: dokunulmaz; yeni tutar farklıysa uyarılır
  assert.deepEqual(fixedReminderFollow({ ...r, amount: 193_500 }, kira, [], kira, [{ fromMonth: "2026-11", period: "aylik", amount: 200_000 }]), { kind: "manual", expected: 240_000 });
  assert.deepEqual(fixedReminderFollow({ ...r, amount: 193_500 }, kira, [], kira, []), { kind: "manual", expected: 192_000 });
  assert.deepEqual(fixedReminderFollow({ ...r, amount: 192_000.4 }, kira, [], kira, []), { kind: "same" });
  // Tutarsız hatırlatıcı zaten Giderler'i izler; dönemi değişen kalem (aylık → yıllık) boşalır
  assert.deepEqual(fixedReminderFollow({ ...r, amount: null }, kira, [], kira, [{ fromMonth: "2026-11", period: "aylik", amount: 1 }]), { kind: "same" });
  assert.deepEqual(fixedReminderFollow(r, kira, [], { ...kira, period: "yillik", amount: 1_920_000 }, []), { kind: "update", amount: null });
});

test("E-13 nakit planı: bu ay girilmiş harcamanın hatırlatıcısı aynı ay ikinci kez ödenmez", () => {
  const model = createModel(converted());
  const inp = planInputFromModel(model, TODAY);
  // Ekim'in 50.000'i girildi (ödendi); Ekim 30'daki tutarsız hatırlatıcı Ekim için 0, Kasım 30'da 50.000
  const rem = reminder({ title: "Influencer", kind: "odeme", amount: null, dueDate: "2026-10-30" });
  const plan = buildCashPlan(planInput({ months: inp.months, reminders: [rem] }));
  const lines = planLines(plan).filter((l) => l.key.startsWith(`reminder:${rem.id}@`));
  assert.deepEqual(lines.map((l) => [l.date, l.amount]), [["2026-11-30", 50_000]]);
  assert.deepEqual(plan.unknownAmounts, [], "Ekim ödendi: tutarı girilmemiş ödeme de değil");
  // Harcaması hiç olmayan ayda (kategori yok) tutarı girilmemiş ödemedir
  const none = buildCashPlan(planInput({ reminders: [reminder({ title: "Influencer", kind: "odeme", amount: null, dueDate: "2026-11-30" })] }));
  assert.equal(none.unknownAmounts.length, 1);
});

test("E-13 nakit planı: çevirmenin tahmini kaydı ödenmiş sayılmaz; bu ayın kalan günlerine ve tutarsız hatırlatıcıya girer", () => {
  // 1 Ekim'den çevrildi, tahmini 50.000 yazıldı; Influencer'ın gerçek ödemesi henüz girilmedi
  const model = createModel(converted([{ ...entry(1, 1, "2026-10-01", 50_000), description: FIXED_ESTIMATE_DESCRIPTION }]));
  const inp = planInputFromModel(model, TODAY);
  assert.deepEqual(inp.months["2026-10"].expenses, [{ id: 1, name: "Influencer", amount: 50_000, paid: 0, from: "2026-10" }]);
  // Başabaş ve tahmin tahmini tutarı saymaya devam eder
  close(model.monthlyExpensePlan("2026-10")[0].amount, 50_000, "başabaşın tutarı");
  const plan = buildCashPlan(planInput({ months: inp.months }));
  const oct = plan.weeks[0].lines.find((l) => l.key === "expense")!;
  // 23–28 Ekim: Ekim'in kalan 9 gününe yayılan 50.000'in 6 günü
  close(oct.amount, (50_000 / 9) * 6, "ilk hafta");
  // Ekim 30'daki tutarsız hatırlatıcı Ekim'de de tahmini tutarı taşır
  const rem = reminder({ title: "Influencer", kind: "odeme", amount: null, dueDate: "2026-10-30" });
  const withRem = buildCashPlan(planInput({ months: inp.months, reminders: [rem] }));
  assert.deepEqual(
    planLines(withRem)
      .filter((l) => l.key.startsWith(`reminder:${rem.id}@`))
      .map((l) => [l.date, l.amount]),
    [
      ["2026-10-30", 50_000],
      ["2026-11-30", 50_000],
    ],
  );
  // Gerçek kayıt (açıklaması değişmiş) ödenmiş sayılır
  const real = planInputFromModel(createModel(converted([{ ...entry(1, 1, "2026-10-01", 60_000), description: null }])), TODAY);
  assert.equal(real.months["2026-10"].expenses![0].paid, 60_000);
});

test("E-13 nakit planı: bağlı fatura kategorisi faturası gelmemiş aylarda tutarıyla (KDV dahil) yayılır; ayın faturası karşılanmış", () => {
  const inv = (id: number, date: string, amount: number, payable: number): Invoice => ({
    id,
    date,
    supplier: "Meta",
    description: null,
    invoiceNo: null,
    category: "Reklam & Tabela",
    amount,
    discount: 0,
    payable,
    unpaid: false,
    note: null,
  });
  const ds: Dataset = {
    ...converted([], { invoiceCategory: "Reklam & Tabela" }),
    invoices: [...base.invoices.filter((i) => i.category !== "Reklam & Tabela"), inv(990_001, "2026-10-05", 20_000, 24_000), inv(990_002, "2026-10-12", 10_000, 12_000)],
  };
  const model = createModel(ds);
  // Başabaş KDV hariç tutarla (30.000), nakit planı ödenecek tutarla (36.000)
  close(model.monthlyExpensePlan("2026-11")[0].amount, 30_000, "Kasım başabaşı");
  close(breakEvenOf(model, "2026-11").fixed - model.fixedStandardTotalFor("2026-11"), 30_000, "başabaşta");
  const inp = planInputFromModel(model, TODAY);
  // Ekim'in faturaları geldi (ödenmiş ya da Ödemeler'de kesin kalem): kalan yok
  assert.deepEqual(inp.months["2026-10"].expenses, [{ id: 1, name: "Influencer", amount: 36_000, paid: 36_000, from: "2026-10", linked: true }]);
  assert.deepEqual(inp.months["2026-11"].expenses, [{ id: 1, name: "Influencer", amount: 36_000, paid: 0, from: "2026-10", linked: true }]);
  assert.deepEqual(inp.months["2026-12"].expenses, [{ id: 1, name: "Influencer", amount: 36_000, paid: 0, from: "2026-10", linked: true }]);
  const plan = buildCashPlan(planInput({ months: inp.months }));
  const total = planLines(plan)
    .filter((l) => l.key === "expense")
    .reduce((a, l) => a + l.amount, 0);
  close(total, 36_000 + (36_000 / 31) * 2, "Kasım + 1–2 Aralık", 1e-3);
  assert.match(plan.estimates.find((r) => r.key === "expense:1")!.note ?? "", /bağlı faturalar KDV dahil/);
  // Süren ayda faturanın bir kısmı geldiyse kalanı yayılır: 12 Ekim'deki fatura yok, 24.000 geldi
  const part = createModel({ ...ds, invoices: ds.invoices.filter((i) => i.id !== 990_002), expenseEntries: [entry(1, 1, "2026-09-10", 30_000)] });
  const pi = planInputFromModel(part, TODAY);
  assert.deepEqual(pi.months["2026-10"].expenses, [{ id: 1, name: "Influencer", amount: 30_000, paid: 24_000, from: "2026-09" }]);
});

test("U1: sabit gideri izleyen hatırlatıcı zamdan sonraki dönemde sürümün tutarını öder; uyarı yok; Ödendi tutarı taşır", () => {
  const months = planInput().months;
  const kira = (amount: number) => ({ payroll: PAYROLL0, fixed: [{ id: 1, name: "Kira", period: "aylik" as const, amount, vatRate: 0.2 }] });
  const input = (note: string | null) =>
    planInput({
      months: { ...months, "2026-11": kira(160_000), "2026-12": kira(200_000) },
      fixedNames: [{ id: 1, name: "Kira", period: "aylik" }],
      reminders: [reminder({ id: 900, title: "Kira", amount: 192_000, dueDate: "2026-11-01", note })],
    });
  const plan = buildCashPlan(input("Sabit giderlerden"));
  const lines = planLines(plan).filter((l) => l.key.startsWith("reminder:900@"));
  assert.deepEqual(
    lines.map((l) => [l.date, l.amount]),
    [
      ["2026-11-01", 192_000],
      ["2026-12-01", 240_000],
    ],
  );
  assert.match(lines[1].detail ?? "", /Sabit giderdeki Aralık 2026 tutarı \(KDV dahil\); hatırlatıcı gideri izler/);
  assert.deepEqual(plan.reminderDrift, []);
  // Elle açılmış (notsuz) hatırlatıcı izlemez: tutarını öder, uyarır (U3: "ödendi sayıldı" demez)
  const manual = buildCashPlan(input(null));
  const m = planLines(manual).filter((l) => l.key.startsWith("reminder:900@"));
  assert.deepEqual(
    m.map((l) => l.amount),
    [192_000, 192_000],
  );
  assert.equal(m[1].detail, "Sabit giderde Aralık 2026 tutarı 240.000\u00a0₺ (KDV dahil); plan hatırlatıcıdaki 192.000\u00a0₺ tutarını sayar, Ödemeler'de güncelleyin");
  assert.doesNotMatch(m[1].detail ?? "", /ödendi sayıldı/);
  assert.equal(manual.reminderDrift.length, 1);
  // "Ödendi" sıradaki dönemin sürümüne taşır
  const f = { amount: 160_000, period: "aylik" as const, section: "kira" as const, vatRate: null };
  const v = [{ fromMonth: "2026-12", period: "aylik" as const, amount: 200_000 }];
  const rem = { note: "Sabit giderlerden", amount: 192_000, dueDate: "2026-11-01", repeat: "monthly" as const };
  assert.equal(fixedReminderNextAmount(rem, f, v, "2026-12-01"), 240_000);
  assert.equal(fixedReminderNextAmount(rem, f, [], "2026-12-01"), null, "tutar aynı");
  assert.equal(fixedReminderNextAmount({ ...rem, note: null }, f, v, "2026-12-01"), null, "elle açılmış");
  assert.equal(fixedReminderNextAmount({ ...rem, amount: 190_000 }, f, v, "2026-12-01"), null, "elle yazılmış tutar");
  assert.equal(fixedReminderFollows(rem, f, v), true);
});

test("E-62: bitmiş sabit giderin tutarlı hatırlatıcısı bitişten sonra planda söylenir; aylık girişe çevrilmişse söylenmez", () => {
  const months = planInput().months;
  const ig = { payroll: PAYROLL0, fixed: [{ id: 7, name: "Instagram reklamı", period: "aylik" as const, amount: 30_000, vatRate: 0.2 }] };
  const rem = reminder({ id: 901, title: "Instagram reklamı", kind: "odeme", amount: 36_000, dueDate: "2026-11-01", note: "Sabit giderlerden" });
  const input = planInput({
    months: { ...months, "2026-11": ig },
    fixedNames: [{ id: 7, name: "Instagram reklamı", period: "aylik", endMonth: "2026-11" }],
    reminders: [rem],
  });
  const plan = buildCashPlan(input);
  const lines = planLines(plan).filter((l) => l.key.startsWith("reminder:901@"));
  assert.deepEqual(
    lines.map((l) => [l.date, l.amount]),
    [
      ["2026-11-01", 36_000],
      ["2026-12-01", 36_000],
    ],
  );
  assert.match(lines[1].detail ?? "", /Sabit gider Kasım 2026 ayında bitti; plan hatırlatıcıdaki 36\.000\s₺ tutarını sayar/);
  assert.deepEqual(plan.reminderDrift, [{ reminderId: 901, title: "Instagram reklamı", month: "2026-12", reminderAmount: 36_000, fixedAmount: 0, ended: "2026-11" }]);
  // Aylık girişe çevrilmiş (aynı adlı her ay girilen harcama): hatırlatıcı onu karşılar, bitti denmez
  const conv = buildCashPlan({
    ...input,
    months: { ...input.months, "2026-12": { payroll: PAYROLL0, fixed: [], expenses: [{ id: 3, name: "Instagram reklamı", amount: 36_000, paid: 0, from: "2026-11" }] } },
  });
  assert.deepEqual(conv.reminderDrift, []);
  // Modelden: bitiş ayı plan girdisinde
  const m = createModel({ ...base, fixedExpenses: base.fixedExpenses.map((f) => (f.id === influencer.id ? { ...f, endMonth: "2026-11" } : f)) });
  assert.equal(planInputFromModel(m, TODAY).fixedNames.find((f) => f.id === influencer.id)?.endMonth, "2026-11");
});
