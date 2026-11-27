/**
 * Nakit planı (docs/NAKIT-PLANI.md): bugünden başlayan 42 gün (6 × 7, kayan hafta) için gelecek para, ödenecekler ve
 * elde kalacak para. Saf modül; tests/nakit-plani.test.ts.
 *
 * - Kesin: ödenmemiş faturalar (kalan borç, vade gününde; gecikmiş olan bugüne) ve tutarı girilmiş hatırlatıcılar
 *   (her tekrarıyla).
 * - Tahmini: satışlar (son 28 günün kasa raporları, yetmezse son ayın POS cirosu; kafe kapalı işaretli günlerde yok),
 *   laffogato.net online, maaş ve SGK (Personel), hatırlatıcısı olmayan sabit giderler ve her ay girilen harcamalar
 *   (Aylık harcamalar; ay içine yayılır), yeni mal faturaları (son 8 haftanın ortalaması, tedarikçinin vadesinde).
 * - Bugün kuralı: girilen bakiye bugünü kapsar; gün 0'a yalnız fatura ve hatırlatıcı yazılır, tahminler yarından başlar.
 * - Hatırlatıcı eşleşmesi: adı bir sabit giderle ya da her ay girilen harcama kategorisiyle aynıysa onun yerine geçer;
 *   değilse Maaş, SGK ya da diğer. Tutarsız hatırlatıcı eşleştiği tahminin tutarını taşır; eşleşmeyeni "Tutarı
 *   girilmemiş ödemeler"e girer. Sabit gidere bağlı tutarlı hatırlatıcının tutarı o ayın sabit gider tutarından farklıysa
 *   satırda ve `reminderDrift`'te söylenir (denetim E-46).
 * - Vergi tahmini yok (Vergi bölümü 27 Kasım 2026'da kaldırıldı; vergiyi muhasebeci yürütüyor): KDV, muhtasar, geçici
 *   vergi ve damga planda yalnız Ödemeler'e tutarıyla yazıldıysa, düz hatırlatıcı olarak görünür. Bordro yasal oranlarla
 *   (src/lib/bordro/payroll.ts); stopajlı sabit gider bankadan net çıkar (stopajı muhasebeci muhtasarla öder).
 */

import { supplierMatchKey } from "../app/panel/faturalar/rules";
import { payrollFromModel, type PayrollMonth } from "./bordro/payroll";
import { r2, rulesFor } from "./bordro/rules";
import { DEFAULT_PAYROLL_SETTINGS, type PayrollSettings } from "./bordro/settings";
import { paidFixedRates } from "./bordro/stopaj";
import { daysInMonth, officialRentGross, shiftMonth, type Model } from "./calc/engine";
import type { FixedExpense, FixedPeriod, FixedSection, Withholding } from "./calc/types";
import { dayRevenue } from "./cash-revenue";
import { FIXED_ESTIMATE_DESCRIPTION, fixedVatRate, GOODS_CATEGORIES, MONTH_NAMES } from "./constants";
import { monthLabel, num, pct, tl } from "./format";
import {
  addDays,
  daysBetween,
  FIXED_REMINDER_NOTE,
  fixedReminderAt,
  fixedReminderFollows,
  monthEnd,
  nextOccurrence,
  reminderCategory,
  todayTR,
  type ReminderRow,
  type UpcomingItem,
} from "./reminders";
import { unreachable } from "./unreachable";

export const PLAN_WEEKS = 6;
/** 42 gün; Ödemeler'in ufkundan (UPCOMING_HORIZON_DAYS, 45) kısa: faturaların hepsi yükleyicinin listesinde (testli) */
export const PLAN_DAYS = PLAN_WEEKS * 7;
export const SALES_LOOKBACK_DAYS = 28;
export const MIN_SALES_REPORTS = 7;
export const GOODS_LOOKBACK_DAYS = 56;
export const MIN_GOODS_DAYS = 14;
export const STALE_BALANCE_DAYS = 3;

export type PlanKind = "sales" | "online" | "invoice" | "reminder" | "salary" | "sgk" | "fixed" | "expense" | "goods";

/**
 * Tahminden çıkarılabilen anahtarlar (Tahmine katılanlar). `kdv` ve `vergi` kaldırılan KDV ve vergi tahminlerinin
 * anahtarlarıdır (27 Kasım 2026): tahminleri yok, kayıtta kalırlarsa okunup olduğu gibi geri yazılır (silinmez)
 */
export const EXCLUDABLE_KEY = /^(sales|online|salary|sgk|goods|kdv|vergi|fixed:\d+|expense:\d+)$/;

/** integration_state › "cashflow.plan": girilen bakiye, tahminden çıkarılanlar, eski devreden KDV kaydı */
export interface CashPlanState {
  /** Bankadaki ve kasadaki paranın girildiği günkü toplamı (TL; eksi olabilir) */
  balance: number | null;
  /** YYYY-MM-DD (Türkiye), girildiği gün */
  balanceDate: string | null;
  balanceBy: string | null;
  excluded: string[];
  /**
   * Muhasebecinin son beyannamesindeki "sonraki döneme devreden KDV" (yoksa null). KDV tahmini 27 Kasım 2026'da
   * kaldırıldı: kullanılmaz, kayıt silinmesin diye okunur ve bakiye ya da tahmin ayarı kaydedilirken olduğu gibi korunur
   */
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
  /** KDV hariç (Giderler'de girilen) */
  amount: number;
  /**
   * Faturasındaki KDV oranı (constants.ts fixedVatRate; kalemde boşsa bölümün varsayılanı). Plan gideri KDV dahil öder:
   * kiranın %20'si de bankadan çıkar. Doğrudan yurt dışına ödenende 0 (src/lib/bordro/stopaj.ts paidFixedRates):
   * yabancı firma Türk KDV'si kesmez
   */
  vatRate?: number;
  /**
   * Stopaj profili ve ödemeden kesilen stopaj oranı (saklı profil; src/lib/bordro/stopaj.ts paidWithholdingRate):
   * şahsa kira, serbest meslek ve şahsa internet reklamında bankadan net çıkar (kira 160.000 brüt, KDV'siz → 128.000);
   * stopajı muhasebeci muhtasarla öder, plan vergi tahmini yapmaz. Yurt dışına ödenende oran 0 ve KDV yok
   */
  withholding?: Withholding | null;
  withholdingRate?: number;
}

/**
 * Sabit giderin bankadan çıkan tutarı: KDV hariç tutar × (1 + KDV oranı), stopajlı kalemde ödemeden kesilen stopaj
 * düşülür (stopajı muhasebeci muhtasarla ayrıca öder)
 */
const paidOut = (f: Pick<FixedItem, "amount" | "vatRate" | "withholdingRate">, amount = f.amount) => amount * (1 + (f.vatRate ?? 0) - (f.withholdingRate ?? 0));

/** Stopajlı sabit giderin aylık brütü (KDV hariç), stopaj oranı ve bankadan çıkanı; stopajsızsa null */
function withheldParts(f: Pick<FixedItem, "period" | "amount" | "vatRate" | "withholdingRate">, acikGun: number): { gross: number; rate: number; paid: number } | null {
  const rate = f.withholdingRate ?? 0;
  if (!(rate > 0)) return null;
  const paid = monthlyOf(f, acikGun);
  return { gross: paid / (1 + (f.vatRate ?? 0) - rate), rate, paid };
}

/** Stopajlı sabit giderin notu: "Kira 160.000 ₺ brüt · stopaj %20 ödemeden kesildi · ödenen 128.000 ₺" (aylık karşılığıyla) */
function withheldNote(f: Pick<FixedItem, "name" | "period" | "amount" | "vatRate" | "withholdingRate">, acikGun: number): string | null {
  const w = withheldParts(f, acikGun);
  return w ? `${f.name} ${tl(w.gross)} brüt · stopaj %${num(w.rate * 100)} ödemeden kesildi · ödenen ${tl(w.paid)}` : null;
}

/**
 * Planın kasa raporları şubesiyle ve şube sırasıyla (loadCashPlan; kütük `branches` ekrandaki sırayla): günlük satış şube
 * şube ortalanıp toplanır (salesDaily; denetim 21 Kasım #11). Kapatılmış (pasif) şubenin raporları sayılmaz: kapalı şube
 * satış yapmaz, son 28 günün ortalaması ileriye yazılmasın. Kütükte bulunmayan şubenin raporu (olmamalı) yine sayılır
 */
export function planCashReports(
  reports: readonly {
    branchId: string;
    date: string;
    zTotal: number;
    card: number;
    mealCard: number;
    online?: number;
    cash?: number;
    other?: number;
    offRevenue?: number | null;
  }[],
  branches: readonly { id: string; name: string; active: boolean }[],
): CashPlanInput["cashReports"] {
  const of = new Map(branches.map((b, i) => [b.id, { name: b.name, active: b.active, i }]));
  return reports
    .filter((r) => of.get(r.branchId)?.active !== false)
    .map((r) => ({ r, i: of.get(r.branchId)?.i ?? branches.length }))
    .sort((a, b) => a.i - b.i)
    .map(({ r }) => ({
      date: r.date,
      zTotal: r.zTotal,
      card: r.card,
      mealCard: r.mealCard,
      online: r.online,
      // Ödenmez Z'nin içindeyse ciroya girmez (dayRevenue): ödeme dökümü de verilir (yoksa Z toplamı ciro sayılır)
      ...(r.offRevenue !== undefined ? { offRevenue: r.offRevenue } : {}),
      ...(r.cash !== undefined ? { payments: Math.round((r.cash + r.card + r.mealCard + (r.online ?? 0) + (r.other ?? 0)) * 100) / 100 } : {}),
      branchId: r.branchId,
      branchName: of.get(r.branchId)?.name ?? r.branchId,
    }));
}

/** Raporun cirosu: Z toplamı − Z'nin içindeki ödenmez / ikram (ay bilgisinin kuralı, src/lib/cash-revenue.ts dayRevenue) */
const reportRevenue = (r: { zTotal: number; offRevenue?: number | null; payments?: number | null }) =>
  dayRevenue({ zTotal: r.zTotal, offRevenue: r.offRevenue ?? null, payments: r.payments ?? null }).revenue;

/**
 * Nakit planının günlük satışı şube şube (docs/NAKIT-PLANI.md › Satışlar): her kasanın cirosu (Z toplamı, ödenmez / ikram
 * hariç; denetim 13 Kasım HM-08) ÷ o kasanın raporlu gün sayısı. Şubesi verilmeyen raporlar tek kasa sayılır (aynı günün
 * iki raporu bir gün). Sıra: girdideki ilk görünüş
 */
export function salesDaily(
  reports: readonly { date: string; zTotal: number; offRevenue?: number | null; payments?: number | null; branchId?: string; branchName?: string }[],
): { id: string; name: string; days: number; daily: number }[] {
  const groups = new Map<string, { name: string; z: number; dates: Set<string> }>();
  for (const r of reports) {
    const id = r.branchId ?? "";
    const g = groups.get(id) ?? { name: r.branchName ?? r.branchId ?? "", z: 0, dates: new Set<string>() };
    g.z += reportRevenue(r);
    g.dates.add(r.date);
    groups.set(id, g);
  }
  return [...groups].map(([id, g]) => ({ id, name: g.name, days: g.dates.size, daily: g.dates.size ? g.z / g.dates.size : 0 }));
}

export interface CashPlanInput {
  today: string;
  opening: { amount: number; date: string } | null;
  excluded: readonly string[];
  settings: { komisyon: number; kartOrani: number; acikGun: number };
  /** Vadesiz faturanın genel vade günü (bildirim ayarı) */
  invoiceTermDays: number;
  /**
   * `online`: Z raporundaki online platform ödemeleri (Yemeksepeti, Getir…; laffogato.net değil, o kasadan geçmez).
   * `branchId` / `branchName`: raporun kasası (şube); günlük satış şube şube ortalanıp toplanır (yoksa tek kasa sayılır).
   * `offRevenue` ve `payments` (ciroya dahil ödemelerin toplamı) ödenmezin Z toplamının içinde olup olmadığını söyler
   * (src/lib/cash-revenue.ts dayRevenue); verilmezse Z toplamı ciro sayılır
   */
  cashReports: readonly {
    date: string;
    zTotal: number;
    card: number;
    mealCard: number;
    online?: number;
    offRevenue?: number | null;
    payments?: number | null;
    branchId?: string;
    branchName?: string;
  }[];
  /** Bu aya kadarki, açık günü ve POS cirosu girilmiş son ay (kasa raporu yetmezse) */
  posMonth: { month: string; posRevenue: number; openDays: number } | null;
  online: { month: string; perDay: number } | null;
  /**
   * Ödemeler'in listesi: faturalar ve faturasız borçlar (cari) kesin kalem, hatırlatıcılar `reminders`'tan. Tutar
   * hesaptaki ödeme düşüldükten sonraki kalan; faturasız alımın faturası olabilecek fatura ("link") girmez
   */
  invoices: readonly UpcomingItem[];
  reminders: readonly ReminderRow[];
  /** Son 8 haftanın mal faturaları ve tedarikçinin ödeme gecikmesi (peşinde 0) */
  goods: readonly { supplier: string; date: string; payable: number; lagDays: number }[];
  /**
   * Faturası beklenen ("Faturası gelecek") açık cari borçlar, kart kart (K19): kartın ad anahtarları (adı ve diğer
   * adları), tutar. O tedarikçinin mal tahmini bu kadar düşürülür (borç kesin kalemde zaten). Yoksa boş
   */
  expectedDebts?: readonly { name: string; keys: readonly string[]; amount: number }[];
  /** Mal faturalarının ortalama aralığı; 0 = yetersiz geçmiş */
  goodsSpanDays: number;
  /**
   * Önceki aylardan ufkun son ayına kadar: bordro, o ayın sabit giderleri ve her ay girilen harcamaları (Aylık
   * harcamalar, denetim E-13: `amount` ayın beklenen ödemesi, bağlı faturalar KDV dahil; `paid` bugüne kadar girilen ve o
   * ayın bağlı faturaları; `from` tutarın ayı, model.monthlyExpensePlan; `linked` tutarda bağlı fatura var)
   */
  months: Readonly<
    Record<
      string,
      {
        payroll: { net: number; sgk: number; people: number };
        fixed: readonly FixedItem[];
        expenses?: readonly { id: number; name: string; amount: number; paid: number; from: string; linked?: boolean }[];
      }
    >
  >;
  /** Bütün sabit giderler (hatırlatıcı eşleşmesi için; `endMonth` biten kalemin hatırlatıcısı söylensin diye) */
  fixedNames: readonly { id: number; name: string; period: FixedPeriod; endMonth?: string | null }[];
  /** Kafe kapalı işaretli günler (Özel günler; denetim E-41): o günlerde satış ve online girişi yazılmaz. Yoksa boş */
  closedDays?: readonly string[];
  /** Bordronun SGK oranları (yasal, elle işveren oranı uygulanmış; planInputFromModel): SGK notu bunlarla */
  sgkRates?: { year: number; isveren: number; issizlik: number } | null;
}

export interface PlanLine {
  /** "invoice:12", "reminder:4@2026-11-01" (dönemin asıl vadesi), "salary@2026-11-01", "sgk@2026-10-31", "fixed", "expense", "goods", "sales", "online" */
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

export interface UnknownAmount {
  key: string;
  reminderId: number | null;
  title: string;
  date: string;
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
      | {
          kind: "kasa";
          reports: number;
          days: number;
          daily: number;
          cardShare: number;
          platformShare: number;
          /** Birden çok kasa raporladıysa şube şube: raporlu gün ve günlük ortalama (günlük = bunların toplamı) */
          branches?: { id: string; name: string; days: number; daily: number }[];
        }
      | { kind: "pos"; month: string; daily: number; openDays: number; cardShare: number }
      | { kind: "none" };
    online: { month: string; perDay: number } | null;
    goods: { spanDays: number; weekly: number; top: { supplier: string; weekly: number; lagDays: number }[] } | null;
    /** Mal tahmini faturası beklenen cari borçlar kadar düşürülen tedarikçiler (K19) */
    goodsReduced: { name: string; amount: number }[];
    /** Faturasız borçlar (cari) kesin kalem sayısı; hesaptaki ödemesi düşülen kalem var mı */
    cari: { count: number; credited: boolean };
    payroll: { people: number; net: number; sgk: number } | null;
    /** default: her ayın 1'i / son günü; carrier: tutarsız hatırlatıcının gününde; reminder: hatırlatıcıdaki tutar */
    salaryMode: "default" | "carrier" | "reminder";
    sgkMode: "default" | "carrier" | "reminder";
    /** Yayılan sabit giderlerin sayısı ve aylık toplamı (KDV dahil); `vat`: KDV'li kalem var; `withheld`: stopajlı kalem var */
    fixedSpread: { count: number; monthly: number; vat: boolean; withheld: boolean };
    /** Yayılan, her ay girilen harcamaların (Aylık harcamalar) sayısı ve bu ayın beklenen toplamı (E-13) */
    expenseSpread: { count: number; monthly: number };
    /** Ufuktaki kafe kapalı işaretli günler (yarından): satış ve online girişi yazılmadı (E-41) */
    closedDays: string[];
    overdueInvoices: number;
    sgkRates: { year: number; isveren: number; issizlik: number } | null;
  };
  /** Plana girmeyen, tutarı girilmemiş hatırlatıcılar (ad ve ilk tarih). `key` satırın kimliği ("reminder:4") */
  unknownAmounts: UnknownAmount[];
  /** Yıllık sabit giderler: günü bilinmediği için plana girmez */
  notIncluded: { title: string; amount: number; period: FixedPeriod }[];
  /**
   * Sabit gidere bağlı tutarlı hatırlatıcının tutarı o ayın sabit gider tutarından (KDV dahil, aynı dönem) 1 ₺'den fazla
   * farklı (denetim E-46): plan hatırlatıcının tutarını öder; ilk farklı ay ve iki tutar. Ödemeler de gösterir
   */
  reminderDrift: ReminderDrift[];
  estimates: EstimateRow[];
  excluded: string[];
  hasData: boolean;
  /**
   * Şubenin nakit akışı (Nakit planı alanının şube kipi; src/lib/cash-plan-branch.ts › branchPlanWithoutTax): vergi ve
   * SGK ödemeleri (Ödemeler'deki vergi hatırlatıcıları, SGK tahmini) firmanın, bu planda yok (sahibin kararı 27 Kasım
   * 2026: vergi şubeye bölünmez). "Nasıl hesaplandı" SGK notunun yerine tek not yazar (`FIRM_TAX_NOTE`). Firmanın
   * planında yok
   */
  taxFirmWide?: true;
}

/** Şubenin nakit akışının notu: vergi ve SGK ödemeleri şubeye bölünmez (sahibin kararı 27 Kasım 2026) */
export const FIRM_TAX_NOTE = "Vergi ve SGK ödemeleri firma geneli: Tümü'de görünür";

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

/** Sabit gidere bağlı tutarlı hatırlatıcının tutarı sabit giderin o ayki tutarından farklı (denetim E-46) */
export interface ReminderDrift {
  reminderId: number;
  title: string;
  /** İlk farklı dönemin ayı */
  month: string;
  /** Hatırlatıcıdaki tutar (planın ödediği) */
  reminderAmount: number;
  /** Sabit giderin o ayki tutarı, KDV dahil (Giderler'deki sürüm); bitmiş kalemde 0 */
  fixedAmount: number;
  /** Sabit gider bu ayda bitti (bitiş ayı); hatırlatıcı sonraki dönemlerde hâlâ tutar taşıyor (E-62) */
  ended?: string;
}

/** Hatırlatıcının dönemine karşılık gelen sabit gider dönemi (çeyreklik ve tek seferlik karşılaştırılmaz) */
function cadenceOf(repeat: ReminderRow["repeat"]): FixedPeriod | null {
  return repeat === "none" ? null : CADENCE_OF[repeat];
}

/** Ödemeler'deki "farklı tutar" notu: "Kira: Ocak 2027'den sabit giderde 240.000 ₺; hatırlatıcıda 192.000 ₺" */
export function reminderDriftText(d: ReminderDrift): string {
  if (d.ended) return `${d.title}: sabit gider ${monthLabel(d.ended)} ayında bitti; hatırlatıcı ${monthLabel(d.month)} döneminde hâlâ ${tl(d.reminderAmount)}`;
  return `${d.title}: ${monthLabel(d.month)} döneminde sabit giderde ${tl(d.fixedAmount)} (KDV dahil); hatırlatıcıda ${tl(d.reminderAmount)}`;
}

/**
 * Ödemeler için (sayfa nakit planını kurmaz): adı bir sabit giderle aynı, tutarı yazılı, etkin hatırlatıcıların önümüzdeki
 * dönemlerinde (varsayılan bir yıl) sabit giderin o ayki tutarı (sürümüyle, KDV dahil; aynı dönemde) 1 ₺'den fazla farklı mı.
 * Eşleşme nakit planınınkiyle aynı (katlanmış ad, en küçük kimlik). Gideri izleyen hatırlatıcı (fixedReminderFollows)
 * karşılaştırılmaz: plan sürümü öder. Bitmiş kalemin hatırlatıcısı bitişten sonraki ilk dönemde söylenir (`ended`)
 */
export function fixedReminderDrifts(
  reminders: readonly Pick<ReminderRow, "id" | "title" | "amount" | "active" | "dueDate" | "repeat" | "anchorDate" | "note">[],
  fixed: readonly {
    id: number;
    name: string;
    period: FixedPeriod;
    amount: number;
    section: FixedSection;
    /** Yurt dışı hizmette 0 (src/lib/bordro/stopaj.ts paidFixedRates) */
    vatRate?: number | null;
    /** Ödemeden kesilen stopaj oranı (src/lib/bordro/stopaj.ts paidFixedRates): tutar bankadan çıkan net */
    withholdingRate?: number | null;
    startMonth: string | null;
    endMonth: string | null;
  }[],
  versions: readonly { fixedExpenseId: number; fromMonth: string; period: FixedPeriod; amount: number }[],
  today: string,
  horizonDays = 366,
  /** Aylık harcamalar'da her ay girilen kategorilerin adları: aylık girişe çevrilmiş gider bitmiş sayılmaz */
  monthlyExpenseNames: readonly string[] = [],
): ReminderDrift[] {
  const converted = new Set(monthlyExpenseNames.map(foldName));
  const byName = new Map<string, (typeof fixed)[number]>();
  for (const f of [...fixed].sort((a, b) => a.id - b.id)) if (!byName.has(foldName(f.name))) byName.set(foldName(f.name), f);
  const end = addDays(today, horizonDays);
  const out: ReminderDrift[] = [];
  for (const r of [...reminders].sort((a, b) => a.id - b.id)) {
    if (!r.active || !hasAmount(r)) continue;
    const f = byName.get(foldName(r.title));
    const cadence = cadenceOf(r.repeat);
    if (!f || !cadence) continue;
    const own = versions.filter((v) => v.fixedExpenseId === f.id);
    const follows = fixedReminderFollows(r, f, own);
    for (const o of reminderOccurrences(r, today, end)) {
      const m = o.due.slice(0, 7);
      if (f.endMonth && f.endMonth < m) {
        if (converted.has(foldName(r.title))) break;
        out.push({ reminderId: r.id, title: r.title, month: m, reminderAmount: r.amount!, fixedAmount: 0, ended: f.endMonth });
        break;
      }
      if (follows || (f.startMonth && f.startMonth > m)) continue;
      const at = fixedReminderAt(f, own, m);
      if (at.period !== cadence || Math.abs(at.gross - r.amount!) <= 1) continue;
      out.push({ reminderId: r.id, title: r.title, month: m, reminderAmount: r.amount!, fixedAmount: at.gross });
      break;
    }
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

/**
 * Sabit giderin ödemesinden kesilen stopaj profili (nakit planı): resmi kiralı kalemde yok (stopaj resmi brütten, ev
 * sahibine kesintisiz); ev sahibi şahıs ve resmi kira yoksa kira stopajı; şirkete kirada yok; öteki kalemlerde saklı
 * profil (eski Vergi › sınıflandırma; ekranı kaldırıldı, değer yerinde)
 */
type PaidFixedInput = Pick<FixedExpense, "section" | "officialAmount" | "officialBasis" | "landlordType"> & {
  taxWithholding?: Withholding | null;
  vatRate?: number | null;
};

function paidWithholdingOf(f: PaidFixedInput): Withholding | null {
  if (f.section === "kira" && f.landlordType === "sirket") return null;
  if (f.section === "kira" && f.landlordType === "sahis") return officialRentGross(f, 0.2) !== null ? null : "kira";
  return f.officialAmount ? null : (f.taxWithholding ?? null);
}

/**
 * Sabit giderin bankadan çıkan tutarının oranları (tek kural): nakit planının yayılımı ve Ödemeler'in "Sabit giderlerden
 * ekle", izleme ve tutarsızlık denetimi aynı sonucu verir. Ev sahibi türü KDV'yi ve ödemeden kesilen stopajı belirler
 * (paidWithholdingOf, fixedVatRate); yurt dışı hizmette KDV 0 (paidFixedRates)
 */
export function paidFixedRatesOf<T extends PaidFixedInput>(f: T, year: number): T & { taxWithholding: Withholding | null; vatRate: number; withholdingRate: number } {
  const rated = paidFixedRates({ ...f, taxWithholding: paidWithholdingOf(f), vatRate: fixedVatRate(f) }, year);
  return { ...rated, vatRate: rated.vatRate ?? 0 };
}

/**
 * Modelden planın girdileri: oranlar, POS yedeği, online, bordro ve sabit giderler (önceki aylardan ufkun sonuna).
 * Bordro yasal bordrodur (src/lib/bordro/payroll.ts payrollFromModel): netten brüt, 2026 yasal SGK oranları, PEK sınırı;
 * Ayarlar'daki SGK oranları yalnız Gelir-gider'de kalır. `payroll` bordronun saklı ayarlarıdır (hesap dönemi, asgari
 * ücret desteği, elle işveren oranı; src/lib/bordro/settings.ts); verilmezse varsayılanlar. Hesap döneminden önceki ayda
 * bordro yok (0). Stopajlı sabit gider bankadan net çıkar (`withholdingRate`; stopajı muhasebeci muhtasarla öder)
 */
export function planInputFromModel(
  model: Model,
  today: string,
  payroll: Pick<PayrollSettings, "periodStart" | "minWageSupport" | "overrides"> = DEFAULT_PAYROLL_SETTINGS,
): Pick<CashPlanInput, "settings" | "posMonth" | "online" | "months" | "fixedNames" | "closedDays" | "sgkRates"> {
  const st = model.settings;
  const cur = today.slice(0, 7);
  // Yılın bordrosu (yıl başına bir kez; ufuk yıl sonunu geçebilir)
  const payrolls = new Map<number, Map<string, PayrollMonth>>();
  const payrollAt = (m: string) => {
    const y = Number(m.slice(0, 4));
    if (!payrolls.has(y)) payrolls.set(y, payrollFromModel(model, y, payroll));
    return payrolls.get(y)!.get(m) ?? null;
  };
  const pos = [...model.monthInfo.values()]
    .filter((m) => m.month <= cur && (m.openDays ?? 0) > 0 && (m.posRevenue ?? 0) > 0)
    .sort((a, b) => a.month.localeCompare(b.month))
    .at(-1);
  const months: Record<string, CashPlanInput["months"][string]> = {};
  const last = addDays(today, PLAN_DAYS - 1).slice(0, 7);
  // Aylık harcamalar: bugüne kadar girilenler (ödenmiş), kategori ve ay başına. Sabit gideri aylık girişe çevirmenin
  // tahmini kaydı ödeme değildir: ayın beklenen tutarında kalır, ödendi sayılmaz (gerçeği girilene kadar plan öder)
  const paid = new Map<string, number>();
  for (const e of model.ds.expenseEntries ?? []) {
    if (e.date > today || e.description === FIXED_ESTIMATE_DESCRIPTION) continue;
    const k = `${e.date.slice(0, 7)}|${e.categoryId}`;
    paid.set(k, (paid.get(k) ?? 0) + e.amount);
  }
  // Her ay girilen harcamalar (E-13): ayın beklenen ödemesi (bağlı faturalar KDV dahil). O ay girilmiş harcamalar ve o
  // ayın bağlı faturaları (ödenmiş ya da Ödemeler'de kesin kalem) karşılanmış sayılır; gelecek ayda faturası henüz
  // gelmemiş bağlı kategori de tutarıyla yayılır
  const monthExpenses = (m: string): NonNullable<CashPlanInput["months"][string]["expenses"]> => {
    const linked = new Map(model.expenseAmounts(m).map((x) => [x.cat.id, x.invoicesPayable]));
    return model
      .monthlyExpensePlan(m)
      .filter((x) => x.cash > 0.005)
      .map((x) => ({
        id: x.cat.id,
        name: x.cat.name,
        amount: x.cash,
        paid: (paid.get(`${m}|${x.cat.id}`) ?? 0) + (linked.get(x.cat.id) ?? 0),
        from: x.from,
        ...(x.cash > x.entries + 0.005 ? { linked: true } : {}),
      }));
  };
  // Gecikmiş maaş / SGK hatırlatıcısının bordrosu için iki ay geriden
  for (let m = shiftMonth(cur, -2); m <= last; m = shiftMonth(m, 1)) {
    // Maaş: net + ek ödemeler (personele giden); SGK: dört pay, asgari ücret desteği düşülmüş (ayın tahakkuku)
    const t = payrollAt(m)?.totals;
    const year = Number(m.slice(0, 4));
    months[m] = {
      payroll: t ? { net: r2(t.net + t.extras), sgk: t.sgkTotal, people: t.people } : { net: 0, sgk: 0, people: 0 },
      fixed: model.fixedInMonth(m).map((f) => {
        // Resmi kirası olan kalemde ev sahibine giden tutar kesintisiz. Ev sahibi türü: şahsa kira KDV'siz, resmi kira
        // yoksa stopaj ödemeden kesilir; şirkete kira %20 KDV'li, stopajsız. Yurt dışı hizmette KDV yok (paidFixedRates)
        const rated = paidFixedRatesOf(f, year);
        const withholding = rated.taxWithholding;
        return {
          id: f.id,
          name: f.name,
          period: f.period,
          amount: f.amount,
          vatRate: rated.vatRate,
          ...(withholding ? { withholding, withholdingRate: rated.withholdingRate } : {}),
        };
      }),
      expenses: monthExpenses(m),
    };
  }
  const { rules } = rulesFor(Number(cur.slice(0, 4)), payroll.overrides);
  return {
    settings: { komisyon: st.komisyon, kartOrani: st.kartOrani, acikGun: st.acikGun },
    posMonth: pos ? { month: pos.month, posRevenue: pos.posRevenue!, openDays: pos.openDays! } : null,
    online: onlineBasis(model, today),
    months,
    fixedNames: model.ds.fixedExpenses.map((f) => ({ id: f.id, name: f.name, period: f.period, endMonth: f.endMonth ?? null })),
    // Ufuktaki kafe kapalı işaretli günler (E-41)
    closedDays: (model.ds.closedDays ?? []).filter((d) => d >= today && d <= addDays(today, PLAN_DAYS - 1)),
    sgkRates: { year: Number(cur.slice(0, 4)), isveren: rules.sgk.isverenOran.value, issizlik: rules.sgk.isverenIssizlik.value },
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

/**
 * Sabit giderin aylık karşılığı, bankadan çıkan (KDV dahil, stopaj düşülmüş; notlar ve Tahmine katılanlar için; günlük
 * gider ayda en çok 30 açık gün)
 */
function monthlyOf(f: Pick<FixedItem, "period" | "amount" | "vatRate" | "withholdingRate">, acikGun: number): number {
  if (f.period === "gunluk") return paidOut(f, f.amount * Math.min(30, acikGun));
  if (f.period === "haftalik") return paidOut(f, (f.amount * 52) / 12);
  if (f.period === "yillik") return paidOut(f, f.amount / 12);
  return paidOut(f);
}

type RemClass =
  | { kind: "fixed"; id: number; endMonth: string | null }
  | { kind: "expense"; id: number }
  | { kind: "salary" }
  | { kind: "sgk" }
  | { kind: "other" };

const hasAmount = (r: Pick<ReminderRow, "amount">) => r.amount !== null && r.amount > 0;

/** Hatırlatıcının bir dönemi kaç aylıktır; sabit giderin aynı dönemi */
const REPEAT_PER_MONTH: Record<Exclude<ReminderRow["repeat"], "none">, number> = { weekly: 12 / 52, monthly: 1, quarterly: 3, yearly: 12 };
const CADENCE_OF: Record<Exclude<ReminderRow["repeat"], "none">, FixedPeriod | null> = { weekly: "haftalik", monthly: "aylik", quarterly: null, yearly: "yillik" };

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

  // Günü belli satırlar (kesinler ve hatırlatıcının, maaşın, SGK'nın tahmini); gün dizini tarihinden
  const dated: PlanLine[] = [];
  const dayOfLine = (l: PlanLine) => dayIndex(l.date!);
  const unknown = new Map<string, UnknownAmount>();
  const addUnknown = (r: ReminderRow, date: string) => {
    const key = `reminder:${r.id}`;
    const cur = unknown.get(key);
    if (!cur || date < cur.date) unknown.set(key, { key, reminderId: r.id, title: r.title, date });
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
  // Günlük satış işletmenin günüdür: her kasanın (şubenin) Z toplamı kendi raporlu gün sayısına bölünür, şubelerin
  // günlük ortalamaları toplanır (salesDaily). Bütün şubelerin Z'si ortak gün sayısına bölünseydi yeni açılan ya da
  // eksik raporlu şubenin cirosu 28 güne yayılırdı (denetim 21 Kasım #11); rapor sayısına bölünseydi iki şubeyle ortalama
  // yarıya düşerdi. Tek şubede gün = rapor, sonuç aynı. Yeterlilik işletmenin raporlu gün sayısıyla
  const days = new Set(reports.map((r) => r.date)).size;
  let sales: CashPlan["basis"]["sales"] = { kind: "none" };
  if (days >= MIN_SALES_REPORTS) {
    // Ciro ay bilgisinin kuralıyla: Z toplamı − Z'nin içindeki ödenmez / ikram (denetim 13 Kasım HM-08)
    const revenue = reports.reduce((a, r) => a + reportRevenue(r), 0);
    const card = reports.reduce((a, r) => a + r.card + r.mealCard, 0);
    const platform = reports.reduce((a, r) => a + (r.online ?? 0), 0);
    const share = (v: number) => (revenue > 0 ? Math.min(1, Math.max(0, v / revenue)) : 0);
    const per = salesDaily(reports);
    sales = {
      kind: "kasa",
      reports: reports.length,
      days,
      daily: per.reduce((a, b) => a + b.daily, 0),
      cardShare: share(card),
      platformShare: share(platform),
      ...(per.length > 1 ? { branches: per } : {}),
    };
  } else if (input.posMonth && input.posMonth.openDays > 0 && input.posMonth.posRevenue > 0) {
    sales = { kind: "pos", month: input.posMonth.month, daily: input.posMonth.posRevenue / input.posMonth.openDays, openDays: input.posMonth.openDays, cardShare: st.kartOrani };
  }
  const openRatio = Math.min(1, st.acikGun / 30);
  // Kartla ödenen pay için banka komisyonu düşülür; günlük ortalama açık gün oranıyla takvim gününe çevrilir
  const salesPerDay = sales.kind === "none" ? 0 : sales.daily * (1 - st.komisyon * sales.cardShare) * openRatio;
  // Kafe kapalı işaretli günde satış ve online girişi yok (Özel günler; E-41)
  const shut = new Set(input.closedDays ?? []);
  const closedAhead = dates.filter((d, i) => i >= 1 && shut.has(d));
  const salesIn = dates.map((d, i) => (i >= 1 && !off("sales") && !shut.has(d) ? salesPerDay : 0));
  const onlineIn = dates.map((d, i) => (i >= 1 && input.online && !off("online") && !shut.has(d) ? input.online.perDay : 0));

  // ------------------------------------------------------------ Faturalar ve faturasız borçlar (kesin)
  let overdueInvoices = 0;
  let cariCount = 0;
  let credited = false;
  for (const it of input.invoices) {
    // Faturasız alımın faturası olabilecek fatura bağlanana kadar plana girmez (borç kesin kalemde; K17)
    if (it.quiet === "link") continue;
    let key: string;
    let title: string;
    let href: string;
    let cari = false;
    switch (it.source) {
      case "invoice":
        key = `invoice:${it.sourceId}`;
        title = it.title;
        href = "/panel/hatirlaticilar?kaynak=fatura";
        break;
      case "cari":
        cari = true;
        key = `cari:${it.sourceId}`;
        title = `${it.title} · ${it.costMode === "fatura" ? "fatura bekleniyor" : it.costMode === "devir" ? "eski borç" : "faturasız alım"}`;
        href = "/panel/hatirlaticilar?kaynak=cari";
        break;
      case "reminder":
        continue;
      default:
        unreachable(it.source);
    }
    const d = daysBetween(today, it.dueDate);
    if (d > N - 1) continue;
    if (d < 0 && !cari) overdueInvoices++;
    if (cari) cariCount++;
    if (it.credited) credited = true;
    dated.push({
      key,
      kind: "invoice",
      direction: "out",
      title,
      date: d < 0 ? today : it.dueDate,
      ...(d < 0 ? { due: it.dueDate } : {}),
      amount: it.amount ?? 0,
      estimated: false,
      overdue: d < 0,
      detail: it.detail ?? undefined,
      href,
    });
  }

  // ------------------------------------------------------------ Hatırlatıcılar: sınıf ve dönemler
  const fixedByName = new Map<string, { id: number; period: FixedPeriod; endMonth: string | null }>();
  for (const f of [...input.fixedNames].sort((a, b) => a.id - b.id)) {
    const k = foldName(f.name);
    if (!fixedByName.has(k)) fixedByName.set(k, { id: f.id, period: f.period, endMonth: f.endMonth ?? null });
  }
  // Her ay girilen harcama kategorileri (ufuktaki aylardan): adı aynı hatırlatıcı onun yerine geçer (E-13)
  const expenseByName = new Map<string, number>();
  for (const m of monthKeys) for (const x of input.months[m]?.expenses ?? []) if (!expenseByName.has(foldName(x.name))) expenseByName.set(foldName(x.name), x.id);
  const expenseIn = (m: string, id: number) => input.months[m]?.expenses?.find((x) => x.id === id) ?? null;
  const classify = (r: ReminderRow): RemClass => {
    const f = fixedByName.get(foldName(r.title));
    if (f) return { kind: "fixed", id: f.id, endMonth: f.endMonth };
    const e = expenseByName.get(foldName(r.title));
    if (e !== undefined) return { kind: "expense", id: e };
    const cat = reminderCategory(r.kind, r.title);
    // "Sabit giderlerden ekle" personel kalemini maaş türüyle açar (Muhasebeci, Part-time çalışan): gider silinir ya da
    // adı değişince ad eşleşmesi kalkar, ama bu hatırlatıcı bordro değildir; maaşı ya da SGK'yı kapatmaz, taşımaz
    if ((cat === "maas" || cat === "sgk") && r.note?.startsWith(FIXED_REMINDER_NOTE)) return { kind: "other" };
    if (cat === "maas") return { kind: "salary" };
    if (cat === "sgk") return { kind: "sgk" };
    // Vergi hatırlatıcıları (KDV, KDV-2, muhtasar, geçici vergi, damga) diğerdir: vergi tahmini yok (27 Kasım 2026),
    // her dönem yazılı tutarıyla girer; tutarsızı "Tutarı girilmemiş ödemeler"de
    return { kind: "other" };
  };
  const active = input.reminders.filter((r) => r.active).sort((a, b) => a.id - b.id);
  const salaryRems: ReminderRow[] = [];
  const sgkRems: ReminderRow[] = [];
  const covered = new Set<number>();
  const coveredExpense = new Set<number>();
  const drift: ReminderDrift[] = [];
  // Hatırlatıcının ayındaki her ay girilen harcaması (dönemine çevrilmiş; o ay girilmiş olan ödenmiş sayılır): tutarsız
  // hatırlatıcı bunu taşır
  const expenseForReminder = (r: ReminderRow, o: { date: string; due: string }, id: number) => {
    const x = expenseIn(o.due.slice(0, 7), id) ?? expenseIn(o.date.slice(0, 7), id);
    if (!x) return null;
    const left = Math.max(0, x.amount - x.paid);
    return r.repeat === "none" || r.repeat === "monthly" ? left : left * REPEAT_PER_MONTH[r.repeat];
  };
  for (const r of active) {
    const c = classify(r);
    // Adı her ay girilen bir harcamayla aynı hatırlatıcı (sabit gideri bitmiş olsa da) o harcamayı karşılar: yayılmaz
    const e = expenseByName.get(foldName(r.title));
    if (e !== undefined) coveredExpense.add(e);
    if (c.kind === "salary") salaryRems.push(r);
    else if (c.kind === "sgk") sgkRems.push(r);
    else if (c.kind === "fixed") {
      // Gideri bir hatırlatıcı karşılıyor: ay içine yayılmaz; tutarsızsa hatırlatıcının günlerine giderin tutarı
      covered.add(c.id);
      let drifted = false;
      const rep = r.repeat === "none" ? null : r.repeat;
      /** Sabit giderin o ayki sürümü, hatırlatıcının döneminde ve KDV dahil (dönem tutmuyorsa ya da kalem o ay yoksa null) */
      const grossIn = (m: string) => {
        const f = fixedIn(m).find((x) => x.id === c.id);
        return f && rep && f.period === CADENCE_OF[rep] ? Math.round(paidOut(f) * 100) / 100 : null;
      };
      // "Sabit giderlerden ekle" ile açılmış, tutarı sıradaki dönemin sürümü olan hatırlatıcı gideri izler: zamdan sonraki
      // dönemlerde sürümün tutarı ödenir, uyarı çıkmaz (fixedReminderFollows)
      const dueGross = hasAmount(r) ? grossIn(r.dueDate.slice(0, 7)) : null;
      const follows = Boolean(r.note?.startsWith(FIXED_REMINDER_NOTE)) && dueGross !== null && Math.abs(dueGross - r.amount!) <= 1;
      for (const o of reminderOccurrences(r, today, end)) {
        if (hasAmount(r)) {
          const m = o.due.slice(0, 7);
          // Sabit gider bitti: plan hatırlatıcının tutarını saymaya devam eder ama söyler (E-62; Ödemeler'de kapatılır).
          // Aylık girişe çevrilmiş gider (aynı adlı her ay girilen harcama) bitmiş sayılmaz: hatırlatıcı onu karşılar
          if (c.endMonth && m > c.endMonth && e === undefined) {
            if (!drifted) drift.push({ reminderId: r.id, title: r.title, month: m, reminderAmount: r.amount!, fixedAmount: 0, ended: c.endMonth });
            drifted = true;
            reminderLine(r, o, { detail: `Sabit gider ${monthLabel(c.endMonth)} ayında bitti; plan hatırlatıcıdaki ${tl(r.amount!)} tutarını sayar, ödeme bittiyse Ödemeler'de kapatın` });
            continue;
          }
          // Tutar sabit giderin o ayki sürümünden (aynı dönem, KDV dahil) farklıysa satırda ve uyarıda söylenir (E-46)
          const expected = grossIn(m);
          if (expected !== null && Math.abs(expected - r.amount!) > 1) {
            if (follows) {
              reminderLine(r, o, { amount: expected, detail: `Sabit giderdeki ${monthLabel(m)} tutarı (KDV dahil); hatırlatıcı gideri izler` });
              continue;
            }
            if (!drifted) drift.push({ reminderId: r.id, title: r.title, month: m, reminderAmount: r.amount!, fixedAmount: expected });
            drifted = true;
            reminderLine(r, o, { detail: `Sabit giderde ${monthLabel(m)} tutarı ${tl(expected)} (KDV dahil); plan hatırlatıcıdaki ${tl(r.amount!)} tutarını sayar, Ödemeler'de güncelleyin` });
          } else reminderLine(r, o);
        } else if (r.amount === null && e !== undefined && !fixedIn(o.due.slice(0, 7)).some((x) => x.id === c.id)) {
          // Sabit gider aylık girişe çevrilmiş (dönemi bitmiş): hatırlatıcı Aylık harcamalar'daki tutarı taşır (o ay girilmiş
          // olan ödenmiş sayılır: 0 kalırsa satır yok)
          const amount = off(`expense:${e}`) ? 0 : expenseForReminder(r, o, e);
          if (amount === null) addUnknown(r, o.date);
          else if (amount > 0) reminderLine(r, o, { kind: "expense", amount, estimated: true, detail: "Aylık harcamalar'daki tutar" });
        } else if (r.amount === null && !off(`fixed:${c.id}`)) {
          const f = fixedIn(o.due.slice(0, 7)).find((x) => x.id === c.id) ?? fixedIn(o.date.slice(0, 7)).find((x) => x.id === c.id);
          // O ayın sürümü hatırlatıcının dönemine çevrilir: dönemi sonradan değişen gider (aylık → yıllık) her ayda
          // yıllık tutarı göstermesin; dönemler aynıysa tutar giderinkidir (günlük, aylık hatırlatıcıda ayda açık gün)
          const rep = r.repeat === "none" ? null : r.repeat;
          const converted = f !== undefined && rep !== null && f.period !== CADENCE_OF[rep] && !(f.period === "gunluk" && rep === "monthly");
          const amount = !f ? 0 : converted && rep !== null ? monthlyOf(f, st.acikGun) * REPEAT_PER_MONTH[rep] : paidOut(f, f.period === "gunluk" ? f.amount * Math.min(30, st.acikGun) : f.amount);
          const withheld = f ? withheldNote(f, st.acikGun) : null;
          const detail = `Sabit giderdeki tutar${converted ? ", hatırlatıcının dönemine çevrildi" : ""}${f?.vatRate ? ` + %${num(f.vatRate * 100)} KDV` : ""}${withheld ? `; ${withheld}` : ""}`;
          if (amount > 0) reminderLine(r, o, { kind: "fixed", amount, estimated: true, detail });
          else addUnknown(r, o.date);
        }
      }
    } else if (c.kind === "expense") {
      // Her ay girilen harcamanın hatırlatıcısı: tutarlıysa o, değilse harcamanın beklenen tutarı (E-13)
      for (const o of reminderOccurrences(r, today, end)) {
        if (hasAmount(r)) reminderLine(r, o);
        else if (r.amount === null && !off(`expense:${c.id}`)) {
          const amount = expenseForReminder(r, o, c.id);
          if (amount === null) addUnknown(r, o.date);
          else if (amount > 0) reminderLine(r, o, { kind: "expense", amount, estimated: true, detail: "Aylık harcamalar'daki tutar" });
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

  // ------------------------------------------------------------ Sabit giderler (yayılan, tahmini, yarından)
  const fixedOut = dates.map(() => 0);
  const fixedParts = new Map<number, { name: string; perDay: number[]; withheld: string | null }>();
  // Faturası KDV'li bir gider yayıldı mı ("Sabit giderler" satırının açıklaması bunu söyler)
  let fixedVat = false;
  const spreadable = (f: FixedItem) => f.amount > 0 && f.period !== "yillik" && !covered.has(f.id) && !off(`fixed:${f.id}`);
  for (let i = 1; i < N; i++) {
    const m = monthOfDay(i);
    const dim = daysInMonth(m);
    for (const f of fixedIn(m)) {
      if (!spreadable(f)) continue;
      if (f.vatRate) fixedVat = true;
      const v = paidOut(f, f.period === "aylik" ? f.amount / dim : f.period === "haftalik" ? f.amount / 7 : f.amount * openRatio);
      fixedOut[i] += v;
      const part = fixedParts.get(f.id) ?? { name: f.name, perDay: dates.map(() => 0), withheld: withheldNote(f, st.acikGun) };
      part.perDay[i] += v;
      fixedParts.set(f.id, part);
    }
  }
  // Ufuktaki bütün sabit giderler (ilk göründükleri ayın tutarıyla): Tahmine katılanlar ve yıllıklar
  const horizonFixed = new Map<number, FixedItem>();
  for (const m of monthKeys.filter((m) => m >= today.slice(0, 7) && m <= end.slice(0, 7))) for (const f of fixedIn(m)) if (!horizonFixed.has(f.id)) horizonFixed.set(f.id, f);
  const spreadNow = [...horizonFixed.values()].filter(spreadable);
  // Yıllık gider günü bilinmediği için plana girmez (Ödemeler'de hatırlatıcısı varsa onun gününde girer)
  const notIncluded = [...horizonFixed.values()].filter((f) => f.period === "yillik" && f.amount > 0 && !covered.has(f.id)).map((f) => ({ title: f.name, amount: paidOut(f), period: f.period }));

  // ------------------------------------------------------------ Her ay girilen harcamalar (yayılan, tahmini, yarından)
  // Aylık harcamalar'da "her ay" kategoriler (reklam, influencer…; E-13): ayın beklenen ödemesinden bugüne kadar
  // girileni ve o ayın bağlı faturaları düşülür (faturalar ödenmiş ya da Ödemeler'de kesin kalem), kalanı ayın kalan
  // günlerine (gelecek ayda bütün günlerine) eşit yayılır. Adı aynı hatırlatıcı varsa onun gününde (yukarıda)
  const curMonth = today.slice(0, 7);
  const expenseOut = dates.map(() => 0);
  const expenseParts = new Map<number, { name: string; perDay: number[] }>();
  const spreadableExpense = (id: number) => !coveredExpense.has(id) && !off(`expense:${id}`);
  for (let i = 1; i < N; i++) {
    const m = monthOfDay(i);
    const days = m === curMonth ? daysInMonth(m) - dayOf(today) : daysInMonth(m);
    for (const x of input.months[m]?.expenses ?? []) {
      const left = x.amount - x.paid;
      if (!spreadableExpense(x.id) || !(left > 0.005) || days <= 0) continue;
      const v = left / days;
      expenseOut[i] += v;
      const part = expenseParts.get(x.id) ?? { name: x.name, perDay: dates.map(() => 0) };
      part.perDay[i] += v;
      expenseParts.set(x.id, part);
    }
  }
  // Ufuktaki her ay girilen harcamalar (ilk göründükleri ayın tutarıyla): Tahmine katılanlar
  const horizonExpenses = new Map<number, { id: number; name: string; amount: number; from: string; linked?: boolean }>();
  for (const m of monthKeys.filter((m) => m >= curMonth && m <= end.slice(0, 7)))
    for (const x of input.months[m]?.expenses ?? []) if (!horizonExpenses.has(x.id)) horizonExpenses.set(x.id, x);

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
  // Faturası beklenen cari borçlar (K19): tedarikçinin ufuktaki tahmini (T) borcun kalanı (X) kadar küçülür, oranla:
  // tahmin × (1 − min(T, X) / T). Borç kesin kalemde zaten; haftalık irsaliyenin aylık faturası iki kez sayılmasın
  const goodsReduced: { name: string; amount: number }[] = [];
  for (const e of input.expectedDebts ?? []) {
    if (!(e.amount > 0) || off("goods")) continue;
    const keys = new Set(e.keys);
    const parts = [...goodsParts].filter(([supplier]) => keys.has(supplierMatchKey(supplier))).map(([, part]) => part);
    const total = parts.reduce((a, part) => a + part.reduce((x, v) => x + v, 0), 0);
    if (!(total > 0)) continue;
    const share = Math.min(total, e.amount) / total;
    for (const part of parts) {
      for (let i = 0; i < N; i++) {
        const cut = part[i] * share;
        goodsOut[i] -= cut;
        part[i] -= cut;
      }
    }
    goodsReduced.push({ name: e.name, amount: Math.min(total, e.amount) });
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
  const outDay = dates.map((_, i) => outKnown[i] + outEst[i] + fixedOut[i] + expenseOut[i] + goodsOut[i]);
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
  const expenseNamed = () => [...expenseParts.values()].map((p) => [p.name, p.perDay] as [string, number[]]);

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
        detail: `Ay içine yayıldı${fixedVat ? " (faturadaki KDV dahil)" : ""}: ${topParts(fixedNamed(), a, b)
          .map((x) => `${x.name} ${tl(x.sum)}`)
          .join(" · ")}${fixedParts.size > 4 ? " …" : ""}${(() => {
          // Stopajlı kalem (bu hafta yayılan): brütü, stopajı ve bankadan çıkanı
          const notes = [...fixedParts.values()].filter((p) => p.withheld && p.perDay.slice(a, b + 1).some((v) => v > 0)).map((p) => p.withheld);
          return notes.length ? `; ${notes.join("; ")}` : "";
        })()}`,
      });
    }
    const expenseSum = sum(expenseOut);
    if (expenseSum >= 0.5) {
      spread.push({
        key: "expense",
        kind: "expense",
        direction: "out",
        title: "Aylık harcamalar",
        date: null,
        amount: expenseSum,
        estimated: true,
        overdue: false,
        detail: `Her ay girilenler, ay içine yayıldı: ${topParts(expenseNamed(), a, b)
          .map((x) => `${x.name} ${tl(x.sum)}`)
          .join(" · ")}${expenseParts.size > 4 ? " …" : ""}`,
        href: "/panel/harcamalar",
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
    const wEst = sum(outEst) + fixedSum + expenseSum + goodsSum;
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
        ...(expenseOut[i] >= 0.5
          ? [{ key: "expense", kind: "expense" as const, direction: "out" as const, title: "Aylık harcamalar", date: null, amount: expenseOut[i], estimated: true, overdue: false }]
          : []),
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
  for (const f of [...horizonFixed.values()].filter((f) => f.amount > 0)) {
    const key = `fixed:${f.id}`;
    const st2: EstimateRow["status"] = covered.has(f.id) ? "covered" : f.period === "yillik" ? "yearly" : off(key) ? "off" : "on";
    const w = withheldParts(f, st.acikGun);
    estimatesRows.push({
      key,
      title: f.name,
      monthly: monthlyOf(f, st.acikGun),
      status: st2,
      note: `${st2 === "yearly" ? "Yıllık: gününü bilmek için Ödemeler'e ekleyin" : st2 === "covered" ? "Ödemeler'de hatırlatıcısı var" : "ay içine yayılır"}${f.vatRate ? ` · %${num(f.vatRate * 100)} KDV dahil` : ""}${
        w ? ` · ${tl(w.gross)} brüt, stopaj %${num(w.rate * 100)} ödemeden kesildi` : ""
      }`,
      direction: "out",
    });
  }
  for (const x of horizonExpenses.values()) {
    const key = `expense:${x.id}`;
    const st3: EstimateRow["status"] = coveredExpense.has(x.id) ? "covered" : off(key) ? "off" : "on";
    estimatesRows.push({
      key,
      title: x.name,
      monthly: x.amount,
      status: st3,
      note:
        st3 === "covered"
          ? "Ödemeler'de hatırlatıcısı var"
          : `Aylık harcamalar'daki ${monthLabel(x.from)} tutarı${x.linked ? " (bağlı faturalar KDV dahil)" : ""} · ay içine yayılır`,
      direction: "out",
    });
  }

  const totalIn = inDay.reduce((a, b) => a + b, 0);
  const totalKnown = outKnown.reduce((a, b) => a + b, 0);
  const totalEst = dates.reduce((a, _, i) => a + outEst[i] + fixedOut[i] + expenseOut[i] + goodsOut[i], 0);
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
      goodsReduced,
      cari: { count: cariCount, credited },
      payroll: payroll.people > 0 ? payroll : null,
      salaryMode,
      sgkMode,
      fixedSpread: {
        count: spreadNow.length,
        monthly: spreadNow.reduce((a, f) => a + monthlyOf(f, st.acikGun), 0),
        vat: spreadNow.some((f) => (f.vatRate ?? 0) > 0),
        withheld: spreadNow.some((f) => (f.withholdingRate ?? 0) > 0),
      },
      expenseSpread: (() => {
        const xs = [...horizonExpenses.values()].filter((x) => spreadableExpense(x.id));
        return { count: xs.length, monthly: xs.reduce((a, x) => a + x.amount, 0) };
      })(),
      closedDays: closedAhead,
      overdueInvoices,
      sgkRates: input.sgkRates ?? null,
    },
    unknownAmounts,
    notIncluded,
    reminderDrift: drift,
    estimates: estimatesRows,
    excluded: [...excluded],
    hasData: weeks.some((w) => w.lines.length > 0) || unknownAmounts.length > 0,
  };
}

/** "Nasıl hesaplandı": her varsayım rakamlarıyla, bir satır */
/**
 * Satış notunun gün parantezi: tek kasada boş (gün = rapor); şube şube "(Tuzla 28 gün, Marina 7 gün; şube
 * ortalamalarının toplamı)"; şubesiz birden çok rapor aynı güne düştüyse "(10 gün, şubelerin toplamı)"
 */
function salesDaysText(s: { reports: number; days: number; branches?: { name: string; days: number }[] }): string {
  if (s.branches && s.branches.length > 1) return ` (${s.branches.map((b) => `${b.name} ${num(b.days)} gün`).join(", ")}; şube ortalamalarının toplamı)`;
  return s.days === s.reports ? "" : ` (${num(s.days)} gün, şubelerin toplamı)`;
}

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
        ? `Son 28 günün ${num(s.reports)} kasa raporuna${salesDaysText(s)} göre günde ortalama ${tl(s.daily)} (Z toplamı, ödenmez / ikram hariç${s.platformShare >= 0.005 ? `; Z'deki online platform ödemeleri (Yemeksepeti, Getir…) ${pct(s.platformShare, 0)}, aynı gün ve kesintisiz sayıldı` : ""}). ${commission(s.cardShare)} ${fromTomorrow}`
        : s.kind === "pos"
          ? `Son 28 günde yeterli kasa raporu yok; ${monthLabel(s.month)} POS cirosuna göre günde ${tl(s.daily)} (${num(s.openDays)} açık gün). ${commission(s.cardShare)} ${fromTomorrow}`
          : "Satış verisi yok: gelen para sayılmadı. Kasa raporu girildikçe tahmin oluşur.",
  });
  if (b.closedDays.length && !off("sales")) {
    out.push({
      key: "closed",
      title: "Kapalı günler",
      text: `Kafe kapalı işaretli ${num(b.closedDays.length)} günde (${b.closedDays.map(shortDate).join(", ")}) satış ve online girişi yazılmadı (Özel günler).`,
    });
  }
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
    text: `Ödenmemiş faturaların kalan borcu, vade gününde. Vadesi yazılmamışsa tedarikçinin vadesi, yoksa ${num(opts.invoiceTermDays)} gün.${b.overdueInvoices ? ` Gecikmiş ${num(b.overdueInvoices)} fatura bugüne yazıldı.` : ""}${
      b.cari.count ? ` Tedarikçilere faturasız borçlar (${num(b.cari.count)}) da kesin kalem, aynı kuralla.` : ""
    }`,
  });
  if (b.cari.credited) {
    out.push({ key: "credit", title: "Hesaptaki ödeme", text: "Tedarikçinin hesabındaki sayılmamış ödeme borcundan düşüldü (en eski vadeden başlayarak)." });
  }
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
    // Şubenin akışında SGK yok (vergi ve SGK şubeye bölünmez): notu aşağıdaki tek "Vergi ve SGK" notu
    if (!plan.taxFirmWide) {
      out.push({
        key: "sgk",
        title: "SGK",
        text: off("sgk")
          ? "SGK primleri tahmine katılmıyor (Tahmine katılanlar'dan açın)."
          : b.sgkMode === "reminder"
            ? "SGK hatırlatıcısına yazdığınız tutar, onun gününde; ayrıca tahmin yapılmadı."
            : `İşçi ve işveren SGK + işsizlik payları (ayda ${tl(b.payroll.sgk)}), ${b.sgkMode === "carrier" ? "SGK hatırlatıcısının gününde" : "takip eden ayın son günü"}. ${sgkBasis(b)}`,
      });
    }
  }
  if (b.fixedSpread.count) {
    out.push({
      key: "fixed",
      title: "Sabit giderler",
      text: `Hatırlatıcısı olmayan ${num(b.fixedSpread.count)} sabit gider (ayda ${tl(b.fixedSpread.monthly)}${b.fixedSpread.vat ? ", faturadaki KDV dahil" : ""}) ay içine eşit yayıldı. Giderler'de KDV hariç girilen tutara kalemin KDV'si eklenir (kira, faturalar ve genel giderler varsayılan %20, personel KDV'siz; kalemde değiştirilir).${
        b.fixedSpread.withheld
          ? " Stopajlı kalemde (şahsa kira, serbest meslek) ödemeden kesilen stopaj düşüldü: stopajı muhasebeciniz muhtasarla öder, plan vergi tahmini yapmaz (tutarını Ödemeler'e yazarsanız planda görünür)."
          : ""
      } Gününü bilmek için Ödemeler'e ekleyin.`,
    });
  }
  if (b.expenseSpread.count) {
    out.push({
      key: "expense",
      title: "Aylık harcamalar",
      text: `Aylık harcamalar'da her ay girilen ${num(b.expenseSpread.count)} kategori (ayda ${tl(b.expenseSpread.monthly)}): o ay girilen tutar, daha azsa geçen ayınki; bağlı faturalar KDV dahil. Bu ay girilen kadarı ve bu ayın bağlı faturaları ödenmiş sayılır (sabit gideri çevirmenin tahmini kaydı sayılmaz), kalanı ayın kalan günlerine eşit yayılır. Gününü bilmek için Ödemeler'e aynı adla ekleyin.`,
    });
  }
  out.push({
    key: "goods",
    title: "Mal alımı",
    text: off("goods")
      ? "Yeni mal faturaları tahmine katılmıyor (Tahmine katılanlar'dan açın)."
      : b.goods
        ? `Son ${num(b.goods.spanDays)} günün mal faturalarına göre haftada ${tl(b.goods.weekly)}. Yeni faturalar tedarikçinin vadesinde ödenir, peşin çalışılanlar hemen.${
            b.goodsReduced.length ? ` ${b.goodsReduced.map((r) => `${r.name} tahmini, faturası beklenen ${tl(r.amount)} kadar düşürüldü`).join("; ")}.` : ""
          }`
        : "Mal alımı tahmini için en az 2 haftalık fatura gerekir.",
  });
  // Şubenin akışı: SGK notunun yerine tek not (vergi ve SGK şubeye bölünmez)
  if (plan.taxFirmWide) out.push({ key: "vergi", title: "Vergi ve SGK", text: `${FIRM_TAX_NOTE}.` });
  out.push({
    key: "double",
    title: "Çift sayım",
    text: `Aynı ödeme hem hatırlatıcı hem fatura olarak duruyorsa iki kez sayılır (Ödemeler'deki gibi). Faturası ayrıca gelen sabit gideri “Tahmine katılanlar”dan çıkarın.${
      b.cari.count || b.goodsReduced.length ? " Faturasız borçlar kesin kalemde; faturası beklenenler kadar mal tahmini düşürüldü, faturası gelmiş olabilecek fatura bağlanana kadar plana girmez." : ""
    }`,
  });
  const yearly = plan.notIncluded.map((n) => n.title);
  out.push({
    key: "excluded",
    title: "Dahil değil",
    text: `${plan.taxFirmWide ? "Vergi ve SGK ödemeleri (firma geneli)" : "Vergiler (KDV, muhtasar, geçici ve kurumlar vergisi, damga; muhasebeciniz yürütür, tutarını Ödemeler'e yazarsanız planda görünür)"}, Aylık harcamalar'da her ay girilmeyen (tek seferlik) ödemeler (cari borçların gider kayıtları dahil), yıllık giderler${yearly.length ? ` (${yearly.join(", ")})` : ""}, yatırım ve kredi.`,
  });
  return out;
}

/**
 * SGK notunun bordro cümlesi: yasal oranlarla hesaplandıysa oranlar ("işveren %19,75 + %2"); ücretin gelir ve damga
 * vergisi (muhtasar) planda yok
 */
function sgkBasis(b: CashPlan["basis"]): string {
  if (!b.sgkRates) return "Gelir ve damga vergisi dahil değil.";
  const r = b.sgkRates;
  const rates = `${r.year} yasal oranlarıyla (işveren %${num(r.isveren * 100, 0, 2)} + %${num(r.issizlik * 100, 0, 2)})`;
  return `Brüt, gelir ve damga vergisiyle; ${rates} hesaplanır; gelir ve damga vergisi (muhtasar) bu planda yok.`;
}
