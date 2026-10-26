/*
 * Yazarkasa kartının saf form mantığı (docs/planlar/okc-z.md §3.2; okc-card.tsx çizer, tests/okc-z.test.ts sınar):
 * kayıtlı değerler formun metnine, formun metni kimliklerin girdisine ve gönderime. Zorunluluk kuralının metni
 * sunucuyla aynı (okcFormError); alanı burada bulunur.
 */

import { parseNumberTR } from "@/lib/calc/expr";
import type { CashReportFields } from "@/lib/cash-report";
import { normalizeVat, okcFormError, type OkcFormValues, type OkcVatInput, type OkcVatLine } from "@/lib/okc-z";

/** Yazarkasa tutar alanları (formdaki sırayla); döküm `okcT*` / `okcV*` olarak iki sütunda yazılır */
export const OKC_MONEY_KEYS = ["okcTotal", "okcCash", "okcCard", "okcMealCard", "okcOther", "okcVatTotal", "okcT1", "okcV1", "okcT10", "okcV10", "okcT20", "okcV20"] as const;
export type OkcMoneyKey = (typeof OKC_MONEY_KEYS)[number];
export type OkcKey = OkcMoneyKey | "okcZNo" | "okcReceipts";
export const OKC_KEYS: readonly OkcKey[] = ["okcZNo", "okcReceipts", ...OKC_MONEY_KEYS];
export type OkcValues = Record<OkcKey, string>;

/** Formda alanı olan KDV oranları (%1 satırı yalnız okunduysa ya da yazılıysa görünür) */
export const OKC_RATES_SHOWN = [1, 10, 20] as const;
export const okcTKey = (rate: number) => `okcT${rate}` as OkcMoneyKey;
export const okcVKey = (rate: number) => `okcV${rate}` as OkcMoneyKey;

const text = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Math.round(v * 100) / 100).replace(".", ","));

/** Kayıtlı raporun (ya da bekleyen isteğin) yazarkasa alanları formun metnine */
export function okcValuesOf(r: Partial<CashReportFields> | null): OkcValues {
  const out = Object.fromEntries(OKC_KEYS.map((k) => [k, ""])) as OkcValues;
  if (!r) return out;
  out.okcZNo = r.okcZNo ?? "";
  out.okcReceipts = r.okcReceipts === null || r.okcReceipts === undefined ? "" : String(r.okcReceipts);
  for (const k of ["okcTotal", "okcVatTotal", "okcCash", "okcCard", "okcMealCard", "okcOther"] as const) out[k] = text(r[k]);
  for (const l of r.okcVat ?? []) {
    if (!OKC_RATES_SHOWN.includes(l.rate as (typeof OKC_RATES_SHOWN)[number])) continue;
    out[okcTKey(l.rate)] = text(l.total);
    out[okcVKey(l.rate)] = text(l.vat);
  }
  return out;
}

export const amountOf = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = parseNumberTR(t);
  return n === null || n < 0 ? null : Math.round(n * 100) / 100;
};

/** Formun yazarkasa metinleri sayıya (okunamayan tutar boş sayılır; canlı denetim için) */
export function okcFigures(v: OkcValues): OkcFormValues & { lines: OkcVatInput[] } {
  const lines: OkcVatInput[] = OKC_RATES_SHOWN.map((rate) => ({ rate, total: amountOf(v[okcTKey(rate)]), vat: amountOf(v[okcVKey(rate)]) })).filter((l) => l.total !== null || l.vat !== null);
  const receipts = v.okcReceipts.trim() ? Number(v.okcReceipts.replace(/\D/g, "")) : null;
  return {
    okcZNo: v.okcZNo.trim() || null,
    okcReceipts: receipts !== null && Number.isFinite(receipts) ? receipts : null,
    okcTotal: amountOf(v.okcTotal),
    okcVatTotal: amountOf(v.okcVatTotal),
    okcCash: amountOf(v.okcCash),
    okcCard: amountOf(v.okcCard),
    okcMealCard: amountOf(v.okcMealCard),
    okcOther: amountOf(v.okcOther),
    // Kimliklere yalnız toplamı ve KDV'si birlikte yazılan oranlar (eksik çift gönderimde söylenir)
    okcVat: lines.filter((l): l is OkcVatLine => l.total !== null && l.vat !== null),
    lines,
  };
}

/**
 * Gönderimde yazarkasa alanları (plan §3.2; sunucu aynı kuralı aynı metinle uygular, okcFormError): bölüm boş
 * kalabilir; bir tutar yazıldıysa günlük toplam, nakit ve kredi kartı; oranın toplamı ile KDV'si birlikte, KDV
 * toplamdan büyük değil. Hatalı alan ve metni, yoksa raporun yazarkasa alanları (boşlar null)
 */
export function okcFieldsOf(v: OkcValues): { fields: Pick<CashReportFields, "okcZNo" | "okcReceipts" | "okcTotal" | "okcVatTotal" | "okcVat" | "okcCash" | "okcCard" | "okcMealCard" | "okcOther"> | null; errors: Partial<Record<OkcKey, string>> } {
  const errors: Partial<Record<OkcKey, string>> = {};
  for (const k of OKC_MONEY_KEYS) if (v[k].trim() && amountOf(v[k]) === null) errors[k] = "Geçerli bir tutar yazın (ör. 1.250,50)";
  if (Object.keys(errors).length) return { fields: null, errors };
  const f = okcFigures(v);
  const message = okcFormError({ ...f, okcVat: f.lines });
  if (message) {
    // Kuralın alanı (okcFormError'un sırasıyla): önce döküm çiftleri, sonra günlük toplam, nakit, kart
    const pair = f.lines.find((l) => (l.total === null) !== (l.vat === null) || (l.total !== null && l.vat !== null && l.vat > l.total + 0.005));
    const key: OkcKey = pair ? (pair.total === null ? okcTKey(pair.rate) : okcVKey(pair.rate)) : f.okcTotal === null ? "okcTotal" : f.okcCash === null ? "okcCash" : "okcCard";
    return { fields: null, errors: { [key]: message } };
  }
  return {
    fields: {
      okcZNo: f.okcZNo,
      okcReceipts: f.okcReceipts,
      okcTotal: f.okcTotal,
      okcVatTotal: f.okcVatTotal,
      // Kayıtlı biçim: sıfır gruplar yok, orana göre sıralı (sunucu da aynı biçime getirir)
      okcVat: normalizeVat(f.okcVat).length ? normalizeVat(f.okcVat) : null,
      okcCash: f.okcCash,
      okcCard: f.okcCard,
      okcMealCard: f.okcMealCard,
      okcOther: f.okcOther,
    },
    errors,
  };
}
