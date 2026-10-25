import "server-only";

import { isNotNull } from "drizzle-orm";

import type { SiteMenuItem } from "@/lib/site-menu/schema";
import { linkStatus, type SiteMenuSlot } from "@/lib/site-menu/slot";
import { markerValid, soldOutBoard, type SoldOutEntry, type SoldOutFact, type SoldOutItem, type SoldOutRow } from "@/lib/site-menu/sold-out";
import { getDb, schema as s } from "@/server/db";
import { siteLinkSecret } from "@/server/site-link";
import { readMarkers } from "@/server/site-menu/sold-out-store";
import { readSiteSnapshot } from "@/server/site-menu/sync";

/**
 * Tükenenler kartının okuyucusu (dalga 10 §2.1; kurallar src/lib/site-menu/sold-out.ts). İki rol de okur; personel
 * yükleyicisi olduğu için sabit sütunlu (tests/personel-sizinti-ops.test.ts): ürünlerden yalnız kimlik, ad, boy,
 * bağlantı ve "Menüde aktif"; sitenin kaleminden yalnız kimlik, ad, kategori, durum ve damga (fiyatlar sunucuda
 * atılır, bağlantının durumu önce hesaplanır). Siteye gitmez: son listenin kopyasından okur.
 */

/** Ürünlerden okunan sütunlar (fiyat, maliyet ve kasanın fiyatı yok) */
const ROW_COLUMNS = {
  id: s.products.id,
  name: s.products.name,
  size: s.products.size,
  siteMenuId: s.products.siteMenuId,
  siteMenuSlot: s.products.siteMenuSlot,
  active: s.products.active,
};

/** Sitenin kalemini fiyatsız kopyaya indirir */
export function toSoldOutItem(i: SiteMenuItem): SoldOutItem {
  return { id: i.id, name: i.name, categoryLabel: i.categoryLabel, isActive: i.isActive, updatedAt: i.updatedAt };
}

/**
 * Bağlı satırlar (fiyatsız) ve kalemlerin fiyatsız kopyası. Bağlantının durumu (L yuvası ama kalem tek boy: kopuk)
 * fiyat atılmadan önce hesaplanır.
 */
async function boardInputs(): Promise<{ rows: SoldOutRow[]; items: SoldOutItem[] }> {
  const [linked, snapshot] = await Promise.all([getDb().select(ROW_COLUMNS).from(s.products).where(isNotNull(s.products.siteMenuId)), readSiteSnapshot()]);
  const byId = new Map(snapshot.items.map((i) => [i.id, i]));
  const rows = linked.flatMap((r): SoldOutRow[] => {
    if (!r.siteMenuId || (r.siteMenuSlot !== "M" && r.siteMenuSlot !== "L")) return [];
    const slot: SiteMenuSlot = r.siteMenuSlot;
    return [{ id: r.id, name: r.name, size: r.size, siteMenuId: r.siteMenuId, siteMenuSlot: slot, link: linkStatus(byId.get(r.siteMenuId), slot), active: r.active }];
  });
  return { rows, items: snapshot.items.map(toSoldOutItem) };
}

export interface SoldOutView {
  /** Site bağlantısı kurulu (değilse kart çizilmez) */
  configured: boolean;
  entries: SoldOutEntry[];
}

/** Bar ekranının Tükenenler kartı ve penceresi */
export async function loadSoldOut(): Promise<SoldOutView> {
  if (!siteLinkSecret()) return { configured: false, entries: [] };
  const [{ rows, items }, record] = await Promise.all([boardInputs(), readMarkers()]);
  return { configured: true, entries: soldOutBoard(rows, items, record.items) };
}

/**
 * Bugün, zil ve sabah e-postasının olgusu: kartla kapatılıp kaydı hâlâ geçerli ürünler (kalem, ad, kim, ne zaman),
 * en eskisi önce. Kayıt yoksa ürünlere bakılmaz.
 */
export async function soldOutFacts(): Promise<{ names: string[]; items: SoldOutFact[] } | null> {
  const record = await readMarkers();
  if (!Object.keys(record.items).length) return null;
  const { rows, items } = await boardInputs();
  const byId = new Map(items.map((i) => [i.id, i]));
  const facts = soldOutBoard(rows, items, record.items)
    .filter((e) => e.state === "card" && e.marker && markerValid(record.items[e.id], byId.get(e.id)))
    .map((e) => ({ id: e.id, name: e.name, by: e.marker!.by, at: e.marker!.at, staff: e.marker!.staff }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return facts.length ? { names: facts.map((f) => f.name), items: facts } : null;
}

/** Ürün kartının notu (yönetici): kalem kartla kapatıldıysa kim ve ne zaman; yoksa null */
export async function soldOutNoteFor(siteMenuId: string | null): Promise<{ by: string; at: string; staff: boolean } | null> {
  if (!siteMenuId) return null;
  const record = await readMarkers();
  const marker = record.items[siteMenuId];
  if (!marker) return null;
  const item = (await readSiteSnapshot()).items.find((i) => i.id === siteMenuId);
  return markerValid(marker, item) ? { by: marker.by, at: marker.at, staff: marker.byRole === "staff" } : null;
}
