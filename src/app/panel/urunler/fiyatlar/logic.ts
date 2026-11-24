// Fiyatlar ekranının saf yardımcıları: toplu değişikliğin süzgeçleri (adresteki adlar Ürün listesiyle aynı: ?kategori,
// ?boy, ?ara, ?pasif) ve Ürün listesindeki "Toplu fiyat" bağlantısı. tests/fiyatlar.test.ts ile sınanır.

import { matches } from "@/components/ui/filters";
import type { Size } from "@/lib/calc/types";
import { SIZE_LABELS, SIZES } from "@/lib/constants";

export const FIYATLAR_HREF = "/panel/urunler/fiyatlar";

export type FiyatlarTab = "toplu" | "kasa" | "gecmis" | "sube" | "eski";

const TABS: readonly FiyatlarTab[] = ["toplu", "kasa", "gecmis", "sube", "eski"];

/** ?sekme: boş = Toplu değiştir; "sube" Şube fiyatı, "eski" Eski fiyattan satılanlar */
export function tabOf(sekme: string | string[] | undefined): FiyatlarTab {
  return TABS.includes(sekme as FiyatlarTab) ? (sekme as FiyatlarTab) : "toplu";
}

/** "3,5" → [3, 5]; bozuk parçalar atlanır, her kimlik bir kez */
export function parseCategoryParam(v: string | null | undefined): number[] {
  const ids = (v ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)];
}

export function parseSizeParam(v: string | null | undefined): Size | null {
  return SIZES.includes(v as Size) ? (v as Size) : null;
}

export interface BulkFilters {
  categories: number[];
  size: Size | null;
  q: string;
  includeInactive: boolean;
}

/**
 * Ürün aramasının metni: ad, boyun kodu (M) ve görünen adı (Medium), kategori, not ve site işareti ("Sitede", "Bağlı
 * değil"). Ürün listesi de bunu kullanır: "Toplu fiyat" listenin gösterdiği ürünlerle açılsın (aynı arama, aynı sonuç).
 */
export const productSearchText = (r: { name: string; size: string; category: string; note?: string | null; siteText?: string | null }) =>
  `${r.name} ${r.size} ${SIZE_LABELS[r.size as Size] ?? r.size} ${r.category} ${r.note ?? ""} ${r.siteText ?? ""}`;

/** Toplu değişikliğe giren ürünler: pasifler yalnız istenirse (sahibin kararı D5) */
export function filterBulkRows<T extends { name: string; size: string; category: string; categoryId: number; active: boolean; note?: string | null; siteText?: string | null }>(
  rows: readonly T[],
  f: BulkFilters,
): T[] {
  return rows.filter(
    (r) =>
      (f.includeInactive || r.active) &&
      (!f.categories.length || f.categories.includes(r.categoryId)) &&
      (f.size === null || r.size === f.size) &&
      matches(productSearchText(r), f.q),
  );
}

/** Ürün listesinin süzgeçleriyle Fiyatlar › Toplu değiştir bağlantısı (boş olanlar yazılmaz) */
export function bulkHref(f: { categoryId?: number | null; size?: string | null; q?: string | null; includeInactive?: boolean }): string {
  const sp = new URLSearchParams();
  if (f.categoryId) sp.set("kategori", String(f.categoryId));
  if (f.size) sp.set("boy", f.size);
  if (f.q?.trim()) sp.set("ara", f.q.trim());
  if (f.includeInactive) sp.set("pasif", "1");
  const qs = sp.toString();
  return `${FIYATLAR_HREF}${qs ? `?${qs}` : ""}`;
}

/** Sekmenin adresi; toplu sekmede süzgeçler korunur, ötekilerde yalnız sekme */
export function tabHref(tab: FiyatlarTab, keep?: string): string {
  if (tab === "toplu") return `${FIYATLAR_HREF}${keep ? `?${keep}` : ""}`;
  return `${FIYATLAR_HREF}?sekme=${tab}`;
}
