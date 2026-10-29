/**
 * Muhtasar ve prim hizmet beyannamesinin vergi kısmı (plan docs/planlar/vergi.md §3.5, K20): ücretin gelir ve damga
 * vergisi (bordro, payroll.ts), sabit giderin stopaj profiline göre stopaj (tutar brüt kabul edilir) ve beyanname
 * damgası; ay P'nin beyannamesi P+1'in 26'sında. Faturalardaki stopaj Paraşüt'ten okunmadığı için profili seçilmemiş
 * kira, reklam ya da dışarıdan hizmet kalemi varsa tutar "en az"dır. Yurt dışına ödenen hizmetin KDV'si (sorumlu
 * sıfatıyla) ayrıca KDV-2'yle ödenir. Muhasebecinin kaydı tahminin yerine geçer. Saf modül; tests/vergi-muhtasar.test.ts.
 */

import type { Model } from "../calc/engine";
import { fixedMonthly, shiftMonth } from "../calc/engine";
import type { FixedSection } from "../calc/types";
import { PANEL_GROUP_KEYWORDS } from "../constants";

import { legalDueDate, monthName, nominalDue } from "./calendar";
import { filingFor, filingValue, type TaxFiling } from "./corporate";
import type { PayrollMonth } from "./payroll";
import { r2, rulesFor, type TaxDoc, type TaxOverrides, type Withholding, withholdingKdv2, withholdingRate, WITHHOLDING_LABELS } from "./rules";
import { muhtasarStamp } from "./stamp";

/** Ayın muhtasara giren sabit gider ve harcama kalemleri (brüt tutar) */
export interface MuhtasarItem {
  id: number | null;
  name: string;
  section: FixedSection | "mal";
  /** Ayda ödenen brüt tutar */
  amount: number;
  withholding: Withholding | null;
  doc: TaxDoc | null;
  /** Aylık harcama kategorisi (stopaj profili seçilemez; sınıflandırılmazsa bilinmeyen) */
  category?: boolean;
  /** Kategorinin Genel bakış grubu (reklam) */
  panelGroup?: string | null;
}

export interface MuhtasarMonthInput {
  /** YYYY-MM */
  period: string;
  payroll?: PayrollMonth;
  items: readonly MuhtasarItem[];
}

export interface MuhtasarMonth {
  period: string;
  nominal: string;
  due: string;
  people: number;
  ucretGv: number;
  ucretDv: number;
  stopaj: { id: number | null; name: string; withholding: Withholding; base: number; rate: number; amount: number }[];
  stopajTotal: number;
  /** Stopajı bilinmeyen kalemler (ad) */
  unknown: string[];
  /** Sorumlu sıfatıyla KDV (KDV-2'de ödenir) ve kalemleri */
  kdv2Hizmet: number;
  kdv2Items: { name: string; base: number; amount: number }[];
  /** Ayın kendi vergisi (ücret GV + DV + stopaj) */
  vergi: number;
  /** Bu beyannamede ödenecek vergi: üç aylıkta ara aylarda 0, çeyrek sonunda üç ayın toplamı */
  vergiPayable: number;
  /** Üç aylık seçenekte vergi çeyrek sonuna kaldı */
  deferred: boolean;
  damga: number;
  damgaKind: "mphb" | "muhtasar" | null;
  /** Damga tutarı açıklanmamış yılın (en son bilinen yılın tutarı) */
  stampEstimated: boolean;
  /** Ödenecek: vergi + damga; muhasebeci kaydı varsa onun ödenecek + damgası */
  payable: number;
  /** Stopajı bilinmeyen kalem var: tutar "en az" */
  atLeast: boolean;
  filing: TaxFiling | null;
  source: "Muhasebeci" | "tahmin";
  /** Beyanname yok: personel yok, vergi yok, stopajı bilinmeyen kalem yok, kayıt yok */
  empty: boolean;
}

/** Türkçe küçük harf, ı → i, aksansız: anahtar kelime aramak için (calc/insights.ts foldKey ile aynı) */
const foldKey = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFKD").replace(/[̀-ͯ]/g, "");

/**
 * Stopajı bilinmeyen kalem: profili seçilmemiş; Paraşüt faturası, bordro ya da belgesiz değil; kira bölümünde (ortak
 * gider, aidat, avans hariç) ya da adı kira, reklam veya dışarıdan hizmet (muhasebe, avukat, danışman) anahtar
 * kelimelerine uyan. Aylık harcama kategorisinde reklam grubu da (sabit giderden çevrilen reklam "en az"dan düşmesin)
 */
export function withholdingUnknown(item: MuhtasarItem): boolean {
  if (item.withholding !== null || item.doc === "fatura" || item.doc === "bordro" || item.doc === "yok" || !(item.amount > 0)) return false;
  const n = foldKey(item.name);
  const K = PANEL_GROUP_KEYWORDS;
  if (K.notKira.test(n) && (item.section === "kira" || K.kira.test(n))) return false;
  return item.section === "kira" || K.kira.test(n) || K.reklam.test(n) || K.notPersonel.test(n) || (item.category === true && item.panelGroup === "reklam");
}

interface Own {
  ucretGv: number;
  ucretDv: number;
  stopaj: MuhtasarMonth["stopaj"];
  unknown: string[];
  kdv2Items: MuhtasarMonth["kdv2Items"];
  people: number;
  vergi: number;
}

function own(input: MuhtasarMonthInput, overrides?: TaxOverrides): Own {
  const { rules } = rulesFor(Number(input.period.slice(0, 4)), overrides);
  const t = input.payroll?.totals;
  const stopaj: MuhtasarMonth["stopaj"] = [];
  const kdv2Items: MuhtasarMonth["kdv2Items"] = [];
  const unknown: string[] = [];
  for (const it of input.items) {
    if (it.withholding) {
      const rate = withholdingRate(it.withholding, rules);
      if (rate > 0 && it.amount > 0) stopaj.push({ id: it.id, name: it.name, withholding: it.withholding, base: it.amount, rate, amount: r2(it.amount * rate) });
      const k2 = withholdingKdv2(it.withholding, rules);
      if (k2 > 0 && it.amount > 0) kdv2Items.push({ name: it.name, base: it.amount, amount: r2(it.amount * k2) });
    } else if (withholdingUnknown(it)) unknown.push(it.name);
  }
  const ucretGv = t?.gv ?? 0;
  const ucretDv = t?.dv ?? 0;
  const stopajTotal = r2(stopaj.reduce((s, x) => s + x.amount, 0));
  return { ucretGv, ucretDv, stopaj, unknown, kdv2Items, people: t?.people ?? 0, vergi: r2(ucretGv + ucretDv + stopajTotal) };
}

const QUARTER_END = new Set(["03", "06", "09", "12"]);

/**
 * Ay P'nin muhtasarı. Üç aylık seçenekte (`quarterly`) vergi kısmı Mart, Haziran, Eylül ve Aralık'ta üç ayın toplamı
 * olarak ödenir, ara aylarda yalnız damga; `quarterMonths` çeyreğin önceki aylarının girdileri.
 */
export function muhtasarMonth(
  input: MuhtasarMonthInput,
  opts: { filings?: readonly TaxFiling[]; overrides?: TaxOverrides; quarterly?: boolean; quarterMonths?: readonly MuhtasarMonthInput[] } = {},
): MuhtasarMonth {
  const o = own(input, opts.overrides);
  const quarterEnd = QUARTER_END.has(input.period.slice(5, 7));
  const deferred = Boolean(opts.quarterly) && !quarterEnd;
  let vergiPayable = deferred ? 0 : o.vergi;
  let unknown = o.unknown;
  if (opts.quarterly && quarterEnd) {
    for (const m of opts.quarterMonths ?? []) {
      const x = own(m, opts.overrides);
      vergiPayable = r2(vergiPayable + x.vergi);
      unknown = [...new Set([...unknown, ...x.unknown])];
    }
  }
  const stamp = muhtasarStamp(input.period, o.people > 0, vergiPayable > 0, opts.overrides);
  const filing = filingFor(opts.filings ?? [], "mphb", input.period);
  const nominal = nominalDue("mphb", input.period);
  const estimate = r2(vergiPayable + stamp.amount);
  return {
    period: input.period,
    nominal,
    due: legalDueDate(nominal).date,
    people: o.people,
    ucretGv: o.ucretGv,
    ucretDv: o.ucretDv,
    stopaj: o.stopaj,
    stopajTotal: r2(o.stopaj.reduce((s, x) => s + x.amount, 0)),
    unknown,
    kdv2Hizmet: r2(o.kdv2Items.reduce((s, x) => s + x.amount, 0)),
    kdv2Items: o.kdv2Items,
    vergi: o.vergi,
    vergiPayable,
    deferred,
    damga: filing ? filing.stamp : stamp.amount,
    damgaKind: stamp.kind,
    stampEstimated: stamp.estimated,
    payable: filing ? r2(filing.payable + filing.stamp) : estimate,
    atLeast: !filing && unknown.length > 0,
    filing,
    source: filing ? "Muhasebeci" : "tahmin",
    // Stopajı bilinmeyen kalem varsa beyanname olabilir: satır "en az" ya da tutarı bilinmiyor diye kalır (§3.5, §13)
    empty: !filing && o.people === 0 && vergiPayable === 0 && stamp.amount === 0 && unknown.length === 0,
  };
}

/** Ardışık ayların muhtasarı (üç aylık seçenekte çeyreğin önceki ayları girdilerden) */
export function muhtasarMonths(inputs: readonly MuhtasarMonthInput[], opts: { filings?: readonly TaxFiling[]; overrides?: TaxOverrides; quarterly?: boolean } = {}): Map<string, MuhtasarMonth> {
  const byPeriod = new Map(inputs.map((i) => [i.period, i]));
  const out = new Map<string, MuhtasarMonth>();
  for (const input of [...inputs].sort((a, b) => a.period.localeCompare(b.period))) {
    const prior = [2, 1].map((d) => byPeriod.get(shiftMonth(input.period, -d))).filter((x): x is MuhtasarMonthInput => Boolean(x));
    out.set(input.period, muhtasarMonth(input, { ...opts, quarterMonths: prior }));
  }
  return out;
}

/** "en az 974 ₺; 4 kalemin stopajı bilinmiyor" ya da tutar */
export function unknownText(m: Pick<MuhtasarMonth, "unknown">): string | null {
  return m.unknown.length ? `${m.unknown.length} kalemin stopajı bilinmiyor` : null;
}

/** Muhtasar satırının dökümü (takvim ayrıntısı ve nakit planı notu) */
export function muhtasarBreakdown(m: MuhtasarMonth): { label: string; amount: number; note?: string }[] {
  if (m.filing) {
    const v = (k: string) => filingValue(m.filing!, k);
    const parts: { label: string; amount: number }[] = [];
    for (const [k, label] of [
      ["ucretGv", "Ücret gelir vergisi"],
      ["ucretDv", "Ücret damga vergisi"],
      ["kiraStopaj", "Kira stopajı"],
      ["smStopaj", "Serbest meslek stopajı"],
      ["digerStopaj", "Diğer stopaj"],
    ] as const) {
      const x = v(k);
      if (x !== undefined) parts.push({ label, amount: x });
    }
    return [...parts, { label: "Ödenecek (tahakkuk fişi)", amount: m.filing.payable }, { label: "Beyanname damgası", amount: m.filing.stamp }];
  }
  return [
    { label: "Ücret gelir vergisi", amount: m.ucretGv },
    { label: "Ücret damga vergisi", amount: m.ucretDv },
    ...m.stopaj.map((s) => ({ label: `${s.name}: ${WITHHOLDING_LABELS[s.withholding]}`, amount: s.amount })),
    ...(m.deferred ? [{ label: "Vergi kısmı çeyrek sonunda (üç aylık)", amount: -m.vergi }] : []),
    ...(m.vergiPayable !== m.vergi && !m.deferred ? [{ label: "Çeyreğin önceki ayları (üç aylık)", amount: r2(m.vergiPayable - m.vergi) }] : []),
    { label: m.damgaKind === "muhtasar" ? "Muhtasar beyannamesi damgası" : "Muhtasar ve prim hizmet damgası", amount: m.damga, note: m.stampEstimated ? `${Number(m.nominal.slice(0, 4))} tutarı açıklanmadı` : undefined },
  ];
}

/** Takvim ve nakit planı başlığı: "Muhtasar ve prim hizmet (Eylül)" */
export const muhtasarTitle = (period: string) => `Muhtasar ve prim hizmet (${monthName(period)})`;

/**
 * Modelden ayın muhtasar kalemleri: o ay hesaba giren sabit giderler (Gelir-gider'de elle girildiyse o tutar, değilse
 * aylık karşılık; açık gün oranı uygulanmaz, kira tam ödenir) ve kaydı olan aylık harcama kategorileri
 */
export function muhtasarItemsFromModel(model: Pick<Model, "fixedInMonth" | "pnlMonth" | "settings" | "expenseAmounts">, period: string): MuhtasarItem[] {
  const items: MuhtasarItem[] = [];
  const cells = model.pnlMonth(period).cells;
  for (const f of model.fixedInMonth(period)) {
    const cell = cells.get(`fixed:${f.id}`);
    const amount = cell?.overridden ? (cell.value ?? 0) : fixedMonthly(f, model.settings);
    items.push({ id: f.id, name: f.name, section: f.section, amount: r2(amount), withholding: f.taxWithholding ?? null, doc: f.taxDoc ?? null });
  }
  for (const x of model.expenseAmounts(period)) {
    if (!(x.entries > 0)) continue;
    items.push({ id: x.cat.id, name: x.cat.name, section: x.cat.section, amount: r2(x.entries), withholding: null, doc: x.cat.taxDoc ?? null, category: true, panelGroup: x.cat.panelGroup });
  }
  return items;
}
