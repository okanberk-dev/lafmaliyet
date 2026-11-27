/**
 * Alış faturasının KDV'si (dışa aktarımın Faturalar sekmesi, tedarikçinin fatura bağlama penceresi): faturanın KDV
 * toplamı (`vat`, Paraşüt); yoksa (içe aktarılmışlarda 0) ödenecek − (tutar − iskonto). Tevkifatlı faturada KDV'nin
 * tamamı ve tevkif edilen kısım ayrı okunur. Nakit planının KDV tahmini Vergi bölümüyle birlikte 27 Kasım 2026'da
 * kaldırıldı (KDV beyanını muhasebeci yürütüyor). Saf modül; tests/fatura-kdv.test.ts.
 */

import type { Invoice } from "./calc/types";

type PurchaseVatInput = Pick<Invoice, "amount" | "discount" | "payable"> & { vat?: number | null };

/** En yüksek KDV oranı (%1, %10, %20) */
const MAX_VAT_RATE = 0.2;

/**
 * Kayıttaki KDV toplamı, tutarlar onu taşıyabiliyorsa (net tutarın en çok %20'si). Paraşüt bağı kopan (iptal) kayıtta
 * tutarlar panelde değişince `vat` 0 yazılır (saveInvoice, rules.ts amountsChanged); bu sınır ondan önce (24 Ekim
 * 2026) tutarı düşürülmüş kayıtlar içindir: eski `vat`'a güvenilse olmayan KDV indirilir, fark tevkifat sanılırdı.
 */
function storedVat(inv: PurchaseVatInput): number | null {
  const vat = inv.vat ?? 0;
  if (vat <= 0) return null;
  return vat <= (inv.amount - inv.discount) * MAX_VAT_RATE + 1 ? vat : null;
}

/**
 * Alış faturasının indirilecek KDV'si: KDV toplamı (`vat`, tevkifat düşülmemiş); yoksa ödenecek − (tutar − iskonto).
 * İadede (eksi) fark kullanılır.
 */
export function purchaseVat(inv: PurchaseVatInput): number {
  return storedVat(inv) ?? inv.payable - (inv.amount - inv.discount);
}

/** Faturadaki KDV tevkifatı: KDV toplamı − tedarikçiye ödenen KDV (ödenecek − net); tevkifatsız ve iadede 0 */
export function purchaseWithheld(inv: PurchaseVatInput): number {
  const vat = storedVat(inv);
  if (vat === null) return 0;
  const withheld = vat - (inv.payable - (inv.amount - inv.discount));
  return withheld > 0.01 ? withheld : 0;
}
