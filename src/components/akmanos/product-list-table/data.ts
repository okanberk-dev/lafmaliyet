import {
  compareValues,
  formatListCount,
  getPageCount,
  paginateRows,
} from "@/components/akmanos/list-table";
import {
  CATEGORIES,
  DEMO_EMPTY_SEED_MOD,
  DEMO_ERROR_SEED_MOD,
  STATUS_LABELS,
  TOTAL_PRODUCTS,
  type ProductColumnKey,
  type ProductSort,
  type ProductStatus,
} from "./constants";

export type ProductRow = {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  stock: number;
  status: ProductStatus;
};

const PRODUCT_NAMES = [
  "Aurora Headphones",
  "Nimbus Sneakers",
  "Lumen Desk Lamp",
  "Cedar Water Bottle",
  "Pulse Fitness Band",
  "Drift Hoodie",
  "Echo Bluetooth Speaker",
  "Summit Backpack",
  "Nova Keyboard",
  "Harbor Candle Set",
] as const;

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function getStatusLabel(status: ProductStatus) {
  return STATUS_LABELS[status];
}

export function generateProducts(seed = 0): ProductRow[] {
  if (seed > 0 && seed % DEMO_ERROR_SEED_MOD === 0) {
    throw new Error("Failed to load products");
  }

  if (seed > 0 && seed % DEMO_EMPTY_SEED_MOD === 0) {
    return [];
  }

  return Array.from({ length: TOTAL_PRODUCTS }, (_, index) => {
    const offset = seed * 7 + index;
    const baseName = PRODUCT_NAMES[offset % PRODUCT_NAMES.length];
    const variant = (offset % 5) + 1;

    return {
      id: `product-${seed}-${index}`,
      name: `${baseName} ${variant}`,
      sku: `SKU-${1000 + offset}`,
      category: CATEGORIES[offset % CATEGORIES.length],
      price: 19 + ((offset * 13) % 280),
      stock: 4 + ((offset * 5) % 120),
      status: offset % 8 === 0 ? "archived" : "active",
    };
  });
}

export function getActiveProductCount(products: ProductRow[]) {
  return products.filter((product) => product.status === "active").length;
}

function getSortValue(product: ProductRow, key: ProductColumnKey) {
  switch (key) {
    case "name":
      return product.name;
    case "sku":
      return product.sku;
    case "category":
      return product.category;
    case "price":
      return product.price;
    case "stock":
      return product.stock;
    case "status":
      return product.status;
    default:
      return product.name;
  }
}

export function sortProducts(products: ProductRow[], sort: ProductSort) {
  const sorted = [...products];

  sorted.sort((left, right) => {
    const result = compareValues(
      getSortValue(left, sort.key),
      getSortValue(right, sort.key),
    );
    return sort.direction === "asc" ? result : -result;
  });

  return sorted;
}

export function downloadProductsCsv(products: ProductRow[]) {
  const header = ["Name", "SKU", "Category", "Price", "Stock", "Status"];
  const rows = products.map((product) => [
    product.name,
    product.sku,
    product.category,
    formatPrice(product.price),
    String(product.stock),
    getStatusLabel(product.status),
  ]);

  const csv = [header, ...rows]
    .map((row) =>
      row
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "products.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export { formatListCount, formatPrice, getPageCount, paginateRows };
