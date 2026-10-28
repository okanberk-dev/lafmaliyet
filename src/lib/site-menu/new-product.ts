import { cleanName, nameKey } from "@/lib/count-item";

import { menuNameKey, similarNames, type SiteGap } from "./names";
import type { SiteMenuItem } from "./schema";
import { isSingleSize, slotPriceMinor, type SiteMenuSlot } from "./slot";

/**
 * "Yalnız sitede" kalemden panel ürünü açma (denetim E-48; Ürünler › Site menüsü › Yalnız sitede › "Panelde aç ve
 * bağla"). Saf: pencerenin ön dolumu (ad, kategori tahmini, boylar ve sitenin fiyatları) ve sunucunun aynı ad + boy
 * denetimi. Ürünler sunucuda tek işlemde açılır ve aynı işlemde kalemin yuvalarına bağlanır
 * (src/server/site-menu/link.ts › createLinkedProducts); fiyat ve menü durumu sitenindir.
 */

export type PanelSize = "M" | "L" | "Tek";

/** Kategori tahmininin dayanağı (pencerede yazılır; yönetici değiştirebilir) */
export type CategorySource = "pair" | "site-category" | "name";

export const CATEGORY_SOURCE_TEXT: Record<CategorySource, string> = {
  pair: "öteki boyun kategorisi",
  "site-category": "sitede aynı kategorideki ürünlerin çoğu burada",
  name: "sitedeki kategori adıyla aynı",
};

export interface NewFromSiteRow {
  slot: SiteMenuSlot;
  /** Panelde açılacak boy: iki boylu kalemde yuvanın boyu, tek boyluda "Tek" (değiştirilebilir) */
  size: PanelSize;
  /** Yuvanın sitedeki fiyatı (kuruş); ürün bu fiyatla açılır */
  priceMinor: number;
}

export interface NewFromSiteDraft {
  siteMenuId: string;
  name: string;
  categoryId: number | null;
  categorySource: CategorySource | null;
  rows: NewFromSiteRow[];
  /** Kalemin öteki yuvası panelde bağlıysa o ürünün adı ve boyu ("Matcha Latte · M"): ad ondan gelir */
  pair: { name: string; size: string } | null;
}

export interface DraftProduct {
  name: string;
  size: string;
  categoryId: number;
  link: { siteMenuId: string; slot: SiteMenuSlot } | null;
}

/** Tek boylu kalemin yuvası M'dir; panelde boyu "Tek" önerilir (yuva boydan bağımsızdır: docs/SITE-MENU.md) */
export function rowSize(item: Pick<SiteMenuItem, "priceMinorL">, slot: SiteMenuSlot): PanelSize {
  return isSingleSize(item) ? "Tek" : slot;
}

/**
 * Pencerenin ön dolumu. Ad: kalemin öteki yuvası panelde bir ürüne bağlıysa onun adı (M/L tek ürün olarak eşleşsin),
 * değilse sitedeki ad. Kategori sırayla: öteki boyun kategorisi; sitede aynı kategorideki kalemlere bağlı panel
 * ürünlerinin en çok bulunduğu kategori (eşitlikte panelin sırası); sitedeki kategori adıyla aynı ya da benzer adlı
 * panel kategorisi; bulunamazsa boş (yönetici seçer).
 */
export function newFromSiteDraft(
  gap: SiteGap,
  items: readonly SiteMenuItem[],
  products: readonly DraftProduct[],
  categories: readonly { id: number; name: string }[],
): NewFromSiteDraft {
  const item = gap.item;
  const rows = gap.slots.flatMap((slot) => {
    const priceMinor = slotPriceMinor(item, slot);
    return priceMinor === null ? [] : [{ slot, size: rowSize(item, slot), priceMinor }];
  });
  const known = new Set(categories.map((c) => c.id));
  const pair = products.find((p) => p.link?.siteMenuId === item.id && known.has(p.categoryId)) ?? products.find((p) => p.link?.siteMenuId === item.id);
  if (pair) {
    return {
      siteMenuId: item.id,
      name: pair.name,
      categoryId: known.has(pair.categoryId) ? pair.categoryId : null,
      categorySource: known.has(pair.categoryId) ? "pair" : null,
      rows,
      pair: { name: pair.name, size: pair.size },
    };
  }
  const base = { siteMenuId: item.id, name: cleanName(item.name), rows, pair: null };

  // Sitede aynı kategorideki kalemlere bağlı ürünler hangi panel kategorisinde
  const sameSiteCategory = new Set(items.filter((i) => i.id !== item.id && i.categoryKey && i.categoryKey === item.categoryKey).map((i) => i.id));
  const votes = new Map<number, number>();
  for (const p of products) if (p.link && sameSiteCategory.has(p.link.siteMenuId) && known.has(p.categoryId)) votes.set(p.categoryId, (votes.get(p.categoryId) ?? 0) + 1);
  if (votes.size) {
    const best = Math.max(...votes.values());
    const winner = categories.find((c) => votes.get(c.id) === best)!;
    return { ...base, categoryId: winner.id, categorySource: "site-category" };
  }

  const label = menuNameKey(item.categoryLabel);
  const byName = label ? (categories.find((c) => menuNameKey(c.name) === label) ?? categories.find((c) => similarNames(menuNameKey(c.name), label))) : undefined;
  if (byName) return { ...base, categoryId: byName.id, categorySource: "name" };
  return { ...base, categoryId: null, categorySource: null };
}

/**
 * Aynı ad + boyda bekleyen yeni ürün önerisi varken (pendingProposalIssue) metnin sonu: öneri onaylanınca ürün
 * personelin reçetesiyle açılır, sitedeki kaleme Öneriler sekmesinden (aynı ad) bağlanır.
 */
export const NEW_FROM_SITE_PENDING_THEN = "önce Onaylar'da onaylayın (ürün reçetesiyle açılır), sonra Öneriler sekmesinden bağlayın";

/**
 * Aynı ad + boyda panel ürünü (Türkçe büyük/küçük harf ve boşluk farkı gözetmeden): açmak yerine o ürün bağlanmalı.
 * Pencere gönderilmeden, sunucu kilit altında aynı kuralla söyler.
 */
export function newFromSiteTaken(name: string, sizes: readonly string[], products: readonly { name: string; size: string }[]): string | null {
  const key = nameKey(name);
  if (!key) return null;
  const hit = products.find((p) => sizes.includes(p.size) && nameKey(p.name) === key);
  if (!hit) return null;
  return `“${hit.name} · ${hit.size}” panelde zaten var: yenisini açmak yerine onu bağlayın (Öneriler ya da Panelde bağlı değil sekmesi)`;
}
