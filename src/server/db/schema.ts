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
  /** İki adımlı doğrulama anahtarı (AES-GCM ile şifreli); kurulum onaylanana kadar totpEnabled false kalır */
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  /** Son kabul edilen TOTP zaman adımı (aynı kod iki kez kullanılamaz) */
  totpLastStep: integer("totp_last_step"),
  /** Kullanılmamış kurtarma kodlarının sha256 özetleri */
  recoveryCodes: jsonb("recovery_codes").$type<string[]>(),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  /** Parola, iki adımlı doğrulama ya da yetki değişince artar; eski oturumlar geçersiz olur */
  sessionVersion: integer("session_version").notNull().default(1),
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
    /** Faturanın nereden geldiği: elle, Excel aktarımı ya da Paraşüt eşitlemesi */
    source: text("source", { enum: ["manual", "excel", "parasut"] }).notNull().default("manual"),
    /** Kaydı ilk kim açtı; Paraşüt'e bağlanınca source "parasut" olur ama origin değişmez (iptalde silinip silinmeyeceğine bakılır) */
    origin: text("origin", { enum: ["manual", "excel", "parasut"] }).notNull().default("manual"),
    /** Paraşüt'teki gider faturası (purchase_bill) kimliği */
    externalId: text("external_id"),
    vat: doublePrecision("vat").notNull().default(0),
    /** Vade (son ödeme) tarihi, YYYY-MM-DD; ödenmemiş faturalar hatırlatıcıya düşer */
    dueDate: text("due_date"),
    /** Paraşüt'ün son bildirdiği "ödenmedi" değeri; panelde elle değiştirilmişse ayırt etmek için */
    parasutUnpaid: boolean("parasut_unpaid"),
    /** Kalan borç (TL, KDV dahil); kısmen ödenmiş faturada hatırlatıcı bunu gösterir */
    outstanding: doublePrecision("outstanding"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("invoices_date_idx").on(t.date), uniqueIndex("invoices_external_id_uq").on(t.externalId)],
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

// ---------------------------------------------------------------- Paraşüt entegrasyonu
/** Entegrasyon durumu: şifrelenmiş erişim belirteci, eşitleme imleci (anahtar → değer) */
export const integrationState = pgTable("integration_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

/** Her eşitleme çalışmasının kaydı */
export const parasutSyncRuns = pgTable(
  "parasut_sync_runs",
  {
    id: serial("id").primaryKey(),
    trigger: text("trigger", { enum: ["cron", "manual"] }).notNull(),
    status: text("status", { enum: ["running", "ok", "error"] }).notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    fetched: integer("fetched").notNull().default(0),
    created: integer("created").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    removed: integer("removed").notNull().default(0),
    message: text("message"),
  },
  (t) => [index("parasut_sync_runs_started_idx").on(t.startedAt)],
);

/** Paraşüt faturasının kalemleri (purchase_bill_details); hammaddeye bağlanınca alınan miktar ve fiyat buradan hesaplanır */
export const parasutBillLines = pgTable(
  "parasut_bill_lines",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    productKey: text("product_key").notNull(),
    productName: text("product_name").notNull(),
    description: text("description"),
    quantity: doublePrecision("quantity").notNull().default(0),
    unit: text("unit"),
    unitPrice: doublePrecision("unit_price").notNull().default(0),
    discount: doublePrecision("discount").notNull().default(0),
    vatRate: doublePrecision("vat_rate").notNull().default(0),
    netTotal: doublePrecision("net_total").notNull().default(0),
  },
  (t) => [uniqueIndex("parasut_bill_lines_external_uq").on(t.externalId), index("parasut_bill_lines_product_idx").on(t.productKey)],
);

/** Paraşüt ürünü → hammadde eşleştirmesi. factor: Paraşüt'teki 1 birim kaç hammadde birimi (ör. 1 koli = 12000 ml) */
export const parasutProductLinks = pgTable("parasut_product_links", {
  id: serial("id").primaryKey(),
  productKey: text("product_key").notNull().unique(),
  productName: text("product_name").notNull(),
  ingredientId: integer("ingredient_id")
    .notNull()
    .references(() => ingredients.id, { onDelete: "cascade" }),
  factor: doublePrecision("factor").notNull().default(1),
  /** Yeni faturadaki birim fiyat hammaddenin paket fiyatını güncellesin mi */
  updatePrice: boolean("update_price").notNull().default(true),
  createdAt: createdAt(),
});

/** Paraşüt faturasına panel kategorisi verme kuralları (ilk eşleşen kazanır, öncelik küçükten büyüğe) */
export const parasutCategoryRules = pgTable("parasut_category_rules", {
  id: serial("id").primaryKey(),
  matchType: text("match_type", { enum: ["supplier", "parasut_category", "keyword"] }).notNull(),
  pattern: text("pattern").notNull(),
  category: text("category").notNull(),
  priority: integer("priority").notNull().default(100),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- Hatırlatıcılar ve bildirimler
/**
 * Ödeme ve beyan hatırlatıcıları. dueDate her zaman sıradaki (bekleyen) tarihtir; tekrar eden bir hatırlatıcı
 * "ödendi" işaretlenince anchorDate'in gününe göre bir sonraki döneme ilerler.
 */
export const reminders = pgTable(
  "reminders",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    kind: text("kind", { enum: ["odeme", "vergi", "kira", "maas", "fatura", "diger"] }).notNull().default("odeme"),
    amount: doublePrecision("amount"),
    dueDate: text("due_date").notNull(),
    anchorDate: text("anchor_date").notNull(),
    repeat: text("repeat", { enum: ["none", "weekly", "monthly", "quarterly", "yearly"] }).notNull().default("none"),
    remindDaysBefore: integer("remind_days_before").notNull().default(3),
    note: text("note"),
    active: boolean("active").notNull().default(true),
    lastDoneAt: timestamp("last_done_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("reminders_due_idx").on(t.dueDate)],
);

/** Hatırlatma e-postalarının gideceği adresler */
export const notificationRecipients = pgTable("notification_recipients", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Gönderilen bildirimler; key aynı hatırlatmanın iki kez gitmesini önler (ör. "reminder:4:2026-10-28:before") */
export const notificationLog = pgTable(
  "notification_log",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    channel: text("channel").notNull().default("email"),
    subject: text("subject"),
    recipients: text("recipients"),
    ok: boolean("ok").notNull().default(true),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notification_log_key_uq").on(t.key), index("notification_log_sent_idx").on(t.sentAt)],
);
