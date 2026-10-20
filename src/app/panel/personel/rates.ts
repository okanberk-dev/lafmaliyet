// SGK oran alanlarının okunması ve denetimi (saf; testleri tests/personel-rates.test.ts).
//
// Alana her zaman yüzde puanı yazılır: "14", "%14", "14%" ve "% 14" hepsi 0,14 olur (parsePercentInput).
// Eskiden "%15,75" iki kez 100'e bölünüyordu (0,001575). Ayrıca işçi kesintileri toplamı %100'e ulaşırsa
// brüt = net ÷ (1 − kesinti) sonsuz / negatif olur; bu kaydedilmez.

import { formatPercentInput, parsePercentInput } from "@/lib/calc/expr";

export type Rates = { isciSgk: number; isciIssizlik: number; isverenSgk: number; isverenIssizlik: number };
export type RateKey = keyof Rates;
export type RateTexts = Record<RateKey, string>;

export const RATE_KEYS: RateKey[] = ["isciSgk", "isciIssizlik", "isverenSgk", "isverenIssizlik"];

/** Kayıtlı oranlardan alan metinleri: 0,14 → "14" */
export function toRateTexts(r: Rates): RateTexts {
  return {
    isciSgk: formatPercentInput(r.isciSgk),
    isciIssizlik: formatPercentInput(r.isciIssizlik),
    isverenSgk: formatPercentInput(r.isverenSgk),
    isverenIssizlik: formatPercentInput(r.isverenIssizlik),
  };
}

export interface RateCheck {
  /** Okunan oranlar (kesir); okunamayan alan null */
  values: Record<RateKey, number | null>;
  /** Kaydı engelleyen alan hataları */
  errors: Partial<Record<RateKey, string>>;
  /** Kaydı engellemeyen ama şüpheli değerler (ör. 0,1575 yazılmış: %0,16) */
  warnings: Partial<Record<RateKey, string>>;
  /** Alanlar arası hata (işçi kesintileri toplamı) */
  formError: string | null;
  /** Hepsi geçerli: kaydedilebilir */
  ok: boolean;
}

const pctText = (v: number) => `%${formatPercentInput(v)}`;

export function checkRates(t: RateTexts): RateCheck {
  const values = {} as Record<RateKey, number | null>;
  const errors: RateCheck["errors"] = {};
  const warnings: RateCheck["warnings"] = {};
  for (const k of RATE_KEYS) {
    const text = t[k].trim();
    const v = text === "" ? null : parsePercentInput(text);
    values[k] = v;
    if (text === "") errors[k] = "Oran yazın (yoksa 0)";
    else if (v === null) errors[k] = "Sayı yazın, ör. 14 ya da %14";
    else if (v < 0) errors[k] = "Negatif olamaz";
    else if (v >= 1) errors[k] = "%100'den küçük olmalı";
    else if (v > 0 && v < 0.01) warnings[k] = `${pctText(v)} çok düşük: yüzde olarak yazın, ör. 15,75`;
    else if (v > 0.4) warnings[k] = `${pctText(v)} alışılmadık yüksek bir oran`;
  }
  const employee = (values.isciSgk ?? 0) + (values.isciIssizlik ?? 0);
  const formError =
    !errors.isciSgk && !errors.isciIssizlik && employee >= 1
      ? `İşçi SGK + işçi işsizlik toplamı %100'ün altında olmalı (şu an ${pctText(employee)}); yoksa brüt maaş hesaplanamaz.`
      : null;
  return { values, errors, warnings, formError, ok: Object.keys(errors).length === 0 && !formError };
}

/** Değişiklik var mı (biçim farkı sayılmaz: "14" ile "%14" aynı) */
export function ratesChanged(t: RateTexts, saved: Rates): boolean {
  return RATE_KEYS.some((k) => {
    const v = parsePercentInput(t[k].trim());
    return v === null || Math.abs(v - saved[k]) > 1e-9;
  });
}
