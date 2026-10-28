import { addDays, monthEnd } from "@/lib/reminders";

import { dayRangeTR } from "./sales";
import { isLafposDay, kasaName, monthSource } from "./switch";

/**
 * Kasanın adı metinlerde (denetim E-39; docs/LAFPOS.md › Metinler): geçiş günü boşken ya da gün ondan önceyken her
 * metin bugünkü gibi "ModPOS" der; geçiş gününden itibaren "LafPOS". Günlük metinler (Bugün, zil, Kasa raporu, Kasadaki
 * fiyatlar) günün kasasıyla (kasaName), aylık rapor etiketleri (Genel bakış, Gelir-gider, Tutarlılık, Ürünler, Analiz,
 * Excel, Claude) ayın kasasıyla (monthKasa). Saf; testleri tests/lafpos-metin.test.ts.
 */

export type KasaName = ReturnType<typeof kasaName>;

/** Ayın kasası, rapor etiketleri için */
export interface MonthKasa {
  source: ReturnType<typeof monthSource>;
  /** Kısa ad (tutarın yanında): "ModPOS", "LafPOS"; geçiş ayında "Kasa" */
  short: "ModPOS" | "LafPOS" | "Kasa";
  /** Parantez içinde ("kasadan (ModPOS) geçmez"): "ModPOS", "LafPOS"; geçiş ayında "ModPOS / LafPOS" */
  both: "ModPOS" | "LafPOS" | "ModPOS / LafPOS";
  /** Uzun ad (açıklamada): "ModPOS", "LafPOS"; geçiş ayında "Kasa (ModPOS 1–9 Kasım · LafPOS 10–30 Kasım)" */
  long: string;
  /** Ürün satışlarının kaynağı: "Patron (ModPOS)", "LafPOS"; geçiş ayında uzun ad */
  report: string;
}

/** Ayın kasası (geçiş günü boşken ve geçiş gününden önceki aylarda bugünkü metinler) */
export function monthKasa(month: string, switchDay: string | null): MonthKasa {
  const source = monthSource(month, switchDay);
  if (source === "modpos" || switchDay === null) return { source: "modpos", short: "ModPOS", both: "ModPOS", long: "ModPOS", report: "Patron (ModPOS)" };
  if (source === "lafpos") return { source, short: "LafPOS", both: "LafPOS", long: "LafPOS", report: "LafPOS" };
  const first = `${month}-01`;
  const long = `Kasa (ModPOS ${dayRangeTR(first, addDays(switchDay, -1))} · LafPOS ${dayRangeTR(switchDay, monthEnd(first))})`;
  return { source, short: "Kasa", both: "ModPOS / LafPOS", long, report: long };
}

/**
 * Birden çok ayın kasası (Gelir-gider'in yıl tablosu ve kartları, Excel): ayların hepsi ModPOS ya da hepsi LafPOS ise
 * o, karışıksa (geçiş ayı ya da iki kasalı yıl) "Kasa" / "ModPOS / LafPOS". Ay yoksa ModPOS
 */
export function periodKasa(months: readonly string[], switchDay: string | null): Pick<MonthKasa, "short" | "both"> {
  const kinds = new Set(months.map((m) => monthSource(m, switchDay)));
  if (!kinds.size || (kinds.size === 1 && kinds.has("modpos"))) return { short: "ModPOS", both: "ModPOS" };
  if (kinds.size === 1 && kinds.has("lafpos")) return { short: "LafPOS", both: "LafPOS" };
  return { short: "Kasa", both: "ModPOS / LafPOS" };
}

/**
 * Kasadaki fiyatların kapsamı (denetim E-39; docs/FIYATLAR.md › LafPOS): bugünün (iş günü) kasası ve LafPOS günü mü.
 * LafPOS gününde siteye bağlı ürünün satış fiyatını LafPOS siteden kendisi alır: fiyat değişince kasa listesine girmez,
 * listede bekleyen eski işareti de gösterilmez (silinmez; geçiş günü kaldırılırsa yeniden görünür). Siteye bağlı
 * olmayan ürün (LafPOS'ta yerel ürünse) kasada yine elle değişir.
 */
export interface TillScope {
  kasa: KasaName;
  lafpos: boolean;
}

/** `day` iş günü (05:00 kuralı) */
export function tillScope(day: string, switchDay: string | null): TillScope {
  const lafpos = isLafposDay(day, switchDay);
  return { kasa: lafpos ? "LafPOS" : "ModPOS", lafpos };
}

/** Bu ürünün fiyatı kasada elle mi değişir: LafPOS gününde siteye bağlı ürününki değişmez (LafPOS siteden alır) */
export function tillPriceManual(scope: TillScope, linkedToSite: boolean): boolean {
  return !(scope.lafpos && linkedToSite);
}
