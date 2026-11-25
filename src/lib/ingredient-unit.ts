import { num } from "@/lib/format";

import type { Unit } from "@/lib/calc/types";

/**
 * Hammaddenin birimi değişince eski birimle yazılmış bağlılar (denetim bulgu 41). Paraşüt bağlantısının çarpanı
 * ("1 Koli = 12.000 ml"), kritik stok eşiği ve zayi / ikram kaydının çarpanı (qty × factor = hammaddenin birimi) kendi
 * kendine yeni birime çevrilmez: gr'dan adet'e geçişte çarpan 1000 kat yanlış kalır, FIFO partisi, Tutarlılık'ın
 * "alınan"ı, tahmini stok ve otomatik fiyat güncellemesi sessizce bozulur. Kayıt bunları sayıp söyler; ölçü ailesi
 * değişiyorsa (gr / ml ↔ adet / dilim) onay ister.
 */

/** Son kaç günün zayi / ikram kaydı sayılır */
export const UNIT_WASTE_DAYS = 90;

/** Ölçü ailesi: tartılan ya da ölçülen (gr, ml) ve sayılan (adet, dilim) */
const FAMILY: Record<Unit, "olcu" | "tane"> = { gr: "olcu", ml: "olcu", adet: "tane", dilim: "tane" };

/** Birim değişimi ölçü ailesini değiştiriyor mu (gr / ml ↔ adet / dilim): kayıt onay ister */
export function unitFamilyChanged(from: Unit, to: Unit): boolean {
  return FAMILY[from] !== FAMILY[to];
}

/** Birimi değişen hammaddenin eski birimle yazılmış bağlıları */
export interface UnitDeps {
  /** Paraşüt ürün → hammadde bağlantıları (çarpanı eski birimle) */
  links: number;
  /** Şubelerin kritik stok eşikleri */
  thresholds: number;
  /** Son UNIT_WASTE_DAYS günün zayi / ikram kayıtları */
  recentWaste: number;
}

/** Birim `from` → `to` değişirken söylenecekler (bağlı yoksa boş) */
export function unitChangeNotes(from: Unit, to: Unit, deps: UnitDeps): string[] {
  if (from === to) return [];
  const out: string[] = [];
  if (deps.links)
    out.push(
      `Paraşüt'te ${num(deps.links)} ürün bu hammaddeye bağlı; çarpanı “${from}” ile yazıldı (ör. 1 Koli = 12.000 ${from}). Paraşüt › Ürün → hammadde bağlantıları'nda çarpanı “${to}” ile yeniden girin; yoksa gelen faturanın miktarı ve birim fiyatı yanlış hesaplanır.`,
    );
  if (deps.thresholds) out.push(`${num(deps.thresholds)} şubenin kritik stok eşiği “${from}” ile yazıldı; Tahmini stok'ta eşiği “${to}” ile yeniden girin.`);
  if (deps.recentWaste)
    out.push(`Son ${UNIT_WASTE_DAYS} günde ${num(deps.recentWaste)} zayi / ikram kaydı “${from}” üzerinden girildi; miktarları yeni birimle okunur, gerekirse Zayi & ikram'da düzeltin.`);
  return out;
}

/** Ölçü ailesi değişirken onay kutusunun ve sunucunun reddinin metni */
export function unitConfirmText(from: Unit, to: Unit): string {
  return `Birim ${from} → ${to} değişiyor: ${FAMILY[to] === "tane" ? "tartılan malzeme sayılan" : "sayılan malzeme tartılan"} olur, eski miktarlar kendiliğinden çevrilmez.`;
}
