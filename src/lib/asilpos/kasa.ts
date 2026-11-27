import type { AsilposSalesMonth } from "@/lib/calc/types";
import { addDays, dayAblativeTR, monthEnd } from "@/lib/reminders";

import { dayRangeTR } from "./sales";
import { isAsilposDay, kasaName, monthSource } from "./switch";

/**
 * Kasanın adı metinlerde (denetim E-39; docs/ASILPOS.md › Metinler): geçiş günü boşken ya da gün ondan önceyken her
 * metin bugünkü gibi "ModPOS" der; geçiş gününden itibaren "AsilPOS". Günlük metinler (Bugün, zil, Kasa raporu, Kasadaki
 * fiyatlar) günün kasasıyla (kasaName), aylık rapor etiketleri (Genel bakış, Gelir-gider, Tutarlılık, Ürünler, Analiz,
 * dışa aktarım, Claude) ayın kasasıyla (monthKasa). Saf; testleri tests/asilpos-metin.test.ts.
 */

export type KasaName = ReturnType<typeof kasaName>;

/** Ayın kasası, rapor etiketleri için */
export interface MonthKasa {
  source: ReturnType<typeof monthSource>;
  /** Kısa ad (tutarın yanında): "ModPOS", "AsilPOS"; geçiş ayında "Kasa" */
  short: "ModPOS" | "AsilPOS" | "Kasa";
  /** Parantez içinde ("kasadan (ModPOS) geçmez"): "ModPOS", "AsilPOS"; geçiş ayında "ModPOS / AsilPOS" */
  both: "ModPOS" | "AsilPOS" | "ModPOS / AsilPOS";
  /** Uzun ad (açıklamada): "ModPOS", "AsilPOS"; geçiş ayında "Kasa (ModPOS 1–9 Kasım · AsilPOS 10–30 Kasım)" */
  long: string;
  /** Ürün satışlarının kaynağı: "Patron (ModPOS)", "AsilPOS"; geçiş ayında uzun ad */
  report: string;
}

const MODPOS_MONTH: MonthKasa = { source: "modpos", short: "ModPOS", both: "ModPOS", long: "ModPOS", report: "Patron (ModPOS)" };

/**
 * Ayın kasası (geçiş günü boşken ve geçiş gününden önceki aylarda bugünkü metinler). Geçiş ayında iki kullanım var:
 * - `sales` verilmezse (Z, ciro, kasa raporu etiketleri) bölünme geçiş günündedir: "Kasa (ModPOS 1–9 Kasım · AsilPOS
 *   10–30 Kasım)".
 * - `sales` verilirse (ürün satışlarının etiketi; modelin ayı: Dataset.asilposSales) bölünme modelin saydığıdır
 *   (asilposSalesFrom): ModPOS listesi kendi son gününe kadar, AsilPOS `from`'dan sayılan son güne kadar; liste yoksa
 *   "ModPOS listesi yok", AsilPOS'tan henüz sayılan gün yoksa "AsilPOS 10 Kasım'dan itibaren". Liste ayın tamamını
 *   kapsıyorsa (AsilPOS sayılmıyor) ay ModPOS'tur. `sales` null ise (ayın özeti yok) geçiş günündeki bölünme.
 */
export function monthKasa(month: string, switchDay: string | null, sales?: AsilposSalesMonth | null): MonthKasa {
  const source = monthSource(month, switchDay);
  if (source === "modpos" || switchDay === null) return MODPOS_MONTH;
  if (source === "asilpos") return { source, short: "AsilPOS", both: "AsilPOS", long: "AsilPOS", report: "AsilPOS" };
  const first = `${month}-01`;
  let long = `Kasa (ModPOS ${dayRangeTR(first, addDays(switchDay, -1))} · AsilPOS ${dayRangeTR(switchDay, monthEnd(first))})`;
  if (sales) {
    if (sales.from === null) return MODPOS_MONTH;
    const modpos = sales.modpos?.counted ? `ModPOS ${dayRangeTR(first, sales.modpos.through)}` : "ModPOS listesi yok";
    // Sayılan son AsilPOS günü: kasa raporunu bekleyen günler (held) henüz sayılmaz
    const last = sales.asilpos ? (sales.held ? addDays(sales.held.from, -1) : sales.asilpos.last) : null;
    const asilpos = last !== null && last >= sales.from ? `AsilPOS ${dayRangeTR(sales.from, last)}` : `AsilPOS ${dayAblativeTR(sales.from)} itibaren`;
    long = `Kasa (${modpos} · ${asilpos})`;
  }
  return { source, short: "Kasa", both: "ModPOS / AsilPOS", long, report: long };
}

/** Ürün satışlarının etiketi için ayın kasası: modelin ayıyla (Dataset.asilposSales; geçiş günü yoksa alan yok) */
export function salesMonthKasa(month: string, switchDay: string | null, asilposSales: { months: readonly AsilposSalesMonth[] } | undefined): MonthKasa {
  return monthKasa(month, switchDay, asilposSales?.months.find((m) => m.month === month) ?? null);
}

/**
 * Birden çok ayın kasası (Gelir-gider'in yıl tablosu ve kartları, dışa aktarım): ayların hepsi ModPOS ya da hepsi AsilPOS ise
 * o, karışıksa (geçiş ayı ya da iki kasalı yıl) "Kasa" / "ModPOS / AsilPOS". Ay yoksa ModPOS
 */
export function periodKasa(months: readonly string[], switchDay: string | null): Pick<MonthKasa, "short" | "both"> {
  const kinds = new Set(months.map((m) => monthSource(m, switchDay)));
  if (!kinds.size || (kinds.size === 1 && kinds.has("modpos"))) return { short: "ModPOS", both: "ModPOS" };
  if (kinds.size === 1 && kinds.has("asilpos")) return { short: "AsilPOS", both: "AsilPOS" };
  return { short: "Kasa", both: "ModPOS / AsilPOS" };
}

/**
 * Kasadaki fiyatların kapsamı (denetim E-39; docs/FIYATLAR.md › AsilPOS): bugünün (iş günü) kasası ve AsilPOS günü mü.
 * AsilPOS gününde siteye bağlı ürünün satış fiyatını AsilPOS siteden kendisi alır: listede gösterilmez. Kasanın durumu
 * (products.pos_stale_*) geçiş gününden bağımsız yazılmaya devam eder, yalnız okuyanlar süzer: geçiş günü kaldırılır ya
 * da ileri alınırsa ModPOS'un bekleyen fiyatları eksiksiz geri gelir. Siteye bağlı olmayan ürün (AsilPOS'ta yerel ürünse)
 * yalnız fiyatı geçiş gününden sonra panelde değiştiyse listededir (src/server/data/till-scope.ts tillProductFilter):
 * ModPOS'tan kalan işaret AsilPOS'un işi değildir.
 */
export interface TillScope {
  kasa: KasaName;
  asilpos: boolean;
  /** Geçiş günü (YYYY-MM-DD), yalnız AsilPOS gününde; ModPOS gününde null */
  switchDay: string | null;
}

/** `day` iş günü (05:00 kuralı) */
export function tillScope(day: string, switchDay: string | null): TillScope {
  const asilpos = isAsilposDay(day, switchDay);
  return { kasa: asilpos ? "AsilPOS" : "ModPOS", asilpos, switchDay: asilpos ? switchDay : null };
}

/** Bu ürünün fiyatı kasada elle mi değişir: AsilPOS gününde siteye bağlı ürününki değişmez (AsilPOS siteden alır) */
export function tillPriceManual(scope: TillScope, linkedToSite: boolean): boolean {
  return !(scope.asilpos && linkedToSite);
}
