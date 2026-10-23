import { tl } from "@/lib/format";

import type { SiteMenuItem } from "./schema";
import { fromMinor, slotPriceMinor, toMinor, visibilityFromSite, type SiteMenuSlot } from "./slot";

/**
 * Sitenin listesini panelin bağlı satırlarına uygulama planı (saf; sunucu yazar, testler sınar):
 *
 * - Fiyat: yuvanın sitedeki fiyatı (M → priceMinor, L → priceMinorL), kuruş / 100. Kuruşu aynıysa dokunulmaz.
 * - L yuvası ama kalem sitede tek boy (priceMinorL = 0): bağlantı kopuk; satıra hiçbir şey yazılmaz (ne fiyat ne
 *   menü durumu: o boy sitede yok), yönetici bağlantıyı düzeltene kadar listede gösterilir.
 * - Menü durumu: Tükendi → showOnMenu = false (active'e dokunulmaz); Satışta → showOnMenu = true ve active = true.
 *   Bir kaleme bağlı M ve L satırı aynı durumu alır (boy boy satış durumu sitede yok).
 * - Kalem listede yoksa (sitede silinmiş): bağlantı kaldırılır, satırın fiyatı ve durumu kalır.
 *
 * `partial`: liste sitenin bütün menüsü değil (yazma ucunun yanıtındaki tek kalem); listede olmayan bağlı satırlara
 * dokunulmaz.
 */

export interface LinkedRow {
  id: number;
  name: string;
  size: string;
  /** TL, KDV dahil */
  price: number;
  active: boolean;
  showOnMenu: boolean;
  siteMenuId: string;
  siteMenuSlot: SiteMenuSlot;
}

export interface SaleValues {
  price: number;
  active: boolean;
  showOnMenu: boolean;
}

export interface RowChange {
  productId: number;
  /** "Latte L" */
  label: string;
  siteMenuId: string;
  slot: SiteMenuSlot;
  /** Yalnız değişen alanlar */
  set: Partial<SaleValues>;
  before: SaleValues;
}

export interface BrokenLink {
  productId: number;
  label: string;
  siteMenuId: string;
  slot: SiteMenuSlot;
  /** Kalemin sitedeki adı */
  siteName: string;
}

export interface UnlinkedRow {
  productId: number;
  label: string;
  siteMenuId: string;
  slot: SiteMenuSlot;
}

export interface MenuSyncPlan {
  changes: RowChange[];
  broken: BrokenLink[];
  unlinked: UnlinkedRow[];
}

/** Ürünün işlem geçmişindeki ve bildirimdeki adı */
export const rowLabel = (row: { name: string; size: string }) => `${row.name} ${row.size}`;

/** Bir satırın sitedeki kaleme göre olması gereken satış değerleri; L yuvası ve kalem tek boysa null (kopuk) */
export function targetValues(item: SiteMenuItem, row: Pick<LinkedRow, "price" | "active" | "showOnMenu" | "siteMenuSlot">): SaleValues | null {
  const priceMinor = slotPriceMinor(item, row.siteMenuSlot);
  if (priceMinor === null) return null;
  const price = toMinor(row.price) === priceMinor ? row.price : fromMinor(priceMinor);
  return { price, ...visibilityFromSite(item.isActive, row) };
}

/** İki değer kümesinin farkı (fiyat kuruşuyla karşılaştırılır) */
export function diffValues(before: SaleValues, after: SaleValues): Partial<SaleValues> {
  const set: Partial<SaleValues> = {};
  if (toMinor(before.price) !== toMinor(after.price)) set.price = after.price;
  if (before.active !== after.active) set.active = after.active;
  if (before.showOnMenu !== after.showOnMenu) set.showOnMenu = after.showOnMenu;
  return set;
}

export function planMenuSync(siteItems: readonly SiteMenuItem[], rows: readonly LinkedRow[], opts: { partial?: boolean } = {}): MenuSyncPlan {
  const byId = new Map(siteItems.map((i) => [i.id, i]));
  const plan: MenuSyncPlan = { changes: [], broken: [], unlinked: [] };
  for (const row of rows) {
    const item = byId.get(row.siteMenuId);
    const ref = { productId: row.id, label: rowLabel(row), siteMenuId: row.siteMenuId, slot: row.siteMenuSlot };
    if (!item) {
      if (!opts.partial) plan.unlinked.push(ref);
      continue;
    }
    const target = targetValues(item, row);
    if (!target) {
      plan.broken.push({ ...ref, siteName: item.name });
      continue;
    }
    const before = { price: row.price, active: row.active, showOnMenu: row.showOnMenu };
    const set = diffValues(before, target);
    if (Object.keys(set).length) plan.changes.push({ ...ref, set, before });
  }
  return plan;
}

/** Bir değişikliğin okunur hâli: "195 ₺ → 200 ₺ · QR menüden kaldırıldı" */
export function changeText(change: Pick<RowChange, "set" | "before">): string {
  const parts: string[] = [];
  const money = (v: number) => tl(v, Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2);
  if (change.set.price !== undefined) parts.push(`${money(change.before.price)} → ${money(change.set.price)}`);
  if (change.set.showOnMenu === false) parts.push("QR menüden kaldırıldı (sitede Tükendi)");
  if (change.set.showOnMenu === true || change.set.active === true) parts.push("menüye açıldı (sitede Satışta)");
  return parts.join(" · ");
}

/** İşlem geçmişine düşen özet: "Latte L: 210 ₺ → 215 ₺; Mocha M: QR menüden kaldırıldı …" (en çok 500 karakter) */
export function planSummary(changes: readonly RowChange[]): string {
  return changes
    .map((c) => `${c.label}: ${changeText(c)}`)
    .join("; ")
    .slice(0, 500);
}

/**
 * Panelin siteye yazıp sitenin kabul ettiği kalemler: kalem kimliği → sitenin yanıtındaki `updatedAt` ve yazımın anı
 * (integration_state `menu_sync` › `pushed`). Bir saat tutulur.
 */
export type PushedStamps = Record<string, { updatedAt: string; at: string }>;

/** Bir yazımın damgası bu kadar tutulur: o sırada okunmuş listeler çoktan gelmiştir */
export const PUSHED_KEEP_MS = 60 * 60_000;

/** Süresi geçmemiş damgalar (bozuk ve eskiler atılır) */
export function freshStamps(stamps: PushedStamps | null | undefined, nowMs: number): PushedStamps {
  const out: PushedStamps = {};
  for (const [id, v] of Object.entries(stamps ?? {})) {
    const at = Date.parse(v?.at ?? "");
    if (Number.isFinite(at) && nowMs - at < PUSHED_KEEP_MS && Number.isFinite(Date.parse(v.updatedAt))) out[id] = v;
  }
  return out;
}

/**
 * Listede panelin kendi yazımından eski kalan kalemler. Site listenin zamanını (`now`) kalemleri okuduktan sonra alır:
 * yazımdan hemen önce okunmuş bir liste yazımdan sonraki bir `now` taşıyabilir ve son yazımı geri alırdı (toplu fiyat
 * değişikliğinde bir ürünün fiyatı birkaç saniye eskiye dönüp fiyat geçmişine sitenin yapmadığı bir değişiklik olarak
 * düşüyordu). Bu kalemlere bağlı satırlar o çekmede uygulanmaz; kalem listede kalır (bağlantı kaldırılmaz), sonraki
 * çekme yeni hâli getirir. Kalemin zamanı okunamıyorsa eski sayılmaz.
 */
export function staleItemIds(items: readonly Pick<SiteMenuItem, "id" | "updatedAt">[], stamps: PushedStamps): Set<string> {
  const stale = new Set<string>();
  for (const i of items) {
    const pushed = stamps[i.id];
    const listed = Date.parse(i.updatedAt);
    if (pushed && Number.isFinite(listed) && listed < Date.parse(pushed.updatedAt)) stale.add(i.id);
  }
  return stale;
}
