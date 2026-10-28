/**
 * Geçici ve kurumlar vergisi (plan docs/planlar/vergi.md §3.7, §3.8, K21): kafenin geçici vergi matrahına ve kurumlar
 * vergisine katkısı, kümülatif. Muhasebecinin kayıtları (`tax_filings`) tahminin yerine geçer; matrahı girilen kayıt
 * sonraki dönemin çapasıdır. Saf modül; tests/vergi-kurumlar.test.ts.
 */

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
