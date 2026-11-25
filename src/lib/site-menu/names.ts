import { words } from "@/lib/product-match";

import type { SiteMenuItem } from "./schema";
import { defaultSlot, isSingleSize, slotPriceMinor, toMinor, type SiteMenuSlot } from "./slot";

/**
 * Eşleştirme önerileri (saf). Panelin ürün adları ilk aktarımdan gelir (tedarik ve kasa adları, çoğu İngilizce); sitenin
 * kalemleri 22 Eyl 2026'dan beri Türkçe. Öneri sırası:
 *
 * 1. aynı ad (Türkçe duyarlı: büyük/küçük harf, ı/İ, aksan ve noktalama sayılmaz): "Çay" = "çay", "Caffè" = "Caffe";
 * 2. sitenin eski İngilizce adı (sitenin iki Türkçeleştirme migration'ı kimliği eski adın yanında yazar);
 * 3. benzer ad: aynı sözcükler ek almış ya da biri eksik ("Çilekli Magnolia" ~ "Çilek Magnolia"), tek harf yazım
 *    farkı ("Tiramusu" ~ "Tiramisu").
 *
 * Öneri asla kendiliğinden uygulanmaz: eşleştirme ekranında yönetici seçip "Önerileri bağla"ya basar.
 */

/** Adın eşleşme anahtarı: "L'Af Coffee" → "l af coffee", "Çilekli MATCHA" → "cilekli matcha" */
export function menuNameKey(name: string): string {
  return words(name).join(" ");
}

/**
 * Sitenin eski (İngilizce) adları, kimliğiyle: laffogato db/migrations/20260922120000_turkish_catalogue_names.sql ve
 * 20260922130000_turkish_menu_names_pass2.sql. Panelin ilk aktarılan adları bunlardır. Paneldeki yazım sitenin eski adından
 * biraz farklıysa (sitede "Iced …", panelde "Ice …") panelin yazımı da ikinci ad olarak listede.
 */
export const SITE_OLD_NAMES: Readonly<Record<string, readonly string[]>> = {
  "mnu-0002": ["Strawberry Matcha"],
  "mnu-0011": ["Esp. Macchiato"],
  "mnu-0012": ["Spanish Latte"],
  "mnu-0014": ["White Choc. Mocha"],
  "mnu-0015": ["Caramel Latte"],
  "mnu-0016": ["Salted Caramel Latte"],
  "mnu-0018": ["Pumpkin Spice Latte"],
  "mnu-0021": ["Chai Tea"],
  "mnu-0022": ["Iced Americano", "Ice Americano"],
  "mnu-0023": ["Iced Caffè Latte", "Ice Latte"],
  "mnu-0024": ["Iced Caffè Mocha", "Ice Mocha"],
  "mnu-0025": ["Iced White Ch. Mocha", "Ice White Choc. Mocha"],
  "mnu-0026": ["Iced Salted Caramel Latte", "Ice Salted Caramel Latte"],
  "mnu-0027": ["Iced Toffeenut Latte", "Ice Toffeenut Latte"],
  "mnu-0028": ["Iced Pumpkin Spice Latte", "Ice Pumpkin Spice Latte"],
  "mnu-0029": ["Iced Spanish Latte", "Ice Spanish Latte"],
  "mnu-0032": ["Surprise Drink"],
  "mnu-0037": ["Chai Tea Latte"],
  "mnu-0038": ["Hot Chocolate"],
  "mnu-0039": ["White Hot Chocolate"],
  "mnu-0040": ["Caramel Hot Chocolate"],
  "mnu-0042": ["Tea"],
  "mnu-0046": ["Caramel Frappe"],
  "mnu-0047": ["Blueberry"],
  "mnu-0049": ["Apple"],
  "mnu-0051": ["Strawberry"],
  "mnu-0052": ["Raspberry"],
  "mnu-0053": ["Passionfruit"],
  "mnu-0054": ["Pineapple"],
  "mnu-0055": ["Lemon Tea"],
  "mnu-0056": ["Peach Tea"],
  "mnu-0057": ["Donostia (L'Af Special)"],
  "mnu-0059": ["Blueberry San Sebastian"],
  "mnu-0061": ["L'Af Coffee"],
  "mnu-0076": ["Crunchy Granola Bar (Kenya)"],
  "mnu-0080": ["Syrup"],
  "mnu-0081": ["Extra Shot"],
};

export type SuggestionConfidence = "exact" | "known" | "similar";

/** Önerinin güven sözcüğü (ekranda) */
export const CONFIDENCE_LABEL: Record<SuggestionConfidence, string> = {
  exact: "Aynı ad",
  known: "Eski adı",
  similar: "Benzer ad",
};

const RANK: Record<SuggestionConfidence, number> = { exact: 0, known: 1, similar: 2 };

/** Ek almış sözcük de aynı sayılır: "cilekli" ~ "cilek", "fumeli" ~ "fume" (en az 4 harf ortak kök) */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= Math.max(4, Math.min(a.length, b.length) - 2);
}

/** İki metnin düzenleme uzaklığı (Levenshtein) */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Benzer ad: (a) sözcük sayısı aynı ve her sözcük eşleşiyor, ya da kısa adın en az iki sözcüğü uzun adda var (bir
 * sözcük eksik ya da fazla); (b) tek harf yazım farkı (en az 5 harflik adlarda %80 benzerlik). Tek sözcüklük bir ad
 * ("Latte") onu içeren her uzun ada ("Ice Caramel Latte") benzemez.
 */
export function similarNames(aKey: string, bKey: string): boolean {
  if (!aKey || !bKey) return false;
  if (aKey === bKey) return true;
  const a = aKey.split(" ").filter((w) => w.length > 1);
  const b = bKey.split(" ").filter((w) => w.length > 1);
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const covered = short.every((w) => long.some((x) => sameWord(w, x)));
  if (covered && (short.length === long.length || (short.length >= 2 && long.length - short.length <= 1))) return true;
  const n = Math.max(aKey.length, bKey.length);
  return n >= 5 && 1 - editDistance(aKey, bKey) / n >= 0.8;
}

export interface SuggestProduct {
  id: number;
  name: string;
  size: string;
  /** TL */
  price: number;
}

export interface LinkSuggestion {
  productId: number;
  siteMenuId: string;
  slot: SiteMenuSlot;
  confidence: SuggestionConfidence;
  /** Kalemin sitedeki adı */
  siteName: string;
  /** Bu yuvanın sitedeki fiyatı (kuruş) */
  sitePriceMinor: number;
  siteActive: boolean;
}

const slotKey = (siteMenuId: string, slot: SiteMenuSlot) => `${siteMenuId}:${slot}`;

/**
 * Bağlı olmayan ürünlere öneri. Her ürün en çok bir öneri, her (kalem, yuva) en çok bir ürün alır; çakışmada önce
 * güven (aynı ad > eski ad > benzer), sonra fiyatın yakınlığı, sonra boyun yuvaya uygunluğu kazanır (sitede tek boy
 * "Protein Shake" 270 ₺ iki boylu panelde 270 ₺'lik L satırına önerilir). `taken`: zaten bağlı (kalem, yuva)lar.
 */
export function suggestLinks(
  products: readonly SuggestProduct[],
  items: readonly SiteMenuItem[],
  taken: Iterable<{ siteMenuId: string; slot: SiteMenuSlot }> = [],
): LinkSuggestion[] {
  const used = new Set([...taken].map((t) => slotKey(t.siteMenuId, t.slot)));
  const byKey = new Map<string, SiteMenuItem[]>();
  for (const item of items) {
    const key = menuNameKey(item.name);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  const itemById = new Map(items.map((i) => [i.id, i]));
  const byOldName = new Map<string, SiteMenuItem[]>();
  for (const [id, names] of Object.entries(SITE_OLD_NAMES)) {
    const item = itemById.get(id);
    if (!item) continue;
    for (const n of names) {
      const key = menuNameKey(n);
      byOldName.set(key, [...(byOldName.get(key) ?? []), item]);
    }
  }
  const itemKeys = items.map((i) => [i, menuNameKey(i.name)] as const);

  type Candidate = LinkSuggestion & { order: number; priceGap: number; sizeFit: number };
  const candidates: Candidate[] = [];
  products.forEach((p, order) => {
    const key = menuNameKey(p.name);
    if (!key) return;
    let found: { item: SiteMenuItem; confidence: SuggestionConfidence }[] = (byKey.get(key) ?? []).map((item) => ({ item, confidence: "exact" as const }));
    if (!found.length) found = (byOldName.get(key) ?? []).map((item) => ({ item, confidence: "known" as const }));
    if (!found.length) found = itemKeys.filter(([, k]) => similarNames(key, k)).map(([item]) => ({ item, confidence: "similar" as const }));
    for (const { item, confidence } of found) {
      const slot = defaultSlot(p.size, item);
      const sitePriceMinor = slotPriceMinor(item, slot);
      if (sitePriceMinor === null) continue;
      // Tek boy kalemin M fiyatına tek boy ya da M satır, iki boylunun yuvasına aynı boy daha uygun
      const sizeFit = isSingleSize(item) ? (p.size === "L" ? 1 : 0) : p.size === slot ? 0 : 1;
      candidates.push({
        productId: p.id,
        siteMenuId: item.id,
        slot,
        confidence,
        siteName: item.name,
        sitePriceMinor,
        siteActive: item.isActive,
        order,
        priceGap: Math.abs(toMinor(p.price) - sitePriceMinor),
        sizeFit,
      });
    }
  });
  candidates.sort((a, b) => RANK[a.confidence] - RANK[b.confidence] || a.priceGap - b.priceGap || a.sizeFit - b.sizeFit || a.order - b.order);

  const chosen = new Map<number, Candidate>();
  for (const c of candidates) {
    const k = slotKey(c.siteMenuId, c.slot);
    if (chosen.has(c.productId) || used.has(k)) continue;
    chosen.set(c.productId, c);
    used.add(k);
  }
  return [...chosen.values()]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({
      productId: c.productId,
      siteMenuId: c.siteMenuId,
      slot: c.slot,
      confidence: c.confidence,
      siteName: c.siteName,
      sitePriceMinor: c.sitePriceMinor,
      siteActive: c.siteActive,
    }));
}

export interface SiteGap {
  item: SiteMenuItem;
  /** Panelde bağlı satırı olmayan yuvalar (tek boyda yalnız M) */
  slots: SiteMenuSlot[];
}

/** Sitede olup panelde bağlısı olmayan kalemler ve yuvaları, sitenin sırasıyla */
export function siteGaps(items: readonly SiteMenuItem[], links: Iterable<{ siteMenuId: string; slot: SiteMenuSlot }>): SiteGap[] {
  const linked = new Set([...links].map((l) => slotKey(l.siteMenuId, l.slot)));
  const out: SiteGap[] = [];
  for (const item of items) {
    const slots = (isSingleSize(item) ? (["M"] as const) : (["M", "L"] as const)).filter((s) => !linked.has(slotKey(item.id, s)));
    if (slots.length) out.push({ item, slots: [...slots] });
  }
  return out;
}
