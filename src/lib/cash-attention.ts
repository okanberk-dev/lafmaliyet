/**
 * Kayıtlı kasa raporunun dikkat isteyen durumları: ay listesinin rozetleri (cash-history.tsx) ve tek gün görünümündeki
 * rapor dökümünün özeti (cash-form.tsx) aynı yerden okur. Gün açıkken ay listesi çizilmediği için döküm bunlardan biri
 * varken açık gelir ve özet satırı kısa adını söyler (inceleme, 25 Kasım 2026: "Yazarkasa tutmuyor" ve "Z tutmuyor"
 * tek gün görünümünde hiçbir yerde görünmüyordu). Saf; tests/kasa-sade-gorunum.test.ts.
 */

import { CASH_TOLERANCE, computeCash, unreceiptedLabel, withCardExtra, type CashOffDevice } from "@/lib/cash-report";
import { money } from "@/lib/format";
import { okcHasFigures, okcReconcile, type OkcReportFields } from "@/lib/okc-z";

type ReportLike = Parameters<typeof computeCash>[0] & OkcReportFields;

/** Raporun kendi rakamlarından çıkan üç işaret (ay listesindeki rozetlerle aynı kural) */
export interface ReportFlags {
  /** Ödeme türlerinin toplamı Z'yi tutmuyor ("Z tutmuyor") */
  paymentsOff: boolean;
  /** Kart farkı (tolerans dışında; değilse null): "Kart +120 ₺" */
  cardDiff: number | null;
  /** Yazarkasa Z'si kendi içinde tutmuyor ("Yazarkasa tutmuyor") */
  okcOff: boolean;
}

export function reportFlags(report: ReportLike, extras: { cardExtra?: number | null; offDevice?: CashOffDevice | null; kasa?: "ModPOS" | "AsilPOS" } = {}): ReportFlags {
  // AsilPOS gününde kart farkı kartla bahşiş ve cari tahsilatını (G11) ve yazarkasadan geçmeyen kartı (Faz 2) düşer
  const c = computeCash(withCardExtra(report, extras.cardExtra, extras.offDevice, extras.kasa));
  return {
    paymentsOff: Math.abs(c.paymentsDiff) >= CASH_TOLERANCE,
    cardDiff: c.cardDiff !== null && Math.abs(c.cardDiff) >= CASH_TOLERANCE ? c.cardDiff : null,
    okcOff: okcHasFigures(report) && okcReconcile(report, "admin").some((l) => l.key === "okc-self"),
  };
}

export const cardDiffLabel = (d: number) => `Kart ${d > 0 ? "+" : "−"}${money(Math.abs(d))}`;

/**
 * Dikkat isteyenlerin kısa adları (sırası ay listesininki): fotoğraftan farklı, AsilPOS'tan farklı, ModPOS API'den farklı,
 * fişsiz çıkış (bulgu 2; "Fişsiz çıkış: 500 ₺", unreceiptedCashOut), Z tutmuyor, kart farkı, yazarkasa tutmuyor. Boşsa her
 * şey yolunda
 */
export function reportAttention(flags: ReportFlags, o: { photoDiffs?: number; asilposDiffs?: number; modposDiffs?: number; unreceipted?: number | null } = {}): string[] {
  const out: string[] = [];
  if (o.photoDiffs) out.push("Fotoğraftan farklı");
  if (o.asilposDiffs) out.push("AsilPOS'tan farklı");
  if (o.modposDiffs) out.push("ModPOS API'den farklı");
  if (o.unreceipted && o.unreceipted >= CASH_TOLERANCE) out.push(unreceiptedLabel(o.unreceipted));
  if (flags.paymentsOff) out.push("Z tutmuyor");
  if (flags.cardDiff !== null) out.push(cardDiffLabel(flags.cardDiff));
  if (flags.okcOff) out.push("Yazarkasa tutmuyor");
  return out;
}
