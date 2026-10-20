// Hammadde formunun saf yardımcıları (istemci formu ve testler kullanır).

import { countFactor } from "@/lib/calc/engine";
import { COUNT_GROUP_VAT, COUNT_GROUP_VAT_DEFAULT, COUNT_GROUPS } from "@/lib/constants";
import { num } from "@/lib/format";

/** Silmeyi engelleyen geçmiş kayıt sayıları */
export interface IngredientDeps {
  counts: number;
  purchases: number;
  links: number;
}

/** Silmeyi engelleyen geçmiş: "2 sayım, 1 alım miktarı" (boşsa null) */
export function historyText(d: IngredientDeps): string | null {
  const parts = [
    d.counts ? `${num(d.counts)} sayım` : "",
    d.purchases ? `${num(d.purchases)} alım miktarı` : "",
    d.links ? `${num(d.links)} Paraşüt eşleştirmesi` : "",
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

export const vatForGroup = (group: string) => COUNT_GROUP_VAT[group] ?? COUNT_GROUP_VAT_DEFAULT;

/** "1 KG = 1.000 gr" (sayım listesinde nasıl girileceği) */
export const countUnitHint = (countUnit: string, unit: string) => (countUnit ? `Sayımda 1 ${countUnit} = ${num(countFactor(countUnit))} ${unit}` : "Sayım listesinde görünmez");
