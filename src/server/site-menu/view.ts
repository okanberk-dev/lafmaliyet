import "server-only";

import { isNotNull } from "drizzle-orm";

import type { SiteMenuSlot } from "@/lib/site-menu/slot";
import { getDb, schema as s } from "@/server/db";
import { siteLinkSecret } from "@/server/site-link";

import { readMenuSyncState, readSiteSnapshot, type MenuSyncState, type SiteItemsSnapshot } from "./sync";

export interface ProductSiteLink {
  productId: number;
  siteMenuId: string;
  slot: SiteMenuSlot;
}

export interface SiteLinksView {
  /** Anahtar tanımlı mı (değilse bağlantı kapalı; ekranlar söyler, geri kalan her şey eskisi gibi) */
  configured: boolean;
  state: MenuSyncState;
  /** Son çekmedeki liste: ekranlar siteye gitmeden kalemin adını, fiyatını ve durumunu gösterir */
  snapshot: SiteItemsSnapshot;
  links: ProductSiteLink[];
}

/** Ekranlar için bağlantılar, durum ve son listenin kopyası (siteye gitmez) */
export async function loadSiteLinks(): Promise<SiteLinksView> {
  const [state, snapshot, rows] = await Promise.all([
    readMenuSyncState(),
    readSiteSnapshot(),
    getDb()
      .select({ productId: s.products.id, siteMenuId: s.products.siteMenuId, slot: s.products.siteMenuSlot })
      .from(s.products)
      .where(isNotNull(s.products.siteMenuId)),
  ]);
  const links = rows.flatMap((r) => (r.siteMenuId && r.slot ? [{ productId: r.productId, siteMenuId: r.siteMenuId, slot: r.slot }] : []));
  return { configured: Boolean(siteLinkSecret()), state, snapshot, links };
}
