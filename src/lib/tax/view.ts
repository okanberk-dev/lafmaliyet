/**
 * Vergi sayfasının bütün sayıları (plan docs/planlar/vergi.md §3.12, §4, §6.10, §8.1): üç rakam, Başlarken, önümüzdeki
 * 100 günün vergi takvimi (her satırda tek tutar ve kaynağı), geçici ve kurumlar vergisi kartları, Vergiye göre
 * çeyrek görünümü ve nakit planının vergi beslemesi. Ekran, Excel ve nakit planı aynı hesabı okur. Kaynakların önceliği
 * Vergi sayfasında muhasebeci › Ödemeler › tahmin (K4); geçici ve kurumlar vergisinin tahmini takvimin tutar sütununa
 * yazılmaz (K21). Saf modül; tests/vergi-gorunum.test.ts.
 */

import { WEEKDAY_NAMES, WEEKDAY_SHORT, weekdayOf } from "../forecast/calendar";
import type { ReminderRow } from "../reminders";
import {
  addDays,
  dayLocativeTR,
  dayMonthTR,
  isLocalTaxReminder,
  isMuhtasarReminder,
  isProvisionalTaxReminder,
  isVatReminder,
  isVatWithholdingReminder,
  longDateTR,
  monthGenitiveTR,
  nextOccurrence,
  postponedFrom,
  reminderCategory,
  shiftMonth,
  taxAmountTravels,
} from "../reminders";
import type { CashPlanVat } from "../cash-plan";
import { dateTR, money, num, tl } from "../format";
import { paidVatPeriods } from "../vat-paid";

import { ASSET_CATEGORY, assetCandidates, type AssetCandidate, orphanAssets, type OrphanAsset, QUARTER_DEPRECIATION_LABELS, unlistedAssetInvoices } from "./assets";
import {
  defaultQuarter,
  defaultYear,
  legalDayText,
  nextDueQuarter,
  legalDueDate,
  mphbPeriodOf,
  monthName,
  nominalDue,
  periodOf,
  periodQuarters,
  quarterLabel,
  quarterOfDue,
  quarterOfMonth,
  shiftText,
  yearOptions,
} from "./calendar";
import { checksChipText, type CheckStatus, checkStatus } from "./checks";
import { corporateTax, filingFor, minTaxText, type QuarterCalc, quarterTaxes, type TaxFiling, unpaidText, type YearCalc } from "./corporate";
import { type MuhtasarItem, type MuhtasarMonth, muhtasarBreakdown, muhtasarMonths, muhtasarTitle } from "./muhtasar";
import {
  candidateInvoiceIds,
  classificationTargets,
  type ClassifyTarget,
  emptyMonth,
  type QuarterPnl,
  SCOPE_HINT,
  SCOPE_TEXT,
  type TaxMonth,
  taxMonths,
  type TaxPnlInput,
  taxQuarters,
  type TaxScope,
  taxScope,
  unclassified,
  type ExcludedItem,
  type BridgeRow,
} from "./pnl";
import {
  formatEstimate,
  r2,
  RULES_CHECK_NOTE,
  RULES_VERIFIED_AT,
  rulesCompiledText,
  rulesFor,
  rulesStaleNotes,
  TAX_DISCLAIMER,
} from "./rules";
import type { TaxSettings } from "./settings";
import { kvStamps, returnStamps } from "./stamp";

/** Takvimin penceresi: bugün … bugün + 100 gün (§3.12) */
export const CALENDAR_DAYS = 100;
/** "Önümüzdeki 30 gün" rakamı */
export const NEXT_DAYS = 30;

// ---------------------------------------------------------------- Girdi

export interface TaxViewInput {
  today: string;
  /** Seçilen yıl (?yil=) ve çeyrek (?ceyrek=); yoksa varsayılan */
  year?: number | null;
  quarter?: string | null;
  settings: TaxSettings;
  pnl: TaxPnlInput;
  /**
   * Muhtasar kalemleri, dönem dönem (muhtasarItemsFromModel); bordro pnl.payroll'dan. Bugünden 4 ay önceden (üç aylık
   * seçenekte 6 ay önceden: ilk çeyrek sonunun önceki ayları) takvim penceresinin sonuna kadar
   */
  muhtasarItems: ReadonlyMap<string, readonly MuhtasarItem[]>;
  filings: readonly TaxFiling[];
  reminders: readonly ReminderRow[];
  /** Nakit planının KDV'si (plan.vat; ufku 42 gün); yoksa KDV satırları tutarsız */
  vat: CashPlanVat | null;
  /** "Ödendi" işaretli geçici vergi dönemleri (payments.vat-paid, tür gecici) */
  paidQuarters?: readonly { period: string; amount: number | null }[];
  /**
   * Son "Ödendi"ler (payments, 30 gün; nakit planının `paidReminders`'ı): ödenen muhtasar, SGK ve geçici vergi dönemi
   * takvimde satır olmaz (nakit planındaki gibi)
   */
  paidReminders?: readonly { id: number; dueDate: string | null; next?: string | null; amount?: number | null }[];
  /** Ayarlar'daki işveren SGK oranı (Gelir-gider'in kullandığı; yasal orandan farklıysa not) */
  settingsEmployerRate?: number;
}

// ---------------------------------------------------------------- Takvim satırı

export type CalendarKind = "kdv1" | "kdv2" | "mphb" | "sgk" | "gecici" | "kv" | "ctv" | "yerel";
export type CalendarSource = "Muhasebeci" | "Ödemeler'de" | "tahmin" | "nakit planı" | "sabit tutar";

export interface TaxCalendarRow {
  key: string;
  kind: CalendarKind;
  period: string;
  title: string;
  nominal: string;
  /** Yasal son gün (VUK 18) ve kaydırmanın alt yazısı ("Son gün 25 Ekim Pazar → 26 Ekim") */
  due: string;
  shift: string | null;
  /** Vergi + beyanname damgası, tek rakam; bilinmiyorsa null */
  amount: number | null;
  /** Damga (tutarın içinde; tutar yoksa bilinen damga) */
  stamp: number;
  atLeast: boolean;
  source: CalendarSource | null;
  /** Geçici ve kurumlar vergisinde */
  state?: "taslak" | "hazir";
  /** Geçmiş dönemin tahmini: "Tahakkuk fişindeki tutarı girin" */
  ask?: "tahakkuk";
  /** En çok bir rozet: "Muhasebeci", "Ödemeler'de", "Taslak", "sabit tutar", "2026 kuralları" */
  badge: string | null;
  /** Tutar sütunu: "≈ 2.600 ₺", "en az ≈ 974 ₺", "791 ₺", "Tutarı bilinmiyor" … */
  amountText: string;
  /** Tutarın altındaki satır: "Tahakkuk fişindeki tutarı girin", "Tutar yaklaşınca nakit planında" … */
  note: string | null;
  /** Ayrıntı (Nasıl hesaplandı): döküm ve cümleler */
  detail: { label: string; value: string }[];
  notes: string[];
  /** "Ödemeler'e ekle" (karşılığı yoksa) */
  addHref: string | null;
  /** Nakit planındaki (nominal) gün */
  cashPlanDate: string | null;
}

const SHORT: Record<CalendarKind, string> = {
  kdv1: "KDV",
  kdv2: "KDV-2",
  mphb: "muhtasar",
  sgk: "SGK",
  gecici: "geçici vergi",
  kv: "kurumlar vergisi",
  ctv: "ÇTV",
  yerel: "ilan-reklam vergisi",
};

export const ASK_TAHAKKUK = "Tahakkuk fişindeki tutarı girin";
export const NOTE_LATER = "Tutar yaklaşınca nakit planında";
export const NOTE_UNKNOWN = "Tutarı bilinmiyor · şirketin beyannamesi; muhasebecinizden isteyin";
export const NOTE_MUNICIPAL = "tutar belediyeden";
/** K4: muhasebecinin rakamı ile Ödemeler'deki tutar farklı (takvim satırında ve Özet'in uyarılarında sarı) */
export const isMismatchNote = (n: string) => n.startsWith("Ödemeler'deki tutar (");
export const INFLATION_LINE = "Enflasyon düzeltmesi 2026'da yapılmaz (VUK geçici 37) · Bu kafede hesaplanmayanlar";

const fold = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Kurumlar vergisi hatırlatıcısı: başlıkta "kurumlar vergisi", "geçici" değil */
export const isKvReminder = (r: Pick<ReminderRow, "title">) => /kurumlar\s+vergi/.test(fold(r.title)) && !/gecici/.test(fold(r.title));
const dmy = (d: string) => dateTR(d);
/** "17.02.2027 Çar" */
const dueShort = (d: string) => `${dmy(d)} ${WEEKDAY_SHORT[weekdayOf(d)]}`;
/** "30 Nisan 2027 Cuma" */
const longDateYear = (d: string) => `${Number(d.slice(8))} ${monthName(d.slice(0, 7))} ${d.slice(0, 4)} ${WEEKDAY_NAMES[weekdayOf(d)]}`;
const n2 = (x: number) => num(x, 2, 2);
/** Döküm tutarı: tam sayıysa kuruşsuz (0), değilse iki ondalık (34,68; 939,70) */
const amt = (x: number) => (Number.isInteger(r2(x)) ? num(x, 0) : num(x, 2, 2));

/** Hatırlatıcının ertelenmiş kopyasında asıl gün (vat-paid.ts originalDue ile aynı kural) */
const originalDueOf = (r: ReminderRow, due: string) => (r.repeat === "none" ? postponedFrom(r.note) : null) ?? due;

interface ReminderHit {
  reminder: ReminderRow;
  /** Hatırlatıcının sıradaki günü bu dönemin; tutarı o döneme aittir */
  amount: number | null;
}

/**
 * Sınıfın hatırlatıcıları, dönem dönem. Tutarı tek döneme ait hatırlatıcıda (taxAmountTravels: KDV, muhtasar, geçici
 * vergi) tutar yalnız sıradaki dönemindir; sabit tutarlıda ("SGK prim ödemesi", "Kira stopajı") her döneminde (§8.2,
 * K26; nakit planındaki gibi)
 */
function remindersByPeriod(reminders: readonly ReminderRow[], match: (r: ReminderRow) => boolean, periodOfDue: (d: string) => string, until: string): Map<string, ReminderHit> {
  const out = new Map<string, ReminderHit>();
  for (const r of reminders) {
    if (!r.active || !match(r)) continue;
    let d: string | null = r.dueDate;
    for (let g = 0; d && d <= until && g < 60; g++) {
      const p = periodOfDue(originalDueOf(r, d));
      if (!out.has(p)) out.set(p, { reminder: r, amount: d === r.dueDate || !taxAmountTravels(r) ? r.amount : null });
      if (r.repeat === "none") break;
      d = nextOccurrence(d, r.repeat, r.anchorDate);
    }
  }
  return out;
}

function amountTextOf(amount: number | null, source: CalendarSource | null, atLeast: boolean, note: string | null): string {
  if (amount === null) return note ?? "Tutarı bilinmiyor";
  const exact = source === "Muhasebeci" || source === "Ödemeler'de" || source === "sabit tutar";
  const text = exact ? money(amount) : formatEstimate(amount);
  return atLeast ? `en az ${text}` : text;
}

const badgeOf = (source: CalendarSource | null, state?: "taslak" | "hazir", estimated?: boolean): string | null => {
  if (source === "Muhasebeci" || source === "Ödemeler'de" || source === "sabit tutar") return source;
  if (state === "taslak") return "Taslak";
  if (estimated) return "2026 kuralları";
  return null;
};

// ---------------------------------------------------------------- Görünüm

export interface StatView {
  label: string;
  value: string;
  sub: string | null;
}

export interface GettingStartedStep {
  key: "sirket" | "siniflandir" | "demirbas" | "muhasebeci";
  title: string;
  detail: string | null;
  done: boolean;
  href: string;
}

export interface CardRow {
  label: string;
  value: string;
}

export interface GeciciCard {
  key: string;
  title: string;
  periodLine: string;
  state: "taslak" | "hazir";
  badge: string | null;
  headline: string;
  subline: string | null;
  rows: CardRow[];
  notes: string[];
  footer: string;
  calc: QuarterCalc;
}

export interface KvCard {
  year: number;
  title: string;
  subtitle: string | null;
  badge: string | null;
  rows: CardRow[];
  notes: string[];
  footer: string;
  calc: YearCalc;
}

export interface YearView {
  year: number;
  months: TaxMonth[];
  quarters: QuarterPnl[];
  corp: QuarterCalc[];
  kv: YearCalc;
}

/** Nakit planının vergi beslemesi (§8.1): tutarlı satırlar, tutarı bilinmeyenler ve KDV beyannamelerinin damgası */
export interface TaxPlanFeed {
  items: { kind: "muhtasar" | "gecici" | "kdv2_hizmet"; period: string; nominal: string; legalDue: string; amount: number; atLeast: boolean; source: "estimate" | "filing"; detail: string }[];
  pending: { kind: "gecici"; period: string; nominal: string; legalDue: string; note: string }[];
  stamps: { kdv: number; kdv2: number };
}

export interface TaxView {
  today: string;
  year: number;
  yearOptions: number[];
  hasData: boolean;
  rulesInfo: { disclaimer: string; compiled: string; checkNote: string; verified: string | null; stale: string[] };
  scope: { key: TaxScope; text: string; hint: string; warning: string | null };
  checks: CheckStatus & { chip: string };
  stats: { next: StatView; next30: StatView; readiness: StatView };
  gettingStarted: { steps: GettingStartedStep[]; done: number; total: number };
  calendar: TaxCalendarRow[];
  later: { kind: "gecici" | "kv"; period: string; title: string; due: string; text: string }[];
  geciciCard: GeciciCard | null;
  kvCard: KvCard;
  years: YearView[];
  /** Seçilen yılın ayları ve çeyrekleri */
  months: TaxMonth[];
  quarters: QuarterPnl[];
  corp: QuarterCalc[];
  kv: YearCalc;
  /** Vergiye göre: seçilen çeyrek ve kümülatif */
  quarter: QuarterView | null;
  muhtasar: MuhtasarMonth[];
  classify: ClassifyView;
  orphans: OrphanAsset[];
  warnings: string[];
  vat: CashPlanVat | null;
  planFeed: TaxPlanFeed;
}

export interface QuarterView {
  key: string;
  label: string;
  options: string[];
  months: TaxMonth[];
  totals: QuarterPnl;
  corp: QuarterCalc | null;
  /** Yılbaşından (hesap döneminin başından) seçilen çeyreğin sonuna */
  ytd: { income: number; expense: number; result: number; depreciation: number; direct: number; kkeg: number; indirim: number; cumulative: number | null };
  bridge: BridgeRow[];
  depreciationMethod: string;
  warnings: string[];
}

export interface ClassifyView {
  targets: ClassifyTarget[];
  unclassifiedCount: number;
  candidates: AssetCandidate[];
  unlisted: { invoiceId: number; supplier: string; date: string; remaining: number }[];
  /** Belgesi yok: yalnız sayı ve toplam (kalemler Excel'e ve işlem geçmişine gitmez) */
  noDoc: { count: number; total: number; text: string | null };
  /** Kartın başlığı: "Bu çeyrekte 808.610 ₺ gider sayılmadı (24 kalem) · 69.780 ₺ demirbaş olabilir (2 fatura)" */
  header: string;
  excluded: ExcludedItem[];
}

// ---------------------------------------------------------------- Hesap

function yearView(input: TaxViewInput, year: number): YearView {
  const months = taxMonths(input.pnl, year, input.today);
  const quarters = taxQuarters(input.pnl, months, year, input.today);
  const corpInput = { year, quarters, filings: input.filings, settings: input.settings, paidQuarters: input.paidQuarters, today: input.today };
  const corp = quarterTaxes(corpInput);
  return { year, months, quarters, corp, kv: corporateTax(corpInput, corp) };
}

const titleOfKind = (kind: CalendarKind, period: string): string => {
  switch (kind) {
    case "kdv1":
      return `KDV (${monthName(period)})`;
    case "kdv2":
      return `KDV-2 (${monthName(period)})`;
    case "mphb":
      return muhtasarTitle(period);
    case "sgk":
      return `SGK (${monthName(period)})`;
    case "gecici":
      return `Geçici vergi ${quarterLabel(period)}`;
    case "kv":
      return `Kurumlar vergisi ${period}`;
    case "ctv":
      return `ÇTV ${period.slice(0, 4)} ${period.slice(5)}. taksit`;
    case "yerel":
      return "İlan ve reklam vergisi";
  }
};

function baseRow(kind: CalendarKind, period: string, nominal: string, cashPlanDate: string | null = nominal): Omit<TaxCalendarRow, "amount" | "stamp" | "atLeast" | "source" | "badge" | "amountText" | "note"> {
  const l = legalDueDate(nominal);
  return { key: `${kind}:${period}`, kind, period, title: titleOfKind(kind, period), nominal, due: l.date, shift: shiftText(l), detail: [], notes: [], addHref: null, cashPlanDate };
}

function finish(row: Omit<TaxCalendarRow, "badge" | "amountText">, estimatedRules = false): TaxCalendarRow {
  return { ...row, badge: badgeOf(row.source, row.state, estimatedRules), amountText: amountTextOf(row.amount, row.source, row.atLeast, row.note) };
}

/** Önümüzdeki 100 günün vergi takvimi (§3.12) */
export function taxCalendar(
  input: TaxViewInput,
  ctx: { years: Map<number, YearView>; muhtasar: Map<string, MuhtasarMonth> },
): { rows: TaxCalendarRow[]; later: TaxView["later"]; hits: { gecici: Map<string, ReminderHit>; kv: Map<string, ReminderHit> } } {
  const { today } = input;
  const end = addDays(today, CALENDAR_DAYS);
  const inWindow = (nominal: string) => {
    const d = legalDueDate(nominal).date;
    return d >= today && d <= end;
  };
  const cur = today.slice(0, 7);
  const months: string[] = [];
  for (let m = shiftMonth(cur, -3); m <= end.slice(0, 7); m = shiftMonth(m, 1)) months.push(m);
  const until = addDays(end, 40);
  const remMphb = remindersByPeriod(input.reminders, isMuhtasarReminder, mphbPeriodOf, until);
  const remSgk = remindersByPeriod(input.reminders, (r) => reminderCategory(r.kind, r.title) === "sgk", mphbPeriodOf, until);
  const remKdv = remindersByPeriod(input.reminders, isVatReminder, mphbPeriodOf, until);
  const remKdv2 = remindersByPeriod(input.reminders, isVatWithholdingReminder, mphbPeriodOf, until);
  // Geçici ve kurumlar vergisinin hatırlatıcıları kartlar için de (K4): kurumlar vergisi kartının günü 16 aya kadar ileride
  const cardUntil = addDays(today, 500);
  const remGecici = remindersByPeriod(input.reminders, isProvisionalTaxReminder, quarterOfDue, cardUntil);
  const remKv = remindersByPeriod(input.reminders, isKvReminder, (d) => String(Number(d.slice(0, 4)) - 1), cardUntil);
  // "Ödendi" denen dönem (vadesinden önce de) bitmiştir: satırı yok (nakit planındaki gibi; K26, §8.2). Sınıfın bütün
  // hatırlatıcılarından: ödenince kapanan tek seferliğin dönemi de ödenmiştir
  const classOf = (match: (r: ReminderRow) => boolean) => new Map(input.reminders.filter(match).map((r) => [r.id, r]));
  const paidMphb = paidVatPeriods(input.paidReminders, classOf(isMuhtasarReminder));
  const paidSgk = paidVatPeriods(input.paidReminders, classOf((r) => reminderCategory(r.kind, r.title) === "sgk"));
  const paidGecici = new Set([...(input.paidQuarters ?? []).map((x) => x.period), ...paidVatPeriods(input.paidReminders, classOf(isProvisionalTaxReminder), "gecici").keys()]);
  const rows: TaxCalendarRow[] = [];
  const stampsOf = (period: string) => returnStamps(period, { kdv2: true, personnel: false, withholding: false }, input.settings.overrides);
  const planNote = (b: { due: string; cashPlanDate: string | null; notes: string[] }) => {
    if (b.cashPlanDate && b.cashPlanDate !== b.due) b.notes.push(`Nakit planında ${dayLocativeTR(b.cashPlanDate)}.`);
  };
  const mismatch = (filing: number, reminder: number) =>
    `Ödemeler'deki tutar (${money(reminder)}) muhasebecinin rakamından (${money(filing)}) farklı; nakit planı Ödemeler'dekini, Vergi sayfası muhasebecininkini kullanıyor.`;

  // Ödeme günü gelmiş, yasal son günü gelmemiş dönem nakit planında yoktur (plan.vat.onDue; bugünün ödemesi eldeki paradan)
  const onDueNote = (nominal: string) => `Ödeme günü (${dayMonthTR(nominal)}) geldiği için nakit planında yok; eldeki paradan ödenir.`;
  for (const p of months) {
    const ended = p < cur;
    // ---- KDV-1 (nakit planının KDV'si + beyanname damgası)
    const kdvNominal = nominalDue("kdv1", p);
    if (inWindow(kdvNominal) && !input.vat?.paid.some((x) => x.period === p) && !input.vat?.onDue.paid.includes(p)) {
      const st = stampsOf(p);
      const planned = input.vat?.rows.find((x) => x.period === p) ?? null;
      const due = planned ? null : (input.vat?.onDue.rows.find((x) => x.period === p) ?? null);
      const vr = planned ?? due;
      const rem = remKdv.get(p);
      const known = vr?.source === "reminder" && vr.estimate?.known != null ? vr.estimate.known : rem?.amount ?? null;
      const b = baseRow("kdv1", p, kdvNominal, due ? null : (vr?.date ?? kdvNominal));
      if (due) b.notes.push(onDueNote(kdvNominal));
      let amount: number | null = null;
      let source: CalendarSource | null = null;
      let note: string | null = null;
      if (known !== null) {
        amount = known;
        source = "Ödemeler'de";
        b.notes.push("Tutar tahakkuk fişinin toplamı sayıldı (damga dahil).");
      } else if (vr && vr.amount !== null) {
        amount = r2(vr.amount + st.kdv);
        source = vr.amount === 0 ? "sabit tutar" : "nakit planı";
        b.detail.push({ label: "KDV (nakit planı)", value: vr.amount === 0 ? money(0) : formatEstimate(vr.amount) }, { label: "Beyanname damgası", value: money(st.kdv) });
        if (vr.amount === 0) b.notes.push("Ödeme beklenmez (devreden); yalnız damga.");
      } else {
        note = vr ? "KDV tahmini hesaplanamadı (satış verisi yok)" : NOTE_LATER;
        b.detail.push({ label: "Beyanname damgası", value: money(st.kdv) });
      }
      if (st.estimated) b.notes.push(`${st.year} tutarı açıklanmadı; ${st.year - 1} tutarı yazıldı.`);
      planNote(b);
      if (!rem) b.addHref = "/panel/hatirlaticilar?yeni=kdv";
      rows.push(finish({ ...b, amount, stamp: st.kdv, atLeast: false, source, note }, st.estimated));
    }

    // ---- KDV-2 (tevkifat ve yurt dışı hizmet)
    const kdv2Nominal = nominalDue("kdv2", p);
    if (inWindow(kdv2Nominal) && !input.vat?.paid2.some((x) => x.period === p) && !input.vat?.onDue.paid2.includes(p)) {
      const v2Due = kdv2Nominal <= today;
      const v2 = (v2Due ? input.vat?.onDue.vat2 : input.vat?.vat2)?.find((x) => x.period === p) ?? null;
      const rem = remKdv2.get(p);
      const hizmet = ctx.muhtasar.get(p)?.kdv2Hizmet ?? 0;
      if (v2 || rem || hizmet > 0) {
        const st = stampsOf(p);
        const b = baseRow("kdv2", p, kdv2Nominal, v2Due ? null : (v2?.date ?? kdv2Nominal));
        if (v2Due && !rem) b.notes.push(onDueNote(kdv2Nominal));
        let amount: number | null;
        let source: CalendarSource;
        if (rem?.amount != null) {
          amount = rem.amount;
          source = "Ödemeler'de";
          b.notes.push("Tutar tahakkuk fişinin toplamı sayıldı (damga dahil).");
        } else {
          const tevkifat = v2?.amount ?? 0;
          amount = r2(tevkifat + hizmet + st.kdv2);
          source = "nakit planı";
          if (tevkifat) b.detail.push({ label: "Faturalardaki KDV tevkifatı", value: formatEstimate(tevkifat) });
          if (hizmet) b.detail.push({ label: "Yurt dışı hizmetin KDV'si (sorumlu sıfatıyla)", value: formatEstimate(hizmet) });
          b.detail.push({ label: "Beyanname damgası", value: money(st.kdv2) });
          if (hizmet) b.notes.push("Aynı ay 1 No.lu beyannamede indirilir; panelin KDV tahmini bunu görmez.");
        }
        planNote(b);
        rows.push(finish({ ...b, amount, stamp: st.kdv2, atLeast: false, source, note: null }, st.estimated));
      }
    }

    // ---- Muhtasar ve prim hizmet
    const mm = ctx.muhtasar.get(p);
    const mNominal = nominalDue("mphb", p);
    if (mm && !mm.empty && inWindow(mNominal) && !paidMphb.has(p)) {
      const rem = remMphb.get(p);
      const b = baseRow("mphb", p, mNominal);
      let amount: number | null = mm.payable;
      let source: CalendarSource = mm.source === "Muhasebeci" ? "Muhasebeci" : "tahmin";
      let atLeast = mm.atLeast;
      let ask: "tahakkuk" | undefined;
      if (mm.filing && rem?.amount != null && Math.abs(rem.amount - mm.payable) > 1) b.notes.push(mismatch(mm.payable, rem.amount));
      if (!mm.filing && rem?.amount != null) {
        amount = rem.amount;
        source = "Ödemeler'de";
        atLeast = false;
      } else if (!mm.filing && ended) ask = "tahakkuk";
      // Personelsiz, stopajı bilinmeyen ay: "en az 0 ₺" yazılmaz, tutar bilinmiyor (kalemler notta)
      if (amount === 0 && atLeast) amount = null;
      for (const x of muhtasarBreakdown(mm)) b.detail.push({ label: x.label, value: money(x.amount) + (x.note ? ` (${x.note})` : "") });
      if (mm.unknown.length) b.notes.push(`${mm.unknown.length} kalemin stopajı bilinmiyor: ${mm.unknown.join(", ")}.`);
      if (!mm.filing) b.notes.push("Tahmin; kesin tutar tahakkuk fişindedir.");
      planNote(b);
      if (!rem) b.addHref = "/panel/hatirlaticilar?yeni=muhtasar";
      rows.push(finish({ ...b, amount, stamp: mm.damga, atLeast, source, ask, note: ask ? ASK_TAHAKKUK : null }, mm.stampEstimated));
    }

    // ---- SGK primi
    const pay = input.pnl.payroll.get(p);
    const sNominal = nominalDue("sgk", p);
    if (pay && pay.totals.people > 0 && inWindow(sNominal) && !paidSgk.has(p)) {
      const rem = remSgk.get(p);
      const b = baseRow("sgk", p, sNominal);
      const t = pay.totals;
      let amount = t.sgkTotal;
      let source: CalendarSource = "tahmin";
      let ask: "tahakkuk" | undefined;
      if (rem?.amount != null) {
        amount = rem.amount;
        source = "Ödemeler'de";
      } else if (ended) ask = "tahakkuk";
      const pctOf = (x: number) => `%${(Math.round(x * 10_000) / 100).toLocaleString("tr-TR")}`;
      b.detail.push(
        { label: `İşçi SGK (${pctOf(pay.rates.isciSgk)})`, value: money(t.isciSgk) },
        { label: `İşçi işsizlik (${pctOf(pay.rates.isciIssizlik)})`, value: money(t.isciIssizlik) },
        { label: `İşveren SGK (${pctOf(pay.rates.isverenSgk)})`, value: money(t.isverenSgk) },
        { label: `İşveren işsizlik (${pctOf(pay.rates.isverenIssizlik)})`, value: money(t.isverenIssizlik) },
      );
      if (t.support) b.detail.push({ label: "Asgari ücret desteği (şartlı)", value: money(-t.support) });
      b.notes.push("Hazine indirimi (2 puan) primler süresinde ödenirse ve vadesi geçmiş borç yoksa uygulanır; geç ödenen ayda işveren payı %21,75'tir.");
      if (input.settingsEmployerRate !== undefined && Math.abs(input.settingsEmployerRate - pay.rates.isverenSgk) > 1e-9)
        b.notes.push(`Gelir-gider Ayarlar'daki ${pctOf(input.settingsEmployerRate)}'i kullanıyor; vergi ve nakit planı yasal oranı.`);
      if (sNominal.slice(0, 4) !== p.slice(0, 4)) b.notes.push(`${monthName(p)} bordrosu ${p.slice(0, 4)} kurallarıyla.`);
      planNote(b);
      if (!rem) b.addHref = "/panel/hatirlaticilar?yeni=sgk";
      rows.push(finish({ ...b, amount, stamp: 0, atLeast: false, source, ask, note: ask ? ASK_TAHAKKUK : null }, pay.estimated));
    }
  }

  // ---- Geçici vergi ve kurumlar vergisi (tahmin tutar sütununa yazılmaz, K21)
  const later: TaxView["later"] = [];
  const corpOf = (key: string) => ctx.years.get(Number(key.slice(0, 4)))?.corp.find((c) => c.key === key) ?? null;
  const yearsAround = [Number(today.slice(0, 4)) - 1, Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1];
  const quarterKeys = yearsAround.flatMap((y) => periodQuarters(y, input.settings).map((q) => q.key));
  for (const key of quarterKeys) {
    const nominal = nominalDue("gecici", key);
    const l = legalDueDate(nominal);
    if (l.date < today || paidGecici.has(key)) continue;
    const calc = corpOf(key);
    if (!inWindow(nominal)) {
      if (!later.some((x) => x.kind === "gecici")) later.push({ kind: "gecici", period: key, title: titleOfKind("gecici", key), due: l.date, text: `${titleOfKind("gecici", key)} · ${dueShort(l.date)}` });
      continue;
    }
    const filing = filingFor(input.filings, "gecici", key);
    const rem = remGecici.get(key);
    const b = baseRow("gecici", key, nominal);
    let amount: number | null = null;
    let source: CalendarSource | null = null;
    if (filing) {
      amount = r2(filing.payable + filing.stamp);
      source = "Muhasebeci";
      if (rem?.amount != null && Math.abs(rem.amount - amount) > 1) b.notes.push(mismatch(amount, rem.amount));
    } else if (rem?.amount != null) {
      amount = rem.amount;
      source = "Ödemeler'de";
    }
    if (calc) {
      const head = calc.state === "taslak" ? `en çok ${formatEstimate(calc.estimate)}` : formatEstimate(calc.estimate);
      b.detail.push({ label: "Kafenin katkısı (yalnız kafe)", value: `${head} + damga ${n2(calc.stamp)} ₺` });
    }
    b.notes.push("Şirketin beyannamesi; geçici vergi şirketin bütün işleri için tektir.");
    planNote(b);
    if (!rem) b.addHref = "/panel/hatirlaticilar?yeni=gecici";
    rows.push(finish({ ...b, amount, stamp: calc?.stamp ?? 0, atLeast: false, source, state: calc?.state, note: amount === null ? NOTE_UNKNOWN : null }));
  }
  for (const y of yearsAround) {
    if (!periodOf(y, input.settings)) continue;
    const key = String(y);
    const nominal = nominalDue("kv", key);
    const l = legalDueDate(nominal);
    if (l.date < today) continue;
    if (!inWindow(nominal)) {
      if (!later.some((x) => x.kind === "kv")) later.push({ kind: "kv", period: key, title: titleOfKind("kv", key), due: l.date, text: `${titleOfKind("kv", key)} · ${dueShort(l.date)}` });
      continue;
    }
    const calc = ctx.years.get(y)?.kv ?? null;
    const filing = filingFor(input.filings, "kv", key);
    const rem = remKv.get(key);
    const b = baseRow("kv", key, nominal);
    const stamps = kvStamps(y, input.settings.overrides);
    let amount: number | null = null;
    let source: CalendarSource | null = null;
    if (filing) {
      amount = r2(filing.payable + filing.stamp);
      source = "Muhasebeci";
      if (rem?.amount != null && Math.abs(rem.amount - amount) > 1) b.notes.push(mismatch(amount, rem.amount));
    } else if (rem?.amount != null) {
      amount = rem.amount;
      source = "Ödemeler'de";
    }
    if (calc) b.detail.push({ label: "Kafenin katkısı (yalnız kafe)", value: `${formatEstimate(calc.payable)} + damga ${n2(stamps.total)} ₺` });
    if (!rem) b.addHref = "/panel/hatirlaticilar?yeni=kv";
    const state = calc?.quarters.at(-1)?.state;
    rows.push(finish({ ...b, amount, stamp: stamps.total, atLeast: false, source, state, note: amount === null ? NOTE_UNKNOWN : null }));
  }

  // ---- Yerel vergiler: hatırlatıcılarıyla; ÇTV hatırlatıcısı yoksa taksit günü tutarsız (K23)
  const localRems = input.reminders.filter((r) => r.active && isLocalTaxReminder(r));
  for (const r of localRems) {
    const kind = isLocalTaxReminder(r) === "ctv" ? "ctv" : "yerel";
    for (let d: string | null = r.dueDate, g = 0; d && d <= end && g < 30; g++) {
      if (d >= today) {
        const l = legalDueDate(d);
        const period = kind === "ctv" ? `${d.slice(0, 4)}-${Number(d.slice(5, 7)) <= 6 ? 1 : 2}` : d.slice(0, 4);
        const amount = d === r.dueDate || !taxAmountTravels(r) ? r.amount : null;
        rows.push(
          finish({
            key: `${kind}:${r.id}@${d}`,
            kind,
            period,
            title: r.title,
            nominal: d,
            due: l.date,
            shift: shiftText(l),
            amount,
            stamp: 0,
            atLeast: false,
            source: amount !== null ? "Ödemeler'de" : null,
            note: amount === null ? NOTE_MUNICIPAL : null,
            detail: [],
            notes: [],
            addHref: null,
            cashPlanDate: d,
          }),
        );
      }
      if (r.repeat === "none") break;
      d = nextOccurrence(d, r.repeat, r.anchorDate);
    }
  }
  if (!localRems.some((r) => isLocalTaxReminder(r) === "ctv")) {
    for (const y of yearsAround) {
      if (!periodOf(y, input.settings)) continue;
      for (const t of [1, 2]) {
        const period = `${y}-${t}`;
        const nominal = nominalDue("ctv", period);
        if (!inWindow(nominal) || nominal < input.settings.periodStart) continue;
        const b = baseRow("ctv", period, nominal, null);
        b.addHref = `/panel/hatirlaticilar?yeni=ctv${t}`;
        b.notes.push("Ödemeler'de hatırlatıcısı yok; tutarı ve günü belediyenin tahakkukundan yazın.");
        rows.push(finish({ ...b, amount: null, stamp: 0, atLeast: false, source: null, note: NOTE_MUNICIPAL }));
      }
    }
  }

  const order: CalendarKind[] = ["kdv2", "mphb", "kdv1", "sgk", "gecici", "kv", "ctv", "yerel"];
  rows.sort((a, b) => a.due.localeCompare(b.due) || order.indexOf(a.kind) - order.indexOf(b.kind) || a.period.localeCompare(b.period));
  return { rows, later, hits: { gecici: remGecici, kv: remKv } };
}

// ---------------------------------------------------------------- Kartlar

const RANGE = (from: string, to: string) => `${Number(from.slice(8))} ${monthName(from.slice(0, 7))}–${Number(to.slice(8))} ${monthName(to.slice(0, 7))}`;

export const SCOPE_WARNING = "Gelir şirketin tamamı (beyanname), gider yalnız kafe: kafe dışı giderleri girmezseniz rakam yüksek çıkar";

/**
 * Kaynakların önceliği kartta da muhasebeci › Ödemeler › tahmin (K4): kayıt yoksa dönemin Ödemeler'deki tutarı büyük
 * satırdır ("Ödemeler'de" rozeti), kafenin katkısı alt satırda kalır
 */
function geciciCard(calc: QuarterCalc, q: QuarterPnl, input: TaxViewInput, scope: TaxScope, quarters: readonly QuarterCalc[], rem: ReminderHit | undefined): GeciciCard {
  const { rules } = rulesFor(Number(calc.key.slice(0, 4)), input.settings.overrides);
  const l = legalDueDate(nominalDue("gecici", calc.key));
  const title = `Kafenin geçici vergi matrahına katkısı (${scope === "kafe_elle" ? "kafe + elle girilen kafe dışı" : "yalnız kafe"})`;
  const label = quarterLabel(calc.key);
  const notes: string[] = [];
  if (scope === "beyanname") notes.push(SCOPE_WARNING);
  if (!calc.complete) notes.push("Dönem sürüyor: bugüne kadarki veriyle");
  notes.push(minTaxText(Number(calc.key.slice(0, 4)), input.settings));
  notes.push(`Amortisman: ${QUARTER_DEPRECIATION_LABELS[input.settings.quarterDepreciation].toLocaleLowerCase("tr-TR")}`);
  if (calc.noAnchor) notes.push("Sonraki tahmin panelin verisiyle (matrah girilmedi)");
  for (const p of quarters) {
    const due = legalDueDate(nominalDue("gecici", p.key)).date;
    if (due < input.today && !p.filing) notes.push(`${quarterLabel(p.key)} (son gün ${dmy(due)}) için muhasebecinin rakamı girilmedi.`);
  }
  let headline: string;
  let subline: string | null = null;
  const remAmount = calc.filing ? null : (rem?.amount ?? null);
  if (calc.filing) {
    headline = `Şirketin beyannamesi ${money(calc.filing.payable)}`;
    subline = `Kafenin katkısı ${formatEstimate(calc.estimate)} · şirketin beyannamesi ${money(calc.filing.payable)}`;
  } else if (remAmount !== null) {
    headline = `Ödemeler'deki tutar ${money(remAmount)}`;
    subline = `Kafenin katkısı ${calc.state === "taslak" ? "en çok " : ""}${formatEstimate(calc.estimate)} · Ödemeler'deki tutar ${money(remAmount)} (damga dahil)`;
  } else if (calc.state === "taslak") {
    headline = `Giderler sınıflandırılınca netleşir · şimdilik en çok ${formatEstimate(calc.estimate)}`;
    const parts = [`${tl(q.unclassified.total)} gider henüz hesaba girmedi (${q.unclassified.count} kalem)`];
    if (q.candidates.count) parts.push(`${tl(q.candidates.total)} demirbaş olabilir (${q.candidates.count} fatura)`);
    subline = parts.join(" · ");
  } else headline = formatEstimate(calc.estimate);
  const rows: CardRow[] = [
    { label: "Kümülatif kurum kazancı", value: money(calc.cumulative) },
    { label: `× %${Math.round(rules.gecici.oran.value * 100)}`, value: money(calc.hesaplanan) },
    { label: `Asgari kurumlar vergisi (%${Math.round(rules.kv.asgariOran.value * 100)})`, value: calc.asgari === null ? "uygulanmaz" : money(calc.asgari) },
    { label: "Önceki dönemler", value: money(calc.previous) },
    { label: "Kafenin katkısı", value: formatEstimate(calc.estimate) },
    { label: "Beyanname damgası", value: `${n2(calc.stamp)} ₺` },
  ];
  return {
    key: calc.key,
    title,
    periodLine: `${label} · ${RANGE(calc.from, calc.to)} · son gün ${longDateTR(l.date)}`,
    state: calc.state,
    badge: calc.filing ? "Muhasebeci" : remAmount !== null ? "Ödemeler'de" : calc.state === "taslak" ? "Taslak" : null,
    headline,
    subline,
    rows,
    notes,
    footer: `Şirketin geçici vergisi muhasebecinizin beyannamesindedir; ${label} rakamını ${monthGenitiveTR(l.date)} ilk haftası isteyin.`,
    calc,
  };
}

function kvCard(y: YearView, rem: ReminderHit | undefined): KvCard {
  const k = y.kv;
  // K4: kayıt yoksa Ödemeler'deki tutar "Ödenecek"tir; kafenin katkısı ayrı satırda
  const remAmount = k.filing ? null : (rem?.amount ?? null);
  const s = k.stamps;
  const l = legalDueDate(nominalDue("kv", String(y.year)));
  const rows: CardRow[] = [
    { label: "Matrah", value: money(k.matrah) },
    { label: "Hesaplanan", value: money(k.hesaplanan) },
    { label: "Asgari kurumlar vergisi", value: k.asgari === null ? "uygulanmaz" : money(k.asgari) },
    { label: "Mahsup edilecek geçici vergi (yalnız ödendi işaretli)", value: money(k.paidProvisional) },
    ...(remAmount !== null
      ? [
          { label: "Kafenin katkısı", value: k.refund > 0 ? `iade ${formatEstimate(k.refund)}` : formatEstimate(k.payable) },
          { label: "Ödenecek (Ödemeler'deki tutar, damga dahil)", value: money(remAmount) },
        ]
      : [k.refund > 0 ? { label: "İade / mahsup alacağı", value: formatEstimate(k.refund) } : { label: "Ödenecek", value: k.filing ? money(k.payable) : formatEstimate(k.payable) }]),
  ];
  if (k.newLoss > 0) rows.push({ label: "Oluşan zarar (sonraki 5 yılın kazancından düşülür)", value: money(k.newLoss) });
  const notes = k.unpaid.map((u) => unpaidText(u.period));
  if (k.minTaxBinding) notes.unshift("Asgari kurumlar vergisi uygulandı");
  const stampParts = `beyanname ${n2(s.beyanname)}, bilanço ${n2(s.bilanco)}, gelir tablosu ${n2(s.gelirTablosu)}${s.note ? `; ${s.note}` : ""}`;
  return {
    year: y.year,
    title: `Kurumlar vergisi (${y.year}) · kafenin katkısı`,
    subtitle: k.inProgress ? "Bugüne kadarki kârla" : null,
    badge: k.filing ? "Muhasebeci" : remAmount !== null ? "Ödemeler'de" : (y.quarters.at(-1)?.state ?? "taslak") === "taslak" ? "Taslak" : null,
    rows,
    notes,
    footer: `Beyanname 1–30 Nisan ${y.year + 1} · ödeme ${longDateYear(l.date)} · damga ${n2(s.total)} ₺ (${stampParts})`,
    calc: k,
  };
}

// ---------------------------------------------------------------- Nakit planı beslemesi (§8.1)

function planFeed(input: TaxViewInput, ctx: { years: Map<number, YearView>; muhtasar: Map<string, MuhtasarMonth> }): TaxPlanFeed {
  const items: TaxPlanFeed["items"] = [];
  const pending: TaxPlanFeed["pending"] = [];
  const kdv2Item = (m: MuhtasarMonth) => {
    if (m.kdv2Hizmet > 0) {
      const nominal = nominalDue("kdv2", m.period);
      items.push({
        kind: "kdv2_hizmet",
        period: m.period,
        nominal,
        legalDue: legalDueDate(nominal).date,
        amount: m.kdv2Hizmet,
        atLeast: false,
        source: "estimate",
        detail: `Yurt dışı hizmetin KDV'si (sorumlu sıfatıyla): ${m.kdv2Items.map((x) => `${x.name} ${amt(x.base)} × %20`).join(" + ")}. Aynı ay 1 No.lu beyannamede indirilir. ${legalDayText(legalDueDate(nominal)).replace(/^s/, "S")}.`,
      });
    }
  };
  for (const m of ctx.muhtasar.values()) {
    // Yurt dışı hizmetin KDV-2'si ayrı beyannamedir: muhtasar boş olsa da (takvimdeki gibi)
    kdv2Item(m);
    // Tutarı 0 olan ay (personelsiz, stopajı bilinmeyen) plana girmez; hatırlatıcısı varsa "Tutarı girilmemiş"te kalır
    if (m.empty || !(m.payable > 0)) continue;
    // Döküm tutara eşit (üç aylıkta ara ayın vergisi çeyrek sonunda, çeyrek sonunda önceki aylar da)
    const own = [`Ücret GV ${amt(m.ucretGv)} + DV ${amt(m.ucretDv)}`, ...m.stopaj.map((s) => `${s.name} stopajı ${amt(s.amount)}`)].join(" + ");
    const prior = r2(m.vergiPayable - m.vergi);
    const parts = m.deferred
      ? `Damga ${amt(m.damga)}; vergi kısmı (${own}) çeyrek sonunda ödenir (üç aylık)`
      : `${own}${prior !== 0 ? ` + çeyreğin önceki ayları ${amt(prior)}` : ""} + damga ${amt(m.damga)}`;
    const detail = m.filing
      ? `Muhasebecinin rakamı. ${legalDayText(legalDueDate(m.nominal)).replace(/^s/, "S")}.`
      : `${parts}${m.atLeast ? `; en az (${m.unknown.length} kalemin stopajı bilinmiyor)` : ""}. Tahmin; kesin tutar tahakkuk fişindedir. ${legalDayText(legalDueDate(m.nominal)).replace(/^s/, "S")}.`;
    items.push({ kind: "muhtasar", period: m.period, nominal: m.nominal, legalDue: m.due, amount: m.payable, atLeast: m.atLeast, source: m.filing ? "filing" : "estimate", detail });
  }
  for (const y of ctx.years.values()) {
    for (const c of y.corp) {
      const nominal = nominalDue("gecici", c.key);
      const legal = legalDueDate(nominal).date;
      if (legal < addDays(input.today, -60)) continue;
      const label = quarterLabel(c.key);
      if (c.filing) {
        items.push({ kind: "gecici", period: c.key, nominal, legalDue: legal, amount: r2(c.filing.payable + c.filing.stamp), atLeast: false, source: "filing", detail: `Geçici vergi ${label}: muhasebecinin rakamı. ${legalDayText(legalDueDate(nominal)).replace(/^s/, "S")}.` });
      } else if (c.state === "hazir") {
        items.push({
          kind: "gecici",
          period: c.key,
          nominal,
          legalDue: legal,
          amount: r2(c.estimate + c.stamp),
          atLeast: false,
          source: "estimate",
          detail: `Geçici vergi ${label}: kafenin katkısı ${formatEstimate(c.estimate)} + damga ${amt(c.stamp)}. Tahmin; şirketin beyannamesi muhasebecidedir. ${legalDayText(legalDueDate(nominal)).replace(/^s/, "S")}.`,
        });
      } else pending.push({ kind: "gecici", period: c.key, nominal, legalDue: legal, note: `Geçici vergi ${label}: şirketin beyannamesi; tutarı muhasebecinizden isteyin (son gün ${legal.slice(8)}.${legal.slice(5, 7)})` });
    }
  }
  const { rules } = rulesFor(Number(input.today.slice(0, 4)), input.settings.overrides);
  return { items: items.sort((a, b) => a.nominal.localeCompare(b.nominal)), pending: pending.sort((a, b) => a.nominal.localeCompare(b.nominal)), stamps: { kdv: rules.damga.beyanname.kdv.value, kdv2: rules.damga.beyanname.kdv.value } };
}

// ---------------------------------------------------------------- Görünüm

const joinTr = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ve ${xs.at(-1)}`);
const capitalize = (s: string) => (s ? s[0].toLocaleUpperCase("tr-TR") + s.slice(1) : s);

const EXACT_SOURCES: readonly (CalendarSource | null)[] = ["Muhasebeci", "Ödemeler'de", "sabit tutar"];

function sumStat(rows: readonly TaxCalendarRow[]): { known: number; atLeast: boolean; unknown: TaxCalendarRow[]; text: string } {
  const withAmount = rows.filter((r) => r.amount !== null);
  const known = r2(withAmount.reduce((s, r) => s + r.amount!, 0));
  const unknown = rows.filter((r) => r.amount === null);
  const atLeast = rows.some((r) => r.atLeast) || unknown.length > 0;
  // Kesin rakamlar (muhasebeci, Ödemeler, sabit tutar) olduğu gibi; içinde tahmin varsa "≈" (K27)
  const exact = withAmount.every((r) => EXACT_SOURCES.includes(r.source) && !r.atLeast);
  return { known, atLeast, unknown, text: `${atLeast ? "en az " : ""}${exact ? money(known) : formatEstimate(known)}` };
}

function stats(rows: readonly TaxCalendarRow[], today: string, readiness: { done: number; total: number }): TaxView["stats"] {
  const upcoming = rows.filter((r) => r.due >= today);
  const first = upcoming[0];
  let next: StatView = { label: "Sıradaki ödeme", value: "Yok", sub: null };
  if (first) {
    const same = upcoming.filter((r) => r.due === first.due);
    const s = sumStat(same);
    const kinds = [...new Set(same.map((r) => SHORT[r.kind]))];
    const value = s.known > 0 || !s.unknown.length ? s.text : "Tutarı bilinmiyor";
    const unknownText = s.unknown.length && s.known > 0 ? ` + ${s.unknown.length} ödemenin tutarı bilinmiyor` : "";
    next = { label: "Sıradaki ödeme", value: value + unknownText, sub: `${capitalize(joinTr(kinds))} · ${dayMonthTR(first.due)}` };
  }
  const window = upcoming.filter((r) => r.due <= addDays(today, NEXT_DAYS));
  const w = sumStat(window);
  const unknownKinds = [...new Set(w.unknown.map((r) => SHORT[r.kind]))];
  const next30: StatView = {
    label: `Önümüzdeki ${NEXT_DAYS} gün`,
    value: w.text,
    sub: w.unknown.length ? `tutarı bilinmeyen ${w.unknown.length} ödeme (${joinTr(unknownKinds)})` : null,
  };
  return { next, next30, readiness: { label: "Hazırlık", value: `${readiness.done} / ${readiness.total}`, sub: null } };
}

/** Ayların aralığı: "Temmuz–Eylül", tek ay "Eylül", ayrık "Temmuz, Eylül" */
function monthsText(ms: readonly string[]): string {
  if (!ms.length) return "";
  const runs: string[][] = [];
  for (const m of ms) {
    const last = runs.at(-1);
    if (last && shiftMonth(last.at(-1)!, 1) === m) last.push(m);
    else runs.push([m]);
  }
  return runs.map((r) => (r.length === 1 ? monthName(r[0]) : `${monthName(r[0])}–${monthName(r.at(-1)!)}`)).join(", ");
}

/**
 * Muhtasar ayları: bugünden 4 ay önce (gecikmiş dönem) … takvim penceresinin sonu. Üç aylık seçenekte ilk çeyrek
 * sonunun önceki iki ayı da girdidir (pencerenin dışında kalsa da çeyreğin vergisi üç ayın toplamı)
 */
function muhtasarWindow(input: TaxViewInput): Map<string, MuhtasarMonth> {
  const { today, settings } = input;
  const end = addDays(today, CALENDAR_DAYS);
  const first = shiftMonth(today.slice(0, 7), -4);
  const periods: string[] = [];
  for (let m = settings.muhtasarQuarterly ? shiftMonth(first, -2) : first; m <= end.slice(0, 7); m = shiftMonth(m, 1)) if (m >= settings.periodStart.slice(0, 7)) periods.push(m);
  return new Map(
    [
      ...muhtasarMonths(
        periods.map((p) => ({ period: p, payroll: input.pnl.payroll.get(p), items: input.muhtasarItems.get(p) ?? [] })),
        { filings: input.filings, overrides: settings.overrides, quarterly: settings.muhtasarQuarterly },
      ),
    ].filter(([p]) => p >= first),
  );
}

/**
 * Yalnız nakit planının beslemesi (§8.1; K30): takvim, kartlar ve sınıflandırma olmadan, `buildTaxView(input).planFeed`
 * ile aynı. Geçici vergi satırı son 60 günün ve sonrasının dönemleridir: geçen ve bu yılın çeyrekleri yeter. Nakit
 * planı (src/server/data/cash-plan.ts) bunu çağırır; KDV'yi kendisi hesapladığı için `vat` ve hatırlatıcılar okunmaz
 */
export function taxPlanFeed(input: TaxViewInput): TaxPlanFeed {
  const ty = Number(input.today.slice(0, 4));
  const years = new Map<number, YearView>();
  for (const y of [ty - 1, ty]) if (periodOf(y, input.settings) && `${y}-01-01` <= input.today) years.set(y, yearView(input, y));
  return planFeed(input, { years, muhtasar: muhtasarWindow(input) });
}

/** Vergi sayfasının görünümü: bütün sayılar buradan */
export function buildTaxView(input: TaxViewInput): TaxView {
  const { today, settings } = input;
  const kvFilings = input.filings.filter((f) => f.kind === "kv");
  const year = input.year ?? defaultYear(today, kvFilings, settings);
  const ty = Number(today.slice(0, 4));
  const years = new Map<number, YearView>();
  for (const y of [...new Set([ty - 1, ty, year])].sort()) if (periodOf(y, settings) && `${y}-01-01` <= today) years.set(y, yearView(input, y));
  const selected = years.get(year) ?? yearView(input, year);
  const muhtasar = muhtasarWindow(input);
  const ctx = { years, muhtasar };
  const cal = taxCalendar(input, ctx);

  // Sınıflandırma ve Başlarken (seçilen yıl)
  const targets = classificationTargets(input.pnl, selected.months);
  const { rules } = rulesFor(year, settings.overrides);
  const candidates = assetCandidates(input.pnl.invoices, input.pnl.assets, rules).filter((c) => c.invoice.date >= settings.periodStart && c.invoice.date.startsWith(`${year}-`));
  const unlisted = unlistedAssetInvoices(input.pnl.invoices, input.pnl.assets)
    .filter((x) => x.invoice.date >= settings.periodStart && x.invoice.date.startsWith(`${year}-`))
    .map((x) => ({ invoiceId: x.invoice.id, supplier: x.invoice.supplier, date: x.invoice.date, remaining: x.remaining }));
  const excluded = unclassified(selected.months);
  const noDocItems = excluded.filter((x) => x.reason === "yok");
  const noDocTotal = r2(noDocItems.reduce((s, x) => s + x.raw, 0));
  const unclassifiedCount = targets.filter((t) => t.doc === null).length;
  const q = input.quarter && selected.quarters.some((x) => x.key === input.quarter) ? input.quarter : (defaultQuarter(today, year, settings) ?? selected.quarters.at(-1)?.key ?? null);
  const qp = selected.quarters.find((x) => x.key === q) ?? null;
  const classify: ClassifyView = {
    targets,
    unclassifiedCount,
    candidates,
    unlisted,
    noDoc: {
      count: noDocItems.length,
      total: noDocTotal,
      text: noDocItems.length ? `Belgesi yok: ${noDocItems.length} kalem, ${tl(noDocTotal)}. Belgesiz ödeme deftere giremez; şirket kasasından çıktıysa muhasebeciniz ortak hesabına yazar.` : null,
    },
    header: qp
      ? `Bu çeyrekte ${tl(qp.unclassified.total)} gider sayılmadı (${qp.unclassified.count} kalem)${qp.candidates.count ? ` · ${tl(qp.candidates.total)} demirbaş olabilir (${qp.candidates.count} fatura)` : ""}`
      : "",
    excluded,
  };

  const missingLife = input.pnl.assets.filter((a) => a.method === "amortisman" && !a.lifeYears).length;
  const missingMatrah = selected.months.filter((m) => m.month < today.slice(0, 7) && m.revenueSource !== "beyanname" && !emptyMonth(m) && !filingFor(input.filings, "kdv_matrah", m.month)).map((m) => m.month);
  const missingGecici = selected.corp.filter((c) => legalDueDate(nominalDue("gecici", c.key)).date < today && !c.filing).map((c) => c.key);
  const muhasebeParts = [missingMatrah.length ? `${monthsText(missingMatrah)} KDV beyannamesi satışları` : "", missingGecici.length ? `${joinTr(missingGecici.map(quarterLabel))} geçici vergi` : ""].filter(Boolean);
  const steps: GettingStartedStep[] = [
    { key: "sirket", title: "Şirket nasıl kuruldu?", detail: settings.firstActivity === "ilk" ? "İlk defa faaliyete başladı" : settings.firstActivity === "devir" ? "Birleşme, devir, bölünme ya da tür değişikliğiyle" : null, done: settings.firstActivity !== null, href: "/panel/vergi/kurallar" },
    {
      key: "siniflandir",
      title: "Giderleri sınıflandırın",
      detail: unclassifiedCount + candidates.length ? `${unclassifiedCount + candidates.length} kalem kaldı` : null,
      done: unclassifiedCount + candidates.length === 0,
      href: "/panel/vergi/gelir-gider#siniflandir",
    },
    {
      key: "demirbas",
      title: "Demirbaşlar",
      detail: [unlisted.length ? `${unlisted.length} fatura varlık listesinde değil` : "", missingLife ? `${missingLife} varlığın ömrü girilmedi` : ""].filter(Boolean).join(" · ") || null,
      done: unlisted.length === 0 && missingLife === 0,
      href: "/panel/vergi/demirbas",
    },
    {
      key: "muhasebeci",
      title: "Muhasebecinin rakamları",
      detail: muhasebeParts.join(", ") || null,
      done: muhasebeParts.length === 0,
      // Önce KDV beyannamesi satışları (Vergiye göre'nin kartı), sonra eksik ilk geçici vergi (o çeyreğin Vergiye göre'sinde
      // "… geçici vergi rakamını gir" düğmesi)
      href: missingMatrah.length
        ? `/panel/vergi/gelir-gider?ceyrek=${quarterOfMonth(missingMatrah[0])}#kdv-beyannamesi`
        : missingGecici.length
          ? `/panel/vergi/gelir-gider?ceyrek=${missingGecici[0]}`
          : "/panel/vergi/gelir-gider#kdv-beyannamesi",
    },
  ];
  const doneSteps = steps.filter((s) => s.done).length;

  // Kapsam, kartlar
  const scope = taxScope(selected.months, input.pnl);
  // Kartın çeyreği: geçici vergi günü bugün ya da sonra gelen ilk çeyrek (1 Ocak–17 Şubat'ta geçen yılın 4. çeyreği)
  const nextQuarter = nextDueQuarter(today, settings)?.key ?? null;
  const nqYear = nextQuarter ? years.get(Number(nextQuarter.slice(0, 4))) : null;
  const nqCalc = nqYear?.corp.find((c) => c.key === nextQuarter) ?? null;
  const nqPnl = nqYear?.quarters.find((x) => x.key === nextQuarter) ?? null;
  const gCard = nqCalc && nqPnl && nqYear ? geciciCard(nqCalc, nqPnl, input, scope, nqYear.corp, cal.hits.gecici.get(nqCalc.key)) : null;

  // Vergiye göre: seçilen çeyrek ve kümülatif
  let quarter: QuarterView | null = null;
  if (qp) {
    const idx = selected.quarters.indexOf(qp);
    const upto = selected.quarters.slice(0, idx + 1);
    const s = (f: (x: QuarterPnl) => number) => r2(upto.reduce((a, x) => a + f(x), 0));
    const qMonths = selected.months.filter((m) => qp.months.includes(m.month));
    const bridgeSum = new Map<string, BridgeRow>();
    for (const m of qMonths) for (const b of m.bridge) bridgeSum.set(b.key, { ...b, amount: r2((bridgeSum.get(b.key)?.amount ?? 0) + b.amount) });
    const stockDelta = qp.expense - r2(qMonths.reduce((a, m) => a + m.expense.total, 0));
    if (Math.abs(stockDelta) >= 0.005) {
      const end = bridgeSum.get("end");
      bridgeSum.delete("end");
      bridgeSum.set("stock", { key: "stock", label: "Çeyrek sonu stoğu (en son sayım)", amount: r2(stockDelta) });
      if (end) bridgeSum.set("end", { ...end, amount: r2(end.amount + stockDelta) });
    }
    quarter = {
      key: qp.key,
      label: quarterLabel(qp.key),
      options: selected.quarters.map((x) => x.key),
      months: qMonths,
      totals: qp,
      corp: selected.corp.find((c) => c.key === qp.key) ?? null,
      ytd: {
        income: s((x) => x.income),
        expense: s((x) => x.expense),
        result: s((x) => x.result),
        depreciation: s((x) => x.depreciation),
        direct: s((x) => x.direct),
        kkeg: s((x) => x.kkeg),
        indirim: s((x) => x.indirim),
        cumulative: selected.corp.find((c) => c.key === qp.key)?.cumulative ?? null,
      },
      bridge: [...bridgeSum.values()],
      depreciationMethod: `Amortisman: ${QUARTER_DEPRECIATION_LABELS[settings.quarterDepreciation].toLocaleLowerCase("tr-TR")}`,
      warnings: [...qp.warnings, ...qMonths.flatMap((m) => m.warnings)].filter((w, i, a) => a.indexOf(w) === i),
    };
  }

  const orphans = orphanAssets(input.pnl.assets, input.pnl.invoices, { notExpense: candidateInvoiceIds(input.pnl), periodStart: settings.periodStart });
  const warnings = [
    ...orphans.map((o) => `${o.asset.name}: Faturası Paraşüt'te iptal edildi: yeni faturaya bağlayın${o.doubleCounted ? ` (aday fatura şimdi gider sayılıyor: ${tl(o.doubleCounted)} iki kez sayılabilir)` : ""}`),
    ...cal.rows.flatMap((r) => r.notes.filter(isMismatchNote).map((n) => `${r.title}: ${n}`)),
  ];
  const checks = checkStatus(settings);
  const hasData = selected.months.some((m) => m.income.total !== 0 || m.expense.total !== 0) || input.pnl.invoices.some((i) => i.date >= settings.periodStart && i.category !== ASSET_CATEGORY);

  return {
    today,
    year,
    yearOptions: yearOptions(today, settings),
    hasData,
    rulesInfo: {
      disclaimer: TAX_DISCLAIMER,
      compiled: rulesCompiledText(rulesFor(year).fromYear),
      checkNote: RULES_CHECK_NOTE,
      verified: RULES_VERIFIED_AT,
      stale: rulesStaleNotes(today, [year]),
    },
    scope: { key: scope, text: SCOPE_TEXT[scope], hint: SCOPE_HINT, warning: scope === "beyanname" ? SCOPE_WARNING : null },
    checks: { ...checks, chip: checksChipText(checks) },
    stats: stats(cal.rows, today, { done: doneSteps, total: steps.length }),
    gettingStarted: { steps, done: doneSteps, total: steps.length },
    calendar: cal.rows,
    later: cal.later,
    geciciCard: gCard,
    kvCard: kvCard(selected, cal.hits.kv.get(String(selected.year))),
    years: [...years.values()],
    months: selected.months,
    quarters: selected.quarters,
    corp: selected.corp,
    kv: selected.kv,
    quarter,
    muhtasar: [...muhtasar.values()],
    classify,
    orphans,
    warnings,
    vat: input.vat,
    planFeed: planFeed(input, ctx),
  };
}
