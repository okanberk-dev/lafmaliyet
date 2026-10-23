/**
 * Nakit planı (docs/NAKIT-PLANI.md): bugünden başlayan 42 gün (6 × 7, kayan hafta) için gelecek para, ödenecekler ve
 * elde kalacak para. Saf modül; tests/nakit-plani.test.ts.
 *
 * - Kesin: ödenmemiş faturalar (kalan borç, vade gününde; gecikmiş olan bugüne) ve tutarı girilmiş hatırlatıcılar
 *   (her tekrarıyla).
 * - Tahmini: satışlar (son 28 günün kasa raporları, yetmezse son ayın POS cirosu), laffogato.net online, maaş ve SGK
 *   (Personel), hatırlatıcısı olmayan sabit giderler (ay içine yayılır), yeni mal faturaları (son 8 haftanın
 *   ortalaması, tedarikçinin vadesinde) ve KDV (src/lib/kdv.ts).
 * - Bugün kuralı: girilen bakiye bugünü kapsar; gün 0'a yalnız fatura ve hatırlatıcı yazılır, tahminler yarından başlar.
 * - Hatırlatıcı eşleşmesi: adı bir sabit giderle aynıysa o giderin yerine geçer; değilse Maaş, SGK, KDV ya da diğer.
 *   Tutarsız hatırlatıcı eşleştiği tahminin tutarını taşır; eşleşmeyeni "Tutarı girilmemiş ödemeler"e girer.
 */

import { daysInMonth, shiftMonth, type Model } from "./calc/engine";
import type { FixedPeriod } from "./calc/types";
import { GOODS_CATEGORIES, MONTH_NAMES } from "./constants";
import { monthLabel, num, pct, tl } from "./format";
import { round100, vat2DueDate, vat2LineDetail, vatDueDate, vatEstimates, vatLineDetail, vatMonthInputs, vatNote, vatPeriodOf, type VatEstimate, type VatMonthInput } from "./kdv";
import { addDays, daysBetween, FIXED_REMINDER_NOTE, isVatReminder, isVatWithholdingReminder, monthEnd, nextOccurrence, reminderCategory, todayTR, type ReminderRow, type UpcomingItem } from "./reminders";

export const PLAN_WEEKS = 6;
/** 42 gün; Ödemeler'in ufkundan (UPCOMING_HORIZON_DAYS, 45) kısa: faturaların hepsi yükleyicinin listesinde (testli) */
export const PLAN_DAYS = PLAN_WEEKS * 7;
export const SALES_LOOKBACK_DAYS = 28;
export const MIN_SALES_REPORTS = 7;
export const GOODS_LOOKBACK_DAYS = 56;
export const MIN_GOODS_DAYS = 14;
export const STALE_BALANCE_DAYS = 3;

export type PlanKind = "sales" | "online" | "invoice" | "reminder" | "salary" | "sgk" | "fixed" | "goods" | "kdv";

/** Tahminden çıkarılabilen anahtarlar (Tahmine katılanlar) */
export const EXCLUDABLE_KEY = /^(sales|online|salary|sgk|goods|kdv|fixed:\d+)$/;

/** integration_state › "cashflow.plan": girilen bakiye, tahminden çıkarılanlar, muhasebecinin devreden KDV'si */
export interface CashPlanState {
  /** Bankadaki ve kasadaki paranın girildiği günkü toplamı (TL; eksi olabilir) */
  balance: number | null;
  /** YYYY-MM-DD (Türkiye), girildiği gün */
  balanceDate: string | null;
  balanceBy: string | null;
  excluded: string[];
  /** Muhasebecinin son beyannamesindeki "sonraki döneme devreden KDV" (yoksa null) */
  vatCarry: { month: string; amount: number; date: string; by: string } | null;
}

/** Kayıtlı değeri okur: bozuk ya da eksik alanlar varsayılana düşer (silinmiş sabit giderin anahtarı yok sayılır) */
export function parseCashPlanState(v: unknown): CashPlanState {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const date = typeof o.balanceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.balanceDate) ? o.balanceDate : null;
  const balance = typeof o.balance === "number" && Number.isFinite(o.balance) && date ? o.balance : null;
  const excluded = Array.isArray(o.excluded) ? [...new Set(o.excluded.filter((k): k is string => typeof k === "string" && EXCLUDABLE_KEY.test(k)))] : [];
  const c = o.vatCarry && typeof o.vatCarry === "object" ? (o.vatCarry as Record<string, unknown>) : null;
  const vatCarry =
    c && typeof c.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(c.month) && typeof c.amount === "number" && Number.isFinite(c.amount) && c.amount >= 0
      ? { month: c.month, amount: c.amount, date: typeof c.date === "string" ? c.date : "", by: typeof c.by === "string" ? c.by : "" }
      : null;
  return {
    balance,
    balanceDate: balance === null ? null : date,
    balanceBy: balance === null ? null : typeof o.balanceBy === "string" ? o.balanceBy : null,
    excluded,
    vatCarry,
  };
}

interface FixedItem {
  id: number;
  name: string;
  period: FixedPeriod;
  amount: number;
}

export interface CashPlanInput {
  today: string;
  opening: { amount: number; date: string } | null;
  excluded: readonly string[];
  settings: { komisyon: number; kartOrani: number; acikGun: number; kdv: number; kdvHizmet: number };
  /** Vadesiz faturanın genel vade günü (bildirim ayarı) */
  invoiceTermDays: number;
  /** `online`: Z raporundaki online platform ödemeleri (Yemeksepeti, Getir…; laffogato.net değil, o kasadan geçmez) */
  cashReports: readonly { date: string; zTotal: number; card: number; mealCard: number; online?: number }[];
  /** Bu aya kadarki, açık günü ve POS cirosu girilmiş son ay (kasa raporu yetmezse) */
  posMonth: { month: string; posRevenue: number; openDays: number } | null;
  online: { month: string; perDay: number } | null;
  /** Ödemeler'in listesi (source "invoice" olanlar kullanılır) */
  invoices: readonly UpcomingItem[];
  reminders: readonly ReminderRow[];
  /** Son 8 haftanın mal faturaları ve tedarikçinin ödeme gecikmesi (peşinde 0) */
  goods: readonly { supplier: string; date: string; payable: number; lagDays: number }[];
  /** Mal faturalarının ortalama aralığı; 0 = yetersiz geçmiş */
  goodsSpanDays: number;
  /** Önceki aylardan ufkun son ayına kadar: bordro ve o ayın sabit giderleri */
  months: Readonly<Record<string, { payroll: { net: number; sgk: number; people: number }; fixed: readonly FixedItem[] }>>;
  /** Bütün sabit giderler (hatırlatıcı eşleşmesi için) */
  fixedNames: readonly { id: number; name: string; period: FixedPeriod }[];
  vat: { months: VatMonthInput[]; firstSalesMonth: string | null; hasSite: boolean };
  vatAnchor: { month: string; amount: number } | null;
}

export interface PlanLine {
  /** "invoice:12", "reminder:4@2026-11-01" (dönemin asıl vadesi), "salary@2026-11-01", "sgk@2026-10-31", "kdv@2026-11-28", "fixed", "goods", "sales", "online" */
  key: string;
  kind: PlanKind;
  direction: "in" | "out";
  /** "Sütaş", "Kira", "Maaşlar (Ekim)", "SGK primi (Eylül)", "Sabit giderler", "Mal alımı (yeni faturalar)", "Satışlar", "laffogato.net online" */
  title: string;
  /** Yayılan satırlarda null */
  date: string | null;
  /** Gecikmiş satırın asıl vadesi (satır bugüne yazılır) */
  due?: string;
  amount: number;
  estimated: boolean;
  overdue: boolean;
  /** "Fatura 2026-123 · vade tahmini (30 gün)" / "Kira 37.300 ₺ · Influencer 11.700 ₺ …" */
  detail?: string;
  href?: string;
}

export interface PlanWeek {
  index: number;
  from: string;
  to: string;
  in: number;
  outKnown: number;
  outEstimated: number;
  net: number;
  /** Bakiye girilmişse hafta sonu bakiyesi */
  endBalance: number | null;
  /** Bugünden bu haftanın sonuna birikimli net */
  cumulative: number;
  /** Haftanın en düşük günü (bakiye ya da birikimli) */
  low: { date: string; value: number };
  /** Kesinler tarih sırasıyla, sonra tahminler, sonra gelenler */
  lines: PlanLine[];
}

export interface EstimateRow {
  key: string;
  title: string;
  monthly: number;
  /** on: tahmine katılıyor; off: kapatıldı; covered: Ödemeler'de karşılığı var; yearly: yıllık, plana girmez */
  status: "on" | "off" | "covered" | "yearly";
  note?: string;
  direction: "in" | "out";
}

export interface VatRow {
  /** "kdv@2026-11-28" | "reminder:4@2026-10-28" */
  key: string;
  period: string;
  date: string;
  /** Gecikmiş dönemin asıl vadesi */
  due: string;
  overdue: boolean;
  source: "estimate" | "reminder";
  /** Plana giren (kapalıyken gösterilen) tutar; null = hesaplanamadı */
  amount: number | null;
  estimate: VatEstimate | null;
  reminderId: number | null;
}

/** 2 No.lu KDV (tevkifat): dönemin alış faturalarındaki tevkifat, izleyen ayın 25'inde */
export interface Vat2Row {
  /** "kdv2@2026-10-25" */
  key: string;
  period: string;
  date: string;
  /** 100'e yuvarlı */
  amount: number;
  /** Ödemeler'deki KDV-2 hatırlatıcısının bu döneme günü var: plana hatırlatıcı girer (tutarı ya da bu tahmin) */
  covered: boolean;
}

export interface CashPlanVat {
  mode: "default" | "reminder" | "excluded";
  /** KDV hatırlatıcısı varken kapatıldıysa "reminder" (yerleşim hatırlatıcının günlerine göre) */
  baseMode: "default" | "reminder";
  rows: VatRow[];
  /** 2 No.lu KDV (tevkifat) ödemeleri; 1 No.lu beyannamede indirilir, devreden olsa da ödenir */
  vat2: Vat2Row[];
  anchor: { month: string; amount: number } | null;
  /** Muhasebeci kaydı yokken zincirin başladığı ay (ilk satış ayı) */
  chainFrom: string | null;
  rates: { kdv: number; kdvHizmet: number };
  hasSite: boolean;
  /** En az bir dönem tahmin edilebildi */
  ok: boolean;
}

export interface CashPlan {
  today: string;
  end: string;
  opening: { amount: number; date: string; staleDays: number } | null;
  weeks: PlanWeek[];
  totals: { in: number; outKnown: number; outEstimated: number; net: number; endBalance: number | null };
  /** Bakiye girilmişse ilk eksi gün ve o günün en büyük iki gideri */
  firstNegative: { date: string; balance: number; top: PlanLine[] } | null;
  /** En düşük gün (bakiye ya da bugünden birikimli net) */
  lowest: { date: string; value: number; basis: "balance" | "cumulative" } | null;
  /** Bakiye yokken ödemeleri yapabilmek için bugün gereken en az para; bakiye varken 0 */
  requiredCash: number;
  basis: {
    sales:
      | { kind: "kasa"; reports: number; daily: number; cardShare: number; platformShare: number }
      | { kind: "pos"; month: string; daily: number; openDays: number; cardShare: number }
      | { kind: "none" };
    online: { month: string; perDay: number } | null;
    goods: { spanDays: number; weekly: number; top: { supplier: string; weekly: number; lagDays: number }[] } | null;
    payroll: { people: number; net: number; sgk: number } | null;
    /** default: her ayın 1'i / son günü; carrier: tutarsız hatırlatıcının gününde; reminder: hatırlatıcıdaki tutar */
    salaryMode: "default" | "carrier" | "reminder";
    sgkMode: "default" | "carrier" | "reminder";
    fixedSpread: { count: number; monthly: number };
    overdueInvoices: number;
  };
  /** Plana girmeyen, tutarı girilmemiş hatırlatıcılar (ad ve ilk tarih) */
  unknownAmounts: { reminderId: number; title: string; date: string }[];
  /** Yıllık sabit giderler: günü bilinmediği için plana girmez */
  notIncluded: { title: string; amount: number; period: FixedPeriod }[];
  estimates: EstimateRow[];
  vat: CashPlanVat | null;
  excluded: string[];
  hasData: boolean;
}

/** components/ui/filters.tsx `fold` ile aynı: Ödemeler'deki "Listede var" eşleşmesiyle aynı sonucu verir (lib istemci dosyası içe aktarmaz) */
export function foldName(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Hatırlatıcının plan içindeki dönemleri. Geciken dönem bugüne yazılır (asıl vadesiyle); sonra bugünden itibaren
 * `end`'e kadarki bütün dönemler (aradaki kaçan dönemler sayılmaz: Ödemeler'deki kural).
 */
export function reminderOccurrences(r: Pick<ReminderRow, "dueDate" | "repeat" | "anchorDate">, today: string, end: string): { date: string; due: string; overdue: boolean }[] {
  const out: { date: string; due: string; overdue: boolean }[] = [];
  let d: string | null = r.dueDate;
  if (d < today) {
    out.push({ date: today, due: d, overdue: true });
    if (r.repeat === "none") return out;
    d = nextOccurrence(d, r.repeat, r.anchorDate);
    for (let g = 0; d && d < today && g < 400; g++) d = nextOccurrence(d, r.repeat, r.anchorDate);
  }
  for (let g = 0; d && d <= end && g < 400; g++) {
    out.push({ date: d, due: d, overdue: false });
    if (r.repeat === "none") break;
    d = nextOccurrence(d, r.repeat, r.anchorDate);
  }
  return out;
}

/**
 * Yeni mal faturası tahmininin girdisi: mal faturaları (kafe dışı, demirbaş ve komisyon girmez) son 8 haftadan;
 * aralık en eski mal faturasından kısaysa o kadar. 14 günden kısa geçmişte tahmin yok (`spanDays` 0).
 */
export function goodsRows(
  invoices: readonly { supplier: string; date: string; payable: number; category: string }[],
  today: string,
  lagOf: (supplier: string) => number,
): { rows: CashPlanInput["goods"]; spanDays: number } {
  const goods = invoices.filter((i) => GOODS_CATEGORIES.includes(i.category) && i.date < today);
  const oldest = goods.reduce<string | null>((a, i) => (a === null || i.date < a ? i.date : a), null);
  if (!oldest) return { rows: [], spanDays: 0 };
  const span = Math.min(GOODS_LOOKBACK_DAYS, daysBetween(oldest, today));
  if (span < MIN_GOODS_DAYS) return { rows: [], spanDays: 0 };
  const from = addDays(today, -span);
  const lags = new Map<string, number>();
  const rows = goods
    .filter((i) => i.date >= from)
    .map((i) => {
      if (!lags.has(i.supplier)) lags.set(i.supplier, Math.max(0, Math.round(lagOf(i.supplier))));
      return { supplier: i.supplier, date: i.date, payable: i.payable, lagDays: lags.get(i.supplier)! };
    });
  return { rows, spanDays: span };
}

/** Son online satış ayının günlük ortalaması: kapanmış ayda ayın gün sayısıyla, süren ayda geçen günle (7'den azsa önceki ay) */
function onlineBasis(model: Model, today: string): CashPlanInput["online"] {
  const cur = today.slice(0, 7);
  const months = model.siteMonths.filter((m) => m <= cur);
  for (let k = months.length - 1; k >= 0; k--) {
    const m = months[k];
    const rec = model.siteSales(m);
    if (!rec) continue;
    let days = daysInMonth(m);
    if (!rec.closed && m === cur) {
      const t = Date.parse(rec.pulledAt);
      const pulled = Number.isFinite(t) ? todayTR(new Date(t)) : today;
      days = Number((pulled.slice(0, 7) === m ? pulled : today).slice(8, 10)) - 1;
      if (days < 7) continue;
    }
    return { month: m, perDay: (rec.cafe.netMinor + rec.shop.netMinor + rec.karaoke.netMinor) / 100 / days };
  }
  return null;
}

/** Modelden planın girdileri: oranlar, POS yedeği, online, bordro ve sabit giderler (önceki aylardan ufkun sonuna), KDV */
export function planInputFromModel(model: Model, today: string): Pick<CashPlanInput, "settings" | "posMonth" | "online" | "months" | "fixedNames" | "vat"> {
  const st = model.settings;
  const cur = today.slice(0, 7);
  const pos = [...model.monthInfo.values()]
    .filter((m) => m.month <= cur && (m.openDays ?? 0) > 0 && (m.posRevenue ?? 0) > 0)
    .sort((a, b) => a.month.localeCompare(b.month))
    .at(-1);
  const months: Record<string, CashPlanInput["months"][string]> = {};
  const last = addDays(today, PLAN_DAYS - 1).slice(0, 7);
  // Gecikmiş maaş / SGK hatırlatıcısının bordrosu için iki ay geriden
  for (let m = shiftMonth(cur, -2); m <= last; m = shiftMonth(m, 1)) {
    const p = model.personnelFor(m);
    months[m] = {
      payroll: { net: p.net + p.extras, sgk: p.deductions + p.employerSgk + p.employerUnemployment, people: p.rows.length },
      fixed: model.fixedInMonth(m).map((f) => ({ id: f.id, name: f.name, period: f.period, amount: f.amount })),
    };
  }
  return {
    settings: { komisyon: st.komisyon, kartOrani: st.kartOrani, acikGun: st.acikGun, kdv: st.kdv, kdvHizmet: st.kdvHizmet },
    posMonth: pos ? { month: pos.month, posRevenue: pos.posRevenue!, openDays: pos.openDays! } : null,
    online: onlineBasis(model, today),
    months,
    fixedNames: model.ds.fixedExpenses.map((f) => ({ id: f.id, name: f.name, period: f.period })),
    vat: vatMonthInputs(model, today),
  };
}

/** "Bu hafta" | "Gelecek hafta" | "3. hafta" */
export function weekTitle(index: number): string {
  return index === 0 ? "Bu hafta" : index === 1 ? "Gelecek hafta" : `${index + 1}. hafta`;
}

const shortMonth = (date: string) => MONTH_NAMES[Number(date.slice(5, 7)) - 1].slice(0, 3);
const dayOf = (date: string) => Number(date.slice(8, 10));

// Gün ile ay arasında bölünmez boşluk (satır sarılınca tarih bölünmesin)
const NBSP = "\u00a0";

/** "22–28 Eki"; ay geçişinde "29 Eki – 4 Kas" */
export function rangeText(from: string, to: string): string {
  return from.slice(0, 7) === to.slice(0, 7) ? `${dayOf(from)}–${dayOf(to)}${NBSP}${shortMonth(to)}` : `${shortDate(from)} – ${shortDate(to)}`;
}

/** "1 Kas" */
export function shortDate(date: string): string {
  return `${dayOf(date)}${NBSP}${shortMonth(date)}`;
}

/** Satırın etiketi, tahminiyse belirtilerek: "Maaşlar (Ekim, tahmini)", "Kira (tahmini)" */
export function lineLabel(l: Pick<PlanLine, "title" | "estimated">): string {
  if (!l.estimated) return l.title;
  return l.title.endsWith(")") ? `${l.title.slice(0, -1)}, tahmini)` : `${l.title} (tahmini)`;
}

/** Sabit giderin aylık karşılığı (notlar ve Tahmine katılanlar için; günlük gider ayda en çok 30 açık gün) */
function monthlyOf(f: Pick<FixedItem, "period" | "amount">, acikGun: number): number {
  if (f.period === "gunluk") return f.amount * Math.min(30, acikGun);
  if (f.period === "haftalik") return (f.amount * 52) / 12;
  if (f.period === "yillik") return f.amount / 12;
  return f.amount;
}

type RemClass = { kind: "fixed"; id: number } | { kind: "salary" } | { kind: "sgk" } | { kind: "kdv" } | { kind: "kdv2" } | { kind: "other" };

const hasAmount = (r: Pick<ReminderRow, "amount">) => r.amount !== null && r.amount > 0;

export function buildCashPlan(input: CashPlanInput): CashPlan {
  const { today, settings: st } = input;
  const N = PLAN_DAYS;
  const dates = Array.from({ length: N }, (_, i) => addDays(today, i));
  const end = dates[N - 1];
  const excluded = new Set(input.excluded);
  const off = (key: string) => excluded.has(key);
  const dayIndex = (date: string) => Math.max(0, daysBetween(today, date));
  const monthOfDay = (i: number) => dates[i].slice(0, 7);
  const monthKeys = Object.keys(input.months).sort();
  /** Ayın bordrosu; kayıt yoksa en yakın ayınki */
  const payrollOf = (m: string) => {
    const hit = input.months[m] ?? input.months[m < (monthKeys[0] ?? "") ? monthKeys[0] : (monthKeys.at(-1) ?? "")];
    return hit?.payroll ?? { net: 0, sgk: 0, people: 0 };
  };
  const fixedIn = (m: string) => input.months[m]?.fixed ?? [];

  // Günü belli satırlar (kesinler ve hatırlatıcının, maaşın, SGK'nın, KDV'nin tahmini); gün dizini tarihinden
  const dated: PlanLine[] = [];
  const dayOfLine = (l: PlanLine) => dayIndex(l.date!);
  const unknown = new Map<number, { reminderId: number; title: string; date: string }>();
  const addUnknown = (r: ReminderRow, date: string) => {
    const cur = unknown.get(r.id);
    if (!cur || date < cur.date) unknown.set(r.id, { reminderId: r.id, title: r.title, date });
  };
  // Anahtar dönemin asıl vadesinden: geciken dönem ile bugünkü dönem aynı güne düşse de (haftalık, bir hafta geciken)
  // iki satır ayrı kalır
  const reminderLine = (r: ReminderRow, o: { date: string; due: string; overdue: boolean }, extra: Partial<PlanLine> = {}) => {
    dated.push({
      key: `reminder:${r.id}@${o.due}`,
      kind: "reminder",
      direction: "out",
      title: r.title,
      date: o.date,
      ...(o.overdue ? { due: o.due } : {}),
      amount: r.amount ?? 0,
      estimated: false,
      overdue: o.overdue,
      href: "/panel/hatirlaticilar",
      ...extra,
    });
  };

  // ------------------------------------------------------------ Satışlar ve online (gelen, tahmini, yarından)
  const lookFrom = addDays(today, -SALES_LOOKBACK_DAYS);
  const reports = input.cashReports.filter((r) => r.date >= lookFrom && r.date < today && r.zTotal > 0);
  let sales: CashPlan["basis"]["sales"] = { kind: "none" };
  if (reports.length >= MIN_SALES_REPORTS) {
    const z = reports.reduce((a, r) => a + r.zTotal, 0);
    const card = reports.reduce((a, r) => a + r.card + r.mealCard, 0);
    const platform = reports.reduce((a, r) => a + (r.online ?? 0), 0);
    const share = (v: number) => Math.min(1, Math.max(0, v / z));
    sales = { kind: "kasa", reports: reports.length, daily: z / reports.length, cardShare: share(card), platformShare: share(platform) };
  } else if (input.posMonth && input.posMonth.openDays > 0 && input.posMonth.posRevenue > 0) {
    sales = { kind: "pos", month: input.posMonth.month, daily: input.posMonth.posRevenue / input.posMonth.openDays, openDays: input.posMonth.openDays, cardShare: st.kartOrani };
  }
  const openRatio = Math.min(1, st.acikGun / 30);
  // Kartla ödenen pay için banka komisyonu düşülür; günlük ortalama açık gün oranıyla takvim gününe çevrilir
  const salesPerDay = sales.kind === "none" ? 0 : sales.daily * (1 - st.komisyon * sales.cardShare) * openRatio;
  const salesIn = dates.map((_, i) => (i >= 1 && !off("sales") ? salesPerDay : 0));
  const onlineIn = dates.map((_, i) => (i >= 1 && input.online && !off("online") ? input.online.perDay : 0));

  // ------------------------------------------------------------ Faturalar (kesin)
  let overdueInvoices = 0;
  for (const it of input.invoices) {
    if (it.source !== "invoice") continue;
    const d = daysBetween(today, it.dueDate);
    if (d > N - 1) continue;
    if (d < 0) overdueInvoices++;
    dated.push({
      key: `invoice:${it.sourceId}`,
      kind: "invoice",
      direction: "out",
      title: it.title,
      date: d < 0 ? today : it.dueDate,
      ...(d < 0 ? { due: it.dueDate } : {}),
      amount: it.amount ?? 0,
      estimated: false,
      overdue: d < 0,
      detail: it.detail ?? undefined,
      href: "/panel/hatirlaticilar?kaynak=fatura",
    });
  }

  // ------------------------------------------------------------ Hatırlatıcılar: sınıf ve dönemler
  const fixedByName = new Map<string, { id: number; period: FixedPeriod }>();
  for (const f of [...input.fixedNames].sort((a, b) => a.id - b.id)) {
    const k = foldName(f.name);
    if (!fixedByName.has(k)) fixedByName.set(k, { id: f.id, period: f.period });
  }
  const classify = (r: ReminderRow): RemClass => {
    const f = fixedByName.get(foldName(r.title));
    if (f) return { kind: "fixed", id: f.id };
    const cat = reminderCategory(r.kind, r.title);
    // "Sabit giderlerden ekle" personel kalemini maaş türüyle açar (Muhasebeci, Part-time çalışan): gider silinir ya da
    // adı değişince ad eşleşmesi kalkar, ama bu hatırlatıcı bordro değildir; maaşı ya da SGK'yı kapatmaz, taşımaz
    if ((cat === "maas" || cat === "sgk") && r.note?.startsWith(FIXED_REMINDER_NOTE)) return { kind: "other" };
    if (cat === "maas") return { kind: "salary" };
    if (cat === "sgk") return { kind: "sgk" };
    if (isVatWithholdingReminder(r)) return { kind: "kdv2" };
    if (isVatReminder(r)) return { kind: "kdv" };
    return { kind: "other" };
  };
  const active = input.reminders.filter((r) => r.active).sort((a, b) => a.id - b.id);
  const salaryRems: ReminderRow[] = [];
  const sgkRems: ReminderRow[] = [];
  const vatRems: ReminderRow[] = [];
  const vat2Rems: ReminderRow[] = [];
  const covered = new Set<number>();
  for (const r of active) {
    const c = classify(r);
    if (c.kind === "salary") salaryRems.push(r);
    else if (c.kind === "sgk") sgkRems.push(r);
    else if (c.kind === "kdv") vatRems.push(r);
    else if (c.kind === "kdv2") vat2Rems.push(r);
    else if (c.kind === "fixed") {
      // Gideri bir hatırlatıcı karşılıyor: ay içine yayılmaz; tutarsızsa hatırlatıcının günlerine giderin tutarı
      covered.add(c.id);
      for (const o of reminderOccurrences(r, today, end)) {
        if (hasAmount(r)) reminderLine(r, o);
        else if (r.amount === null && !off(`fixed:${c.id}`)) {
          const f = fixedIn(o.due.slice(0, 7)).find((x) => x.id === c.id) ?? fixedIn(o.date.slice(0, 7)).find((x) => x.id === c.id);
          const amount = f ? (f.period === "gunluk" ? f.amount * Math.min(30, st.acikGun) : f.amount) : 0;
          if (amount > 0) reminderLine(r, o, { kind: "fixed", amount, estimated: true, detail: "Sabit giderdeki tutar" });
          else addUnknown(r, o.date);
        }
      }
    } else {
      for (const o of reminderOccurrences(r, today, end)) {
        if (hasAmount(r)) reminderLine(r, o);
        else if (r.amount === null) addUnknown(r, o.date);
      }
    }
  }

  // ------------------------------------------------------------ Maaş ve SGK (personel)
  const salaryMonthOf = (date: string) => (dayOf(date) <= 15 ? shiftMonth(date.slice(0, 7), -1) : date.slice(0, 7));
  const sgkMonthOf = (date: string) => shiftMonth(date.slice(0, 7), -1);
  const staffLines = (
    rems: ReminderRow[],
    key: "salary" | "sgk",
    amountFor: (date: string) => { amount: number; month: string },
    title: (month: string) => string,
    defaultDays: number[],
  ): "default" | "carrier" | "reminder" => {
    const anyAmount = rems.some(hasAmount);
    if (!rems.length) {
      if (off(key)) return "default";
      for (const i of defaultDays) {
        const { amount, month } = amountFor(dates[i]);
        if (amount > 0) dated.push({ key: `${key}@${dates[i]}`, kind: key, direction: "out", title: title(month), date: dates[i], amount, estimated: true, overdue: false });
      }
      return "default";
    }
    // Taşıyıcı: tutarlı hatırlatıcı yoksa kimliği en küçük olan bordro tutarını taşır; ötekiler tutarsız kalır
    const carrier = anyAmount ? null : rems[0].id;
    for (const r of rems) {
      for (const o of reminderOccurrences(r, today, end)) {
        if (hasAmount(r)) reminderLine(r, o);
        else if (r.amount !== null) continue;
        else if (r.id === carrier) {
          if (off(key)) continue;
          const { amount, month } = amountFor(o.due);
          if (amount > 0) reminderLine(r, o, { kind: key, amount, estimated: true, title: `${r.title} (${MONTH_NAMES[Number(month.slice(5, 7)) - 1]})` });
        } else addUnknown(r, o.date);
      }
    }
    return anyAmount ? "reminder" : "carrier";
  };
  const firsts = dates.map((d, i) => (i >= 1 && d.endsWith("-01") ? i : -1)).filter((i) => i >= 0);
  const lasts = dates.map((d, i) => (i >= 1 && monthEnd(d) === d ? i : -1)).filter((i) => i >= 0);
  const salaryMode = staffLines(
    salaryRems,
    "salary",
    (date) => {
      const month = salaryMonthOf(date);
      return { amount: payrollOf(month).net, month };
    },
    (month) => `Maaşlar (${MONTH_NAMES[Number(month.slice(5, 7)) - 1]})`,
    firsts,
  );
  const sgkMode = staffLines(
    sgkRems,
    "sgk",
    (date) => {
      const month = sgkMonthOf(date);
      return { amount: payrollOf(month).sgk, month };
    },
    (month) => `SGK primi (${MONTH_NAMES[Number(month.slice(5, 7)) - 1]})`,
    lasts,
  );

  // ------------------------------------------------------------ KDV (src/lib/kdv.ts)
  const vatBaseMode: "default" | "reminder" = vatRems.length ? "reminder" : "default";
  const vatMode = off("kdv") ? "excluded" : vatBaseMode;
  const known = new Map<string, number>();
  const claimed = new Set<string>();
  const knownRows: VatRow[] = [];
  const placements: { period: string; date: string; due: string; overdue: boolean; reminder: ReminderRow | null }[] = [];
  if (vatBaseMode === "reminder") {
    const occs = vatRems.flatMap((r) => reminderOccurrences(r, today, end).map((o) => ({ r, o, first: o.due === r.dueDate, period: vatPeriodOf(o.due) })));
    // Ödemeler'e yazılan tutar yalnız hatırlatıcının kayıtlı (sıradaki ya da geciken) dönemine aittir
    for (const x of occs) {
      if (!x.first || x.r.amount === null) continue;
      if (x.r.amount > 0) reminderLine(x.r, x.o);
      known.set(x.period, x.r.amount);
      claimed.add(x.period);
      knownRows.push({ key: `reminder:${x.r.id}@${x.o.due}`, period: x.period, date: x.o.date, due: x.o.due, overdue: x.o.overdue, source: "reminder", amount: x.r.amount, estimate: null, reminderId: x.r.id });
    }
    const rest = occs.filter((x) => !(x.first && x.r.amount !== null)).sort((a, b) => a.o.date.localeCompare(b.o.date) || a.r.id - b.r.id);
    for (const x of rest) {
      if (claimed.has(x.period)) addUnknown(x.r, x.o.date);
      else {
        claimed.add(x.period);
        placements.push({ period: x.period, date: x.o.date, due: x.o.due, overdue: x.o.overdue, reminder: x.r });
      }
    }
  } else {
    // Hatırlatıcı yok: her dönem ayın 28'inde, yarından itibaren (bugünkü ödeme elinizdeki paradan)
    for (let p = shiftMonth(today.slice(0, 7), -2); vatDueDate(p) <= end; p = shiftMonth(p, 1)) {
      const due = vatDueDate(p);
      if (due > today) placements.push({ period: p, date: due, due, overdue: false, reminder: null });
    }
  }
  const vatPeriods = [...new Set([...placements.map((p) => p.period), ...known.keys()])].sort();
  const estimates = vatEstimates({
    today,
    months: input.vat.months,
    firstSalesMonth: input.vat.firstSalesMonth,
    anchor: input.vatAnchor,
    known,
    periods: vatPeriods,
    hasSite: input.vat.hasSite,
  });
  const vatRows: VatRow[] = knownRows.map((r) => ({ ...r, estimate: estimates.get(r.period) ?? null }));
  const usedKeys = new Set<string>();
  for (const p of placements) {
    const e = estimates.get(p.period) ?? null;
    const ok = e?.status === "ok";
    let key = `kdv@${p.date}`;
    if (usedKeys.has(key)) key = `kdv@${p.date}#${p.period}`;
    usedKeys.add(key);
    vatRows.push({ key, period: p.period, date: p.date, due: p.due, overdue: p.overdue, source: "estimate", amount: ok ? e!.payable : null, estimate: e, reminderId: p.reminder?.id ?? null });
    if (vatMode === "excluded") {
      // Kapalı: kesinler yazıldı; tutarsız KDV dönemleri tutarı girilmemiş ödeme olarak görünür
      if (p.reminder) addUnknown(p.reminder, p.date);
      continue;
    }
    if (!ok) {
      if (p.reminder) addUnknown(p.reminder, p.date);
      continue;
    }
    if (e!.payable > 0) {
      dated.push({
        key,
        kind: "kdv",
        direction: "out",
        title: `KDV (${MONTH_NAMES[Number(p.period.slice(5, 7)) - 1]})`,
        date: p.date,
        ...(p.overdue ? { due: p.due } : {}),
        amount: e!.payable,
        estimated: true,
        overdue: p.overdue,
        detail: vatLineDetail(e!),
        href: "#kdv",
      });
    }
  }
  vatRows.sort((a, b) => a.date.localeCompare(b.date) || a.period.localeCompare(b.period));
  // KDV-2 (tevkifat): alış faturalarındaki tevkifat izleyen ayın 25'inde 2 No.lu beyannameyle ödenir; 1 No.lu
  // beyannamede indirilir (alışların içinde), o ay ödenecek çıkmasa da (Eylül 2026: devreden 121.204,69, KDV-2
  // 1.800 ₺). Tahminler yarından. Ödemeler'deki KDV-2 hatırlatıcısı yalnız günlerinin dönemlerini karşılar: yazılı
  // tutarı her gününde kesindir; tutarsızsa tahmin hatırlatıcının gününde girer, tahmin yoksa tutarı girilmemiş ödemedir.
  const withheldOf = new Map(input.vat.months.map((m) => [m.month, round100(m.purchases.withheld)]));
  const vat2Claimed = new Set<string>();
  for (const r of vat2Rems) {
    for (const o of reminderOccurrences(r, today, end)) {
      const period = vatPeriodOf(o.due);
      vat2Claimed.add(period);
      if (r.amount !== null) {
        if (r.amount > 0) reminderLine(r, o);
        continue;
      }
      const amount = withheldOf.get(period);
      if (vatMode === "excluded" || amount === undefined) addUnknown(r, o.date);
      else if (amount > 0)
        reminderLine(r, o, {
          kind: "kdv",
          amount,
          estimated: true,
          title: `${r.title} (${MONTH_NAMES[Number(period.slice(5, 7)) - 1]})`,
          detail: vat2LineDetail(period),
          href: "#kdv",
        });
    }
  }
  const vat2: Vat2Row[] = [];
  for (const m of input.vat.months) {
    const date = vat2DueDate(m.month);
    const amount = round100(m.purchases.withheld);
    if (date <= today || date > end || amount <= 0) continue;
    const row: Vat2Row = { key: `kdv2@${date}`, period: m.month, date, amount, covered: vat2Claimed.has(m.month) };
    vat2.push(row);
    if (vatMode === "excluded" || row.covered) continue;
    dated.push({
      key: row.key,
      kind: "kdv",
      direction: "out",
      title: `KDV-2 (${MONTH_NAMES[Number(m.month.slice(5, 7)) - 1]})`,
      date,
      amount,
      estimated: true,
      overdue: false,
      detail: vat2LineDetail(m.month),
      href: "#kdv",
    });
  }
  const vat: CashPlanVat | null =
    !input.vat.months.length && !vatRems.length
      ? null
      : {
          mode: vatMode,
          baseMode: vatBaseMode,
          rows: vatRows,
          vat2,
          anchor: input.vatAnchor,
          chainFrom: input.vatAnchor ? null : input.vat.firstSalesMonth,
          rates: { kdv: st.kdv, kdvHizmet: st.kdvHizmet },
          hasSite: input.vat.hasSite,
          ok: vatRows.some((r) => r.estimate?.status === "ok"),
        };

  // ------------------------------------------------------------ Sabit giderler (yayılan, tahmini, yarından)
  const fixedOut = dates.map(() => 0);
  const fixedParts = new Map<number, { name: string; perDay: number[] }>();
  const spreadable = (f: FixedItem) => f.amount > 0 && f.period !== "yillik" && !covered.has(f.id) && !off(`fixed:${f.id}`);
  for (let i = 1; i < N; i++) {
    const m = monthOfDay(i);
    const dim = daysInMonth(m);
    for (const f of fixedIn(m)) {
      if (!spreadable(f)) continue;
      const v = f.period === "aylik" ? f.amount / dim : f.period === "haftalik" ? f.amount / 7 : f.amount * openRatio;
      fixedOut[i] += v;
      const part = fixedParts.get(f.id) ?? { name: f.name, perDay: dates.map(() => 0) };
      part.perDay[i] += v;
      fixedParts.set(f.id, part);
    }
  }
  // Ufuktaki bütün sabit giderler (ilk göründükleri ayın tutarıyla): Tahmine katılanlar ve yıllıklar
  const horizonFixed = new Map<number, FixedItem>();
  for (const m of monthKeys.filter((m) => m >= today.slice(0, 7) && m <= end.slice(0, 7))) for (const f of fixedIn(m)) if (!horizonFixed.has(f.id)) horizonFixed.set(f.id, f);
  const spreadNow = [...horizonFixed.values()].filter(spreadable);
  // Yıllık gider günü bilinmediği için plana girmez (Ödemeler'de hatırlatıcısı varsa onun gününde girer)
  const notIncluded = [...horizonFixed.values()].filter((f) => f.period === "yillik" && f.amount > 0 && !covered.has(f.id)).map((f) => ({ title: f.name, amount: f.amount, period: f.period }));

  // ------------------------------------------------------------ Mal alımı (yeni faturalar, tahmini)
  const goodsOut = dates.map(() => 0);
  const goodsParts = new Map<string, number[]>();
  const goodsOk = input.goodsSpanDays >= MIN_GOODS_DAYS;
  if (goodsOk && !off("goods")) {
    for (const g of input.goods) {
      const rate = g.payable / input.goodsSpanDays;
      // Bugünden sonra kesilecek fatura vadesinde ödenir: gecikmesi i − 1 günü geçmeyenler i. günde ödenmiş olur
      for (let i = Math.max(1, g.lagDays + 1); i < N; i++) {
        goodsOut[i] += rate;
        const part = goodsParts.get(g.supplier) ?? dates.map(() => 0);
        part[i] += rate;
        goodsParts.set(g.supplier, part);
      }
    }
  }
  let goodsBasis: CashPlan["basis"]["goods"] = null;
  if (goodsOk) {
    const bySupplier = new Map<string, { total: number; lagDays: number }>();
    for (const g of input.goods) {
      const cur = bySupplier.get(g.supplier) ?? { total: 0, lagDays: g.lagDays };
      cur.total += g.payable;
      bySupplier.set(g.supplier, cur);
    }
    const weeklyOf = (total: number) => (total / input.goodsSpanDays) * 7;
    goodsBasis = {
      spanDays: input.goodsSpanDays,
      weekly: weeklyOf(input.goods.reduce((a, g) => a + g.payable, 0)),
      top: [...bySupplier]
        .map(([supplier, v]) => ({ supplier, weekly: weeklyOf(v.total), lagDays: v.lagDays }))
        .sort((a, b) => b.weekly - a.weekly)
        .slice(0, 4),
    };
  }

  // ------------------------------------------------------------ Günler, bakiye, haftalar
  const outKnown = dates.map(() => 0);
  const outEst = dates.map(() => 0);
  for (const l of dated) {
    if (l.estimated) outEst[dayOfLine(l)] += l.amount;
    else outKnown[dayOfLine(l)] += l.amount;
  }
  const inDay = dates.map((_, i) => salesIn[i] + onlineIn[i]);
  const outDay = dates.map((_, i) => outKnown[i] + outEst[i] + fixedOut[i] + goodsOut[i]);
  const opening = input.opening;
  const cum: number[] = [];
  const bal: number[] = [];
  dates.forEach((_, i) => {
    cum[i] = (i ? cum[i - 1] : 0) + inDay[i] - outDay[i];
    bal[i] = (opening?.amount ?? 0) + cum[i];
  });
  const track = opening ? bal : cum;

  const topParts = (parts: Iterable<[string, number[]]>, from: number, to: number, max = 4) =>
    [...parts]
      .map(([name, perDay]) => ({ name, sum: perDay.slice(from, to + 1).reduce((a, b) => a + b, 0) }))
      .filter((x) => x.sum >= 0.5)
      .sort((a, b) => b.sum - a.sum)
      .slice(0, max);
  const fixedNamed = () => [...fixedParts.values()].map((p) => [p.name, p.perDay] as [string, number[]]);

  const weeks: PlanWeek[] = [];
  for (let w = 0; w < PLAN_WEEKS; w++) {
    const a = w * 7;
    const b = a + 6;
    const inWeek = (l: PlanLine) => dayOfLine(l) >= a && dayOfLine(l) <= b;
    const byDay = (x: PlanLine, y: PlanLine) => dayOfLine(x) - dayOfLine(y) || y.amount - x.amount;
    const knownLines = dated.filter((l) => inWeek(l) && !l.estimated).sort(byDay);
    const estLines = dated.filter((l) => inWeek(l) && l.estimated).sort(byDay);
    const sum = (xs: number[]) => xs.slice(a, b + 1).reduce((s, v) => s + v, 0);
    const spread: PlanLine[] = [];
    const fixedSum = sum(fixedOut);
    if (fixedSum >= 0.5) {
      spread.push({
        key: "fixed",
        kind: "fixed",
        direction: "out",
        title: "Sabit giderler",
        date: null,
        amount: fixedSum,
        estimated: true,
        overdue: false,
        detail: `Ay içine yayıldı: ${topParts(fixedNamed(), a, b)
          .map((x) => `${x.name} ${tl(x.sum)}`)
          .join(" · ")}${fixedParts.size > 4 ? " …" : ""}`,
      });
    }
    const goodsSum = sum(goodsOut);
    if (goodsSum >= 0.5) {
      spread.push({
        key: "goods",
        kind: "goods",
        direction: "out",
        title: "Mal alımı (yeni faturalar)",
        date: null,
        amount: goodsSum,
        estimated: true,
        overdue: false,
        detail: topParts(goodsParts, a, b)
          .map((x) => `${x.name} ${tl(x.sum)}`)
          .join(" · "),
      });
    }
    const incoming: PlanLine[] = [];
    const salesSum = sum(salesIn);
    if (salesSum >= 0.5) incoming.push({ key: "sales", kind: "sales", direction: "in", title: "Satışlar", date: null, amount: salesSum, estimated: true, overdue: false });
    const onlineSum = sum(onlineIn);
    if (onlineSum >= 0.5) incoming.push({ key: "online", kind: "online", direction: "in", title: "laffogato.net online", date: null, amount: onlineSum, estimated: true, overdue: false });
    let low = { date: dates[a], value: track[a] };
    for (let i = a + 1; i <= b; i++) if (track[i] < low.value) low = { date: dates[i], value: track[i] };
    const wIn = sum(inDay);
    const wKnown = sum(outKnown);
    const wEst = sum(outEst) + fixedSum + goodsSum;
    weeks.push({
      index: w,
      from: dates[a],
      to: dates[b],
      in: wIn,
      outKnown: wKnown,
      outEstimated: wEst,
      net: wIn - wKnown - wEst,
      endBalance: opening ? bal[b] : null,
      cumulative: cum[b],
      low,
      lines: [...knownLines, ...estLines, ...spread, ...incoming],
    });
  }

  let firstNegative: CashPlan["firstNegative"] = null;
  if (opening) {
    const i = bal.findIndex((v) => v < 0);
    if (i >= 0) {
      const dayLines: PlanLine[] = [
        ...dated.filter((l) => dayOfLine(l) === i),
        ...(fixedOut[i] >= 0.5 ? [{ key: "fixed", kind: "fixed" as const, direction: "out" as const, title: "Sabit giderler", date: null, amount: fixedOut[i], estimated: true, overdue: false }] : []),
        ...(goodsOut[i] >= 0.5 ? [{ key: "goods", kind: "goods" as const, direction: "out" as const, title: "Mal alımı (yeni faturalar)", date: null, amount: goodsOut[i], estimated: true, overdue: false }] : []),
      ];
      firstNegative = { date: dates[i], balance: bal[i], top: dayLines.sort((x, y) => y.amount - x.amount).slice(0, 2) };
    }
  }
  let lowI = 0;
  for (let i = 1; i < N; i++) if (track[i] < track[lowI]) lowI = i;
  const lowest = { date: dates[lowI], value: track[lowI], basis: opening ? ("balance" as const) : ("cumulative" as const) };

  // ------------------------------------------------------------ Tahmine katılanlar
  const cur = today.slice(0, 7);
  const payroll = payrollOf(cur);
  const estimatesRows: EstimateRow[] = [];
  const status = (key: string, coveredBy: boolean): EstimateRow["status"] => (coveredBy ? "covered" : off(key) ? "off" : "on");
  estimatesRows.push({
    key: "sales",
    title: "Satışlar",
    monthly: salesPerDay * 30,
    status: status("sales", false),
    note: sales.kind === "kasa" ? "son 28 günün kasa raporlarından" : sales.kind === "pos" ? `${monthLabel(sales.month)} POS cirosundan` : "satış verisi yok",
    direction: "in",
  });
  if (input.online) estimatesRows.push({ key: "online", title: "laffogato.net online", monthly: input.online.perDay * 30, status: status("online", false), note: `${monthLabel(input.online.month)} satışından`, direction: "in" });
  if (payroll.people > 0) {
    estimatesRows.push({
      key: "salary",
      title: "Maaşlar",
      monthly: payroll.net,
      status: status("salary", salaryMode === "reminder"),
      note: salaryMode === "reminder" ? "Ödemeler'de tutarlı hatırlatıcısı var" : salaryMode === "carrier" ? "Maaş hatırlatıcısının gününde" : "her ayın 1'inde",
      direction: "out",
    });
    estimatesRows.push({
      key: "sgk",
      title: "SGK primleri",
      monthly: payroll.sgk,
      status: status("sgk", sgkMode === "reminder"),
      note: sgkMode === "reminder" ? "Ödemeler'de tutarlı hatırlatıcısı var" : sgkMode === "carrier" ? "SGK hatırlatıcısının gününde" : "takip eden ayın son günü",
      direction: "out",
    });
  }
  estimatesRows.push({
    key: "goods",
    title: "Mal alımı (yeni faturalar)",
    monthly: goodsBasis ? (goodsBasis.weekly * 30) / 7 : 0,
    status: status("goods", false),
    note: goodsBasis ? `son ${num(goodsBasis.spanDays)} günün mal faturalarından, tedarikçinin vadesinde` : "en az 2 haftalık fatura gerekir",
    direction: "out",
  });
  if (vat) {
    const estRows = vat.rows.filter((r) => r.source === "estimate");
    const last = estRows.at(-1);
    const m = last ? MONTH_NAMES[Number(last.period.slice(5, 7)) - 1] : "";
    const when = vat.baseMode === "reminder" ? "KDV hatırlatıcısının gününde" : "Ayın 28'inde";
    // Satır yoksa KDV hatırlatıcısının sıradaki günü 6 haftanın dışındadır
    const what = !last ? (vat.rows.length ? "Ödemeler'deki tutarla" : "6 hafta içinde ödeme günü yok") : last.amount === null ? `${m} için hesaplanamadı` : last.amount > 0 ? `${m} için ≈ ${tl(last.amount)}` : `${m} için ödeme beklenmez`;
    estimatesRows.push({
      key: "kdv",
      title: "KDV tahmini",
      monthly: last?.amount ?? 0,
      status: vat.mode === "excluded" ? "off" : estRows.length ? "on" : "covered",
      note: `${when} · ${what}`,
      direction: "out",
    });
  }
  for (const f of [...horizonFixed.values()].filter((f) => f.amount > 0)) {
    const key = `fixed:${f.id}`;
    const st2: EstimateRow["status"] = covered.has(f.id) ? "covered" : f.period === "yillik" ? "yearly" : off(key) ? "off" : "on";
    estimatesRows.push({
      key,
      title: f.name,
      monthly: monthlyOf(f, st.acikGun),
      status: st2,
      note: st2 === "yearly" ? "Yıllık: gününü bilmek için Ödemeler'e ekleyin" : st2 === "covered" ? "Ödemeler'de hatırlatıcısı var" : "ay içine yayılır",
      direction: "out",
    });
  }

  const totalIn = inDay.reduce((a, b) => a + b, 0);
  const totalKnown = outKnown.reduce((a, b) => a + b, 0);
  const totalEst = dates.reduce((a, _, i) => a + outEst[i] + fixedOut[i] + goodsOut[i], 0);
  const unknownAmounts = [...unknown.values()].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "tr"));
  return {
    today,
    end,
    opening: opening ? { amount: opening.amount, date: opening.date, staleDays: Math.max(0, daysBetween(opening.date, today)) } : null,
    weeks,
    totals: { in: totalIn, outKnown: totalKnown, outEstimated: totalEst, net: totalIn - totalKnown - totalEst, endBalance: opening ? bal[N - 1] : null },
    firstNegative,
    lowest,
    requiredCash: opening ? 0 : Math.max(0, -Math.min(...cum)),
    basis: {
      sales,
      online: input.online,
      goods: goodsBasis,
      payroll: payroll.people > 0 ? payroll : null,
      salaryMode,
      sgkMode,
      fixedSpread: { count: spreadNow.length, monthly: spreadNow.reduce((a, f) => a + monthlyOf(f, st.acikGun), 0) },
      overdueInvoices,
    },
    unknownAmounts,
    notIncluded,
    estimates: estimatesRows,
    vat,
    excluded: [...excluded],
    hasData: weeks.some((w) => w.lines.length > 0) || unknownAmounts.length > 0,
  };
}

/** "Nasıl hesaplandı": her varsayım rakamlarıyla, bir satır */
export function planNotes(plan: CashPlan, opts: { komisyon: number; acikGun: number; invoiceTermDays: number }): { key: string; title: string; text: string }[] {
  const off = (key: string) => plan.excluded.includes(key);
  const b = plan.basis;
  const out: { key: string; title: string; text: string }[] = [];
  const s = b.sales;
  const commission = (share: number) => `Kartla ödenen ${pct(share, 0)} için ${pct(opts.komisyon, 1)} komisyon düşüldü; ayda ${num(opts.acikGun)} açık gün (Ayarlar).`;
  const fromTomorrow = "Tahmin yarından başlar: bugünkü satış elinizdeki paraya dahil sayılır.";
  out.push({
    key: "sales",
    title: "Satışlar",
    text: off("sales")
      ? "Satışlar tahmine katılmıyor (Tahmine katılanlar'dan açın)."
      : s.kind === "kasa"
        ? `Son 28 günün ${num(s.reports)} kasa raporuna göre günde ortalama ${tl(s.daily)} (Z toplamı${s.platformShare >= 0.005 ? `; Z'deki online platform ödemeleri (Yemeksepeti, Getir…) ${pct(s.platformShare, 0)}, aynı gün ve kesintisiz sayıldı` : ""}). ${commission(s.cardShare)} ${fromTomorrow}`
        : s.kind === "pos"
          ? `Son 28 günde yeterli kasa raporu yok; ${monthLabel(s.month)} POS cirosuna göre günde ${tl(s.daily)} (${num(s.openDays)} açık gün). ${commission(s.cardShare)} ${fromTomorrow}`
          : "Satış verisi yok: gelen para sayılmadı. Kasa raporu girildikçe tahmin oluşur.",
  });
  if (b.online) {
    out.push({
      key: "online",
      title: "laffogato.net online",
      text: off("online")
        ? "laffogato.net online satışları tahmine katılmıyor."
        : `laffogato.net ${monthLabel(b.online.month)} online satışına göre günde ${tl(b.online.perDay)} (iadeler düşülmüş). Kasadan geçmez, Z raporundaki online platformlardan ayrıdır. Ödeme kuruluşunun kesintisi ve aktarım günü düşülmedi.`,
    });
  }
  out.push({
    key: "invoices",
    title: "Faturalar",
    text: `Ödenmemiş faturaların kalan borcu, vade gününde. Vadesi yazılmamışsa tedarikçinin vadesi, yoksa ${num(opts.invoiceTermDays)} gün.${b.overdueInvoices ? ` Gecikmiş ${num(b.overdueInvoices)} fatura bugüne yazıldı.` : ""}`,
  });
  out.push({ key: "reminders", title: "Hatırlatıcılar", text: "Ödemeler'deki hatırlatıcılar, her tekrarıyla." });
  if (b.payroll) {
    out.push({
      key: "salary",
      title: "Maaşlar",
      text: off("salary")
        ? "Maaşlar tahmine katılmıyor (Tahmine katılanlar'dan açın)."
        : b.salaryMode === "reminder"
          ? "Maaş hatırlatıcısına yazdığınız tutar, onun gününde; ayrıca tahmin yapılmadı."
          : `${num(b.payroll.people)} kişinin net maaşı ve ek ödemeleri (ayda ${tl(b.payroll.net)}), ${b.salaryMode === "carrier" ? "Maaş hatırlatıcısının gününde" : "her ayın 1'inde"}. Ödemeler'e tutarlı bir Maaş hatırlatıcısı eklerseniz onun günü ve tutarı geçerli olur.`,
    });
    out.push({
      key: "sgk",
      title: "SGK",
      text: off("sgk")
        ? "SGK primleri tahmine katılmıyor (Tahmine katılanlar'dan açın)."
        : b.sgkMode === "reminder"
          ? "SGK hatırlatıcısına yazdığınız tutar, onun gününde; ayrıca tahmin yapılmadı."
          : `İşçi ve işveren SGK + işsizlik payları (ayda ${tl(b.payroll.sgk)}), ${b.sgkMode === "carrier" ? "SGK hatırlatıcısının gününde" : "takip eden ayın son günü"}. Gelir ve damga vergisi dahil değil.`,
    });
  }
  if (b.fixedSpread.count) {
    out.push({
      key: "fixed",
      title: "Sabit giderler",
      text: `Hatırlatıcısı olmayan ${num(b.fixedSpread.count)} sabit gider (ayda ${tl(b.fixedSpread.monthly)}) ay içine eşit yayıldı. Gününü bilmek için Ödemeler'e ekleyin.`,
    });
  }
  out.push({
    key: "goods",
    title: "Mal alımı",
    text: off("goods")
      ? "Yeni mal faturaları tahmine katılmıyor (Tahmine katılanlar'dan açın)."
      : b.goods
        ? `Son ${num(b.goods.spanDays)} günün mal faturalarına göre haftada ${tl(b.goods.weekly)}. Yeni faturalar tedarikçinin vadesinde ödenir, peşin çalışılanlar hemen.`
        : "Mal alımı tahmini için en az 2 haftalık fatura gerekir.",
  });
  if (plan.vat) out.push({ key: "kdv", title: "KDV", text: vatNote(plan.vat.mode, plan.vat.ok, plan.vat.rates, plan.vat.hasSite) });
  out.push({
    key: "double",
    title: "Çift sayım",
    text: "Aynı ödeme hem hatırlatıcı hem fatura olarak duruyorsa iki kez sayılır (Ödemeler'deki gibi). Faturası ayrıca gelen sabit gideri “Tahmine katılanlar”dan çıkarın.",
  });
  const yearly = plan.notIncluded.map((n) => n.title);
  out.push({
    key: "excluded",
    title: "Dahil değil",
    text: `Tutarı girilmemiş vergiler (muhtasar, geçici vergi vb.), Aylık harcamalar'daki fatura dışı ödemeler, yıllık giderler${yearly.length ? ` (${yearly.join(", ")})` : ""}, yatırım ve kredi.`,
  });
  return out;
}

export type { VatEstimate };
