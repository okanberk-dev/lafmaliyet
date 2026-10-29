/**
 * Vergi bordrosu (plan docs/planlar/vergi.md §3.4, K16): netten brüt, yıl içindeki kümülatif matrahla ücretin gelir
 * vergisi, asgari ücret gelir ve damga vergisi istisnası, ücret damgası, prime esas kazancın alt ve üst sınırı; SGK
 * oranları kural tablosundan (yasal 2026: işçi %14 + %1, işveren %19,75 + %2; `sgk.isverenOran` elle değişebilir).
 * Ayarlar'daki oranlar yalnız Gelir-gider'de kalır (engine.ts staffCost değişmez, K17). Aylar tam sayılır (personelin
 * giriş günü panelde yok). Ek ödemeler vergisiz, brütleştirilmeden maliyete eklenir. Saf modül;
 * tests/vergi-bordro.test.ts.
 */

import type { Model } from "../calc/engine";
import { inRange, shiftMonth } from "../calc/engine";

import { type Bracket, r2, rulesFor, type TaxOverrides, type TaxYearRules } from "./rules";
import type { TaxSettings } from "./settings";

export interface PayrollRates {
  isciSgk: number;
  isciIssizlik: number;
  isverenSgk: number;
  isverenIssizlik: number;
  pekAlt: number;
  pekUst: number;
  /** Ücretin damga vergisi oranı */
  stampRate: number;
  /** Asgari ücret (brüt): gelir ve damga vergisi istisnasının tabanı */
  minGross: number;
  brackets: readonly Bracket[];
  /** Asgari ücret desteği, kişi başına günlük */
  supportDaily: number;
}

/** Kural tablosundan bordro oranları (elle `sgk.isverenOran` rulesFor'da uygulanmış) */
export function payrollRates(rules: TaxYearRules): PayrollRates {
  return {
    isciSgk: rules.sgk.isciOran.value,
    isciIssizlik: rules.sgk.isciIssizlik.value,
    isverenSgk: rules.sgk.isverenOran.value,
    isverenIssizlik: rules.sgk.isverenIssizlik.value,
    pekAlt: rules.sgk.pek.value.alt,
    pekUst: rules.sgk.pek.value.ust,
    stampRate: rules.ucret.damgaOrani.value,
    minGross: rules.ucret.asgariBrut.value,
    brackets: rules.ucret.tarife.value,
    supportDaily: rules.sgk.asgariUcretDestegi.value,
  };
}

/** Kayan nokta artığını atar (4.211,325 tam kalsın; kuruşa yuvarlama r2'de) */
const clean = (x: number) => Math.round(x * 1e6) / 1e6;

/** Gelir vergisi tarifesiyle vergi (yuvarlanmaz; farklar r2 ile alınır) */
export function incomeTax(base: number, brackets: readonly Bracket[]): number {
  let tax = 0;
  let lo = 0;
  for (const b of brackets) {
    if (base <= lo) break;
    const hi = b.upTo ?? Number.POSITIVE_INFINITY;
    tax += (Math.min(base, hi) - lo) * b.rate;
    lo = hi;
  }
  return clean(tax);
}

/** Asgari ücretin gelir vergisi matrahı: brüt − işçi SGK − işçi işsizlik (2026: 28.075,50) */
export function minWageBase(rates: PayrollRates): number {
  return r2(rates.minGross - r2(rates.minGross * rates.isciSgk) - r2(rates.minGross * rates.isciIssizlik));
}

/**
 * Ay `month`'un (1–12) asgari ücret istisnası (GVK 23/18): gelir vergisinde asgari matrahın o aya kadarki kümülatif
 * tarife farkı (Ocak–Haziran 4.211,33; Temmuz 4.537,75; Ağustos–Aralık 5.615,10), damga vergisinde asgari ücretin damgası
 */
export function minWageExemption(month: number, rules: TaxYearRules | PayrollRates): { gv: number; dv: number } {
  const rates = "brackets" in rules ? rules : payrollRates(rules);
  const base = minWageBase(rates);
  return {
    gv: r2(incomeTax(base * month, rates.brackets) - incomeTax(base * (month - 1), rates.brackets)),
    dv: r2(rates.minGross * rates.stampRate),
  };
}

export interface SlipCtx {
  /** Ayın yıldaki sırası (1–12) */
  month: number;
  /** Aynı yılda bu işverendeki önceki ayların gelir vergisi matrahı toplamı */
  cumPrev: number;
  rates: PayrollRates;
  /** Ek ödemeler (yemek, yol, prim): vergisiz, yalnız maliyete */
  extras?: number;
}

export interface Payslip {
  month: number;
  gross: number;
  net: number;
  /** Prime esas kazanç: brüt, alt ve üst sınır arasında */
  pekBase: number;
  isciSgk: number;
  isciIssizlik: number;
  gvMatrah: number;
  /** Bu ay dahil kümülatif matrah */
  cumBase: number;
  gvHesap: number;
  gvIstisna: number;
  gv: number;
  dv: number;
  isverenSgk: number;
  isverenIssizlik: number;
  extras: number;
  /** Brüt + işveren SGK + işveren işsizlik + ek ödemeler */
  cost: number;
}

const ZERO_SLIP = (month: number, cumPrev: number, extras: number): Payslip => ({
  month,
  gross: 0,
  net: 0,
  pekBase: 0,
  isciSgk: 0,
  isciIssizlik: 0,
  gvMatrah: 0,
  cumBase: cumPrev,
  gvHesap: 0,
  gvIstisna: 0,
  gv: 0,
  dv: 0,
  isverenSgk: 0,
  isverenIssizlik: 0,
  extras,
  cost: r2(extras),
});

/** Brütten bordro (§3.4) */
export function payslipFromGross(gross: number, ctx: SlipCtx): Payslip {
  const { rates, month, cumPrev } = ctx;
  const extras = ctx.extras ?? 0;
  if (!(gross > 0)) return ZERO_SLIP(month, cumPrev, extras);
  const pekBase = Math.min(Math.max(gross, rates.pekAlt), rates.pekUst);
  const isciSgk = r2(pekBase * rates.isciSgk);
  const isciIssizlik = r2(pekBase * rates.isciIssizlik);
  const gvMatrah = r2(gross - isciSgk - isciIssizlik);
  const cumBase = r2(cumPrev + gvMatrah);
  const gvHesap = r2(incomeTax(cumBase, rates.brackets) - incomeTax(cumPrev, rates.brackets));
  const ex = minWageExemption(month, rates);
  const gv = Math.max(0, r2(gvHesap - ex.gv));
  const dv = Math.max(0, r2(gross * rates.stampRate - ex.dv));
  const net = r2(gross - isciSgk - isciIssizlik - gv - dv);
  const isverenSgk = r2(pekBase * rates.isverenSgk);
  const isverenIssizlik = r2(pekBase * rates.isverenIssizlik);
  return {
    month,
    gross,
    net,
    pekBase,
    isciSgk,
    isciIssizlik,
    gvMatrah,
    cumBase,
    gvHesap,
    gvIstisna: ex.gv,
    gv,
    dv,
    isverenSgk,
    isverenIssizlik,
    extras,
    cost: r2(gross + isverenSgk + isverenIssizlik + extras),
  };
}

/** Netten bordro: net' ≥ net olan en küçük kuruşluk brüt (ikiye bölme, sonra kuruş kuruş) */
export function payslipFromNet(net: number, ctx: SlipCtx): Payslip {
  if (!(net > 0)) return ZERO_SLIP(ctx.month, ctx.cumPrev, ctx.extras ?? 0);
  const netOf = (g: number) => payslipFromGross(g, ctx).net;
  let lo = net;
  let hi = net * 2;
  for (let guard = 0; netOf(hi) < net && guard < 20; guard++) hi *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (netOf(mid) < net) lo = mid;
    else hi = mid;
  }
  let g = Math.floor(lo * 100) / 100;
  for (let guard = 0; netOf(g) < net && guard < 10_000; guard++) g = r2(g + 0.01);
  return payslipFromGross(g, ctx);
}

/** Bir kişinin yıl içindeki ayları: ay ("YYYY-MM"), net maaş, ek ödemeler */
export interface StaffMonths {
  id: number;
  name: string;
  months: readonly { month: string; net: number; extras: number }[];
}

export interface PayrollPerson extends Payslip {
  staffId: number;
  name: string;
}

export interface PayrollTotals {
  people: number;
  gross: number;
  net: number;
  extras: number;
  isciSgk: number;
  isciIssizlik: number;
  isverenSgk: number;
  isverenIssizlik: number;
  gv: number;
  dv: number;
  cost: number;
  /** Asgari ücret desteği (şartlı; anahtar kapalıysa 0) */
  support: number;
  /** Dört SGK payı, destek düşülmüş: ayın SGK ödemesi */
  sgkTotal: number;
}

export interface PayrollMonth {
  /** "YYYY-MM" */
  month: string;
  people: PayrollPerson[];
  totals: PayrollTotals;
  /** Kullanılan oranlar */
  rates: PayrollRates;
  /** Yılın kuralı tabloda yok, en son bilinen yılın değerleri */
  estimated: boolean;
}

/** Bordronun notları (Bordro dökümü penceresi, §4.5-e) */
export const PAYROLL_NOTE = "Hesap 2026 yasal SGK oranları ve gelir vergisi tarifesiyle yapıldı; kesin tutar bordronuzdadır.";
export const PAYROLL_FULL_MONTH_NOTE = "Personel: işe giriş günü bilinmediği için ay tam sayıldı";
export const PAYROLL_EXTRAS_NOTE = "Ek ödemeler vergisiz sayıldı (yemek ve yol istisnası içindeyse doğru); prim ise brüte eklenmeli";

function totalsOf(people: readonly PayrollPerson[], rates: PayrollRates, minWageSupport: boolean): PayrollTotals {
  const s = (f: (p: PayrollPerson) => number) => r2(people.reduce((a, p) => a + f(p), 0));
  const sgk4 = s((p) => p.isciSgk + p.isciIssizlik + p.isverenSgk + p.isverenIssizlik);
  const support = minWageSupport ? r2(people.filter((p) => p.gross > 0).length * 30 * rates.supportDaily) : 0;
  return {
    people: people.length,
    gross: s((p) => p.gross),
    net: s((p) => p.net),
    extras: s((p) => p.extras),
    isciSgk: s((p) => p.isciSgk),
    isciIssizlik: s((p) => p.isciIssizlik),
    isverenSgk: s((p) => p.isverenSgk),
    isverenIssizlik: s((p) => p.isverenIssizlik),
    gv: s((p) => p.gv),
    dv: s((p) => p.dv),
    cost: s((p) => p.cost),
    support,
    sgkTotal: Math.max(0, r2(sgk4 - support)),
  };
}

/**
 * Yılın bordrosu, ay ay: her kişi yılbaşında (ya da ilk ayında) sıfır kümülatif matrahla başlar. `from` ("YYYY-MM")
 * hesabın ilk ayıdır (hesap döneminin başı); daha önceki aylar hesaplanmaz. Ayın kimsesi yoksa ay yoktur.
 */
export function taxPayroll(
  staff: readonly StaffMonths[],
  year: number,
  rules: TaxYearRules,
  opts: { minWageSupport: boolean; from: string; estimated?: boolean },
): Map<string, PayrollMonth> {
  const rates = payrollRates(rules);
  const byMonth = new Map<string, PayrollPerson[]>();
  for (const s of staff) {
    let cum = 0;
    const months = [...s.months].filter((m) => m.month.startsWith(`${year}-`) && m.month >= opts.from).sort((a, b) => a.month.localeCompare(b.month));
    for (const m of months) {
      const slip = payslipFromNet(m.net, { month: Number(m.month.slice(5, 7)), cumPrev: cum, rates, extras: m.extras });
      cum = slip.cumBase;
      const list = byMonth.get(m.month) ?? [];
      list.push({ ...slip, staffId: s.id, name: s.name });
      byMonth.set(m.month, list);
    }
  }
  const out = new Map<string, PayrollMonth>();
  for (const month of [...byMonth.keys()].sort()) {
    const people = byMonth.get(month)!;
    out.set(month, { month, people, totals: totalsOf(people, rates, opts.minWageSupport), rates, estimated: opts.estimated ?? false });
  }
  return out;
}

/** İlk satış ayı: kasa cirosu girilmiş ilk ay (personelin başlangıç ayı boşsa bordro buradan başlar) */
export function firstSalesMonth(model: Pick<Model, "monthInfo">): string | null {
  return (
    [...model.monthInfo.values()]
      .filter((m) => (m.posRevenue ?? 0) > 0)
      .map((m) => m.month)
      .sort()[0] ?? null
  );
}

/**
 * Modelden yılın vergi bordrosu (K16, K18): personel `staffAtMonth`'ın maaşıyla, aralığındaki aylarda. Kişinin ilk ayı
 * başlangıç ayı, boşsa ilk satış ayı; hesap döneminin ayından önce olamaz. Oranlar kural tablosundan, elle
 * `sgk.isverenOran` uygulanmış; Ayarlar'daki SGK oranları kullanılmaz.
 */
export function taxPayrollFromModel(
  model: Pick<Model, "ds" | "monthInfo" | "staffAtMonth">,
  year: number,
  settings: Pick<TaxSettings, "periodStart" | "minWageSupport" | "overrides">,
  overrides: TaxOverrides = settings.overrides,
): Map<string, PayrollMonth> {
  const { rules, estimated } = rulesFor(year, overrides);
  const periodMonth = settings.periodStart.slice(0, 7);
  const from = `${year}-01` > periodMonth ? `${year}-01` : periodMonth;
  const sales = firstSalesMonth(model);
  const staff: StaffMonths[] = model.ds.staff.map((s) => {
    const own = s.startMonth ?? sales ?? periodMonth;
    const first = own > from ? own : from;
    const months: { month: string; net: number; extras: number }[] = [];
    for (let m = first; m <= `${year}-12`; m = shiftMonth(m, 1)) {
      if (!inRange(s, m)) continue;
      const at = model.staffAtMonth(s, m);
      months.push({ month: m, net: at.netSalary, extras: at.extras });
    }
    return { id: s.id, name: s.name, months };
  });
  return taxPayroll(staff, year, rules, { minWageSupport: settings.minWageSupport, from, estimated });
}
