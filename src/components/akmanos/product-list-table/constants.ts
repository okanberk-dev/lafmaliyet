import type { ListSort } from "@/components/akmanos/list-table";

export const ROW_NUMBER_LABEL = "#";

export const COLUMNS = [
  { key: "name", label: "Product" },
  { key: "sku", label: "SKU" },
  { key: "category", label: "Category" },
  { key: "price", label: "Price" },
  { key: "stock", label: "Stock" },
  { key: "status", label: "Status" },
] as const;

export type ProductColumnKey = (typeof COLUMNS)[number]["key"];

export type ProductSort = ListSort<ProductColumnKey>;

export const DEFAULT_SORT: ProductSort = {
  key: "name",
  direction: "asc",
};

export type ProductStatus = "active" | "archived";

export const STATUS_LABELS: Record<ProductStatus, string> = {
  active: "Active",
  archived: "Archived",
};

export const CATEGORIES = [
  "Electronics",
  "Apparel",
  "Home",
  "Beauty",
  "Sports",
  "Books",
] as const;

export const TOTAL_PRODUCTS = 48;

export const DEMO_ERROR_SEED_MOD = 11;
export const DEMO_EMPTY_SEED_MOD = 13;
