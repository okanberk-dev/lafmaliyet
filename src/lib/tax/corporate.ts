/**
 * Geçici ve kurumlar vergisi (plan docs/planlar/vergi.md §3.7, §3.8, K21): kafenin geçici vergi matrahına ve kurumlar
 * vergisine katkısı, kümülatif. Muhasebecinin kayıtları (`tax_filings`) tahminin yerine geçer; matrahı girilen kayıt
 * sonraki dönemin çapasıdır. Saf modül; tests/vergi-kurumlar.test.ts.
 */

import { r2, rulesFor } from "./rules";
import type { TaxSettings } from "./settings";
import { geciciStamp, type KvStamps, kvStamps } from "./stamp";

/** Muhasebecinin kaydının türü: geçici vergi, kurumlar vergisi, muhtasar ve prim hizmet, KDV beyannamesi satışları */
export type TaxFilingKind = "gecici" | "kv" | "mphb" | "kdv_matrah";

/** Geçici vergi kaydının isteğe bağlı alanları; ikisi birlikte çapa */
export interface GeciciValues {
  matrah?: number;
  hesaplanan?: number;
}
export interface KvValues {
  matrah?: number;
  hesaplanan?: number;
  mahsup?: number;
  iade?: number;
  devredenZarar?: number;
}
export interface MphbValues {
  ucretGv?: number;
  ucretDv?: number;
  kiraStopaj?: number;
  smStopaj?: number;
  digerStopaj?: number;
}
/** KDV beyannamesindeki satış matrahları (KDV hariç) ve muhasebecinin söylediği kafe dışı kısmı */
export interface KdvMatrahValues {
  m1?: number;
  m10: number;
  m20: number;
  istisna?: number;
  kafeDisi?: number;
}

export type TaxFilingValues = GeciciValues | KvValues | MphbValues | KdvMatrahValues;

/** tax_filings satırı */
export interface TaxFiling {
  id: number;
  kind: TaxFilingKind;
  /** "2026-Q3" | "2026" | "2026-09" */
  period: string;
  /** Ödenecek vergi; KDV beyannamesi satışlarında 0 */
  payable: number;
  stamp: number;
  values: Readonly<Record<string, number | undefined>>;
  note?: string | null;
  enteredByName?: string | null;
  updatedAt?: string | null;
}

export const FILING_KIND_LABELS: Record<TaxFilingKind, string> = {
  gecici: "Geçici vergi",
  kv: "Kurumlar vergisi",
  mphb: "Muhtasar ve prim hizmet",
  kdv_matrah: "KDV beyannamesi satışları",
};

/** Türün ve dönemin kaydı */
export function filingFor(filings: readonly TaxFiling[], kind: TaxFilingKind, period: string): TaxFiling | null {
  return filings.find((f) => f.kind === kind && f.period === period) ?? null;
}

/** Kaydın sayısal alanı (yoksa undefined) */
export function filingValue(f: Pick<TaxFiling, "values">, key: string): number | undefined {
  const v = f.values[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

// ---------------------------------------------------------------- Geçici vergi (§3.7)

/** Çeyreğin hesaba giren rakamları (pnl.ts taxQuarters'ın QuarterPnl'ı bunu karşılar) */
export interface CorpQuarterInput {
  key: string;
  q: number;
  from: string;
  to: string;
  /** Ayların sonucu: gelir − gider (çeyrek sonu stoğu düzeltmesi dahil) */
  result: number;
  depreciation: number;
  direct: number;
  kkeg: number;
  indirim: number;
  /** Alt sınırla sonuç (K13) */
  floorResult: number;
  state: "taslak" | "hazir";
}

export interface CorpInput {
  year: number;
  /** Yılın hesap dönemindeki çeyrekleri sırasıyla */
  quarters: readonly CorpQuarterInput[];
  filings: readonly TaxFiling[];
  settings: Pick<TaxSettings, "firstActivity" | "periodStart" | "carriedLoss" | "overrides">;
  /** "Ödendi" işaretli geçici vergi dönemleri ve Ödendi anındaki hatırlatıcı tutarı (payments.vat-paid, tür gecici) */
  paidQuarters?: readonly { period: string; amount: number | null }[];
  today: string;
}

/** Asgari kurumlar vergisinin durumu (K10) */
export type MinTaxStatus = "muaf" | "uygulandi" | "bilinmiyor";

export interface QuarterCalc {
  key: string;
  q: number;
  /** Kümülatif dönem: hesap döneminin başından çeyreğin sonuna */
  from: string;
  to: string;
  complete: boolean;
  state: "taslak" | "hazir";
  /** Çeyreğin dönem sonucu: sonuç − amortisman − doğrudan gider + indirilemeyen gider */
  periodResult: number;
  depreciation: number;
  direct: number;
  kkeg: number;
  /** Kümülatif kurum kazancı (çapa varsa çapanın matrahından) */
  cumulative: number;
  /** Düşülen devreden zarar ve kümülatif indirim */
  loss: number;
  indirim: number;
  matrah: number;
  hesaplanan: number;
  /** Asgari kurumlar vergisi; muaf yılda null */
  asgari: number | null;
  minTax: MinTaxStatus;
  cumulativeTax: number;
  /** Önceki dönemler (çapanın hesaplanan vergisi + aradaki ödenecekler ya da önceki ödenecekler) */
  previous: number;
  /** Kafenin katkısı: bu dönemin tahmini ödenecek vergisi */
  estimate: number;
  stamp: number;
  stampEstimated: boolean;
  /** Muhasebecinin kaydı (varsa tahminin yerine geçer) */
  filing: TaxFiling | null;
  source: "Muhasebeci" | "tahmin";
  /** Ödenecek: kayıt varsa onun ödenecek tutarı, değilse tahmin */
  payable: number;
  /** Kullanılan çapa (önceki bir dönemin matrahlı kaydı) */
  anchor: { period: string; matrah: number; hesaplanan: number } | null;
  /** Kayıt var ama matrahı girilmedi: sonraki tahmin panelin verisiyle */
  noAnchor: boolean;
  /** Alt sınırla aynı hesap (K13; yalnız "Nasıl hesaplandı"da) */
  floor: { cumulative: number; matrah: number; estimate: number };
}

/** Asgari vergi uygulanır mı: ilk defa faaliyete başlayan şirkette başladığı yıl dahil 3 hesap dönemi muaf (KVK 32/C/5) */
export function minTaxApplies(year: number, settings: Pick<TaxSettings, "firstActivity" | "periodStart">, muafDonem = 3): boolean {
  const start = Number(settings.periodStart.slice(0, 4));
  return settings.firstActivity !== "ilk" || year > start + muafDonem - 1;
}

/** Asgari vergi satırının metni */
export function minTaxText(year: number, settings: Pick<TaxSettings, "firstActivity" | "periodStart">): string {
  const start = Number(settings.periodStart.slice(0, 4));
  if (!minTaxApplies(year, settings)) return `Asgari kurumlar vergisi: uygulanmaz (ilk 3 hesap dönemi, ${start}–${start + 2})`;
  if (settings.firstActivity === null) return "Asgari kurumlar vergisi: uygulandı; muafiyet için ilk defa faaliyete başlama işaretlenmedi (Kurallar › Vergi ayarları)";
  if (settings.firstActivity === "devir") return "Asgari kurumlar vergisi: uygulandı (birleşme, devir, bölünme ya da tür değişikliğiyle kurulan şirkette muafiyet yok)";
  return "Asgari kurumlar vergisi: uygulandı (ilk 3 hesap dönemi geçti)";
}

/** Önceki yıllardan devreden zarar: önceki yılın kurumlar vergisi kaydı, yoksa elle girilen (tek alan) */
export function carriedLossFor(year: number, filings: readonly TaxFiling[], settings: Pick<TaxSettings, "carriedLoss">): number {
  const prev = filingFor(filings, "kv", String(year - 1));
  const v = prev ? filingValue(prev, "devredenZarar") : undefined;
  return v ?? settings.carriedLoss?.amount ?? 0;
}

/** Yılın geçici vergi dönemleri, kümülatif (§3.7) */
export function quarterTaxes(input: CorpInput): QuarterCalc[] {
  const { rules } = rulesFor(input.year, input.settings.overrides);
  const oran = rules.gecici.oran.value;
  const asgariOran = rules.kv.asgariOran.value;
  const applies = minTaxApplies(input.year, input.settings, rules.kv.asgariMuafDonem.value);
  const minTax: MinTaxStatus = !applies ? "muaf" : input.settings.firstActivity === null ? "bilinmiyor" : "uygulandi";
  const carried = carriedLossFor(input.year, input.filings, input.settings);
  const periodFrom = input.quarters[0]?.from ?? `${input.year}-01-01`;
  const out: QuarterCalc[] = [];
  const periodResult = (x: CorpQuarterInput, floor = false) => r2((floor ? x.floorResult : x.result) - x.depreciation - x.direct + x.kkeg);

  const calc = (i: number, floor: boolean) => {
    const x = input.quarters[i];
    // Çapa: önceki dönemlerin en sonuncusunun matrahlı kaydı
    let anchorIdx = -1;
    let anchorF: TaxFiling | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const f = filingFor(input.filings, "gecici", input.quarters[j].key);
      if (f && filingValue(f, "matrah") !== undefined) {
        anchorIdx = j;
        anchorF = f;
        break;
      }
    }
    const since = input.quarters.slice(anchorIdx + 1, i + 1);
    const anchorMatrah = anchorF ? filingValue(anchorF, "matrah")! : 0;
    const anchorTax = anchorF ? (filingValue(anchorF, "hesaplanan") ?? r2(Math.max(0, anchorMatrah) * oran)) : 0;
    const cumulative = r2(anchorMatrah + since.reduce((s, r) => s + periodResult(r, floor), 0));
    const indirim = r2(since.reduce((s, r) => s + r.indirim, 0));
    const loss = Math.min(Math.max(0, cumulative), carried);
    const matrah = Math.max(0, r2(cumulative - loss - indirim));
    const hesaplanan = r2(matrah * oran);
    const asgari = applies ? r2(Math.max(0, cumulative) * asgariOran) : null;
    const cumulativeTax = Math.max(hesaplanan, asgari ?? 0);
    let previous = anchorTax;
    for (let j = anchorIdx + 1; j < i; j++) previous = r2(previous + out[j].payable);
    if (!anchorF) previous = r2(input.quarters.slice(0, i).reduce((s, _r, j) => s + out[j].payable, 0));
    const estimate = Math.max(0, r2(cumulativeTax - previous));
    return { x, anchorF, anchorMatrah, anchorTax, cumulative, indirim, loss, matrah, hesaplanan, asgari, cumulativeTax, previous, estimate };
  };

  for (let i = 0; i < input.quarters.length; i++) {
    const c = calc(i, false);
    const fl = calc(i, true);
    const x = c.x;
    const filing = filingFor(input.filings, "gecici", x.key);
    const stamp = geciciStamp(x.key, input.settings.overrides);
    out.push({
      key: x.key,
      q: x.q,
      from: periodFrom,
      to: x.to,
      complete: x.to < input.today,
      state: x.state,
      periodResult: periodResult(x),
      depreciation: x.depreciation,
      direct: x.direct,
      kkeg: x.kkeg,
      cumulative: c.cumulative,
      loss: c.loss,
      indirim: c.indirim,
      matrah: c.matrah,
      hesaplanan: c.hesaplanan,
      asgari: c.asgari,
      minTax,
      cumulativeTax: c.cumulativeTax,
      previous: c.previous,
      estimate: c.estimate,
      stamp: filing ? filing.stamp : stamp.amount,
      stampEstimated: !filing && stamp.estimated,
      filing,
      source: filing ? "Muhasebeci" : "tahmin",
      payable: filing ? filing.payable : c.estimate,
      anchor: c.anchorF ? { period: c.anchorF.period, matrah: c.anchorMatrah, hesaplanan: c.anchorTax } : null,
      noAnchor: filing !== null && filingValue(filing, "matrah") === undefined,
      floor: { cumulative: fl.cumulative, matrah: fl.matrah, estimate: fl.estimate },
    });
  }
  return out;
}

// ---------------------------------------------------------------- Kurumlar vergisi (§3.8)

export interface YearCalc {
  year: number;
  /** Yıl sürüyor: bugüne kadarki kârla (yıl sonu tahmini değil) */
  inProgress: boolean;
  /** Son çeyreğin kümülatif kazancı ya da muhasebecinin kaydının matrahı */
  income: number;
  loss: number;
  carried: number;
  indirim: number;
  matrah: number;
  hesaplanan: number;
  asgari: number | null;
  minTax: MinTaxStatus;
  /** Asgari kurumlar vergisi hesaplanandan büyük: KV asgaridir */
  minTaxBinding: boolean;
  tax: number;
  /** Mahsup edilecek geçici vergi: yalnız "Ödendi" işaretli dönemler */
  paidProvisional: number;
  paidQuarters: { period: string; amount: number }[];
  /** Ödenecek ya da iade / mahsup alacağı */
  payable: number;
  refund: number;
  /** Oluşan mali zarar (sonraki 5 yılın kazancından düşülür) */
  newLoss: number;
  /** Ödendi işaretlenmemiş, tutarı olan dönemler */
  unpaid: { period: string; amount: number }[];
  stamps: KvStamps;
  filing: TaxFiling | null;
  source: "Muhasebeci" | "tahmin";
  quarters: QuarterCalc[];
}

/** "2026/3 ödendi olarak işaretlenmedi: ödenmezse yıllık beyannamede mahsup edilemez." */
export const unpaidText = (period: string) => `${period.replace("-Q", "/")} ödendi olarak işaretlenmedi: ödenmezse yıllık beyannamede mahsup edilemez.`;

export function corporateTax(input: CorpInput, quarters: QuarterCalc[] = quarterTaxes(input)): YearCalc {
  const { rules } = rulesFor(input.year, input.settings.overrides);
  const last = quarters.at(-1);
  const filing = filingFor(input.filings, "kv", String(input.year));
  const carried = carriedLossFor(input.year, input.filings, input.settings);
  const fMatrah = filing ? filingValue(filing, "matrah") : undefined;
  const income = fMatrah ?? last?.cumulative ?? 0;
  const indirim = fMatrah !== undefined ? 0 : (last?.indirim ?? 0);
  const loss = Math.min(Math.max(0, income), carried);
  const matrah = Math.max(0, r2(income - loss - indirim));
  const hesaplanan = filing && filingValue(filing, "hesaplanan") !== undefined ? filingValue(filing, "hesaplanan")! : r2(matrah * rules.kv.oran.value);
  const applies = minTaxApplies(input.year, input.settings, rules.kv.asgariMuafDonem.value);
  const asgari = applies ? r2(Math.max(0, income) * rules.kv.asgariOran.value) : null;
  const tax = Math.max(hesaplanan, asgari ?? 0);
  const paidSet = new Map((input.paidQuarters ?? []).map((p) => [p.period, p.amount]));
  const paidQuarters: { period: string; amount: number }[] = [];
  const unpaid: { period: string; amount: number }[] = [];
  for (const q of quarters) {
    const amount = q.filing ? q.filing.payable : paidSet.has(q.key) ? (paidSet.get(q.key) ?? q.estimate) : q.estimate;
    if (paidSet.has(q.key)) paidQuarters.push({ period: q.key, amount });
    else if (amount > 0.005) unpaid.push({ period: q.key, amount });
  }
  const paidProvisional = r2(paidQuarters.reduce((s, p) => s + p.amount, 0));
  const stamps = kvStamps(input.year, input.settings.overrides);
  return {
    year: input.year,
    inProgress: input.today <= `${input.year}-12-31`,
    income,
    loss,
    carried,
    indirim,
    matrah,
    hesaplanan,
    asgari,
    minTax: !applies ? "muaf" : input.settings.firstActivity === null ? "bilinmiyor" : "uygulandi",
    minTaxBinding: asgari !== null && asgari > hesaplanan,
    tax,
    paidProvisional,
    paidQuarters,
    payable: filing ? filing.payable : Math.max(0, r2(tax - paidProvisional)),
    refund: filing ? (filingValue(filing, "iade") ?? 0) : Math.max(0, r2(paidProvisional - tax)),
    newLoss: income < 0 ? r2(-income) : 0,
    unpaid,
    stamps: filing ? { ...stamps, total: filing.stamp } : stamps,
    filing,
    source: filing ? "Muhasebeci" : "tahmin",
    quarters,
  };
}
