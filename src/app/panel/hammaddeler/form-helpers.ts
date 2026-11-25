// Hammadde formunun saf yardımcıları (istemci formu ve testler kullanır).

import { countFactor } from "@/lib/calc/engine";
import type { Settings } from "@/lib/calc/types";
import { COUNT_GROUPS, DEFAULT_SETTINGS, groupVatRate } from "@/lib/constants";
import { num } from "@/lib/format";

/** Silmeyi engelleyen geçmiş kayıt sayıları */
export interface IngredientDeps {
  counts: number;
  purchases: number;
  links: number;
  /** Zayi / ikram kayıtları (silinirse geçmiş ayların zayi maliyeti ve kayıtlı tüketimi 0'a düşerdi) */
  waste: number;
  /** Şubelerin kritik stok eşikleri (birim değişince söylenir; src/lib/ingredient-unit.ts) */
  thresholds?: number;
  /** Son 90 günün zayi / ikram kayıtları (birim değişince söylenir) */
  recentWaste?: number;
}

/** Silmeyi engelleyen geçmiş: "2 sayım, 1 alım miktarı, 3 zayi / ikram" (boşsa null) */
export function historyText(d: IngredientDeps): string | null {
  const parts = [
    d.counts ? `${num(d.counts)} sayım` : "",
    d.purchases ? `${num(d.purchases)} alım miktarı` : "",
    d.links ? `${num(d.links)} Paraşüt eşleştirmesi` : "",
    d.waste ? `${num(d.waste)} zayi / ikram` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Karşılaştırma anahtarı: büyük/küçük harf, Türkçe harf ve boşluk/noktalama farkı sayılmaz ("AEM/Mipak" = "AEM / Mipak") */
export const looseKey = (v: string) =>
  v
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");

/** Yazılan değer listedeki bir değerle aynı ama farklı yazılmışsa o değer (ör. "kaldı" → "Kaldi") */
export function nearMatch(value: string, list: string[]): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (list.includes(v)) return undefined;
  const k = looseKey(v);
  return list.find((x) => looseKey(x) === k);
}

/** Kategorinin en sık kullanılan sayım grubu (yeni malzemede öneri) */
export function groupForCategory(rows: { category: string; countGroup: string | null }[], category: string): string {
  const tally = new Map<string, number>();
  for (const r of rows) if (r.category === category && r.countGroup) tally.set(r.countGroup, (tally.get(r.countGroup) ?? 0) + 1);
  let best = "";
  let n = 0;
  for (const [g, c] of tally) if (c > n || (c === n && COUNT_GROUPS.indexOf(g) < COUNT_GROUPS.indexOf(best))) [best, n] = [g, c];
  return best || (category === "Ambalaj" ? "AMBALAJ MALZEMELERİ" : "DİĞER GIDA ÜRÜNLERİ");
}

/** Sayım gruplarının olağan alış KDV'si (Ayarlar › Oranlar: ambalaj ve gıda) */
export type GroupVatRates = Pick<Settings, "alisKdvAmbalaj" | "alisKdvGida">;

/** Yeni malzemeye önerilen Alış KDV'si: sayım grubunun olağan oranı (Ayarlar; elle değiştirilebilir) */
export const vatForGroup = (group: string, rates: GroupVatRates = DEFAULT_SETTINGS) => groupVatRate(rates, group);

/** "1 KG = 1.000 gr" (sayım listesinde nasıl girileceği) */
export const countUnitHint = (countUnit: string, unit: string) => (countUnit ? `Sayımda 1 ${countUnit} = ${num(countFactor(countUnit))} ${unit}` : "Sayım listesinde görünmez");
