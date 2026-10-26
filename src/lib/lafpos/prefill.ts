import type { CashPrefill, PrefillField, PrefillPlan, ReadValue } from "@/lib/photo-read/kasa";

import type { PosDayZ } from "./day";

/**
 * Kasa raporunun "LafPOS'tan doldur"u (saf; docs/LAFPOS.md › Kasa raporu): LafPOS'un gün sonu Z özeti formun ModPOS Z
 * ve kasa alanlarına, fotoğraf okumasının biçimiyle (CashPrefill, `source: "lafpos"`). Form aynı kuralla uygular: yalnız
 * boş alanlar dolar, yazılmış ve farklı olanın altında "LafPOS'ta …" ve "LafPOS'takini yaz" çıkar; hiçbir şey
 * kendiliğinden kaydedilmez, personel bakıp gönderir. Rakamlar LafPOS'un kendi hesabıdır (tahmin yok): güveni hep "high".
 * Personele de gider: yalnız formun zaten yazdırdığı rakamlar (maliyet, kâr, komisyon, ödeme kanalı yok).
 */

/** Günün LafPOS özeti: formun "LafPOS'tan doldur" bandı */
export interface LafposDay {
  /** LafPOS'un son gönderiminin geldiği an (ISO); düzeltme yeniden gönderilince değişir */
  receivedAt: string;
  prefill: CashPrefill;
}

/** Gün sayılmadan kapandıysa (LafPOS'ta sayım yok) sayılan nakit boş kalır, altında bu yazar */
export const LAFPOS_NO_COUNT_TEXT = "LafPOS'ta gün sonu sayımı yok; çekmeceyi sayıp yazın.";

/** LafPOS'un Z özeti → formun alanları (zNo metin: formdaki Z no metindir) */
export function lafposPrefill(z: PosDayZ): CashPrefill {
  const values: Partial<Record<PrefillField, ReadValue>> = {};
  const put = (field: PrefillField, value: number | string | null) => {
    if (value !== null) values[field] = { value, confidence: "high" };
  };
  put("zNo", String(z.zNo));
  put("receipts", z.receipts);
  put("zTotal", z.zTotal);
  put("cash", z.cash);
  put("card", z.card);
  put("mealCard", z.mealCard);
  put("online", z.online);
  put("other", z.other);
  put("offRevenue", z.offRevenue);
  put("discounts", z.discounts);
  put("openingCash", z.openingCash);
  put("cashOut", z.cashOut);
  put("countedCash", z.countedCash);
  put("handedOver", z.handedOver);
  return { source: "lafpos", values, checks: [], missing: z.countedCash === null ? ["countedCash"] : [] };
}

/** "LafPOS'tan doldur"dan sonraki satır */
export function lafposSummary(plan: PrefillPlan): string {
  const filled = plan.fill.length;
  const differs = plan.differs.length;
  if (filled && differs) return `LafPOS'tan ${filled} alan dolduruldu; ${differs} alan yazdığınızdan farklı, turuncu olanlara bakın.`;
  if (filled) return `LafPOS'tan ${filled} alan dolduruldu. Kontrol edip gönderin.`;
  if (differs) return `LafPOS'ta ${differs} alan yazdığınızdan farklı; turuncu olanlara bakın.`;
  if (plan.missing.length) return LAFPOS_NO_COUNT_TEXT;
  return "Yazdıklarınız LafPOS'takiyle aynı.";
}
