import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------- Kullanıcılar
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "staff"] }).notNull().default("staff"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

// ---------------------------------------------------------------- Ayarlar (anahtar → değer)
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------- Hammaddeler
export const ingredients = pgTable("ingredients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: text("category").notNull(),
  supplier: text("supplier"),
  packageDesc: text("package_desc"),
  packagePrice: doublePrecision("package_price").notNull().default(0),
  packageSize: doublePrecision("package_size").notNull().default(1),
  unit: text("unit", { enum: ["gr", "ml", "adet", "dilim"] }).notNull(),
  vatRate: doublePrecision("vat_rate").notNull().default(0.01),
  note: text("note"),
  isEstimate: boolean("is_estimate").notNull().default(false),
  priceSource: text("price_source", { enum: ["manual", "water"] }).notNull().default("manual"),
  countUnit: text("count_unit", { enum: ["KG", "LT", "ADET", "DİLİM"] }),
  countGroup: text("count_group"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  updatedAt: updatedAt(),
});

/** Hammadde fiyat geçmişi (her fiyat değişikliğinde bir satır) */
export const ingredientPrices = pgTable(
  "ingredient_prices",
  {
    id: serial("id").primaryKey(),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    packagePrice: doublePrecision("package_price").notNull(),
    packageSize: doublePrecision("package_size").notNull(),
    note: text("note"),
    changedBy: text("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ingredient_prices_ingredient_idx").on(t.ingredientId)],
);

// ---------------------------------------------------------------- Ürünler & reçeteler
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    size: text("size", { enum: ["M", "L", "Tek"] }).notNull(),
    price: doublePrecision("price").notNull().default(0),
    fireOverride: doublePrecision("fire_override"),
    note: text("note"),
    active: boolean("active").notNull().default(true),
    showOnMenu: boolean("show_on_menu").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("products_name_size_uq").on(t.name, t.size)],
);

export const recipeItems = pgTable(
  "recipe_items",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "restrict" }),
    qty: doublePrecision("qty").notNull().default(0),
    qtyExpr: text("qty_expr"),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("recipe_items_product_idx").on(t.productId), index("recipe_items_ingredient_idx").on(t.ingredientId)],
);

// ---------------------------------------------------------------- Aylar & satışlar
export const months = pgTable("months", {
  month: text("month").primaryKey(), // YYYY-MM
  openDays: integer("open_days"),
  posRevenue: doublePrecision("pos_revenue"),
  discounts: doublePrecision("discounts").notNull().default(0),
  offRevenue: doublePrecision("off_revenue").notNull().default(0),
  note: text("note"),
  updatedAt: updatedAt(),
});

export const salesLines = pgTable(
  "sales_lines",
  {
    id: serial("id").primaryKey(),
    month: text("month")
      .notNull()
      .references(() => months.month, { onDelete: "cascade" }),
    posName: text("pos_name").notNull(),
    qty: doublePrecision("qty").notNull().default(0),
    revenue: doublePrecision("revenue").notNull().default(0),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    isService: boolean("is_service").notNull().default(false),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("sales_lines_month_idx").on(t.month)],
);

/** POS ürün adı → menü ürünü eşleştirme hafızası (her ay yeniden eşleştirmemek için) */
export const posMappings = pgTable("pos_mappings", {
  posName: text("pos_name").primaryKey(), // normalize edilmiş (büyük harf, tek boşluk)
  productId: integer("product_id").references(() => products.id, { onDelete: "cascade" }),
  isService: boolean("is_service").notNull().default(false),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------- Faturalar
export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    date: text("date").notNull(), // YYYY-MM-DD
    supplier: text("supplier").notNull(),
    description: text("description"),
    invoiceNo: text("invoice_no"),
    category: text("category").notNull(),
    amount: doublePrecision("amount").notNull().default(0),
    discount: doublePrecision("discount").notNull().default(0),
    payable: doublePrecision("payable").notNull().default(0),
    unpaid: boolean("unpaid").notNull().default(false),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("invoices_date_idx").on(t.date)],
);

// ---------------------------------------------------------------- Personel & giderler
export const staff = pgTable("staff", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  netSalary: doublePrecision("net_salary").notNull().default(0),
  extras: doublePrecision("extras").notNull().default(0),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const fixedExpenses = pgTable("fixed_expenses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  section: text("section", { enum: ["personel", "faturalar", "kira", "genel"] }).notNull(),
  period: text("period", { enum: ["aylik", "gunluk", "haftalik", "yillik"] }).notNull().default("aylik"),
  amount: doublePrecision("amount").notNull().default(0),
  note: text("note"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const investments = pgTable("investments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  amount: doublePrecision("amount").notNull().default(0),
  date: text("date"),
  note: text("note"),
});

/** Gelir-Gider tablosunda elle girilen ya da üzerine yazılan hücreler */
export const pnlEntries = pgTable(
  "pnl_entries",
  {
    id: serial("id").primaryKey(),
    month: text("month").notNull(),
    rowKey: text("row_key").notNull(),
    amount: doublePrecision("amount").notNull(),
    note: text("note"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("pnl_entries_month_row_uq").on(t.month, t.rowKey)],
);

// ---------------------------------------------------------------- Stok sayımı & tutarlılık
export const stockCounts = pgTable(
  "stock_counts",
  {
    id: serial("id").primaryKey(),
    month: text("month").notNull(),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    qty: doublePrecision("qty").notNull(),
    countedBy: text("counted_by"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("stock_counts_month_ingredient_uq").on(t.month, t.ingredientId)],
);

export const stockExtras = pgTable("stock_extras", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("ADET"),
  qty: doublePrecision("qty").notNull().default(0),
  unitPrice: doublePrecision("unit_price").notNull().default(0),
});

/** Tutarlılık kontrolü için ay içinde faturayla alınan miktar (malzemenin kendi biriminde) */
export const purchaseQuantities = pgTable(
  "purchase_quantities",
  {
    id: serial("id").primaryKey(),
    month: text("month").notNull(),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    qty: doublePrecision("qty").notNull(),
    note: text("note"),
  },
  (t) => [uniqueIndex("purchase_quantities_month_ingredient_uq").on(t.month, t.ingredientId)],
);

export const findings = pgTable("findings", {
  id: serial("id").primaryKey(),
  section: text("section").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: createdAt(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

/** Kim, ne zaman, neyi değiştirdi */
export const activityLog = pgTable(
  "activity_log",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    userName: text("user_name"),
    action: text("action").notNull(),
    detail: text("detail"),
  },
  (t) => [index("activity_log_at_idx").on(t.at)],
);
