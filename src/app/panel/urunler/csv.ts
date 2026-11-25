// Ürünler › CSV: görünen ürünlerin sütunları ve satırları (saf; products-table.tsx indirir, testleri tests/csv.test.ts).
// Biçim src/lib/csv.ts: noktalı virgül, virgüllü ondalık, binlik ayraçsız sayı, UTF-8 BOM.

import type { Size } from "@/lib/calc/types";
import { SIZE_LABELS } from "@/lib/constants";
import { csvNumber, csvPercent, csvText } from "@/lib/csv";

import type { ProductRow } from "./products-table";

/** CSV'nin okuduğu alanlar (ürün listesinin satırı) */
export type ProductCsvRow = Pick<
  ProductRow,
  | "name"
  | "size"
  | "category"
  | "active"
  | "price"
  | "net"
  | "commission"
  | "cost"
  | "totalCost"
  | "unitProfit"
  | "margin"
  | "costRatio"
  | "suggestedPrice"
  | "status"
  | "soldQty"
  | "monthProfit"
  | "monthNet"
  | "fireRate"
  | "fireOverridden"
  | "note"
  | "hasEstimate"
  | "site"
>;

/** Sütun adları: birimi adında (₺, %); ayın sütunları ayın adıyla ("Satış adedi (Eylül 2026)") */
export function productCsvHeader(monthLabel: string): string[] {
  return [
    "Ürün",
    "Boy",
    "Kategori",
    "Satışta",
    "Satış fiyatı (KDV dahil, ₺)",
    "Net satış (KDV hariç, ₺)",
    "POS komisyonu (₺)",
    "Malzeme + ambalaj maliyeti (₺)",
    "Toplam maliyet (₺)",
    "Birim kâr (₺)",
    "Kâr marjı (%)",
    "Maliyet oranı (%)",
    "Önerilen fiyat (KDV dahil, ₺)",
    "Durum",
    `Satış adedi (${monthLabel})`,
    `Brüt kâr (${monthLabel}, ₺)`,
    `Net ciro (${monthLabel}, ₺)`,
    "Fire oranı (%)",
    "Fire oranı ürüne özel",
    "Tahmini fiyatlı malzeme",
    "Site menüsü",
    "Not",
  ];
}

const sizeLabel = (s: string) => SIZE_LABELS[s as Size] ?? s;

/**
 * Ürün satırı. Reçetesi boş üründe (Durum: Reçete yok) birim kâr, marj, maliyet oranı, önerilen fiyat ve aylık brüt kâr
 * boş: maliyeti bilinmiyor (listedeki tire ve dışa aktarılan çalışma kitabı gibi)
 */
export function productCsvLine(r: ProductCsvRow): string[] {
  const nr = r.status === "Reçete yok";
  const site = r.site?.ref ? `${r.site.ref}${r.site.kind === "linked" || r.site.kind === "pending" ? "" : ` (${r.site.text})`}` : "";
  return [
    csvText(r.name),
    sizeLabel(r.size),
    csvText(r.category),
    r.active ? "Evet" : "Hayır",
    csvNumber(r.price),
    csvNumber(r.net),
    csvNumber(r.commission),
    csvNumber(r.cost),
    csvNumber(r.totalCost),
    nr ? "" : csvNumber(r.unitProfit),
    nr ? "" : csvPercent(r.margin),
    nr ? "" : csvPercent(r.costRatio),
    nr ? "" : csvNumber(r.suggestedPrice, 0),
    r.status,
    csvNumber(r.soldQty, 0),
    nr ? "" : csvNumber(r.monthProfit),
    csvNumber(r.monthNet),
    csvPercent(r.fireRate),
    r.fireOverridden ? "Evet" : "",
    r.hasEstimate ? "Evet" : "",
    csvText(site),
    csvText(r.note),
  ];
}

/** Başlık + satırlar */
export const productCsv = (rows: readonly ProductCsvRow[], monthLabel: string): string[][] => [productCsvHeader(monthLabel), ...rows.map(productCsvLine)];
