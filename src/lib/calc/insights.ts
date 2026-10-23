import {
  COUNT_GROUP_VAT,
  COUNT_GROUP_VAT_DEFAULT,
  MANUAL_PNL_ROWS,
  PANEL_FIXED_GROUPS,
  PANEL_GROUP_KEYWORDS,
  type PanelFixedGroup,
} from "../constants";
import { isUnpriced } from "../count-item";
import { currentMonthTR, daysInMonth, fixedMonthly, shiftMonth, type Model, type ProductCalc, type StockSheet } from "./engine";
import { monthLabel, num } from "../format";
import { isSummaryRow } from "./pos-paste";
import type { FixedSection, Ingredient } from "./types";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const safeDiv = (a: number, b: number) => (b ? a / b : 0);
/** Kuruş altı kayan nokta gürültüsü sıfır sayılır */
const nonZero = (v: number) => Math.abs(v) >= 0.005;

const FIXED_SECTION_KEYS: FixedSection[] = ["personel", "faturalar", "kira", "genel"];
const WATER_ROW = "manual:su";

// ============================================================================
// Panel
// ============================================================================

export interface CategoryStat {
  categoryId: number;
  name: string;
  count: number;
  avgMargin: number;
  avgUnitProfit: number;
  avgCostRatio: number;
  soldQty: number;
  revenueNet: number;
  profit: number;
  weightedMargin: number;
}

export interface Alert {
  level: "danger" | "warning" | "info";
  title: string;
  detail: string;
  href?: string;
}

/**
 * Ayın satış verisi yoksa kâr oranı için kullanılacak en yakın satış ayı: önceki son satış ayı; yoksa sonraki
 * ilk satış ayı (bu aydan sonrakiler, ör. ileri tarihli deneme verisi, ancak başka hiçbir ay yoksa).
 */
export function referenceSalesMonth(model: Model, month: string): string | null {
  if (model.monthSales(month).lines.length) return month;
  const before = model.salesMonths.filter((m) => m <= month);
  if (before.length) return before[before.length - 1];
  const after = model.salesMonths.filter((m) => m > month);
  const cur = model.ds.currentMonth ?? currentMonthTR();
  return after.find((m) => m <= cur) ?? after[0] ?? null;
}

/**
 * ?ay= verilmediğinde açılacak ay: bu aya kadarki son satış ayı → en son satış ayı → aynı kuralla ay bilgisi
 * girilmiş aylar → bu ay. İleri tarihli tek bir kayıt (deneme, yanlış yazılmış ay) varsayılanı geleceğe taşımaz.
 */
export function defaultMonthOf(salesMonths: string[], infoMonths: string[], currentMonth: string): string {
  const pick = (months: string[]) => {
    const sorted = [...months].sort();
    const past = sorted.filter((m) => m <= currentMonth);
    return past.at(-1) ?? sorted.at(-1) ?? null;
  };
  return pick(salesMonths) ?? pick(infoMonths) ?? currentMonth;
}

/** Satış listesi olan son ay (bu aydan sonrakiler yalnızca başka satış ayı yoksa) */
export function latestSalesMonth(model: Model): string | null {
  const cur = model.ds.currentMonth ?? currentMonthTR();
  return model.salesMonths.filter((m) => m <= cur).at(-1) ?? model.salesMonths.at(-1) ?? null;
}

/**
 * Kategori satırları. Ortalamalar ve satış ağırlıklı marj reçetesi olan ürünlerden ("Bütün menü" satırı,
 * urunler/logic.ts menuAverages ile aynı kural): reçetesiz ürünün maliyeti 0, marjı ~%98 sayılıp ortalamayı
 * olduğundan iyi göstermesin. Ürün ve satış adedi bütün etkin ürünlerden. Excel'de reçetesiz ürün yok, sonuç aynı.
 */
export function categoryStats(model: Model, month: string | null): CategoryStat[] {
  const sold = month ? model.soldByProduct(month) : new Map<number, number>();
  return model.categories.map((c) => {
    const ps = model.products.filter((p) => p.product.categoryId === c.id && p.product.active);
    const rp = ps.filter((p) => p.status !== "Reçete yok");
    const soldQty = sum(ps.map((p) => sold.get(p.product.id) ?? 0));
    const revenueNet = sum(rp.map((p) => p.net * (sold.get(p.product.id) ?? 0)));
    const profit = sum(rp.map((p) => p.unitProfit * (sold.get(p.product.id) ?? 0)));
    return {
      categoryId: c.id,
      name: c.name,
      count: ps.length,
      avgMargin: safeDiv(sum(rp.map((p) => p.margin)), rp.length),
      avgUnitProfit: safeDiv(sum(rp.map((p) => p.unitProfit)), rp.length),
      avgCostRatio: safeDiv(sum(rp.map((p) => p.costRatio)), rp.length),
      soldQty,
      revenueNet,
      profit,
      weightedMargin: safeDiv(profit, revenueNet),
    };
  });
}

// ---------------------------------------------------------------------------- Sabit giderler (Panel)

/** Türkçe küçük harf, ı→i, aksansız: anahtar kelime aramak için */
function foldKey(s: string): string {
  return s.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/**
 * Sabit gider kaleminin Excel Panel grubu (Kira / Personel / Reklam / Diğer). Kayıtta `panelGroup`
 * alanı varsa o kullanılır; yoksa Gelir-gider bölümü ve addan bulunur:
 * reklam kelimeleri → Reklam; kira bölümünde adı "kira" olan → Kira (ortak gider / aidat Diğer);
 * personel bölümünde muhasebe / müşavir dışındakiler → Personel; geri kalan → Diğer.
 */
export function panelGroupOf(fe: { name: string; section: FixedSection; panelGroup?: PanelFixedGroup | null }): PanelFixedGroup {
  if (fe.panelGroup) return fe.panelGroup;
  const n = foldKey(fe.name);
  if (PANEL_GROUP_KEYWORDS.reklam.test(n)) return "reklam";
  if (fe.section === "kira") return PANEL_GROUP_KEYWORDS.kira.test(n) && !PANEL_GROUP_KEYWORDS.notKira.test(n) ? "kira" : "diger";
  if (fe.section === "personel") return PANEL_GROUP_KEYWORDS.notPersonel.test(n) ? "diger" : "personel";
  return "diger";
}

export interface FixedLine {
  /** Gelir-gider satır anahtarı: "personnel:net", "personnel:employer", "fixed:<id>" */
  key: string;
  label: string;
  section: FixedSection;
  group: PanelFixedGroup;
  /** Standart ayın tutarı (Sabit Giderler sayfası, Excel SabitGiderToplam'ın parçası) */
  standard: number;
  /** Bu ay için açık gün oranıyla hesaplanan tutar */
  computed: number;
  /** Bu ay kullanılan tutar: Gelir-gider'de elle düzeltildiyse o değer */
  value: number;
  overridden: boolean;
}

export interface FixedManualRow {
  key: string;
  label: string;
  section: FixedSection;
  amount: number;
}

export interface FixedFlowLine {
  key: PanelFixedGroup | "extras";
  label: string;
  hint: string;
  /** Bu ayın tutarı (pozitif = gider) */
  amount: number;
  /** Excel'deki standart aylık tutar (extras için 0; aylık harcamalar dahil değil) */
  standard: number;
  /** En büyük kalemlerin adları */
  items: string[];
  /** Gelir-gider'de elle düzeltilmiş bir kalem içeriyor mu */
  overridden: boolean;
}

export interface FixedMonthBreakdown {
  month: string;
  /**
   * "month": Gelir-gider'deki o ayın tutarları (açık gün oranı + elle düzeltmeler + o aya özel satırlar).
   * "standard": ayın açık gün sayısı girilmemiş; standart aylık tutarlar (Excel SabitGiderToplam) kullanıldı.
   */
  basis: "month" | "standard";
  openDays: number;
  dim: number;
  /** Ayarlar'daki "ayda açık gün" (günlük kalemlerin standart çarpanı) */
  acikGun: number;
  /** Standart aylık sabit gider (Excel 'Sabit Giderler'!B22 / SabitGiderToplam) */
  standard: number;
  /** Açık gün etkisi: Σ (bu ayın hesaplanan tutarı − standart tutar). Tam ayda 0 */
  proration: number;
  /** Gelir-gider'de elle düzeltilen hücrelerin farkı (düzeltilen − hesaplanan) */
  overrides: number;
  /** Gelir-gider'deki o aya özel elle satırlar (doğalgaz, ciro kirası, harici…); SU GİDERİ hariç olabilir */
  manual: number;
  /** overrides + manual: "bu aya özel giderler" */
  extras: number;
  /** Aylık harcamalar (Harcamalar sayfası + bağlı fatura kategorisi): Excel'de yok, `standard`a girmez */
  expenses: number;
  /** Reçetelerde su + buz maliyeti olarak sayıldığı için sabit giderden çıkarılan SU GİDERİ */
  waterExcluded: number;
  waterInRecipes: boolean;
  /** standard + proration + overrides + manual + expenses */
  total: number;
  /** Gelir-gider bölümlerine göre (SU GİDERİ düşülmüş) */
  sections: Record<FixedSection, number>;
  lines: FixedLine[];
  manualRows: FixedManualRow[];
  overrideRows: (FixedLine & { delta: number })[];
  /** "Para nereye gitti?" için Excel Panel'deki 4 grup + varsa "Bu aya özel giderler"; Σ amount = total */
  flow: FixedFlowLine[];
}

/**
 * Bir ayın sabit giderleri, Excel Panel'deki gruplamayla ve kaynaklarına ayrılmış olarak.
 *
 * Bilerek yapılan sapma (docs/PROMPT-VE-PLAN.md §5): Excel Panel!B13 her ay standart SabitGiderToplam'ı
 * düşer. Panel o ayın Gelir-gider tutarlarını kullanır (açık gün oranı, elle düzeltmeler, o aya özel
 * satırlar); böylece eksik açık aylar ve gerçek faturalar doğru yansır ve faturaya göre kârla aynı
 * temel kullanılır. Fark `proration`, `overrides` ve `manual` olarak ayrı ayrı verilir.
 * SU GİDERİ reçetelerde su + buz maliyeti olarak sayılıyorsa (model.water.perLiter > 0) burada
 * ikinci kez sayılmaz.
 */
export function fixedCostsForMonth(model: Model, month: string): FixedMonthBreakdown {
  const st = model.settings;
  const pm = model.pnlMonth(month);
  const openDays = pm.openDays;
  const dim = pm.dim;
  const basis: FixedMonthBreakdown["basis"] = openDays > 0 ? "month" : "standard";
  // O ay çalışan personel ve o ay geçerli sabit giderler, o ayın tutarlarıyla
  const p = model.personnelFor(month);

  const defs: Omit<FixedLine, "computed" | "value" | "overridden">[] = [
    { key: "personnel:net", label: "Personel maaş (net)", section: "personel", group: "personel", standard: p.net },
    { key: "personnel:employer", label: "Personel SGK + işsizlik (işveren)", section: "personel", group: "personel", standard: p.total - p.net },
    ...model.fixedInMonth(month).map((fe) => ({
      key: `fixed:${fe.id}`,
      label: fe.name,
      section: fe.section,
      group: panelGroupOf(fe),
      standard: fixedMonthly(fe, st),
    })),
    // Aylık harcamalar (reklam, influencer, fatura dışı): o ay girilen tutar, kategorinin grubunda; mal kategorileri
    // mal maliyetindedir, burada sayılmaz
    ...model
      .expenseAmounts(month)
      .filter((x) => x.cat.section !== "mal" && (x.total || x.cat.active))
      .map((x) => ({ key: `expense:${x.cat.id}`, label: x.cat.name, section: x.cat.section as FixedSection, group: x.cat.panelGroup, standard: x.total })),
  ];
  // Aralık dışındaki (bitmiş / başlamamış / silinmiş) kalemin o aya elle girilmiş tutarı da sayılır
  const byId = new Map(model.ds.fixedExpenses.map((fe) => [`fixed:${fe.id}`, fe]));
  const inMonth = new Set(defs.map((d) => d.key));
  for (const [key, cell] of pm.cells) {
    if (!key.startsWith("fixed:") || inMonth.has(key) || !cell.overridden || cell.value === null) continue;
    const fe = byId.get(key);
    defs.push({
      key,
      label: fe ? `${fe.name} (bu ay dönemi dışında)` : "Silinmiş gider kalemi",
      section: fe?.section ?? "genel",
      group: fe ? panelGroupOf(fe) : "diger",
      standard: 0,
    });
  }
  const lines: FixedLine[] = defs.map((d) => {
    const cell = pm.cells.get(d.key);
    // computed === null: kalem bu ay dönemi dışında, yalnızca elle girilen tutar sayılır
    const computed = cell && cell.computed === null ? 0 : basis === "month" ? (cell?.computed ?? d.standard * pm.ratio) : d.standard;
    const overridden = !!cell?.overridden && cell.value !== null;
    return { ...d, computed, value: overridden ? (cell!.value as number) : computed, overridden };
  });

  const waterInRecipes = model.water.perLiter > 0;
  const known = MANUAL_PNL_ROWS.filter((r) => r.section !== "mal").map((r) => ({
    key: r.key,
    label: r.label,
    section: r.section as FixedSection,
    amount: (pm.cells.get(r.key)?.value as number | null) ?? 0,
  }));
  const water = known.find((r) => r.key === WATER_ROW);
  const waterExcluded = waterInRecipes && water ? water.amount : 0;
  const manualRows = known.filter((r) => nonZero(r.amount) && !(r.key === WATER_ROW && waterInRecipes));

  // Bölümler: "month" temelinde motorun Gelir-gider toplamları esas alınır (bilinmeyen yeni satırlar da dahil)
  const sections = { personel: 0, faturalar: 0, kira: 0, genel: 0 } as Record<FixedSection, number>;
  if (basis === "month") {
    for (const k of FIXED_SECTION_KEYS) sections[k] = pm.sections[k];
  } else {
    for (const l of lines) sections[l.section] += l.value;
    for (const r of known) sections[r.section] += r.amount;
  }
  if (waterExcluded && water) sections[water.section] -= waterExcluded;

  const lineValues = sum(lines.map((l) => l.value));
  const sectionsTotal = sum(FIXED_SECTION_KEYS.map((k) => sections[k]));
  const manualRaw = sectionsTotal - lineValues;
  const manual = nonZero(manualRaw) ? manualRaw : 0;
  // Motorun bilinmeyen bir satırı varsa (ör. sonradan eklenen elle satır) toplam yine tutsun
  const residual = manual - sum(manualRows.map((r) => r.amount));
  if (nonZero(residual)) manualRows.push({ key: "manual:other", label: "Diğer Gelir-gider satırları", section: "genel", amount: residual });

  // Standart = Excel SabitGiderToplam (model.fixedStandardTotalFor, "Excel temeli"); aylık harcamalar ayrı bileşen
  const isExpense = (l: FixedLine) => l.key.startsWith("expense:");
  const base = lines.filter((l) => !isExpense(l));
  const standard = sum(base.map((l) => l.standard));
  const proration = sum(base.map((l) => l.computed - l.standard));
  const expenses = sum(lines.filter(isExpense).map((l) => l.value));
  const overrideRows = lines.filter((l) => l.overridden && nonZero(l.value - l.computed)).map((l) => ({ ...l, delta: l.value - l.computed }));
  const overrides = sum(overrideRows.map((l) => l.delta));

  const itemNames = (ls: FixedLine[]) => {
    const names: string[] = [];
    for (const l of [...ls].filter((x) => x.value > 0).sort((a, b) => b.value - a.value)) {
      const n = l.key.startsWith("personnel:") ? "Maaş + SGK" : l.label;
      if (!names.includes(n)) names.push(n);
    }
    return names.slice(0, 3);
  };
  const flow: FixedFlowLine[] = PANEL_FIXED_GROUPS.map((g) => {
    const ls = lines.filter((l) => l.group === g.key);
    return {
      key: g.key,
      label: g.label,
      hint: g.hint,
      amount: sum(ls.map((l) => l.value)),
      standard: sum(ls.filter((l) => !isExpense(l)).map((l) => l.standard)),
      items: itemNames(ls),
      overridden: ls.some((l) => l.overridden),
    };
  });
  if (nonZero(manual)) {
    flow.push({
      key: "extras",
      label: "Bu aya özel giderler (Gelir-gider)",
      hint: "Gelir-gider tablosunda yalnızca bu ay için girilen satırlar (doğalgaz, ciro kirası, harici giderler…).",
      amount: manual,
      standard: 0,
      items: [...manualRows].sort((a, b) => b.amount - a.amount).slice(0, 3).map((r) => r.label),
      overridden: false,
    });
  }

  return {
    month,
    basis,
    openDays,
    dim,
    acikGun: st.acikGun,
    standard,
    proration,
    overrides,
    manual,
    extras: overrides + manual,
    expenses,
    waterExcluded,
    waterInRecipes,
    total: lineValues + manual,
    sections,
    lines,
    manualRows,
    overrideRows,
    flow,
  };
}

// ---------------------------------------------------------------------------- Devam eden ay

export interface DashboardOptions {
  /**
   * Bugünün tarihi. Date verilirse ay Europe/Istanbul saatine göre bulunur; "YYYY-MM-DD" ya da "YYYY-MM"
   * metni de olur. Ay sonu tahmini yalnızca bu tarihin ayı (devam eden ay) için yapılır.
   */
  today?: Date | string;
  /** Doğrudan devam eden ay ("YYYY-MM"); today'den önceliklidir */
  currentMonth?: string;
}

/** Bir tarihin Türkiye saatine göre ayı: "2026-10" */
export function runningMonth(today: Date | string): string {
  return typeof today === "string" ? today.slice(0, 7) : currentMonthTR(today);
}

/** Açık gün sayısı ve POS cirosu girilmiş en son ay (tarih verilmediğinde "devam eden ay" sayılır) */
export function latestDataMonth(model: Model): string | null {
  return (
    [...model.monthInfo.values()]
      .filter((m) => (m.openDays ?? 0) > 0 && (m.posRevenue ?? 0) > 0)
      .map((m) => m.month)
      .sort()
      .at(-1) ?? null
  );
}

/**
 * Devam eden ay: opts.currentMonth → opts.today → veri kümesinin "bu ay"ı (sunucu yükleyicisi
 * Türkiye saatine göre doldurur) → veri girilmiş en son ay (tarihsiz testler ve betikler için).
 */
export function resolveCurrentMonth(model: Model, opts?: DashboardOptions): string | null {
  if (opts?.currentMonth) return opts.currentMonth;
  if (opts?.today) return runningMonth(opts.today);
  if (model.ds.currentMonth) return model.ds.currentMonth;
  return latestDataMonth(model);
}

export type MonthState = "running" | "closed" | "future";

/**
 * Ay sonu tahmini yapılacak ay: devam eden ay, açık gün sayısı ayın gün sayısından az ve POS cirosu
 * girilmişse o ay; değilse null. Excel'deki "Ekim tahmini" (Panel B19) yalnızca süren ay içindir.
 */
export function forecastMonthOf(model: Model, opts?: DashboardOptions): string | null {
  const cur = resolveCurrentMonth(model, opts);
  if (!cur) return null;
  const info = model.monthInfo.get(cur);
  const open = info?.openDays ?? 0;
  return info && open > 0 && open < daysInMonth(cur) && (info.posRevenue ?? 0) > 0 ? cur : null;
}

// ---------------------------------------------------------------------------- Genel bakış

/**
 * Genel bakış (Excel Panel) verileri.
 * Ay sonu tahmini yalnızca devam eden ay için yapılır (bkz. resolveCurrentMonth). Sunucuda loadModel()
 * "bu ay"ı zaten doldurduğu için seçenek gerekmez; başka bir gün için `{ today }` ya da `{ currentMonth }` verin.
 */
export function dashboard(model: Model, month: string, opts?: DashboardOptions) {
  const st = model.settings;
  const info = model.monthInfo.get(month);
  const sales = model.monthSales(month);
  const hasSales = sales.lines.length > 0;
  const pm = model.pnlMonth(month);
  const dim = daysInMonth(month);
  const openDays = info?.openDays ?? 0;

  const fixedMonth = fixedCostsForMonth(model, month);
  /** Standart aylık sabit gider (Excel SabitGiderToplam), o ayda geçerli kalemler ve tutarlarla */
  const fixedStandardTotal = model.fixedStandardTotalFor(month);
  const fixed = fixedMonth.sections;
  const fixedTotal = fixedMonth.total;
  const discountsNet = (info?.discounts ?? 0) / (1 + st.kdv);

  // Excel Panel: Brüt kâr − indirim − sabit giderler (reçeteye göre teorik maliyet)
  const theoretical = hasSales
    ? {
        netSales: sales.net,
        discountsNet,
        material: sales.cost,
        commission: sales.commission,
        grossProfit: sales.grossProfit,
        /** Gelir-gider bölümlerine göre (SU GİDERİ reçetedeyse düşülmüş) */
        fixed,
        fixedTotal,
        /** Standart / açık gün etkisi / bu aya özel ayrımı ve Excel Panel grupları */
        fixedBreakdown: fixedMonth,
        /** "Para nereye gitti?" sabit gider satırları (Kira, Personel, Reklam, Diğer, bu aya özel) */
        fixedFlow: fixedMonth.flow,
        netProfit: sales.grossProfit - discountsNet - fixedTotal,
        /** Excel Panel!B13 temelinde: standart SabitGiderToplam ile */
        netProfitStandard: sales.grossProfit - discountsNet - fixedStandardTotal,
      }
    : null;

  // Genel Maliyet: faturaya göre gerçekleşen
  const actual = {
    revenue: pm.revenue,
    revenueNet: pm.revenueNet,
    /** laffogato.net online satışı (KDV hariç); ay çekilmediyse null */
    site: pm.site,
    /** ModPOS + online (KDV hariç): kârın cirosu */
    revenueTotalNet: pm.revenueTotalNet,
    cogs: pm.cogs,
    purchases: pm.purchases,
    personel: pm.sections.personel,
    faturalar: pm.sections.faturalar,
    kira: pm.sections.kira,
    genel: pm.sections.genel,
    komisyon: pm.sections.komisyon,
    expenses: pm.expenses,
    profit: pm.profit,
    hasRevenue: pm.revenue !== null,
  };

  const refMonth = referenceSalesMonth(model, month);
  const ref = refMonth ? model.monthSales(refMonth) : null;
  /** 1 ₺ (KDV dahil) cirodan kalan brüt kâr (Excel: EylulBrutKar / EylulCiro) */
  const grossRatio = ref ? safeDiv(ref.grossProfit, ref.revenue) : 0;
  const breakEvenDaily = grossRatio > 0 ? fixedStandardTotal / grossRatio / st.acikGun : null;
  const grossRevenue = hasSales ? sales.revenue : (info?.posRevenue ?? 0);
  /** Excel B17: satış listesi varsa liste toplamı (indirim öncesi) ÷ açık gün, yoksa POS cirosu ÷ açık gün */
  const dailyAvg = openDays ? grossRevenue / openDays : null;
  /** POS cirosu (indirim sonrası) ÷ açık gün: aylar arası karşılaştırma için ortak temel */
  const dailyPosAvg = openDays && (info?.posRevenue ?? 0) > 0 ? (info!.posRevenue as number) / openDays : null;
  const breakEvenProgress = breakEvenDaily && dailyAvg ? dailyAvg / breakEvenDaily : null;

  const currentMonth = resolveCurrentMonth(model, opts);
  const monthState: MonthState = !currentMonth || month < currentMonth ? "closed" : month === currentMonth ? "running" : "future";
  // Açık gün sayısı, devam eden ay için "geçen gün" olarak da kullanılır (Excel B18/B19: /16 × 31)
  const partial = monthState === "running" && forecastMonthOf(model, { currentMonth: currentMonth! }) === month;
  const forecast = partial
    ? (() => {
        const projectedRevenue = ((info!.posRevenue as number) / openDays) * dim;
        return {
          daysElapsed: openDays,
          dim,
          projectedRevenue,
          projectedProfit: projectedRevenue * grossRatio - fixedStandardTotal,
          refMonth,
        };
      })()
    : null;

  const sold = sales.soldByProduct;
  const withProfit = model.activeProducts
    .map((p) => ({ p, qty: sold.get(p.product.id) ?? 0, profit: p.unitProfit * (sold.get(p.product.id) ?? 0) }))
    .filter((x) => x.qty > 0);
  // Reçetesiz ürünün kârı ~cirosu kadar görünür: kâr ve marj sıralamasına girmez (adet sıralamasına girer)
  const ranked = withProfit.filter((x) => x.p.status !== "Reçete yok");
  const topProducts = [...ranked].sort((a, b) => b.profit - a.profit).slice(0, 5);
  const bestSellers = [...withProfit].sort((a, b) => b.qty - a.qty).slice(0, 5);
  const weakest = [...ranked].sort((a, b) => a.p.margin - b.p.margin).slice(0, 5);

  const topExpenses = [
    { name: "Personel (maaş + SGK)", amount: model.personnelFor(month).total },
    ...model.fixedInMonth(month).map((f) => ({ name: f.name, amount: fixedMonthly(f, st) })),
  ]
    .filter((e) => e.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  /** Kategori tablosundaki "Satış (adet)" ve satış ağırlıklı marjın ayı; seçili ayda satış yoksa referans ay */
  const categoryMonth = hasSales ? month : refMonth;

  return {
    month,
    info,
    hasSales,
    sales,
    theoretical,
    actual,
    fixedMonth,
    refMonth,
    grossRatio,
    breakEvenDaily,
    dailyAvg,
    dailyPosAvg,
    breakEvenProgress,
    /** Seçili ay devam ediyor mu, bitti mi (bugüne göre) */
    monthState,
    currentMonth,
    forecast,
    recipeCostRatio: hasSales ? safeDiv(sales.cost, sales.net) : null,
    invoiceCostRatio: hasSales ? safeDiv(model.goodsPurchases(month), sales.net) : null,
    bestProduct: topProducts[0] ?? null,
    topProducts,
    bestSellers,
    weakest,
    lowProfitCount: model.activeProducts.filter((p) => p.status === "Düşük kâr").length,
    attentionCount: model.activeProducts.filter((p) => p.status === "Dikkat").length,
    categories: categoryStats(model, categoryMonth),
    categoryMonth,
    /** true: kategori adetleri seçili aydan değil, categoryMonth'tan */
    categoryMonthIsOther: categoryMonth !== null && categoryMonth !== month,
    topExpenses,
    fixedStandardTotal,
  };
}

export type DashboardData = ReturnType<typeof dashboard>;

/**
 * Günlük ortalama cironun önceki aya göre değişimi, iki ay için aynı temelde:
 * ikisinde de POS cirosu varsa POS ÷ açık gün; yoksa ikisinde de satış listesi varsa liste ÷ açık gün.
 * Temeller karışıyorsa (biri liste, öteki POS) karşılaştırma yapılmaz.
 */
export function dailyChange(cur: DashboardData, prev: DashboardData) {
  const pick = (): { basis: "pos" | "list"; current: number; previous: number } | null => {
    if (cur.dailyPosAvg !== null && prev.dailyPosAvg !== null) return { basis: "pos", current: cur.dailyPosAvg, previous: prev.dailyPosAvg };
    if (cur.hasSales && prev.hasSales && cur.dailyAvg !== null && prev.dailyAvg !== null) return { basis: "list", current: cur.dailyAvg, previous: prev.dailyAvg };
    return null;
  };
  const p = pick();
  if (!p || !p.previous) return { growth: null, basis: p?.basis ?? null, current: p?.current ?? null, previous: p?.previous ?? null };
  return { growth: (p.current - p.previous) / Math.abs(p.previous), ...p };
}

/**
 * Yıl içindeki aylık ciro / gider / kâr (grafik). POS cirosu girilmemiş ay kâr/zarar sayılmaz: sayımdan sonraki
 * ayda devreden stok, ciro gelmeden mal maliyeti olur; süren ayın faturaları da öyle (Gelir-gider tablosu aynen kalır).
 */
export function yearTrend(model: Model, year: number) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    const pm = model.pnlMonth(month);
    const noRevenue = pm.revenue === null;
    return {
      month,
      // ModPOS + laffogato.net online satışı (KDV hariç): kârla aynı ciro
      revenueNet: pm.revenueTotalNet ?? 0,
      expenses: pm.expenses,
      profit: noRevenue ? 0 : pm.profit,
      /** POS cirosu girilmiş: kâr/zarar şeridine, yıl toplamına ve grafiğe girer */
      active: !noRevenue,
      /** Gider var (fatura, önceki ayın sayım devri) ama ciro girilmedi */
      missingRevenue: noRevenue && pm.expenses > 0,
    };
  });
}

// ============================================================================
// Faturalar: açık bakiye
// ============================================================================

type InvoiceBalance = { payable: number; unpaid: boolean; outstanding?: number | null };

/**
 * Ödenmemiş faturanın kalan borcu (KDV dahil). Paraşüt'ten gelen kısmi ödemede `outstanding`
 * (kalan) kullanılır; yoksa ya da 0 ise Ödenecek tutarın tamamı. Ödenmiş fatura için 0.
 * Hatırlatıcılar (lib/reminders.ts) ile aynı kural.
 */
export function openBalance(inv: InvoiceBalance): number {
  if (!inv.unpaid) return 0;
  return inv.outstanding !== null && inv.outstanding !== undefined && inv.outstanding > 0 ? inv.outstanding : inv.payable;
}

/** Kısmen ödenmiş: kalan > 0 ve Ödenecek'ten az */
export function isPartiallyPaid(inv: InvoiceBalance): boolean {
  return inv.unpaid && inv.outstanding !== null && inv.outstanding !== undefined && inv.outstanding > 0 && inv.outstanding < inv.payable - 0.005;
}

/** Ödenmemiş faturaların sayısı ve kalan borç toplamı */
export function unpaidSummary(invoices: InvoiceBalance[]) {
  const open = invoices.filter((i) => i.unpaid);
  return {
    count: open.length,
    total: sum(open.map(openBalance)),
    payableTotal: sum(open.map((i) => i.payable)),
    partialCount: open.filter(isPartiallyPaid).length,
  };
}

// ============================================================================
// Uyarılar
// ============================================================================

/** Uyarı metnindeki ad listesi: ilk `max` ad, kalanı sayıyla ("A, B, C ve 3 ürün daha") */
export function nameList(names: string[], max: number, noun: string): string {
  const head = names.slice(0, max).join(", ");
  return names.length > max ? `${head} ve ${num(names.length - max)} ${noun} daha` : head;
}

export function alerts(model: Model, month: string): Alert[] {
  const out: Alert[] = [];
  const sales = model.monthSales(month);
  const info = model.monthInfo.get(month);
  const ay = `?ay=${month}`;

  const summaryLines = sales.lines.filter((l) => isSummaryRow(l.line.posName));
  if (summaryLines.length) {
    out.push({
      level: "danger",
      title: "Satış listesinde toplam satırı var",
      detail: `${summaryLines
        .slice(0, 3)
        .map((l) => `“${l.line.posName}” ${Math.round(l.line.revenue).toLocaleString("tr-TR")} ₺`)
        .join(", ")} ürün gibi sayılıyor, ciro ve kâr şişiyor. Satışlar sayfasından bu satırı silin.`,
      href: `/panel/satislar${ay}`,
    });
  }
  const unmatched = sales.unmatched.filter((l) => !isSummaryRow(l.line.posName));
  if (unmatched.length) {
    out.push({
      level: "warning",
      title: `${unmatched.length} POS ürününün reçetesi yok`,
      detail: `${nameList(unmatched.map((l) => l.line.posName), 5, "ürün")}. Bunlara ortalama maliyet oranı uygulanıyor.`,
      href: `/panel/satislar${ay}&durum=eslesmeyen`,
    });
  }
  // laffogato.net online kafe satırları menü bağlantısıyla ürünlere eşlenir; eşlenmeyenin malzemesi tüketime girmez
  const siteUnmapped = model.siteLines(month).unmapped;
  if (siteUnmapped.length) {
    out.push({
      level: "warning",
      title: `${siteUnmapped.length} online satış satırı panel ürününe bağlı değil`,
      detail: `${nameList(
        siteUnmapped.map((l) => `${l.name}${l.size === "single" ? "" : ` ${l.size}`}`),
        5,
        "ürün",
      )}. Ürünü laffogato.net menüsündeki kalemine bağlayın; bağlanana kadar bu satışların malzemesi tutarlılıkta sayılmaz.`,
      href: "/panel/urunler/site",
    });
  }
  if (sales.lines.length && info?.posRevenue) {
    const diff = sales.revenue - (info.discounts ?? 0) - info.posRevenue;
    if (Math.abs(diff) >= 1000) {
      out.push({
        level: "warning",
        title: "Satış listesi ile POS cirosu tutmuyor",
        detail: `Fark ${Math.round(diff).toLocaleString("tr-TR")} ₺. Satış raporunu ve indirimleri kontrol edin.`,
        href: `/panel/tutarlilik${ay}`,
      });
    }
  }
  const low = model.activeProducts.filter((p) => p.status === "Düşük kâr");
  if (low.length) {
    out.push({
      level: "danger",
      title: `${low.length} ürünün kârı düşük`,
      detail: `Maliyet oranı hedefin (%${Math.round(model.settings.hedefMaliyet * 100)}) 10 puandan fazla üstünde. Önerilen fiyatlara bakın.`,
      href: "/panel/urunler?durum=Düşük kâr",
    });
  }
  // Fiyatı girilmemiş hammadde (çoğu sayımda "Listeye ekle" ile 0 ₺ açılan) kullanan ürünün maliyeti eksik. Bütün
  // malzemesi fiyatsızsa maliyet 0 olur ve durumu "Reçete yok" görünür (Excel kuralı): reçetesi boş sayılmaz, burada söylenir
  const unpricedIds = new Set(model.ds.ingredients.filter(isUnpriced).map((i) => i.id));
  const usesUnpriced = (p: ProductCalc) => p.lines.some((l) => l.ingredient !== undefined && unpricedIds.has(l.ingredient.id));
  const noRecipe = model.activeProducts.filter((p) => p.status === "Reçete yok" && !usesUnpriced(p));
  if (noRecipe.length) {
    out.push({
      level: "warning",
      title: `${noRecipe.length} ürünün reçetesi boş`,
      detail: nameList(noRecipe.map((p) => p.key), 5, "ürün"),
      href: "/panel/urunler?durum=Reçete yok",
    });
  }
  const unpricedUse = unpricedIds.size ? model.activeProducts.filter(usesUnpriced) : [];
  if (unpricedUse.length) {
    out.push({
      level: "warning",
      title: `${unpricedUse.length} ürünün maliyeti eksik`,
      detail: `${nameList(unpricedUse.map((p) => p.key), 5, "ürün")}. Reçetesinde fiyatı girilmemiş hammadde var; Hammaddeler'den paket fiyatını girin.`,
      href: "/panel/hammaddeler?durum=fiyatsiz",
    });
  }
  const zeroQty = model.activeProducts.flatMap((p) =>
    p.lines.filter((l) => l.qty === 0 || l.qtyError).map((l) => ({ p, l })),
  );
  if (zeroQty.length) {
    out.push({
      level: "info",
      title: `${zeroQty.length} reçete satırında miktar eksik`,
      detail: nameList(zeroQty.map(({ p, l }) => `${p.key}: ${l.ingredient?.name}`), 4, "satır"),
      href: `/panel/urunler/${zeroQty[0].p.product.id}?ay=${month}`,
    });
  }
  const estimates = model.ds.ingredients.filter((i) => i.active && i.isEstimate);
  if (estimates.length) {
    out.push({
      level: "info",
      title: `${estimates.length} hammaddenin fiyatı tahmini`,
      detail: "Faturada bulunamayan fiyatlar. Gerçek fiyatı girince bütün ürün maliyetleri güncellenir.",
      href: "/panel/hammaddeler?durum=tahmini",
    });
  }
  const unused = model.ds.ingredients.filter((i) => i.active && !model.usedIn.has(i.id));
  if (unused.length) {
    out.push({
      level: "info",
      title: `${unused.length} hammadde hiçbir reçetede yok`,
      detail: `${nameList(unused.map((i) => i.name), 4, "hammadde")}. Hangi üründe kullanılıyorsa reçeteye ekleyin.`,
      href: "/panel/hammaddeler?durum=kullanilmayan",
    });
  }
  const waterUsed = model.ds.ingredients.some((i) => i.priceSource === "water" && model.usedIn.has(i.id));
  if (waterUsed && model.water.perLiter === 0) {
    const billMonth = model.water.reason === "no-usage" ? model.water.latestBillMonth : null;
    out.push(
      billMonth
        ? {
            level: "info",
            title: "Su ve buz maliyeti hesaplanamadı",
            detail: `${monthLabel(billMonth)} su faturası girildi ama ${monthLabel(billMonth)} ürün satış listesi yok; litre hesaplanamadığı için su ve buz şimdilik 0 ₺ sayılıyor. O ayın satış listesini yükleyin ya da birim maliyeti Ayarlar'da elle yazın.`,
            href: `/panel/satislar?ay=${billMonth}`,
          }
        : {
            level: "info",
            title: "Su ve buz maliyeti 0 ₺",
            detail:
              "Gelir-Gider tablosunda SU GİDERİ girilmediği için su ve buz maliyetsiz sayılıyor. Girince (o ayın satış listesi de varsa) reçetelere dağıtılır; reçeteye göre kârda sabit gider olarak ikinci kez sayılmaz.",
            href: "/panel/gelir-gider?ara=su+gideri",
          },
    );
  }
  const prev = shiftMonth(month, -1);
  if (model.monthInfo.has(prev) && !model.stockSheet(prev).hasData) {
    out.push({
      level: "info",
      title: "Geçen ayın stok sayımı yok",
      detail: "Sayım olmadan devreden mal 0 kabul edilir ve alınan malın tamamı maliyet sayılır.",
      href: `/panel/sayim?ay=${prev}`,
    });
  }
  const unpaid = model.ds.invoices.filter((i) => i.unpaid);
  if (unpaid.length) {
    out.push({
      level: "warning",
      title: `${unpaid.length} fatura ödenmemiş görünüyor`,
      detail: unpaid
        .slice(0, 3)
        .map((i) => `${i.supplier} ${Math.round(openBalance(i)).toLocaleString("tr-TR")} ₺${isPartiallyPaid(i) ? " kalan" : ""}`)
        .join(", "),
      href: "/panel/faturalar?durum=odenmedi",
    });
  }
  return out;
}

// ============================================================================
// Tutarlılık Kontrolü
// ============================================================================

/**
 * Stok karşılaştırmasının durumu:
 * - "complete": iki sayım ve bu ayın alım miktarı var; gerçek tüketim ve sapma hesaplandı
 * - "needsPurchase": iki sayım var ama alım miktarı girilmemiş (alınmadıysa 0 girilmeli); sapma hesaplanmaz
 * - "noCount": önceki ya da bu ayın sayımı eksik
 */
export type StockCheck = "complete" | "needsPurchase" | "noCount";

export interface ConsistencyRow {
  ingredient: Ingredient;
  unitCost: number;
  /** Reçeteye göre beklenen tüketim: ModPOS satışları + online kafe siparişleri */
  usage: number;
  /** Bunun ModPOS satışlarından gelen kısmı (Satışlar sayfasındaki rapor) */
  posUsage: number;
  /** laffogato.net online kafe siparişlerinden gelen kısmı (menü bağlantısıyla eşlenen satırlar) */
  onlineUsage: number;
  purchased: number | null;
  ratio: number | null;
  diffAmount: number | null;
  opening: number | null;
  closing: number | null;
  /** Devir + alınan − devreden; yalnızca stock === "complete" iken */
  actualUsage: number | null;
  variance: number | null;
  varianceAmount: number | null;
  /** Devir − devreden (alım bilinmeden stoktaki düşüş); iki sayım varsa */
  stockDrop: number | null;
  stock: StockCheck;
  /** Hammadde herhangi bir reçetede var mı (yoksa tüketimi "reçetesiz tüketim"dir) */
  inRecipe: boolean;
  note: string | null;
  /** Personelin kaydettiği zayi ve ikramın bu malzemeden tükettiği (malzemenin kendi biriminde) */
  zayi: number;
  ikram: number;
  /** Sapmanın kayıtlı zayi ve ikramla açıklanamayan kısmı (porsiyon kaçağı, kayda geçmeyen fire); sapma yoksa null */
  unexplained: number | null;
  unexplainedAmount: number | null;
}

export function consistency(model: Model, month: string) {
  const st = model.settings;
  const sales = model.monthSales(month);
  const info = model.monthInfo.get(month);
  const listTotal = sales.revenue;
  const discounts = info?.discounts ?? 0;
  const computed = listTotal - discounts;
  const pos = info?.posRevenue ?? null;
  const diff = pos === null || !sales.lines.length ? null : computed - pos;
  const offRevenue = info?.offRevenue ?? 0;

  const usage = model.ingredientUsage(month);
  // Online kafe siparişleri ayrı bir kaynak: ModPOS satışına yazılmaz, beklenen tüketime eklenir ve ayrıca gösterilir
  const online = model.onlineUsage(month);
  const recorded = model.recordedUsage(month);
  const purchases = new Map(
    model.ds.purchaseQuantities.filter((p) => p.month === month).map((p) => [p.ingredientId, p]),
  );
  const prevMonth = shiftMonth(month, -1);
  const countedIn = (m: string) => new Set(model.ds.stockCounts.filter((c) => c.month === m).map((c) => c.ingredientId));
  const prevCounted = countedIn(prevMonth);
  // İki ay da sayılan hammaddeler de listelenir: reçetesi olmayan ama stoktan düşen mal görünür olsun
  const countedBoth = [...countedIn(month)].filter((id) => prevCounted.has(id));

  const ids = new Set<number>([...usage.keys(), ...online.keys(), ...purchases.keys(), ...countedBoth, ...recorded.keys()]);
  const rows: ConsistencyRow[] = [];
  for (const id of ids) {
    const ingredient = model.ingById.get(id);
    if (!ingredient) continue;
    if (ingredient.priceSource === "water" && !purchases.has(id)) continue;
    const unitCost = model.unitCost.get(id) ?? 0;
    const posU = usage.get(id) ?? 0;
    const onlineU = online.get(id) ?? 0;
    const u = posU + onlineU;
    const p = purchases.get(id);
    const purchased = p ? p.qty : null;
    // Sayım biriminden malzemenin kendi birimine (sayıldığı andaki çarpanla: KG/LT = 1000)
    const opening = model.countInBaseUnit(prevMonth, id);
    const closing = model.countInBaseUnit(month, id);
    const counted = opening !== null && closing !== null;
    const stock: StockCheck = !counted ? "noCount" : purchased === null ? "needsPurchase" : "complete";
    // Alım girilmeden "gerçek tüketim" hesaplanmaz: eksik alım 0 sayılırsa sapma yanlış (hatta eksi) çıkar
    const actualUsage = stock === "complete" ? opening! + purchased! - closing! : null;
    const variance = actualUsage !== null ? actualUsage - u : null;
    const rec = recorded.get(id) ?? { zayi: 0, ikram: 0 };
    const unexplained = variance !== null ? variance - rec.zayi - rec.ikram : null;
    rows.push({
      ingredient,
      unitCost,
      usage: u,
      posUsage: posU,
      onlineUsage: onlineU,
      purchased,
      ratio: purchased !== null && u ? purchased / u : null,
      diffAmount: purchased !== null ? (purchased - u) * unitCost : null,
      opening,
      closing,
      actualUsage,
      variance,
      varianceAmount: variance !== null ? variance * unitCost : null,
      stockDrop: counted ? opening! - closing! : null,
      stock,
      inRecipe: model.usedIn.has(id),
      note: p?.note ?? null,
      zayi: rec.zayi,
      ikram: rec.ikram,
      unexplained,
      unexplainedAmount: unexplained !== null ? unexplained * unitCost : null,
    });
  }
  const weight = (r: ConsistencyRow) => Math.abs(r.diffAmount ?? (r.usage * r.unitCost || (r.stockDrop ?? 0) * r.unitCost));
  rows.sort((a, b) => {
    if ((a.purchased === null) !== (b.purchased === null)) return a.purchased === null ? 1 : -1;
    return weight(b) - weight(a);
  });

  const complete = rows.filter((r) => r.stock === "complete");
  const unreciped = rows.filter((r) => !r.inRecipe && r.stockDrop !== null && (r.stockDrop + (r.purchased ?? 0)) > 0);
  const siteRecord = model.siteSales(month);
  const siteLines = model.siteLines(month);

  return {
    month,
    sales: {
      listTotal,
      discounts,
      computed,
      pos,
      diff,
      ok: diff !== null && Math.abs(diff) < 1000,
      offRevenue,
      offRevenueCost: (offRevenue / (1 + st.kdv)) * sales.avgCostRatio,
      hasLines: sales.lines.length > 0,
    },
    rows,
    totalDiff: sum(rows.map((r) => r.diffAmount ?? 0)),
    /** Yalnızca alımı girilmiş ve iki ayı sayılmış satırlar (tablonun varsayılan görünümüyle aynı satırlar) */
    totalVariance: sum(complete.map((r) => r.varianceAmount ?? 0)),
    /** Aynı satırlarda kayıtlı zayi ve ikramın maliyeti ve sapmanın açıklanamayan kısmı */
    totalRecorded: sum(complete.map((r) => (r.zayi + r.ikram) * r.unitCost)),
    totalUnexplained: sum(complete.map((r) => r.unexplainedAmount ?? 0)),
    /** Ayın bütün zayi ve ikram kayıtları: adet, malzeme maliyeti, ikramın menü fiyatıyla değeri */
    waste: model.wasteSummary(month),
    hasStockComparison: complete.length > 0,
    /** En az bir hammaddenin iki ayı da sayılmış */
    hasCounts: rows.some((r) => r.stock !== "noCount"),
    /** İki ayı sayılmış ama alım miktarı girilmemiş satır sayısı ("alım girilmeli") */
    needsPurchaseCount: rows.filter((r) => r.stock === "needsPurchase").length,
    /** Hiçbir reçetede olmayıp stoktan düşen hammaddeler: en az (devir − devreden + alınan) × birim maliyet */
    unreciped: {
      count: unreciped.length,
      amount: sum(unreciped.map((r) => (r.stockDrop! + (r.purchased ?? 0)) * r.unitCost)),
    },
    /**
     * laffogato.net online kafe siparişleri (ay çekilmediyse null): ürüne eşlenen ve eşlenmeyen satırlar. Eşlenmeyenin
     * malzemesi beklenen tüketime girmez; ürünü Ürünler › Site menüsü'nden bağlanınca girer.
     */
    online: siteRecord
      ? {
          pulledAt: siteRecord.pulledAt,
          closed: siteRecord.closed,
          orders: siteRecord.cafe.orders,
          mappedQty: sum(siteLines.mapped.map((m) => m.line.qty)),
          mapped: siteLines.mapped.map((m) => ({ ...m.line, productId: m.product.id, productName: m.product.name, productSize: m.product.size })),
          unmapped: siteLines.unmapped,
          unmappedQty: sum(siteLines.unmapped.map((l) => l.qty)),
        }
      : null,
  };
}

// ============================================================================
// Sayım: grup bazında KDV dahil tutar
// ============================================================================

/**
 * Sayım sayfasının grup toplamları KDV hariç ve KDV dahil.
 * Panel her malzemenin Hammaddeler'deki Alış KDV'sini kullanır (engine.stockSheet). Excel Sayım ise grup
 * başına tek oran kullanır (ambalaj %20, diğerleri %1: N = L × M + L). İkisi farklıysa `mismatches`
 * listesi hangi malzemenin oranının grup oranından ayrıldığını gösterir (ör. Yenilebilir bardak %10 / grup %20).
 */
export function stockVatSummary(sheet: StockSheet) {
  const groups = sheet.groups.map((g) => {
    const excelRate = COUNT_GROUP_VAT[g.name] ?? COUNT_GROUP_VAT_DEFAULT;
    return {
      name: g.name,
      total: g.total,
      totalVatIncl: g.totalVatIncl,
      vat: g.totalVatIncl - g.total,
      excelRate,
      excelVatIncl: g.total * (1 + excelRate),
      mismatches: g.lines
        .filter((l) => Math.abs(l.ingredient.vatRate - excelRate) > 1e-9)
        .map((l) => ({ ingredient: l.ingredient, vatRate: l.ingredient.vatRate, amount: l.amount })),
    };
  });
  const extrasVatIncl = sheet.extrasTotal * (1 + COUNT_GROUP_VAT_DEFAULT);
  return {
    groups,
    extras: { total: sheet.extrasTotal, totalVatIncl: extrasVatIncl, rate: COUNT_GROUP_VAT_DEFAULT },
    total: sheet.total,
    totalVatIncl: sheet.totalVatIncl,
    excelTotalVatIncl: sum(groups.map((g) => g.excelVatIncl)) + extrasVatIncl,
  };
}

// ============================================================================
// Menü mühendisliği (Kasavana & Smith) ve senaryo simülatörü
// ============================================================================

export type MenuClass = "star" | "plowhorse" | "puzzle" | "dog";

export const MENU_CLASS_INFO: Record<MenuClass, { label: string; advice: string; tone: string }> = {
  star: { label: "Yıldız", advice: "Çok satıyor, çok kazandırıyor. Kalitesini ve yerini koruyun.", tone: "green" },
  plowhorse: { label: "Beygir", advice: "Çok satıyor ama az kazandırıyor. Küçük zam ya da maliyet düşürme deneyin.", tone: "amber" },
  puzzle: { label: "Bilmece", advice: "Kazandırıyor ama az satıyor. Öne çıkarın, tanıtın, öneri olarak sunun.", tone: "blue" },
  dog: { label: "Zayıf", advice: "Az satıyor, az kazandırıyor. Menüden çıkarmayı ya da yenilemeyi düşünün.", tone: "red" },
};

export interface MenuEngItem {
  p: ProductCalc;
  qty: number;
  mix: number;
  cm: number;
  totalCm: number;
  cls: MenuClass;
}

export function menuEngineering(model: Model, month: string, categoryId?: number) {
  const sold = model.soldByProduct(month);
  const items = model.activeProducts.filter((p) => categoryId === undefined || p.product.categoryId === categoryId);
  const totalQty = sum(items.map((p) => sold.get(p.product.id) ?? 0));
  const n = items.length;
  const popThreshold = n ? (1 / n) * 0.7 : 0;
  const avgCm = safeDiv(sum(items.map((p) => p.unitProfit * (sold.get(p.product.id) ?? 0))), totalQty);
  const result: MenuEngItem[] = items.map((p) => {
    const qty = sold.get(p.product.id) ?? 0;
    const mix = safeDiv(qty, totalQty);
    const highPop = mix >= popThreshold;
    const highCm = p.unitProfit >= avgCm;
    const cls: MenuClass = highPop ? (highCm ? "star" : "plowhorse") : highCm ? "puzzle" : "dog";
    return { p, qty, mix, cm: p.unitProfit, totalCm: p.unitProfit * qty, cls };
  });
  return { items: result, totalQty, popThreshold, avgCm };
}

export interface ScenarioInput {
  priceChangePct: number;
  costChangePct: number;
  volumeChangePct: number;
  extraFixed: number;
}

export interface ScenarioBase {
  revenue: number;
  net: number;
  discountsNet: number;
  material: number;
  commission: number;
  fixed: number;
}

/** Senaryonun çıkış noktası: seçilen ayın satış karması + aylık sabit giderler */
export function scenarioBase(model: Model, month: string): ScenarioBase {
  const st = model.settings;
  const sales = model.monthSales(month);
  const info = model.monthInfo.get(month);
  return {
    revenue: sales.revenue,
    net: sales.net,
    discountsNet: (info?.discounts ?? 0) / (1 + st.kdv),
    material: sales.cost,
    commission: sales.commission,
    fixed: model.fixedStandardTotalFor(month),
  };
}

/** Saf hesap: tarayıcıda canlı çalışır */
export function applyScenario(base: ScenarioBase, input: ScenarioInput, acikGun: number) {
  const p = 1 + input.priceChangePct;
  const v = 1 + input.volumeChangePct;
  const c = 1 + input.costChangePct;
  const sc: ScenarioBase = {
    revenue: base.revenue * p * v,
    net: base.net * p * v,
    discountsNet: base.discountsNet * p * v,
    material: base.material * c * v,
    commission: base.commission * p * v,
    fixed: base.fixed + input.extraFixed,
  };
  const finish = (x: ScenarioBase) => {
    const gross = x.net - x.material - x.commission;
    const profit = gross - x.discountsNet - x.fixed;
    const grossRatio = safeDiv(gross, x.revenue);
    return {
      ...x,
      gross,
      profit,
      grossRatio,
      breakEvenDaily: grossRatio > 0 ? x.fixed / grossRatio / acikGun : null,
      materialRatio: safeDiv(x.material, x.net),
    };
  };
  return { base: finish(base), scenario: finish(sc) };
}

export function scenario(model: Model, month: string, input: ScenarioInput) {
  return applyScenario(scenarioBase(model, month), input, model.settings.acikGun);
}

/** Hedef aylık kâr için gereken günlük ciro (KDV dahil) */
export function requiredDailyRevenue(model: Model, month: string, targetProfit: number): number | null {
  const ref = referenceSalesMonth(model, month);
  if (!ref) return null;
  const s = model.monthSales(ref);
  const ratio = safeDiv(s.grossProfit, s.revenue);
  if (ratio <= 0) return null;
  return (model.fixedStandardTotalFor(month) + targetProfit) / ratio / model.settings.acikGun;
}
