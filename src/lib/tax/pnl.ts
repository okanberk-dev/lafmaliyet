/**
 * Vergiye göre gelir-gider (plan docs/planlar/vergi.md §3.2, K11–K15): KDV hariç, belgeye dayanan satırlar, ay ay ve
 * çeyrek çeyrek. Gelirin kaynağı mali belgedir: muhasebecinin KDV beyannamesi satış matrahı, yoksa yazarkasanın tam mali
 * Z'si, o da yoksa yönetim verisi (ModPOS cirosu) rozetiyle; yönetim verisi "vergi esasında gelir" diye adlandırılmaz ve
 * mali belgeyle farkı hiçbir yerde yazılmaz. Gider fatura tarihine göre; fatura dışı her kalem vergi belgesine göre
 * (sınıflandırılmamış kalem sayılmaz, listede durur); demirbaş ve demirbaş adayı gider değildir; bordro kural
 * tablosunun oranlarıyla (payroll.ts); POS komisyonu Gelir-gider'in hücresinden (K12a). Gelir-gider ekranıyla köprü
 * gider tarafını açar. Saf modül (Model yalnız tip); tests/vergi-gelir-gider.test.ts.
 */

import type { Model } from "../calc/engine";
import { daysInMonth, shiftMonth } from "../calc/engine";
import type { ExpenseCategory, ExpenseEntry, FixedExpense, FixedSection, Invoice } from "../calc/types";
import { COMMISSION_CATEGORY, FIXED_ESTIMATE_DESCRIPTION, GOODS_CATEGORIES, MANUAL_PNL_ROWS, SEPARATE_CATEGORIES } from "../constants";
import { tl } from "../format";
import { monthSource } from "../lafpos/switch";
import { monthEnd } from "../reminders";

import { allocatedByInvoice, ASSET_CATEGORY, assetCandidates, assetTotals, type TaxAsset } from "./assets";
import { monthName, periodQuarters, quarterLabel, quarterOfMonth } from "./calendar";
import { filingFor, filingValue, type TaxFiling } from "./corporate";
import { PAYROLL_FULL_MONTH_NOTE, type PayrollMonth, taxPayrollFromModel } from "./payroll";
import { estimateRound, r2, rulesFor, type TaxDoc, type Withholding } from "./rules";
import type { TaxSettings } from "./settings";

// ---------------------------------------------------------------- Düzeltmeler (tax_adjustments)

export type AdjustmentKind = "gelir_kafe_disi" | "gelir_diger" | "gider_kafe_disi" | "gider_belgeli" | "kkeg" | "indirim";

export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  gelir_kafe_disi: "Kafe dışı gelir",
  gelir_diger: "Diğer gelir (faiz, kur farkı…)",
  gider_kafe_disi: "Kafe dışı gider",
  gider_belgeli: "Belgeli gider (panelde yok)",
  kkeg: "İndirilemeyen gider (ceza, gecikme zammı…)",
  indirim: "İndirim ve istisna (bağış…; muhasebecinin söylediği tutar)",
};
/** Dönemi çeyrek olabilen (kafe dışı) türler */
export const QUARTER_SPAN_KINDS: readonly AdjustmentKind[] = ["gelir_kafe_disi", "gider_kafe_disi"];

export interface TaxAdjustment {
  id: number;
  /** YYYY-MM (çeyrekse çeyreğin son ayı) */
  month: string;
  span: "ay" | "ceyrek";
  kind: AdjustmentKind;
  /** KDV hariç, > 0 */
  amount: number;
  label: string;
  note?: string | null;
  createdByName?: string | null;
}

/** Listede dönemi: "Eylül 2026" ya da "2026/3" */
export function adjustmentPeriodLabel(a: Pick<TaxAdjustment, "month" | "span">): string {
  return a.span === "ceyrek" ? quarterLabel(quarterOfMonth(a.month)) : `${monthName(a.month)} ${a.month.slice(0, 4)}`;
}

// ---------------------------------------------------------------- Girdiler

export type RevenueSource = "beyanname" | "z" | "yonetim";

/**
 * Biten ve hiç hareketi olmayan ay: gelir de gider de 0 (hesap dönemi açılıştan önce başladıysa 25–30 Haziran gibi).
 * Ciro girilmemiş ama gideri olan ay boş değildir: veri eksiktir. Süren ay boş sayılmaz (veri henüz gelmemiş olabilir)
 */
export function emptyMonth(m: Pick<TaxMonth, "inProgress"> & { income: { total: number }; expense: { total: number } }): boolean {
  return !m.inProgress && Math.abs(m.income.total) < 0.005 && Math.abs(m.expense.total) < 0.005;
}

/**
 * Ayın geliri mali belgeye dayanıyor mu (K11, K31): beyanname ya da Z. Boş ay (`emptyMonth`) belge beklemez: girilecek
 * satış yok, Başlarken de sormaz
 */
export function revenueDocumented(m: Pick<TaxMonth, "revenueSource" | "inProgress"> & { income: { total: number }; expense: { total: number } }): boolean {
  return m.revenueSource !== "yonetim" || emptyMonth(m);
}

/** Yazarkasanın ayı (okc-z.ts okcMonth): oran oran KDV hariç matrah toplamı ve ayın her açık günü girildi mi */
export interface ZMonth {
  base: number;
  days: number;
  complete: boolean;
}

/** Ayın Gelir-gider'den gelen kısmı (taxPnlInputFromModel) */
export interface TaxPnlMonthBase {
  month: string;
  /** Kasa cirosu, KDV hariç; girilmediyse null */
  revenueNet: number | null;
  openDays: number;
  /** laffogato.net, KDV hariç; çekilmediyse null */
  site: number | null;
  /** İadesi bekleyen karaoke, KDV hariç (karaoke oranıyla) */
  siteRefundPending: number;
  /** Devir ve sayım (elle düzeltme dahil) */
  opening: number;
  closing: number;
  /** Gelir-gider'deki sabit gider hücreleri (aralık dışı elle girilenler ve silinmiş kalemler dahil) */
  fixedCells: readonly { id: number; value: number; overridden: boolean; outOfRange: boolean }[];
  /** Elle satırların değeri ("manual:su" …) */
  manualCells: Readonly<Record<string, number>>;
  /** Maaş ve personel SGK satırları (elle girildi mi) ve personel bölümünün toplamı */
  personnel: { net: number; employer: number; overridden: boolean; section: number };
  /** BANKA POS KOMİSYONU hücresi */
  pos: { amount: number; overridden: boolean };
  /** Ayın kasa raporu var (POS komisyonunda yemek kartı payı ayrılabildi) */
  hasKasa: boolean;
  /** Gelir-gider'in toplam gideri ve aylık harcama kategorilerine bağlı faturalar (köprü) */
  pnlExpenses: number;
  linkedInvoices: number;
}

export interface TaxPnlInput {
  settings: TaxSettings;
  today: string;
  months: ReadonlyMap<string, TaxPnlMonthBase>;
  invoices: readonly Invoice[];
  fixed: readonly FixedExpense[];
  expenseCategories: readonly ExpenseCategory[];
  expenseEntries: readonly ExpenseEntry[];
  /** Faturası Faturalar'a gelmiş kasadan çıkanlar (denetim B17: iki kez sayılmasın); kayıt "Paraşüt'te faturası var" */
  invoicedCashOuts?: ReadonlySet<number>;
  adjustments: readonly TaxAdjustment[];
  assets: readonly TaxAsset[];
  filings: readonly TaxFiling[];
  zMonths?: ReadonlyMap<string, ZMonth>;
  /** Sayılan aylar ve ay sonu stoğu (elle girilen devreden dahil) */
  counts: ReadonlyMap<string, number>;
  payroll: ReadonlyMap<string, PayrollMonth>;
  /** LafPOS'a geçiş günü (yönetim verisinin rozeti: ModPOS / LafPOS) */
  switchDay: string | null;
}

// ---------------------------------------------------------------- Çıktılar

export interface TaxRow {
  key: string;
  label: string;
  amount: number;
  /** Esas rozeti: "fatura tarihi", "mali belge · beyanname", "tahmini", "elle" … */
  badge?: string;
  note?: string;
  items?: { label: string; amount: number; note?: string }[];
}

/** Vergi hesabına girmeyen giderin nedeni: null sınıflandırılmamış */
export type ExcludeReason = null | "bordro" | "fatura" | "yok" | "aday" | "varlik" | "kafe_disi";
export type ExcludeSource = "fixed" | "manual" | "category" | "entry" | "invoice";

export interface ExcludedItem {
  /** "fixed:1" | "manual:su" | "category:3" | "entry:12" | "invoice:52" */
  key: string;
  source: ExcludeSource;
  id: number | null;
  name: string;
  section: FixedSection | "mal" | null;
  /** Sayılsaydı vergiye girecek tutar (KDV hariç; fişli ÷ 1,10 / 1,20) */
  amount: number;
  /** Gelir-gider'deki ya da faturadaki tutar */
  raw: number;
  reason: ExcludeReason;
  note?: string;
}

export interface BridgeRow {
  key: "start" | "prePeriod" | "excluded" | "receiptVat" | "payroll" | "pos" | "assets" | "invoices" | "adjustments" | "stock" | "end";
  label: string;
  amount: number;
}

export interface TaxMonth {
  month: string;
  /** Hesaba giren günler: ilk ayda hesap döneminin başından */
  from: string;
  to: string;
  inProgress: boolean;
  openDays: number;
  revenueSource: RevenueSource;
  income: { rows: TaxRow[]; total: number };
  expense: {
    rows: TaxRow[];
    total: number;
    opening: number;
    purchases: number;
    closing: number;
    smm: number;
    invoices: number;
    notAsset: number;
    personnel: number;
    personnelManual: boolean;
    belgeli: number;
    pos: number;
    separate: number;
    adjustments: number;
  };
  /** Gelir − gider (amortisman, indirilemeyen gider ve indirim çeyrekte eklenir) */
  result: number;
  excluded: ExcludedItem[];
  /** Alt sınırın ek gideri: sınıflandırılmamış kalemler belgeli, demirbaş adayları ve listede olmayan demirbaş gider (K13) */
  floorExtra: number;
  kkeg: number;
  indirim: number;
  /** Beyanname ayında kafe dışı kısım girildi mi (kapsam) */
  beyannameSplit: boolean | null;
  warnings: string[];
  bridge: BridgeRow[];
  /** Köprünün personel cümlesi (Gelir-gider'deki personel bölümü) */
  personnelNote: string | null;
}

// ---------------------------------------------------------------- Metinler

export const BADGE = {
  beyanname: "mali belge · beyanname",
  z: "mali belge · Z",
  site: "yaklaşık; e-Arşiv tarihinden farklı olabilir",
  invoice: "fatura tarihi",
  estimate: "tahmini",
  manual: "elle",
} as const;

/** Yönetim verisinin rozeti, dönemin kasasıyla (K11, denetim E-39) */
export function managementBadge(month: string, switchDay: string | null): string {
  return `Yönetim verisi (${kasaLabel(month, switchDay)}), mali belge değil`;
}

function kasaLabel(month: string, switchDay: string | null): string {
  const s = monthSource(month, switchDay);
  return s === "lafpos" ? "LafPOS" : s === "gecis" ? "ModPOS ve LafPOS" : "ModPOS";
}

export const EXCLUDE_REASON_TEXT: Record<Exclude<ExcludeReason, null>, string> & { none: string } = {
  none: "Seçilmedi",
  bordro: "Personel'e ekleyin",
  fatura: "Paraşüt'te faturası var",
  yok: "Belgesi yok",
  aday: "Demirbaş olabilir",
  varlik: "Varlık listesinde değil",
  kafe_disi: "Kafe dışı fatura",
};

export const ALP_KOC_NOTE = "Ortağın hesabına alınan fatura şirketin gideri olmayabilir; muhasebecinize sorun.";
export const BEYANNAME_ADJ_WARNING = "Bu ayın geliri beyannameden geliyor; kafe dışı satış zaten içinde.";
const SEPARATE_NOTE = "Kafe dışı geliri de girin; yalnız gider girmek vergiyi düşük gösterir.";

// ---------------------------------------------------------------- Modelden girdiler

export interface TaxPnlExtras {
  settings: TaxSettings;
  today: string;
  adjustments: readonly TaxAdjustment[];
  assets: readonly TaxAsset[];
  filings: readonly TaxFiling[];
  zMonths?: ReadonlyMap<string, ZMonth>;
  invoicedCashOuts?: ReadonlySet<number>;
  /** Yoksa yılların bordrosu buradan hesaplanır */
  payroll?: ReadonlyMap<string, PayrollMonth>;
}

/** Hesap döneminin ilk ayından bugünün ayına kadar Gelir-gider'in ayları ve modelin listeleri */
export function taxPnlInputFromModel(
  model: Pick<
    Model,
    "settings" | "ds" | "pnlMonth" | "siteSales" | "countedMonths" | "closingStock" | "monthInfo" | "expenseAmounts" | "expenseCategories" | "staffAtMonth"
  >,
  extras: TaxPnlExtras,
): TaxPnlInput {
  const st = model.settings;
  const first = extras.settings.periodStart.slice(0, 7);
  const last = extras.today.slice(0, 7);
  const months = new Map<string, TaxPnlMonthBase>();
  const counts = new Map<string, number>();
  for (const m of model.countedMonths) counts.set(m, model.closingStock(m).value);
  for (let m = first; m <= last; m = shiftMonth(m, 1)) {
    const pm = model.pnlMonth(m);
    const value = (key: string) => (pm.cells.get(key)?.value as number | null | undefined) ?? 0;
    const fixedCells: TaxPnlMonthBase["fixedCells"][number][] = [];
    for (const [key, c] of pm.cells) {
      if (!key.startsWith("fixed:")) continue;
      fixedCells.push({ id: Number(key.slice(6)), value: c.value ?? 0, overridden: c.overridden, outOfRange: Boolean(c.outOfRange) });
    }
    const manualCells: Record<string, number> = {};
    for (const r of MANUAL_PNL_ROWS) manualCells[r.key] = value(r.key);
    const pending = model.siteSales(m)?.karaoke.refundPendingMinor ?? 0;
    if (pm.cells.get("stock:closing")?.overridden) counts.set(m, pm.closing);
    months.set(m, {
      month: m,
      revenueNet: pm.revenueNet,
      openDays: pm.openDays,
      site: pm.site ? pm.site.total : null,
      siteRefundPending: r2(pending / 100 / (1 + st.kdvHizmet)),
      opening: pm.opening,
      closing: pm.closing,
      fixedCells,
      manualCells,
      personnel: {
        net: value("personnel:net"),
        employer: value("personnel:employer"),
        overridden: Boolean(pm.cells.get("personnel:net")?.overridden || pm.cells.get("personnel:employer")?.overridden),
        section: pm.sections.personel,
      },
      pos: { amount: value("commission:pos"), overridden: Boolean(pm.cells.get("commission:pos")?.overridden) },
      hasKasa: Boolean(model.monthInfo.get(m)?.kasa),
      pnlExpenses: pm.expenses,
      linkedInvoices: r2(model.expenseAmounts(m).reduce((s, x) => s + x.invoices, 0)),
    });
  }
  let payroll = extras.payroll;
  if (!payroll) {
    const all = new Map<string, PayrollMonth>();
    for (let y = Number(first.slice(0, 4)); y <= Number(last.slice(0, 4)) + 1; y++) for (const [k, v] of taxPayrollFromModel(model, y, extras.settings)) all.set(k, v);
    payroll = all;
  }
  return {
    settings: extras.settings,
    today: extras.today,
    months,
    invoices: model.ds.invoices,
    fixed: model.ds.fixedExpenses,
    expenseCategories: model.expenseCategories,
    expenseEntries: model.ds.expenseEntries ?? [],
    invoicedCashOuts: extras.invoicedCashOuts,
    adjustments: extras.adjustments,
    assets: extras.assets,
    filings: extras.filings,
    zMonths: extras.zMonths,
    counts,
    payroll,
    switchDay: st.lafposGecisGunu ?? null,
  };
}

// ---------------------------------------------------------------- Ay hesabı

const net = (i: Pick<Invoice, "amount" | "discount">) => r2(i.amount - i.discount);
const sumOf = (xs: readonly number[]) => r2(xs.reduce((a, b) => a + b, 0));
const RECEIPT_VAT = { mal: 1.1, other: 1.2 } as const;

/** Harcama kaydının vergideki sonucu (§3.2 Aylık harcamalar) */
function entryOutcome(e: ExpenseEntry, cat: ExpenseCategory, invoiced: ReadonlySet<number> | undefined): { counted: boolean; reason: ExcludeReason; via: "kasa" | "cari" | "kategori" } {
  if (e.cashOutId != null && e.docType) {
    if (invoiced?.has(e.cashOutId)) return { counted: false, reason: "fatura", via: "kasa" };
    return e.docType === "yok" ? { counted: false, reason: "yok", via: "kasa" } : { counted: true, reason: null, via: "kasa" };
  }
  if (e.supplierEntryId != null) return { counted: false, reason: "yok", via: "cari" };
  const doc = cat.taxDoc ?? null;
  return doc === "belgeli" ? { counted: true, reason: null, via: "kategori" } : { counted: false, reason: doc, via: "kategori" };
}

/** Harcamanın KDV hariç tahmini: fiş tutarı ÷ 1,10 (mal) ya da ÷ 1,20; sabit giderden çevrilen tahmini kayıt zaten KDV hariç */
function entryNet(e: ExpenseEntry, section: FixedSection | "mal"): number {
  if (e.description === FIXED_ESTIMATE_DESCRIPTION) return e.amount;
  return r2(e.amount / (section === "mal" ? RECEIPT_VAT.mal : RECEIPT_VAT.other));
}

interface Ctx {
  input: TaxPnlInput;
  candidates: Set<number>;
  linkedCost: Map<number, number>;
  fixedById: Map<number, FixedExpense>;
  catById: Map<number, ExpenseCategory>;
}

/** "Demirbaş olabilir" faturaların kimlikleri, her biri kendi yılının sınırıyla: karar verilene kadar gider sayılmaz */
export function candidateInvoiceIds(input: Pick<TaxPnlInput, "invoices" | "assets" | "settings">): Set<number> {
  const candidates = new Set<number>();
  const years = new Set(input.invoices.map((i) => Number(i.date.slice(0, 4))));
  for (const y of years) {
    const { rules } = rulesFor(y, input.settings.overrides);
    for (const c of assetCandidates(input.invoices, input.assets, rules)) if (c.invoice.date.startsWith(`${y}-`)) candidates.add(c.invoice.id);
  }
  return candidates;
}

function makeCtx(input: TaxPnlInput): Ctx {
  return {
    input,
    candidates: candidateInvoiceIds(input),
    linkedCost: allocatedByInvoice(input.assets),
    fixedById: new Map(input.fixed.map((f) => [f.id, f])),
    catById: new Map(input.expenseCategories.map((c) => [c.id, c])),
  };
}

const EMPTY_BASE = (month: string): TaxPnlMonthBase => ({
  month,
  revenueNet: null,
  openDays: 0,
  site: null,
  siteRefundPending: 0,
  opening: 0,
  closing: 0,
  fixedCells: [],
  manualCells: {},
  personnel: { net: 0, employer: 0, overridden: false, section: 0 },
  pos: { amount: 0, overridden: false },
  hasKasa: false,
  pnlExpenses: 0,
  linkedInvoices: 0,
});

function monthCalc(ctx: Ctx, month: string): TaxMonth {
  const { input } = ctx;
  const { settings, today } = input;
  const base = input.months.get(month) ?? EMPTY_BASE(month);
  const firstMonth = settings.periodStart.slice(0, 7);
  const from = month === firstMonth ? settings.periodStart : `${month}-01`;
  const to = monthEnd(`${month}-01`);
  const inProgress = month === today.slice(0, 7);
  const name = monthName(month);
  const warnings: string[] = [];
  const excluded: ExcludedItem[] = [];
  const adj = input.adjustments.filter((a) => a.month === month);
  const adjSum = (k: TaxAdjustment["kind"]) => sumOf(adj.filter((a) => a.kind === k).map((a) => a.amount));
  const adjItems = (k: TaxAdjustment["kind"]) => adj.filter((a) => a.kind === k).map((a) => ({ label: a.label, amount: a.amount, note: a.span === "ceyrek" ? adjustmentPeriodLabel(a) : undefined }));

  // ---- Gelir (K11)
  const income: TaxRow[] = [];
  const filing = filingFor(input.filings, "kdv_matrah", month);
  const z = input.zMonths?.get(month);
  const source: RevenueSource = filing ? "beyanname" : z?.complete ? "z" : "yonetim";
  let beyannameSplit: boolean | null = null;
  if (filing) {
    const m1 = filingValue(filing, "m1") ?? 0;
    const m10 = filingValue(filing, "m10") ?? 0;
    const m20 = filingValue(filing, "m20") ?? 0;
    const istisna = filingValue(filing, "istisna") ?? 0;
    const items = [
      { label: "%1 matrah", amount: m1 },
      { label: "%10 matrah", amount: m10 },
      { label: "%20 matrah", amount: m20 },
      { label: "İstisna ve diğer", amount: istisna },
    ].filter((x) => x.amount !== 0);
    income.push({ key: "kdv_matrah", label: "KDV beyannamesindeki satışlar (şirketin tamamı)", amount: r2(m1 + m10 + m20 + istisna), badge: BADGE.beyanname, items });
    const kafeDisi = filingValue(filing, "kafeDisi");
    beyannameSplit = kafeDisi !== undefined;
    if (kafeDisi) income.push({ key: "kafe_disi_payi", label: "Kafe dışı kısmı (muhasebecinin söylediği)", amount: -kafeDisi, badge: BADGE.manual });
    if (adj.some((a) => a.kind === "gelir_kafe_disi")) warnings.push(BEYANNAME_ADJ_WARNING);
  } else {
    if (source === "z") income.push({ key: "z", label: "Yazarkasa Z raporları", amount: r2(z!.base), badge: BADGE.z, note: `${z!.days} gün` });
    else {
      const days = base.revenueNet !== null && base.openDays > 0 && base.openDays < daysInMonth(month) ? `${base.openDays} gün` : undefined;
      income.push({
        key: "pos",
        label: `Kasa satışları (${kasaLabel(month, input.switchDay)})`,
        amount: r2(base.revenueNet ?? 0),
        badge: managementBadge(month, input.switchDay),
        note: base.revenueNet === null ? "ciro girilmedi" : days,
      });
    }
    if (base.site !== null) {
      const pending = base.siteRefundPending;
      income.push({
        key: "site",
        label: "laffogato.net",
        amount: r2(base.site - pending),
        badge: BADGE.site,
        note: pending > 0 ? `İadesi bekleyen karaoke düşüldü (${tl(pending, 2)}, KDV hariç)` : undefined,
      });
    }
    const kafeDisiGelir = adjSum("gelir_kafe_disi");
    if (kafeDisiGelir) income.push({ key: "gelir_kafe_disi", label: ADJUSTMENT_LABELS.gelir_kafe_disi, amount: kafeDisiGelir, badge: BADGE.manual, items: adjItems("gelir_kafe_disi") });
  }
  const digerGelir = adjSum("gelir_diger");
  if (digerGelir) income.push({ key: "gelir_diger", label: ADJUSTMENT_LABELS.gelir_diger, amount: digerGelir, badge: BADGE.manual, items: adjItems("gelir_diger") });
  const incomeTotal = sumOf(income.map((r) => r.amount));

  // ---- Faturalar (fatura tarihi; hesap döneminin başından)
  const invs = input.invoices.filter((i) => i.date.slice(0, 7) === month);
  let goods = 0;
  let goodsAll = 0;
  let notAsset = 0;
  let separate = 0;
  let commissionInv = 0;
  let prePeriod = 0;
  const byCategory = new Map<string, number>();
  const separateItems: { label: string; amount: number; note?: string }[] = [];
  for (const inv of invs) {
    const n = net(inv);
    if (inv.date < from) {
      if (GOODS_CATEGORIES.includes(inv.category) || inv.category === COMMISSION_CATEGORY) prePeriod = r2(prePeriod + n);
      continue;
    }
    const a = ctx.linkedCost.get(inv.id) ?? 0;
    const rem = a > 0 ? Math.max(0, r2(n - a)) : n;
    if (SEPARATE_CATEGORIES.includes(inv.category)) {
      const note = inv.category === "Alp Koç" ? ALP_KOC_NOTE : undefined;
      if (settings.includeSeparate) {
        separate = r2(separate + n);
        separateItems.push({ label: `${inv.supplier} · ${inv.category}`, amount: n, note });
      } else excluded.push({ key: `invoice:${inv.id}`, source: "invoice", id: inv.id, name: inv.supplier, section: null, amount: n, raw: n, reason: "kafe_disi", note });
    } else if (GOODS_CATEGORIES.includes(inv.category)) {
      goods = r2(goods + rem);
      goodsAll = r2(goodsAll + n);
    } else if (inv.category === ASSET_CATEGORY) {
      if (rem > 0.005) excluded.push({ key: `invoice:${inv.id}`, source: "invoice", id: inv.id, name: inv.supplier, section: null, amount: rem, raw: n, reason: "varlik" });
    } else if (ctx.candidates.has(inv.id)) {
      excluded.push({ key: `invoice:${inv.id}`, source: "invoice", id: inv.id, name: inv.supplier, section: null, amount: n, raw: n, reason: "aday" });
    } else {
      if (inv.category === COMMISSION_CATEGORY) commissionInv = r2(commissionInv + n);
      if (inv.taxNotAsset) notAsset = r2(notAsset + rem);
      else byCategory.set(inv.category, r2((byCategory.get(inv.category) ?? 0) + rem));
    }
  }
  const invoicesTotal = sumOf([...byCategory.values()]);

  // ---- Aylık harcamalar (kayıt kayıt)
  let goodsEntries = 0;
  let entriesRawAll = 0;
  let entriesNotCountedRaw = 0;
  let entriesCountedRaw = 0;
  let entriesCountedNet = 0;
  const belgeliItems: { label: string; amount: number; note?: string }[] = [];
  const byCatExcluded = new Map<number, ExcludedItem>();
  for (const e of input.expenseEntries) {
    if (e.date.slice(0, 7) !== month) continue;
    const cat = ctx.catById.get(e.categoryId);
    if (!cat) continue;
    entriesRawAll = r2(entriesRawAll + e.amount);
    if (e.date < from) {
      prePeriod = r2(prePeriod + e.amount);
      continue;
    }
    const out = entryOutcome(e, cat, input.invoicedCashOuts);
    const amount = entryNet(e, cat.section);
    if (out.counted) {
      entriesCountedRaw = r2(entriesCountedRaw + e.amount);
      entriesCountedNet = r2(entriesCountedNet + amount);
      if (cat.section === "mal") goodsEntries = r2(goodsEntries + amount);
      else belgeliItems.push({ label: cat.name, amount, note: e.description === FIXED_ESTIMATE_DESCRIPTION ? "tahmini (sabit giderden)" : undefined });
      continue;
    }
    entriesNotCountedRaw = r2(entriesNotCountedRaw + e.amount);
    if (out.via === "kategori") {
      const prev = byCatExcluded.get(cat.id);
      if (prev) {
        prev.amount = r2(prev.amount + amount);
        prev.raw = r2(prev.raw + e.amount);
      } else byCatExcluded.set(cat.id, { key: `category:${cat.id}`, source: "category", id: cat.id, name: cat.name, section: cat.section, amount, raw: e.amount, reason: out.reason });
    } else {
      excluded.push({
        key: `entry:${e.id}`,
        source: "entry",
        id: e.id,
        name: cat.name,
        section: cat.section,
        amount,
        raw: e.amount,
        reason: out.reason,
        note: out.reason === "fatura" ? "Paraşüt'te faturası var: burada sayılmaz" : out.via === "cari" ? "Cari hesapta faturasız borç" : "Kasadan çıkan, belgesi yok",
      });
    }
  }
  excluded.push(...byCatExcluded.values());

  // ---- Sabit giderler (Gelir-gider hücresi, elle düzeltme dahil)
  let fixedBelgeli = 0;
  let fixedNotCounted = 0;
  for (const c of base.fixedCells) {
    if (!c.value) continue;
    const fe = ctx.fixedById.get(c.id);
    const doc: TaxDoc | null = fe?.taxDoc ?? null;
    if (doc === "belgeli") {
      fixedBelgeli = r2(fixedBelgeli + c.value);
      belgeliItems.push({ label: fe!.name, amount: c.value });
    } else {
      fixedNotCounted = r2(fixedNotCounted + c.value);
      excluded.push({
        key: `fixed:${c.id}`,
        source: "fixed",
        id: c.id,
        name: fe?.name ?? "Silinmiş kalem",
        section: fe?.section ?? "genel",
        amount: c.value,
        raw: c.value,
        reason: doc as ExcludeReason,
        note: fe ? undefined : "silinmiş kalem",
      });
    }
  }

  // ---- Gelir-gider'in elle satırları
  let goodsManual = 0;
  let manualBelgeli = 0;
  let manualNotCountedRaw = 0;
  let manualReceiptVat = 0;
  for (const row of MANUAL_PNL_ROWS) {
    const raw = base.manualCells[row.key] ?? 0;
    if (!raw) continue;
    const doc = settings.manualRows[row.key] ?? null;
    const amount = row.section === "mal" ? r2(raw / RECEIPT_VAT.mal) : raw;
    if (doc === "belgeli") {
      if (row.section === "mal") {
        goodsManual = r2(goodsManual + amount);
        manualReceiptVat = r2(manualReceiptVat + raw - amount);
      } else {
        manualBelgeli = r2(manualBelgeli + amount);
        belgeliItems.push({ label: row.label, amount });
      }
    } else {
      manualNotCountedRaw = r2(manualNotCountedRaw + raw);
      excluded.push({ key: row.key, source: "manual", id: null, name: row.label, section: row.section, amount, raw, reason: doc as ExcludeReason });
    }
  }

  // ---- Personel (bordro, yasal oranlarla; Gelir-gider'de elle girildiyse o)
  const payroll = input.payroll.get(month);
  const personnelManual = base.personnel.overridden;
  const personnel = personnelManual ? r2(base.personnel.net + base.personnel.employer) : (payroll?.totals.cost ?? 0);
  if (!personnelManual && payroll && payroll.totals.people > 0) warnings.push(PAYROLL_FULL_MONTH_NOTE);

  // ---- POS komisyonu (K12a: Gelir-gider'in hücresi)
  const pos = r2(base.pos.amount);

  const smmPurchases = r2(goods + goodsEntries + goodsManual);
  const smm = r2(base.opening + smmPurchases - base.closing);
  const belgeli = r2(fixedBelgeli + manualBelgeli + entriesCountedNet - goodsEntries);
  const kafeDisiGider = adjSum("gider_kafe_disi");
  const belgeliAdj = adjSum("gider_belgeli");
  const adjustments = r2(kafeDisiGider + belgeliAdj);

  const expense: TaxRow[] = [];
  expense.push({
    key: "smm",
    label: "Satılan malın maliyeti",
    amount: smm,
    badge: BADGE.invoice,
    items: [
      { label: "Önceki aydan devir", amount: base.opening },
      { label: "Mal faturaları", amount: goods },
      ...(goodsEntries ? [{ label: "Belgeli mal harcamaları (KDV hariç tahmin)", amount: goodsEntries }] : []),
      ...(goodsManual ? [{ label: "Market / nakit alımlar (KDV hariç tahmin)", amount: goodsManual }] : []),
      { label: "Sonraki aya devreden", amount: -base.closing },
    ],
  });
  expense.push({
    key: "invoices",
    label: "Faturalar",
    amount: invoicesTotal,
    badge: BADGE.invoice,
    items: [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0], "tr")).map(([label, amount]) => ({ label, amount })),
  });
  if (notAsset) expense.push({ key: "notAsset", label: "Demirbaş olabilir: gider (demirbaş değil)", amount: notAsset, badge: BADGE.invoice });
  expense.push({
    key: "personnel",
    label: "Personel (bordro)",
    amount: personnel,
    badge: personnelManual ? BADGE.manual : BADGE.estimate,
    note: personnelManual ? "Gelir-gider'de elle girilen bordro (net maaşlar ve personel SGK satırı)" : undefined,
  });
  expense.push({ key: "belgeli", label: "Belgesi muhasebecide olan giderler", amount: belgeli, badge: BADGE.estimate, items: belgeliItems });
  expense.push({
    key: "pos",
    label: "POS komisyonu",
    amount: pos,
    badge: base.pos.overridden ? BADGE.manual : BADGE.estimate,
    note: base.pos.overridden ? "Gelir-gider'de elle girilen" : `Banka dekontundaki tutarı Gelir-gider'e yazabilirsiniz${base.hasKasa ? "" : "; yemek kartı payı ayrılamadı"}`,
  });
  if (kafeDisiGider || separate)
    expense.push({
      key: "kafe_disi",
      label: "Kafe dışı gider",
      amount: r2(kafeDisiGider + separate),
      badge: separate ? BADGE.invoice : BADGE.manual,
      items: [...adjItems("gider_kafe_disi"), ...separateItems],
      note: separate ? SEPARATE_NOTE : undefined,
    });
  if (belgeliAdj) expense.push({ key: "gider_belgeli", label: ADJUSTMENT_LABELS.gider_belgeli, amount: belgeliAdj, badge: BADGE.manual, items: adjItems("gider_belgeli") });
  const expenseTotal = sumOf(expense.map((r) => r.amount));
  const result = r2(incomeTotal - expenseTotal);
  const floorExtra = sumOf(excluded.filter((x) => x.reason === null || x.reason === "aday" || x.reason === "varlik").map((x) => x.amount));

  if (inProgress) {
    warnings.unshift(`${name} bitmedi: bugüne kadar`);
    if (source === "yonetim" && base.revenueNet !== null && base.openDays < daysInMonth(month)) warnings.push(`${name} cirosu ${base.openDays} günlük`);
  }

  // ---- Köprü (gider tarafı): Gelir-gider'deki gider → vergiye göre gider
  const goodsAlloc = r2(goodsAll - goods);
  const persCells = r2(base.personnel.net + base.personnel.employer);
  const bridgeParts: BridgeRow[] = [
    { key: "prePeriod", label: "Hesap döneminin başından önceki faturalar ve harcamalar", amount: -prePeriod },
    { key: "excluded", label: "Sayılmayan giderler", amount: -r2(fixedNotCounted + manualNotCountedRaw + entriesNotCountedRaw) },
    { key: "receiptVat", label: "Fişli tutarların KDV'si (tahmini)", amount: -r2(entriesCountedRaw - entriesCountedNet + manualReceiptVat) },
    { key: "assets", label: "Demirbaş (gider yerine amortisman)", amount: -goodsAlloc },
    { key: "payroll", label: "Bordro farkı", amount: r2(personnel - persCells) },
    { key: "pos", label: "POS komisyonu farkı", amount: r2(pos - base.pos.amount) },
    { key: "invoices", label: "Gelir-gider'e girmeyen faturalar", amount: r2(invoicesTotal + notAsset - commissionInv - base.linkedInvoices) },
    { key: "adjustments", label: "Düzeltmeler", amount: r2(adjustments + separate) },
  ];
  // Kuruş yuvarlaması: satırlar ayrı ayrı yuvarlandığı için toplamları sonla 1–2 kuruş ayrışabilir; fark en büyük satıra
  // eklenir, kartta satırlar iki ucu birebir tutar (ayrışma yuvarlamadan büyükse olduğu gibi kalır, testler yakalar)
  const bridgeStart = r2(base.pnlExpenses);
  const residual = r2(expenseTotal - bridgeStart - sumOf(bridgeParts.map((r) => r.amount)));
  if (residual !== 0 && Math.abs(residual) <= 0.05) {
    const big = bridgeParts.reduce((a, r) => (Math.abs(r.amount) > Math.abs(a.amount) ? r : a), bridgeParts[0]);
    big.amount = r2(big.amount + residual);
  }
  const bridge: BridgeRow[] = [
    { key: "start", label: "Gelir-gider'deki gider", amount: bridgeStart },
    ...bridgeParts.filter((r) => Math.abs(r.amount) >= 0.005),
    { key: "end", label: "Vergiye göre gider", amount: expenseTotal },
  ];
  const others = r2(base.personnel.section - persCells);
  const personnelNote =
    base.personnel.section > 0.005
      ? `Gelir-gider'deki personel ${tl(base.personnel.section)}: maaşlar ≈ ${tl(estimateRound(persCells))}${others > 0.5 ? ` ve personel bölümündeki sabit giderler ≈ ${tl(estimateRound(others))}` : ""}; vergide maaşlar bordroyla, diğerleri belgesine göre sayılır.`
      : null;

  return {
    month,
    from,
    to,
    inProgress,
    openDays: base.openDays,
    revenueSource: source,
    income: { rows: income, total: incomeTotal },
    expense: {
      rows: expense,
      total: expenseTotal,
      opening: base.opening,
      purchases: smmPurchases,
      closing: base.closing,
      smm,
      invoices: invoicesTotal,
      notAsset,
      personnel,
      personnelManual,
      belgeli,
      pos,
      separate,
      adjustments,
    },
    result,
    excluded,
    floorExtra,
    kkeg: adjSum("kkeg"),
    indirim: adjSum("indirim"),
    beyannameSplit,
    warnings,
    bridge,
    personnelNote,
  };
}

/** Yılın ayları: hesap döneminin ilk ayından (ya da yılbaşından) bugünün ayına (süren ay tamamlanmaz) */
export function taxMonths(input: TaxPnlInput, year: number, today: string = input.today): TaxMonth[] {
  const ctx = makeCtx({ ...input, today });
  const firstMonth = input.settings.periodStart.slice(0, 7);
  const start = `${year}-01` > firstMonth ? `${year}-01` : firstMonth;
  const end = `${year}-12` < today.slice(0, 7) ? `${year}-12` : today.slice(0, 7);
  const out: TaxMonth[] = [];
  for (let m = start; m <= end; m = shiftMonth(m, 1)) out.push(monthCalc(ctx, m));
  return out;
}

/** Ayın köprüsü (§3.2): Gelir-gider'deki giderden vergiye göre gidere; gelir için yalnız kaynak */
export function bridge(month: TaxMonth): { rows: BridgeRow[]; income: string; personnel: string | null } {
  const income = month.revenueSource === "beyanname" ? "Gelir: KDV beyannamesi" : month.revenueSource === "z" ? "Gelir: yazarkasa Z raporları" : "Gelir: Gelir-gider'deki kasa cirosu, yönetim verisi";
  return { rows: month.bridge, income, personnel: month.personnelNote };
}

// ---------------------------------------------------------------- Çeyrek

export interface QuarterPnl {
  key: string;
  q: number;
  /** Hesap dönemiyle kesişen aralık */
  from: string;
  to: string;
  months: string[];
  /** Çeyreğin son günü bugünden önce */
  complete: boolean;
  income: number;
  expense: number;
  /** Ayların sonucu + çeyrek sonu stoğu düzeltmesi (K15) */
  result: number;
  stock: { closingMonth: string | null; counted: boolean; closingUsed: number; usedFrom: string | null; adjust: number; warning: string | null };
  depreciation: number;
  direct: number;
  kkeg: number;
  indirim: number;
  /** Alt sınırla sonuç (K13): sınıflandırılmamışlar belgeli, adaylar ve listede olmayan demirbaş gider, ömrü girilmemiş varlık gider */
  floorResult: number;
  unclassified: { total: number; count: number };
  candidates: { total: number; count: number };
  unlisted: { total: number; count: number };
  noDoc: { total: number; count: number };
  missingLifeCost: number;
  sources: RevenueSource[];
  state: "taslak" | "hazir";
  stateReasons: string[];
  warnings: string[];
}

const COUNT_MONTH_END = (month: string) => `${Number(monthEnd(`${month}-01`).slice(8))} ${monthName(month)}`;

/**
 * Çeyrek sonu stoğu (K15): çeyreğin son (hesaba giren) ayında sayım yoksa en son ay sonu sayımı devreden sayılır; o da
 * yoksa 0. Ayların toplamına `adjust` (Gelir-gider'deki devreden − kullanılan) gider olarak eklenir; önceki çeyreğinki
 * geri alınır (kümülatif hesap tutarlı kalsın).
 */
function quarterStock(input: TaxPnlInput, key: string, today: string): QuarterPnl["stock"] {
  const p = periodQuarters(Number(key.slice(0, 4)), input.settings).find((x) => x.key === key);
  const lastMonth = p ? ([p.to.slice(0, 7), today.slice(0, 7)].sort()[0] as string) : null;
  if (!p || !lastMonth || lastMonth < p.from.slice(0, 7)) return { closingMonth: null, counted: true, closingUsed: 0, usedFrom: null, adjust: 0, warning: null };
  const pnlClosing = input.months.get(lastMonth)?.closing ?? 0;
  if (input.counts.has(lastMonth)) return { closingMonth: lastMonth, counted: true, closingUsed: pnlClosing, usedFrom: lastMonth, adjust: 0, warning: null };
  const prev = [...input.counts.keys()].filter((m) => m < lastMonth).sort().at(-1) ?? null;
  const closingUsed = prev ? (input.counts.get(prev) ?? 0) : 0;
  const quarterEnd = lastMonth === p.to.slice(0, 7) && p.to < today;
  const warning = quarterEnd
    ? prev
      ? `${COUNT_MONTH_END(lastMonth)} sayımı yok: ${COUNT_MONTH_END(prev)} sayımı kullanıldı; vergi için çeyrek sonu sayımı gerekir`
      : `${COUNT_MONTH_END(lastMonth)} sayımı yok: stok 0 sayıldı, alışın tamamı gider; vergi için çeyrek sonu sayımı gerekir`
    : null;
  return { closingMonth: lastMonth, counted: false, closingUsed, usedFrom: prev, adjust: r2(pnlClosing - closingUsed), warning };
}

/** Önceki çeyreğin anahtarı */
const prevQuarter = (key: string) => {
  const y = Number(key.slice(0, 4));
  const q = Number(key.slice(-1));
  return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`;
};

/** Yılın hesap dönemindeki çeyrekleri, aylarından (taxMonths) */
export function taxQuarters(input: TaxPnlInput, months: readonly TaxMonth[], year: number, today: string = input.today): QuarterPnl[] {
  const assets = assetTotals(input.assets, year, input.settings);
  const out: QuarterPnl[] = [];
  for (const p of periodQuarters(year, input.settings)) {
    const ms = months.filter((m) => quarterOfMonth(m.month) === p.key);
    const stock = quarterStock(input, p.key, today);
    const prevKey = prevQuarter(p.key);
    const prevInPeriod = periodQuarters(Number(prevKey.slice(0, 4)), input.settings).some((x) => x.key === prevKey);
    const prevAdjust = prevInPeriod ? quarterStock(input, prevKey, today).adjust : 0;
    const sum = (f: (m: TaxMonth) => number) => sumOf(ms.map(f));
    const excludedOf = (pred: (x: ExcludedItem) => boolean) => {
      const items = ms.flatMap((m) => m.excluded.filter(pred));
      return { total: sumOf(items.map((x) => x.amount)), count: new Set(items.map((x) => x.key)).size };
    };
    const unclassifiedQ = excludedOf((x) => x.reason === null);
    const candidatesQ = excludedOf((x) => x.reason === "aday");
    const unlistedQ = excludedOf((x) => x.reason === "varlik");
    const noDocQ = excludedOf((x) => x.reason === "yok");
    const result = r2(sum((m) => m.result) - stock.adjust + prevAdjust);
    const missingLifeCost = assets.missingLife.cost.get(p.key) ?? 0;
    const sources = [...new Set(ms.map((m) => m.revenueSource))];
    const reasons: string[] = [];
    if (unclassifiedQ.total !== 0) reasons.push("Sınıflandırılmamış gider var");
    if (candidatesQ.count) reasons.push("Demirbaş olabilir faturası var");
    const missingLife = input.assets.some((a) => a.method === "amortisman" && !a.lifeYears && a.acquiredOn <= p.to);
    if (missingLife) reasons.push("Faydalı ömrü girilmemiş varlık var");
    if (!ms.length || !ms.every(revenueDocumented)) reasons.push("Gelir mali belgeden girilmedi");
    if (!input.settings.checks.kafe_disi) reasons.push("Kafe dışı işler muhasebeciyle konuşulmadı");
    out.push({
      key: p.key,
      q: p.q,
      from: p.from,
      to: p.to,
      months: ms.map((m) => m.month),
      complete: p.to < today,
      income: sum((m) => m.income.total),
      expense: r2(sum((m) => m.expense.total) + stock.adjust - prevAdjust),
      result,
      stock,
      depreciation: assets.depreciation.get(p.key) ?? 0,
      direct: assets.direct.get(p.key) ?? 0,
      kkeg: sum((m) => m.kkeg),
      indirim: sum((m) => m.indirim),
      floorResult: r2(result - sum((m) => m.floorExtra) - missingLifeCost),
      unclassified: unclassifiedQ,
      candidates: candidatesQ,
      unlisted: unlistedQ,
      noDoc: noDocQ,
      missingLifeCost,
      sources,
      state: reasons.length ? "taslak" : "hazir",
      stateReasons: reasons,
      warnings: stock.warning ? [stock.warning] : [],
    });
  }
  return out;
}

// ---------------------------------------------------------------- Sınıflandırma listesi

export interface ClassifyTarget {
  /** "fixed:1" | "manual:su" | "category:3" */
  key: string;
  source: "fixed" | "manual" | "category";
  id: number | null;
  name: string;
  section: FixedSection | "mal";
  doc: TaxDoc | null;
  withholding: Withholding | null;
  vatRate: number | null;
  /** Yılın Gelir-gider tutarı (kategoride girilen harcamalar) */
  total: number;
  /** "Part-time" adlı personel kalemi: bordroya eklenmeli notu */
  partTime: boolean;
}

/**
 * Sınıflandırılacak kalemler (Vergiye göre › Vergi hesabına girmeyen giderler, Başlarken): yılda hesaba giren ya da
 * elle tutarı olan sabit giderler, Gelir-gider'in elle satırları ve aylık harcama kategorileri (etkin olanlar ve
 * kaydı olan pasifler)
 */
export function classificationTargets(input: TaxPnlInput, months: readonly TaxMonth[]): ClassifyTarget[] {
  const ms = new Set(months.map((m) => m.month));
  const bases = [...input.months.values()].filter((b) => ms.has(b.month));
  const fixedTotal = new Map<number, number>();
  for (const b of bases) for (const c of b.fixedCells) fixedTotal.set(c.id, r2((fixedTotal.get(c.id) ?? 0) + c.value));
  const inRangeSome = (f: FixedExpense) => months.some((m) => (!f.startMonth || f.startMonth <= m.month) && (!f.endMonth || f.endMonth >= m.month));
  const out: ClassifyTarget[] = [];
  for (const f of [...input.fixed].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)) {
    if (!inRangeSome(f) && !fixedTotal.get(f.id)) continue;
    out.push({
      key: `fixed:${f.id}`,
      source: "fixed",
      id: f.id,
      name: f.name,
      section: f.section,
      doc: f.taxDoc ?? null,
      withholding: f.taxWithholding ?? null,
      vatRate: f.vatRate ?? null,
      total: fixedTotal.get(f.id) ?? 0,
      partTime: f.section === "personel" && /part.?time|yarı zamanlı/i.test(f.name),
    });
  }
  for (const r of MANUAL_PNL_ROWS) {
    out.push({
      key: r.key,
      source: "manual",
      id: null,
      name: r.label,
      section: r.section,
      doc: input.settings.manualRows[r.key] ?? null,
      withholding: null,
      vatRate: null,
      total: sumOf(bases.map((b) => b.manualCells[r.key] ?? 0)),
      partTime: false,
    });
  }
  const entryTotal = new Map<number, number>();
  for (const e of input.expenseEntries) if (ms.has(e.date.slice(0, 7))) entryTotal.set(e.categoryId, r2((entryTotal.get(e.categoryId) ?? 0) + e.amount));
  for (const c of [...input.expenseCategories].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)) {
    if (!c.active && !entryTotal.get(c.id)) continue;
    out.push({
      key: `category:${c.id}`,
      source: "category",
      id: c.id,
      name: c.name,
      section: c.section,
      doc: c.taxDoc ?? null,
      withholding: null,
      vatRate: null,
      total: entryTotal.get(c.id) ?? 0,
      partTime: false,
    });
  }
  return out;
}

/** Ayların "vergi hesabına girmeyen" kalemleri, kaynağa göre toplanmış (ekran listesi) */
export function unclassified(months: readonly TaxMonth[]): ExcludedItem[] {
  const byKey = new Map<string, ExcludedItem>();
  for (const m of months) {
    for (const x of m.excluded) {
      const prev = byKey.get(x.key);
      if (prev) {
        prev.amount = r2(prev.amount + x.amount);
        prev.raw = r2(prev.raw + x.raw);
      } else byKey.set(x.key, { ...x });
    }
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------- Kapsam (K3)

export type TaxScope = "kafe" | "kafe_elle" | "beyanname";

export const SCOPE_TEXT: Record<TaxScope, string> = {
  kafe: "Kapsam: yalnız kafe",
  kafe_elle: "Kapsam: kafe + elle girilen kafe dışı",
  beyanname: "Gelir: şirketin tamamı (beyanname) · gider: kafe",
};
export const SCOPE_HINT =
  "Kurumlar ve geçici vergi şirketin bütün işleri için tek beyannamedir; panel yalnız kafeyi görür. Şirketin diğer gelir ve giderlerini Vergiye göre › Düzeltme ekle'den girin.";

/**
 * Başlıktaki kapsam çipi: gelir KDV beyannamesinden geliyor ve kafe dışı kısmı hiçbir ayda girilmediyse "şirketin
 * tamamı"; kafe dışı düzeltme ya da kafe dışı faturalar sayılıyorsa "kafe + elle girilen kafe dışı"; değilse "yalnız
 * kafe"
 */
export function taxScope(months: readonly TaxMonth[], input: Pick<TaxPnlInput, "adjustments" | "settings">): TaxScope {
  const beyanname = months.filter((m) => m.revenueSource === "beyanname");
  if (beyanname.length && !beyanname.some((m) => m.beyannameSplit)) return "beyanname";
  const ms = new Set(months.map((m) => m.month));
  const elle = input.adjustments.some((a) => (a.kind === "gelir_kafe_disi" || a.kind === "gider_kafe_disi") && ms.has(a.month));
  return elle || input.settings.includeSeparate ? "kafe_elle" : "kafe";
}
