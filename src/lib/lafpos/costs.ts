import type { Product } from "@/lib/calc/types";

/**
 * LafPOS'a giden ürün maliyetleri (saf; docs/LAFPOS.md › Ürün maliyetleri; sözleşme LafPOS deposunda
 * docs/03-ENTEGRASYON.md §4.1). Yalnız laffogato.net menüsüne bağlı ürünler (`site_menu_id`; LafPOS ürünü sitenin
 * kalemi ve boyuyla tanır) ve yalnız bu altı alan: fiyat, kâr, marj, reçete ya da hammadde gitmez. `costMinor` reçetenin
 * birim maliyeti (malzeme + fire, KDV hariç; ürün kartındaki "Maliyet", src/lib/calc/engine.ts priceProduct), kuruş.
 * Reçetesi olmayan ürün 0 gider. LafPOS bunu yalnız `rapor.maliyet` yetkisi olanlara gösterir.
 */

export interface PosCostItem {
  siteMenuId: string;
  slot: "M" | "L";
  name: string;
  size: Product["size"];
  /** Reçetenin birim maliyeti, kuruş, KDV hariç */
  costMinor: number;
  /** Ürün panelde etkin mi (Menüde aktif) */
  active: boolean;
}

/** Maliyet modelinin ürünleri (model.products) → LafPOS'un listesi, sitenin kimliğine ve boyuna göre sıralı */
export function posCostItems(products: readonly { product: Product; cost: number }[]): PosCostItem[] {
  const items: PosCostItem[] = [];
  for (const { product: p, cost } of products) {
    if (!p.siteMenuId || !p.siteMenuSlot) continue;
    items.push({
      siteMenuId: p.siteMenuId,
      slot: p.siteMenuSlot,
      name: p.name,
      size: p.size,
      costMinor: Number.isFinite(cost) ? Math.max(0, Math.round(cost * 100)) : 0,
      active: p.active,
    });
  }
  return items.sort((a, b) => (a.siteMenuId < b.siteMenuId ? -1 : a.siteMenuId > b.siteMenuId ? 1 : a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
}
