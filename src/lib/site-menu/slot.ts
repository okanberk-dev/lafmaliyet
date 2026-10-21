import type { SiteMenuItem } from "./schema";

/**
 * Panel satırı ↔ sitedeki fiyat. Sitede bir kalem iki boy fiyatı taşır (priceMinor = M ya da tek fiyat,
 * priceMinorL = L, 0 = tek boy); panelde her boy ayrı satırdır. Satırın bağlı olduğu yuva: M → priceMinor,
 * L → priceMinorL. Fiyat sitede kuruş tamsayı, panelde TL (ikisi de KDV dahil).
 *
 * Menüde mi: sitede isActive ("Satışta" / "Tükendi"); panelde active (ürün yaşıyor) ve showOnMenu (QR menüde).
 */

export type SiteMenuSlot = "M" | "L";
export const SITE_MENU_SLOTS: readonly SiteMenuSlot[] = ["M", "L"];

/** TL → kuruş (sözleşme: Math.round(TL * 100)) */
export const toMinor = (tl: number): number => Math.round(tl * 100);

/** Kuruş → TL */
export const fromMinor = (minor: number): number => minor / 100;

/** Yuvanın sitedeki fiyat alanı (yazma ucunun gövdesinde) */
export const slotField = (slot: SiteMenuSlot): "priceMinor" | "priceMinorL" => (slot === "M" ? "priceMinor" : "priceMinorL");

/** Kalem sitede tek boy mu (L fiyatı yok) */
export const isSingleSize = (item: Pick<SiteMenuItem, "priceMinorL">): boolean => !(item.priceMinorL > 0);

/**
 * Bu yuvanın sitedeki fiyatı (kuruş). L yuvası ve kalem tek boysa (priceMinorL = 0) null: bağlantı kopuk, panelin
 * fiyatına dokunulmaz.
 */
export function slotPriceMinor(item: Pick<SiteMenuItem, "priceMinor" | "priceMinorL">, slot: SiteMenuSlot): number | null {
  if (slot === "M") return item.priceMinor;
  return item.priceMinorL > 0 ? item.priceMinorL : null;
}

/** Ekrandaki yuva adı: tek boy kalemde "tek fiyat", iki boyda "M fiyatı" / "L fiyatı" */
export function slotLabel(slot: SiteMenuSlot, item?: Pick<SiteMenuItem, "priceMinorL"> | null): string {
  if (slot === "M" && item && isSingleSize(item)) return "tek fiyat";
  return `${slot} fiyatı`;
}

export interface Visibility {
  active: boolean;
  showOnMenu: boolean;
}

/** Panel → site: ürün yaşıyor ve QR menüde ise sitede "Satışta" */
export const panelIsActive = (row: Visibility): boolean => row.active && row.showOnMenu;

/**
 * Site → panel: "Tükendi" QR menüden kaldırır, active'e dokunmaz (tükenen kalem geçicidir, maliyet analizinden
 * düşmemeli); "Satışta" ikisini de açar (sitede satılan şey panelde emekli olamaz).
 */
export function visibilityFromSite(isActive: boolean, row: Visibility): Visibility {
  return isActive ? { active: true, showOnMenu: true } : { active: row.active, showOnMenu: false };
}

/** Panel ürününün boyuna göre önerilen yuva: L boy L fiyatına (kalem iki boyluysa), geri kalanı M'ye */
export function defaultSlot(size: string, item: Pick<SiteMenuItem, "priceMinorL">): SiteMenuSlot {
  return size === "L" && !isSingleSize(item) ? "L" : "M";
}

/** Bağlantının durumu: kalem son listede yok (missing), L yuvası ama kalem tek boy (broken) ya da çalışıyor */
export type LinkStatus = "ok" | "broken" | "missing";

export function linkStatus(item: Pick<SiteMenuItem, "priceMinor" | "priceMinorL"> | null | undefined, slot: SiteMenuSlot): LinkStatus {
  if (!item) return "missing";
  return slotPriceMinor(item, slot) === null ? "broken" : "ok";
}
