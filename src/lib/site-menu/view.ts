import { tl } from "@/lib/format";

import type { SiteMenuItem } from "./schema";
import { fromMinor, linkStatus, slotLabel, slotPriceMinor, type SiteMenuSlot } from "./slot";

/**
 * Ürün listesindeki ve kartındaki site işareti (saf): bağlı mı, bağlantı çalışıyor mu. Kalemin adı, fiyatı ve
 * durumu son çekmedeki listeden (siteye gitmeden).
 */

export type SiteMarkerKind = "linked" | "broken" | "missing" | "pending" | "none";

export interface SiteMarker {
  kind: SiteMarkerKind;
  /** Listede görünen kısa metin */
  text: string;
  /** Üzerine gelince açıklama */
  title: string;
}

/** Sitedeki fiyat ve durum: "Latte · M fiyatı 195 ₺ · Satışta" */
export function siteItemLine(item: SiteMenuItem, slot: SiteMenuSlot): string {
  const minor = slotPriceMinor(item, slot);
  return `${item.name} · ${slotLabel(slot, item)} ${minor === null ? "yok" : tl(fromMinor(minor), minor % 100 ? 2 : 0)} · ${item.isActive ? "Satışta" : "Tükendi"}`;
}

export function siteMarker(
  link: { siteMenuId: string; slot: SiteMenuSlot } | null,
  items: readonly SiteMenuItem[] | null,
): SiteMarker {
  if (!link) return { kind: "none", text: "Bağlı değil", title: "laffogato.net menüsünde bir kaleme bağlı değil: fiyatı ve menü durumu yalnız panelde" };
  if (!items) return { kind: "pending", text: "Sitede", title: `laffogato.net menüsüne bağlı (${link.siteMenuId}, ${link.slot}); site listesi henüz alınmadı` };
  const item = items.find((i) => i.id === link.siteMenuId) ?? null;
  const status = linkStatus(item, link.slot);
  if (status === "missing") {
    return { kind: "missing", text: "Sitede yok", title: `${link.siteMenuId} sitenin son listesinde yok (silinmiş olabilir): sonraki eşitlemede bağlantı kaldırılır` };
  }
  if (status === "broken") {
    return { kind: "broken", text: "Bağlantı kopuk", title: `${item!.name} sitede tek boy (L fiyatı silinmiş): fiyata dokunulmuyor; bağlantıyı kaldırın ya da M'ye bağlayın` };
  }
  return { kind: "linked", text: "Sitede", title: `laffogato.net: ${siteItemLine(item!, link.slot)}` };
}
