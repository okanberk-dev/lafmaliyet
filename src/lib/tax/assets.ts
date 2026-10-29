/**
 * Demirbaş ve amortisman (plan docs/planlar/vergi.md §3.3, K12, K14): normal (eşit) amortisman, edinilen yıl tam yıl,
 * son yıl kalanı alır; geçici vergi çeyreklerine dağıtım ayarla ("kalan": edinilen çeyrek dahil kalan çeyreklere eşit;
 * "ay12": kümülatif ay ÷ 12). Ömür girilmezse amortisman 0'dır, ömür uydurulmaz. Faturaya bağlanan maliyet o faturanın
 * giderinden düşer. "Demirbaş olabilir": KDV hariç 12.000 ₺'yi aşan ve aynı tedarikçiden aynı kategoride önceki 90 günde
 * faturası olmayan fatura, sahip karar verene kadar. Saf modül; tests/vergi-demirbas.test.ts.
 */

import { normalizeSupplier } from "../calc/engine";
import type { Invoice } from "../calc/types";
import { COMMISSION_CATEGORY, GOODS_CATEGORIES, SEPARATE_CATEGORIES } from "../constants";
import { dateTR, num } from "../format";
import { daysBetween } from "../reminders";

import { periodQuarters, quarterOfMonth } from "./calendar";
import { r2, type TaxYearRules } from "./rules";
import type { TaxSettings } from "./settings";

/** Kuruluş ve demirbaş faturaları: gider değil, varlık listesine (Demirbaş) */
export const ASSET_CATEGORY = "Kuruluş & Demirbaş";
/** Kira faturaları demirbaş adayı olmaz */
export const RENT_CATEGORY = "Kira & AVM";

export type AssetKind = "demirbas" | "ozel_maliyet" | "diger";
export type AssetMethod = "amortisman" | "dogrudan_gider";
export type QuarterDepreciation = TaxSettings["quarterDepreciation"];

export const ASSET_KIND_LABELS: Record<AssetKind, string> = { demirbas: "Demirbaş", ozel_maliyet: "Özel maliyet", diger: "Diğer" };
export const ASSET_METHOD_LABELS: Record<AssetMethod, string> = { amortisman: "Amortisman", dogrudan_gider: "Doğrudan gider" };
export const QUARTER_DEPRECIATION_LABELS: Record<QuarterDepreciation, string> = { kalan: "Kalan çeyreklere eşit", ay12: "Kümülatif ay ÷ 12" };

/** tax_assets satırı */
export interface TaxAsset {
  id: number;
  name: string;
  invoiceId: number | null;
  /** Bağlandığı anki fatura künyesi ("XND Teknoloji · 13.07.2026 · 338.169,58"); fatura silinince aday aramak için */
  invoiceLabel: string | null;
  /** YYYY-MM-DD */
  acquiredOn: string;
  /** KDV hariç */
  cost: number;
  kind: AssetKind;
  method: AssetMethod;
  /** Boş = girilmedi (amortisman 0) */
  lifeYears: number | null;
  note?: string | null;
}

export interface Depreciation {
  /** Yıl yıl amortisman (edinilen yıldan ömür boyunca; son yıl kalanı) */
  years: { year: number; amount: number }[];
  /** Hesap dönemindeki çeyreklerin payı ("2026-Q3") */
  quarters: Map<string, number>;
  /** Doğrudan gider: edinilen ayın gideri */
  direct: { month: string; amount: number } | null;
  warning: string | null;
}

export const LIFE_MISSING_WARNING = "Faydalı ömür girilmedi; amortisman hesaplanmadı (vergi yüksek çıkar).";

/** "3 varlığın faydalı ömrü girilmedi; amortisman hesaplanmadı (vergi yüksek çıkar)." */
export const lifeMissingText = (n: number) => `${n} varlığın faydalı ömrü girilmedi; amortisman hesaplanmadı (vergi yüksek çıkar).`;

const quarterOfDay = (day: string) => quarterOfMonth(day.slice(0, 7));

/** Yılın payını hesap dönemindeki çeyreklere dağıtır */
function splitYear(amount: number, year: number, firstQ: number, method: QuarterDepreciation, settings: Pick<TaxSettings, "periodStart">): Map<string, number> {
  const out = new Map<string, number>();
  const qs = periodQuarters(year, settings).filter((x) => x.q >= firstQ);
  if (!qs.length) return out;
  if (method === "kalan") {
    const each = r2(amount / qs.length);
    qs.forEach((x, i) => out.set(x.key, i === qs.length - 1 ? r2(amount - each * (qs.length - 1)) : each));
    return out;
  }
  // Kümülatif ay ÷ 12: çeyrek sonu kümülatif payı, çeyreğin payı farktır (ilk çeyrek kendinden öncekini de alır)
  let prev = 0;
  for (const x of qs) {
    const cum = x.q === 4 ? amount : r2((amount * 3 * x.q) / 12);
    out.set(x.key, r2(cum - prev));
    prev = cum;
  }
  return out;
}

/** Varlığın amortismanı (§3.3) */
export function depreciation(asset: Pick<TaxAsset, "acquiredOn" | "cost" | "method" | "lifeYears">, method: QuarterDepreciation, settings: Pick<TaxSettings, "periodStart">): Depreciation {
  if (asset.method === "dogrudan_gider") return { years: [], quarters: new Map(), direct: { month: asset.acquiredOn.slice(0, 7), amount: asset.cost }, warning: null };
  if (!asset.lifeYears || asset.lifeYears < 1) return { years: [], quarters: new Map(), direct: null, warning: LIFE_MISSING_WARNING };
  const y0 = Number(asset.acquiredOn.slice(0, 4));
  const annual = r2(asset.cost / asset.lifeYears);
  const years: { year: number; amount: number }[] = [];
  let left = asset.cost;
  for (let i = 0; i < asset.lifeYears; i++) {
    const amount = i === asset.lifeYears - 1 ? r2(left) : Math.min(annual, r2(left));
    years.push({ year: y0 + i, amount });
    left = r2(left - amount);
  }
  const q0 = Number(quarterOfDay(asset.acquiredOn).slice(-1));
  const quarters = new Map<string, number>();
  for (const { year, amount } of years) {
    for (const [k, v] of splitYear(amount, year, year === y0 ? q0 : 1, method, settings)) quarters.set(k, v);
  }
  return { years, quarters, direct: null, warning: null };
}

/** Doğrudan gider yalnız KDV hariç 12.000 ₺'ye kadar (VUK 313) */
export function directExpenseAllowed(cost: number, rules: TaxYearRules): boolean {
  return cost <= rules.vuk.dogrudanGider.value + 1e-9;
}

/** Faturaya bağlı varlıkların maliyet toplamı, faturaya göre */
export function allocatedByInvoice(assets: readonly Pick<TaxAsset, "invoiceId" | "cost">[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const a of assets) if (a.invoiceId !== null) out.set(a.invoiceId, r2((out.get(a.invoiceId) ?? 0) + a.cost));
  return out;
}

export interface AssetYearTotals {
  /** Yılın çeyreklerine düşen amortisman */
  depreciation: Map<string, number>;
  /** Yılın amortismanı */
  yearDepreciation: number;
  /** Doğrudan gider yazılan demirbaş, edinilen çeyreğe */
  direct: Map<string, number>;
  /** Ömrü girilmemiş varlıklar: sayısı ve edinildiği çeyreğe maliyeti (alt sınır bunları gider sayar, K13) */
  missingLife: { count: number; cost: Map<string, number> };
  warnings: string[];
}

/** Yılın amortisman toplamları (geçici vergi ve kurumlar vergisi) */
export function assetTotals(assets: readonly TaxAsset[], year: number, settings: Pick<TaxSettings, "periodStart" | "quarterDepreciation">): AssetYearTotals {
  const depreciationQ = new Map<string, number>();
  const direct = new Map<string, number>();
  const missingCost = new Map<string, number>();
  let missing = 0;
  let yearDepreciation = 0;
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, r2((m.get(k) ?? 0) + v));
  for (const a of assets) {
    const d = depreciation(a, settings.quarterDepreciation, settings);
    for (const [k, v] of d.quarters) if (k.startsWith(`${year}-`)) add(depreciationQ, k, v);
    yearDepreciation = r2(yearDepreciation + (d.years.find((y) => y.year === year)?.amount ?? 0));
    if (d.direct && d.direct.month.startsWith(`${year}-`)) add(direct, quarterOfMonth(d.direct.month), d.direct.amount);
    if (d.warning) {
      missing++;
      if (a.acquiredOn.startsWith(`${year}-`)) add(missingCost, quarterOfDay(a.acquiredOn), a.cost);
    }
  }
  return { depreciation: depreciationQ, yearDepreciation, direct, missingLife: { count: missing, cost: missingCost }, warnings: missing ? [lifeMissingText(missing)] : [] };
}

export interface AssetRow {
  asset: TaxAsset;
  /** Bu yılın amortismanı, yıl sonuna kadar birikmiş ve net değer (doğrudan giderde maliyet o yıl gider) */
  thisYear: number;
  accumulated: number;
  netValue: number;
  quarters: Map<string, number>;
  warning: string | null;
}

/** Demirbaş listesinin satırları */
export function assetRows(assets: readonly TaxAsset[], year: number, settings: Pick<TaxSettings, "periodStart" | "quarterDepreciation">): AssetRow[] {
  return [...assets]
    .sort((a, b) => a.acquiredOn.localeCompare(b.acquiredOn) || a.id - b.id)
    .map((asset) => {
      const d = depreciation(asset, settings.quarterDepreciation, settings);
      const direct = d.direct && Number(d.direct.month.slice(0, 4)) <= year ? d.direct.amount : 0;
      const thisYear = d.direct ? (d.direct.month.startsWith(`${year}-`) ? d.direct.amount : 0) : (d.years.find((y) => y.year === year)?.amount ?? 0);
      const accumulated = r2(direct + d.years.filter((y) => y.year <= year).reduce((s, y) => s + y.amount, 0));
      return { asset, thisYear, accumulated, netValue: r2(asset.cost - accumulated), quarters: d.quarters, warning: d.warning };
    });
}

const supplierKey = (s: string) => normalizeSupplier(s).toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
const net = (i: Pick<Invoice, "amount" | "discount">) => r2(i.amount - i.discount);

/** Demirbaş adayı olamayan kategoriler: mal, komisyon, kira, kafe dışı ve zaten demirbaş olanlar */
export function candidateCategory(category: string): boolean {
  return !GOODS_CATEGORIES.includes(category) && category !== COMMISSION_CATEGORY && category !== RENT_CATEGORY && category !== ASSET_CATEGORY && !SEPARATE_CATEGORIES.includes(category);
}

export interface AssetCandidate {
  invoice: Invoice;
  /** KDV hariç, iskonto düşülmüş */
  net: number;
}

/**
 * "Demirbaş olabilir" (K12): kategorisi uygun, KDV hariç 12.000 ₺'yi aşan, aynı tedarikçiden aynı kategoride önceki 90
 * günde faturası olmayan, karar verilmemiş ("Gider (demirbaş değil)") ve bir varlığa bağlanmamış fatura
 */
export function assetCandidates(invoices: readonly Invoice[], assets: readonly Pick<TaxAsset, "invoiceId" | "cost">[], rules: TaxYearRules): AssetCandidate[] {
  const linked = allocatedByInvoice(assets);
  const limit = rules.vuk.dogrudanGider.value;
  const out: AssetCandidate[] = [];
  for (const inv of invoices) {
    const n = net(inv);
    if (!candidateCategory(inv.category) || n <= limit || inv.taxNotAsset || linked.has(inv.id)) continue;
    const key = supplierKey(inv.supplier);
    const recent = invoices.some((o) => o !== inv && o.category === inv.category && supplierKey(o.supplier) === key && o.date < inv.date && daysBetween(o.date, inv.date) <= 90);
    if (!recent) out.push({ invoice: inv, net: n });
  }
  return out.sort((a, b) => a.invoice.date.localeCompare(b.invoice.date) || a.invoice.id - b.invoice.id);
}

/** "Gider (demirbaş değil)" denen faturalar */
export function decidedNotAsset(invoices: readonly Invoice[]): Invoice[] {
  return invoices.filter((i) => i.taxNotAsset);
}

/** Kuruluş & Demirbaş faturalarının varlık listesine eklenmemiş (eşlenmemiş) kısmı */
export function unlistedAssetInvoices(invoices: readonly Invoice[], assets: readonly Pick<TaxAsset, "invoiceId" | "cost">[]): { invoice: Invoice; remaining: number }[] {
  const linked = allocatedByInvoice(assets);
  return invoices
    .filter((i) => i.category === ASSET_CATEGORY)
    .map((invoice) => ({ invoice, remaining: r2(net(invoice) - (linked.get(invoice.id) ?? 0)) }))
    .filter((x) => x.remaining > 0.005)
    .sort((a, b) => a.invoice.date.localeCompare(b.invoice.date) || a.invoice.id - b.invoice.id);
}

/** Faturanın kalan (varlığa bağlanmamış) tutarı: varlık eklerken en çok bu kadar (§4.5-c) */
export function invoiceRemaining(invoice: Pick<Invoice, "id" | "amount" | "discount">, assets: readonly Pick<TaxAsset, "id" | "invoiceId" | "cost">[], exceptAssetId?: number): number {
  return r2(net(invoice) - assets.filter((a) => a.invoiceId === invoice.id && a.id !== exceptAssetId).reduce((s, a) => s + a.cost, 0));
}

/** Varlığın künyesindeki fatura: "XND Teknoloji · 13.07.2026 · 338.169,58" */
export function invoiceLabelOf(invoice: Pick<Invoice, "supplier" | "date" | "amount" | "discount">): string {
  return `${invoice.supplier} · ${dateTR(invoice.date)} · ${num(net(invoice), 2, 2)}`;
}

/** Künyeyi okur; bozuksa null */
export function parseInvoiceLabel(label: string | null): { supplier: string; date: string; amount: number } | null {
  const m = /^(.*) · (\d{2})\.(\d{2})\.(\d{4}) · (-?[\d.]+,\d{2})$/.exec(label ?? "");
  if (!m) return null;
  return { supplier: m[1], date: `${m[4]}-${m[3]}-${m[2]}`, amount: Number(m[5].replace(/\./g, "").replace(",", ".")) };
}

export const ORPHAN_ASSET_WARNING = "Faturası Paraşüt'te iptal edildi: yeni faturaya bağlayın";

/** Faturası silinen varlığın aday faturaları: aynı tedarikçi, ±%5 tutar, ±60 gün (§3.3) */
export function relinkCandidates(asset: Pick<TaxAsset, "invoiceId" | "invoiceLabel" | "cost" | "acquiredOn">, invoices: readonly Invoice[]): Invoice[] {
  if (asset.invoiceId !== null) return [];
  const label = parseInvoiceLabel(asset.invoiceLabel);
  if (!label) return [];
  const key = supplierKey(label.supplier);
  return invoices
    .filter((i) => supplierKey(i.supplier) === key && Math.abs(net(i) - label.amount) <= Math.abs(label.amount) * 0.05 + 0.005 && Math.abs(daysBetween(label.date, i.date)) <= 60)
    .sort((a, b) => Math.abs(daysBetween(label.date, a.date)) - Math.abs(daysBetween(label.date, b.date)) || a.id - b.id);
}

export interface OrphanAsset {
  asset: TaxAsset;
  candidates: Invoice[];
  /** Aday faturaların vergi hesabında şimdi gider sayılan tutarı (bağlanana kadar çift sayılan) */
  doubleCounted: number;
}

/**
 * Faturası silinen varlıklar ve adayları. Aday fatura yalnız tamamı gider sayılıyorsa çift sayılır: demirbaş ve kafe dışı
 * kategoride değil, bir varlığa bağlı değil, "demirbaş olabilir" (karar verilmemiş; `notExpense`) değil ve hesap
 * döneminin içinde (§3.3)
 */
export function orphanAssets(assets: readonly TaxAsset[], invoices: readonly Invoice[], opts: { notExpense?: ReadonlySet<number>; periodStart?: string } = {}): OrphanAsset[] {
  const linked = allocatedByInvoice(assets);
  const counted = (i: Invoice) =>
    i.category !== ASSET_CATEGORY && !linked.has(i.id) && !SEPARATE_CATEGORIES.includes(i.category) && !opts.notExpense?.has(i.id) && (!opts.periodStart || i.date >= opts.periodStart);
  return assets
    .filter((a) => a.invoiceId === null && a.invoiceLabel)
    .map((asset) => {
      const candidates = relinkCandidates(asset, invoices);
      const doubleCounted = r2(candidates.filter(counted).reduce((s, i) => s + net(i), 0));
      return { asset, candidates, doubleCounted };
    });
}
