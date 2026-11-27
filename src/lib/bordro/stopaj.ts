/**
 * Sabit giderin ödemeden kesilen stopajı (nakit planı, Ödemeler'in "Sabit giderlerden ekle"si ve tutar karşılaştırması;
 * Gelir-gider'in "Kira stopajı" maliyeti). Profil (`Withholding`) sabit giderin sütunudur (`tax_withholding`), Giderler'in
 * sabit gider penceresinde "Ödemeden kesilen stopaj" alanı (27 Kasım 2026'ya kadar Vergi › sınıflandırma). Türkiye'deki
 * şahsa ödenen kira, serbest meslek ve internet reklamında bankadan net çıkar (kira 160.000 brüt → 128.000); stopajı
 * muhasebeci muhtasarla öder, nakit planı vergi tahmini yapmaz. Doğrudan yurt dışına ödenen reklam ve hizmette yabancı
 * firma Türk KDV'si kesmez: tutar olduğu gibi gider (KDV oranı 0). Saf modül; tests/bordro.test.ts.
 */

import type { Withholding } from "../calc/types";

import { type PayrollYearRules, rulesFor } from "./rules";

/** Saklı profil değerleri (`fixed_expenses.tax_withholding`); "yok" eski sınıflandırmanın "stopaj yok"u */
export const WITHHOLDINGS = ["yok", "kira", "serbest_meslek", "internet_reklam", "internet_reklam_yurtdisi", "yurt_disi_hizmet"] as const satisfies readonly Withholding[];

/**
 * Giderler'in sabit gider penceresindeki seçenekler ("Ödemeden kesilen stopaj"; boş = yok). "yok" seçenek değildir:
 * eski kayıtta boşla aynı sonuç, değiştirilmedikçe yerinde kalır
 */
export const WITHHOLDING_OPTIONS: readonly { value: Exclude<Withholding, "yok">; label: string }[] = [
  { value: "kira", label: "Şahsa işyeri kirası" },
  { value: "serbest_meslek", label: "Serbest meslek makbuzu" },
  { value: "internet_reklam", label: "İnternet reklamı, şahsa" },
  { value: "internet_reklam_yurtdisi", label: "İnternet reklamı, doğrudan yurt dışına" },
  { value: "yurt_disi_hizmet", label: "Yurt dışı hizmet" },
];

/** Profilin gelir vergisi stopajı oranı */
export function withholdingRate(w: Withholding | null | undefined, rules: PayrollYearRules): number {
  switch (w) {
    case "kira":
      return rules.stopaj.kira.value;
    case "serbest_meslek":
      return rules.stopaj.serbestMeslek.value;
    case "internet_reklam":
    case "internet_reklam_yurtdisi":
      return rules.stopaj.internetReklam.value;
    default:
      return 0;
  }
}

/** Doğrudan yurt dışına ödenen profil: yabancı firma Türk KDV'si kesmez, stopaj ödemeden düşülmez */
export function isForeignWithholding(w: Withholding | null | undefined): boolean {
  return w === "internet_reklam_yurtdisi" || w === "yurt_disi_hizmet";
}

/**
 * Ödemeden kesilen stopaj oranı: Türkiye'deki şahsa ödenen kira, serbest meslek ve internet reklamında. Doğrudan yurt
 * dışına ödenende 0. Yılın kuralı yoksa en son bilinen yılınki
 */
export function paidWithholdingRate(w: Withholding | null | undefined, year: number): number {
  if (!w || isForeignWithholding(w)) return 0;
  return withholdingRate(w, rulesFor(year).rules);
}

/**
 * Sabit giderin bankadan çıkan tutarının oranları: ödemeden kesilen stopaj (paidWithholdingRate) ve faturadaki KDV.
 * Doğrudan yurt dışına ödenen reklam ve hizmette KDV oranı 0 (bölümün varsayılan %20'si eklenmez)
 */
export function paidFixedRates<T extends { taxWithholding?: Withholding | null; vatRate?: number | null }>(f: T, year: number): T & { withholdingRate: number } {
  return { ...f, ...(isForeignWithholding(f.taxWithholding) ? { vatRate: 0 } : {}), withholdingRate: paidWithholdingRate(f.taxWithholding, year) };
}
