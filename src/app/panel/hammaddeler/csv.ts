// Hammaddeler › CSV: görünen malzemelerin sütunları ve satırları (saf; ingredients-client.tsx indirir, testleri
// tests/csv.test.ts). Biçim src/lib/csv.ts: noktalı virgül, virgüllü ondalık, binlik ayraçsız sayı, UTF-8 BOM.

import { csvNumber, csvPercent, csvText } from "@/lib/csv";
import { activeUses } from "@/lib/ingredient-usage";

import type { IngredientRow } from "./ingredients-client";

/** CSV'nin okuduğu alanlar (malzeme listesinin satırı) */
export type IngredientCsvRow = Pick<
  IngredientRow,
  "name" | "category" | "supplier" | "packageDesc" | "packagePrice" | "packageSize" | "unit" | "unitCost" | "vatRate" | "priceSource" | "usedIn" | "monthUsage" | "isEstimate" | "active" | "note"
>;

/** Sütun adları: birimi adında (₺, %) */
export const INGREDIENT_CSV_HEADER = [
  "Malzeme",
  "Kategori",
  "Tedarikçi",
  "Paket",
  "Paket fiyatı (KDV hariç, ₺)",
  "Paket içeriği",
  "Birim",
  "Birim maliyet (KDV hariç, ₺)",
  "Alış KDV (%)",
  "Fiyat kaynağı",
  "Reçete sayısı (aktif ürün)",
  "Son ay kullanım",
  "Tahmini fiyat",
  "Aktif",
  "Not",
];

/** Malzeme satırı. Su + buzun paket fiyatı ve içeriği yok (litre maliyeti su faturasından) */
export function ingredientCsvLine(r: IngredientCsvRow): string[] {
  const water = r.priceSource === "water";
  return [
    csvText(r.name),
    csvText(r.category),
    csvText(r.supplier),
    csvText(r.packageDesc),
    water ? "" : csvNumber(r.packagePrice),
    water ? "" : csvNumber(r.packageSize, 3),
    r.unit,
    csvNumber(r.unitCost, 4),
    csvPercent(r.vatRate, 2),
    water ? "Su faturası" : "Fatura / elle",
    csvNumber(activeUses(r), 0),
    csvNumber(r.monthUsage, 2),
    r.isEstimate ? "Evet" : "",
    r.active ? "Evet" : "Hayır",
    csvText(r.note),
  ];
}

/** Başlık + satırlar */
export const ingredientCsv = (rows: readonly IngredientCsvRow[]): string[][] => [INGREDIENT_CSV_HEADER, ...rows.map(ingredientCsvLine)];
