import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
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
/** İkili veri (belge dosyaları); postgres.js Buffer olarak okur ve yazar */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
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

/**
 * Tek kullanımlık bağlantılar: davet (kişi ilk parolasını kendisi belirler) ve parola sıfırlama. Ham anahtar
 * yalnızca bir kez gösterilir; burada sha256 özeti durur. `attempts`: bu bağlantıyla yapılan parola denemesi sayısı.
 */
export const userTokens = pgTable(
  "user_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["invite", "reset"] }).notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("user_tokens_hash_uq").on(t.tokenHash), index("user_tokens_user_idx").on(t.userId, t.kind)],
);

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
    /**
     * laffogato.net menüsündeki kalemin kimliği (mnu-0011); bağlı değilse boş. Bağlı üründe satış fiyatı ve menü
     * durumunun doğru kaynağı sitedir: panel değişikliği önce siteye yazar, sitedeki değişiklik çekilir.
     * Ayrıntı: docs/SITE-MENU.md.
     */
    siteMenuId: text("site_menu_id"),
    /** Bu satır sitedeki hangi fiyat: M = priceMinor (tek boyda tek fiyat), L = priceMinorL */
    siteMenuSlot: text("site_menu_slot", { enum: ["M", "L"] }),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("products_name_size_uq").on(t.name, t.size),
    // Bir site kaleminin bir fiyatına en çok bir panel satırı bağlanır (boş olanlar birbirini engellemez)
    uniqueIndex("products_site_menu_uq").on(t.siteMenuId, t.siteMenuSlot),
    check("products_site_menu_slot_ck", sql`${t.siteMenuSlot} is null or ${t.siteMenuSlot} in ('M', 'L')`),
    check("products_site_menu_pair_ck", sql`(${t.siteMenuId} is null) = (${t.siteMenuSlot} is null)`),
  ],
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
  // Eşleştirme anahtarı: posMatchKey (tr büyük harf, tek boşluk, İ→I, ’‘`´→'). Eski kayıtlar normalizePosName ile
  // yazıldı; createPosMappingIndex iki tarafa da posMatchKey uyguladığı için taşıma gerekmez (src/lib/calc/pos-paste.ts).
  posName: text("pos_name").primaryKey(),
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
    /**
     * Paraşüt'ün son bildirdiği "ödenmedi" değeri (gider faturasında; e-faturada boş). Paneldeki ödeme durumunu
     * kullanıcı işaretler; bu yalnız ipucudur (Tedarikçiler'de "Paraşüt'te ödendi")
     */
    parasutUnpaid: boolean("parasut_unpaid"),
    /** Kalan borç (TL, KDV dahil); kısmen ödenmiş faturada hatırlatıcı bunu gösterir */
    outstanding: doublePrecision("outstanding"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    /**
     * Paraşüt'teki gelen e-fatura (e_invoices) kimliği. "İçeri al" yapılmamış e-faturalar da panele bundan gelir;
     * sonradan içeri alınırsa gider faturası (externalId) aynı kayda bağlanır, kopya açılmaz.
     */
    eInvoiceId: text("e_invoice_id"),
    /** E-faturanın ETTN'si (GİB) */
    eInvoiceUuid: text("e_invoice_uuid"),
    /** Eşitlemenin kategorisini tahmin ettiği yeni fatura; kullanıcı onaylayınca ya da değiştirince kalkar */
    needsReview: boolean("needs_review").notNull().default(false),
    /**
     * E-faturanın UBL belgesindeki kalemlerin okunduğu an (belge okunamadıysa da yazılır, her eşitlemede yeniden
     * denenmesin). Boşsa sıradaki eşitleme okur; e-fatura değişirse yeniden boşaltılır.
     */
    ublReadAt: timestamp("ubl_read_at", { withTimezone: true }),
    /**
     * Ödeme günü (YYYY-MM-DD): "Ödendi" işaretlenirken girilen (varsayılan o gün). "Ödenmedi"ye dönünce boşalır;
     * bu sütundan önce ödenmiş faturalarda boştur.
     */
    paidAt: text("paid_at"),
    /** Ödeme şekli (Tedarikçiler'deki ödeme penceresinden; boş = belirtilmedi) */
    paidVia: text("paid_via", { enum: ["havale", "nakit", "kart", "cek", "diger"] }),
    /** Ödemesi istendiği / ödeme talebi verildiği gün (YYYY-MM-DD): ödenmemiş faturada "Talep edildi" */
    paymentRequestedAt: text("payment_requested_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("invoices_date_idx").on(t.date),
    uniqueIndex("invoices_external_id_uq").on(t.externalId),
    uniqueIndex("invoices_e_invoice_id_uq").on(t.eInvoiceId),
  ],
);

// ---------------------------------------------------------------- Tedarikçiler (cari kartları)
/**
 * Tedarikçinin cari kartı: ticari unvan, vergi numarası ve dairesi, banka (IBAN), iletişim, vade. Faturalar karta
 * yabancı anahtarla bağlanmaz, tedarikçi adıyla eşleşir (büyük/küçük harf, boşluk ve parantezli not sayılmaz;
 * src/app/panel/tedarikciler/logic.ts): `key` kartın adının anahtarı, `aliases` faturalarda geçen başka adlar. Kartı olmayan
 * tedarikçi de faturalarından Tedarikçiler ekranında görünür; kart bilgi girilince (ya da faturalı tedarikçi listeden
 * kaldırılınca, `hiddenOn`) açılır.
 * Ayrıntı: docs/TEDARIKCILER.md.
 */
export const suppliers = pgTable(
  "suppliers",
  {
    id: serial("id").primaryKey(),
    /** Faturalardaki (kısa) ad, ör. "Sütaş" */
    name: text("name").notNull(),
    /** Adın eşleşme anahtarı (supplierMatchKey): iki kart aynı adı taşıyamaz */
    key: text("key").notNull(),
    /** Aynı tedarikçinin faturalarda geçen başka adları ("SÜTAŞ SÜT ÜRÜNLERİ A.Ş."); onların faturaları da bu karttadır */
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    /** Ticari unvan (faturadaki tam ad) */
    legalName: text("legal_name"),
    /** VKN (10 hane) ya da TCKN (11 hane) */
    taxNumber: text("tax_number"),
    taxOffice: text("tax_office"),
    /** Boşluksuz, büyük harf (TR + 24 hane); ekranda dörderli gösterilir */
    iban: text("iban"),
    bankName: text("bank_name"),
    /** Hesap sahibi (unvandan farklıysa, ör. şahıs şirketinde kişinin adı) */
    accountHolder: text("account_holder"),
    /** Yetkili / satış temsilcisi */
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    /** Vade (gün): vadesi yazılmamış faturanın tahmini vadesi fatura tarihi + bu gün (boşsa Ödemeler'deki genel ayar) */
    paymentTermDays: integer("payment_term_days"),
    /** Genelde nasıl ödenir: ödeme penceresinde önce bu seçili gelir */
    paymentMethod: text("payment_method", { enum: ["havale", "nakit", "kart", "cek", "diger"] }),
    /** Peşin çalışılır: Paraşüt'ten gelen yeni faturası ödendi (fatura günü) olarak gelir */
    paidOnDelivery: boolean("paid_on_delivery").notNull().default(false),
    note: text("note"),
    /**
     * Listeden kaldırıldığı gün (YYYY-MM-DD, Türkiye). Faturası olan tedarikçi silinmez, listeden kalkar; ödenmemiş
     * faturası olunca ya da bu günden sonraki tarihli faturası gelince listeye kendiliğinden döner.
     */
    hiddenOn: text("hidden_on"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("suppliers_key_uq").on(t.key)],
);

/**
 * Fatura belgeleri: Paraşüt'ten alınan e-fatura PDF'i (önbellek; bir kez indirilir) ya da panelden yüklenen
 * PDF / fotoğraf. Dosya veritabanında durur, yalnız yöneticiye sunulur.
 */
export const invoiceDocuments = pgTable(
  "invoice_documents",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["parasut", "upload"] }).notNull(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    uploadedBy: text("uploaded_by"),
    createdAt: createdAt(),
  },
  (t) => [index("invoice_documents_invoice_idx").on(t.invoiceId)],
);

// ---------------------------------------------------------------- Personel & giderler
// Geçmiş aylar korunur: netSalary/extras ve period/amount ilk sürümden ÖNCEKİ değerlerdir (taban);
// sonraki değişiklikler *_versions tablolarında "şu aydan itibaren" satırı olarak durur.
// startMonth / endMonth (YYYY-MM, boş = sınırsız) kalemin hangi aylarda hesaba girdiğini belirler.
// active yalnızca geriye dönük uyumluluk içindir: active = endMonth boş ya da endMonth >= bu ay.
export const staff = pgTable("staff", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  netSalary: doublePrecision("net_salary").notNull().default(0),
  extras: doublePrecision("extras").notNull().default(0),
  active: boolean("active").notNull().default(true),
  startMonth: text("start_month"),
  endMonth: text("end_month"),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** Personel maaş değişiklikleri: fromMonth ayından itibaren geçerli net maaş ve ek ödemeler */
export const staffVersions = pgTable(
  "staff_versions",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    fromMonth: text("from_month").notNull(),
    netSalary: doublePrecision("net_salary").notNull().default(0),
    extras: doublePrecision("extras").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("staff_versions_staff_month_uq").on(t.staffId, t.fromMonth)],
);

export const fixedExpenses = pgTable("fixed_expenses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  section: text("section", { enum: ["personel", "faturalar", "kira", "genel"] }).notNull(),
  period: text("period", { enum: ["aylik", "gunluk", "haftalik", "yillik"] }).notNull().default("aylik"),
  amount: doublePrecision("amount").notNull().default(0),
  note: text("note"),
  active: boolean("active").notNull().default(true),
  startMonth: text("start_month"),
  endMonth: text("end_month"),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** Sabit gider tutar değişiklikleri: fromMonth ayından itibaren geçerli dönem ve tutar */
export const fixedExpenseVersions = pgTable(
  "fixed_expense_versions",
  {
    id: serial("id").primaryKey(),
    fixedExpenseId: integer("fixed_expense_id")
      .notNull()
      .references(() => fixedExpenses.id, { onDelete: "cascade" }),
    fromMonth: text("from_month").notNull(),
    period: text("period", { enum: ["aylik", "gunluk", "haftalik", "yillik"] }).notNull().default("aylik"),
    amount: doublePrecision("amount").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("fixed_expense_versions_item_month_uq").on(t.fixedExpenseId, t.fromMonth)],
);

export const investments = pgTable("investments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  amount: doublePrecision("amount").notNull().default(0),
  date: text("date"),
  note: text("note"),
});

// ---------------------------------------------------------------- Aylık harcamalar
/**
 * Aylık harcama kategorileri: her ay farklı tutarla girilen (reklam, influencer) ve fatura dışı (nakit alım,
 * bakım) giderler. Kategori Gelir-gider'de kendi satırında, seçilen bölümde (mal = mal maliyeti); Genel bakış'ta
 * "Para nereye gitti" grubunda sayılır.
 */
export const expenseCategories = pgTable("expense_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  section: text("section", { enum: ["mal", "personel", "faturalar", "kira", "genel"] }).notNull().default("genel"),
  panelGroup: text("panel_group", { enum: ["kira", "personel", "reklam", "diger"] }).notNull().default("diger"),
  /** Bu fatura kategorisindeki faturalar da bu satırda sayılır (ör. "Reklam & Tabela"); boşsa yalnız girilenler */
  invoiceCategory: text("invoice_category"),
  /** Her ay girilmesi beklenir: girilmediyse Genel bakış › Bu ayın işleri hatırlatır */
  monthly: boolean("monthly").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
});

/** Aylık harcama kayıtları: ödenen tutar gider sayılır (KDV ayrılmaz) */
export const expenseEntries = pgTable(
  "expense_entries",
  {
    id: serial("id").primaryKey(),
    date: text("date").notNull(), // YYYY-MM-DD
    categoryId: integer("category_id")
      .notNull()
      .references(() => expenseCategories.id, { onDelete: "restrict" }),
    description: text("description"),
    amount: doublePrecision("amount").notNull(),
    paymentMethod: text("payment_method", { enum: ["nakit", "kart", "havale", "diger"] }),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("expense_entries_date_idx").on(t.date), index("expense_entries_category_idx").on(t.categoryId)],
);

/** Gelir-Gider tablosunda elle girilen ya da üzerine yazılan hücreler */
export const pnlEntries = pgTable(
  "pnl_entries",
  {
    id: serial("id").primaryKey(),
    month: text("month").notNull(),
    rowKey: text("row_key").notNull(),
    amount: doublePrecision("amount").notNull(),
    /** Hücre notu (ör. "makine servisi"); Excel'deki hücre açıklamasının karşılığı */
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
    /** Sayıldığı andaki birim çarpanı (KG/LT = 1000, ADET/DİLİM = 1); sayım birimi sonradan değişse de eski değer korunur */
    factor: doublePrecision("factor"),
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
    /** "history": tedarikçi sayfasındaki "Geçmiş faturaları al" (günlük eşitlemenin sağlığına sayılmaz) */
    trigger: text("trigger", { enum: ["cron", "manual", "history"] }).notNull(),
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

// ---------------------------------------------------------------- Reçete değişiklik önerileri
/** Önerideki ve öneri anındaki reçete: satır adları da saklanır (malzeme sonra silinse ya da adı değişse de okunur) */
export type RecipeSnapshot = {
  note: string | null;
  items: { ingredientId: number; name: string; unit: string; qty: number; qtyExpr: string | null; note: string | null }[];
};

/**
 * Personelin reçete defterinden önerdiği değişiklik: yönetici önceki ve önerilen reçeteyi yan yana görür, onaylarsa
 * reçete `after` ile değişir. Kişi başına ürün başına en çok bir bekleyen öneri olur (yenisi onu günceller).
 */
export const recipeChangeRequests = pgTable(
  "recipe_change_requests",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    requestedBy: integer("requested_by").references(() => users.id, { onDelete: "set null" }),
    requestedByName: text("requested_by_name").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected", "withdrawn"] }).notNull().default("pending"),
    /** Öneri anındaki reçete: onayda bugünkü reçeteyle karşılaştırılır (arada değiştiyse yönetici uyarılır) */
    before: jsonb("before").$type<RecipeSnapshot>().notNull(),
    after: jsonb("after").$type<RecipeSnapshot>().notNull(),
    /** Personelin yöneticiye notu ("süt az geliyordu") */
    message: text("message"),
    /** Yöneticinin notu (red gerekçesi ya da açıklama) */
    reviewNote: text("review_note"),
    reviewedBy: integer("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("recipe_change_requests_status_idx").on(t.status, t.createdAt),
    index("recipe_change_requests_product_idx").on(t.productId),
    uniqueIndex("recipe_change_requests_pending_uq").on(t.productId, t.requestedBy).where(sql`status = 'pending'`),
  ],
);

// ---------------------------------------------------------------- Kişisel hatırlatıcılar
/**
 * Her kullanıcının kendi hatırlatıcıları (personel de kullanır): yalnız sahibi görür. İşletmenin ödeme
 * hatırlatıcılarından (reminders) ayrıdır; sabah e-postasına ve Ödemeler ekranına girmez. dueDate sıradaki tarihtir;
 * tekrar eden "tamamlandı" işaretlenince bir sonraki döneme ilerler, tek seferlik kapanır (active = false).
 */
export const userReminders = pgTable(
  "user_reminders",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    note: text("note"),
    dueDate: text("due_date").notNull(),
    /** "HH:MM" (Türkiye saati); boşsa gün içinde herhangi bir saat */
    dueTime: text("due_time"),
    /** Aylık tekrarın günü (31 Ocak → 28 Şubat → 31 Mart) */
    anchorDate: text("anchor_date").notNull(),
    repeat: text("repeat", { enum: ["none", "daily", "weekly", "monthly"] }).notNull().default("none"),
    active: boolean("active").notNull().default(true),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("user_reminders_user_idx").on(t.userId, t.active, t.dueDate)],
);

// ---------------------------------------------------------------- Karaoke
/**
 * Karaoke oturumları: laffogato.net'teki rezervasyonların panelde tutulan kopyası (source "site", externalId krk-…)
 * ve panelden açılan rezervasyonsuz sayaçlar (source "panel"). Eşitleme yalnız site satırlarının rezervasyon
 * alanlarını yazar; sayaç alanları (extraMinutes, endedAt) panelindir. Ayrıntı: docs/KARAOKE.md.
 */
export const karaokeSessions = pgTable(
  "karaoke_sessions",
  {
    id: serial("id").primaryKey(),
    externalId: text("external_id"),
    source: text("source", { enum: ["site", "panel"] }).notNull().default("site"),
    /** Başladığı gün (Türkiye), YYYY-MM-DD */
    date: text("date").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /** Rezervasyonun bitişi; uzatma (extraMinutes) eklenmeden */
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    guests: integer("guests"),
    /** Müşterinin yalnızca adı (soyadı, telefon, e-posta panele gelmez) ya da sayacın etiketi */
    customerName: text("customer_name"),
    note: text("note"),
    status: text("status", { enum: ["requested", "confirmed", "cancelled"] }).notNull().default("confirmed"),
    paymentStatus: text("payment_status", { enum: ["none", "pending", "paid", "refunding", "refunded", "expired"] }).notNull().default("none"),
    /** Sitenin tuttuğu toplam (kuruş); yalnız yönetici görür */
    totalMinor: integer("total_minor"),
    channel: text("channel"),
    /** Sitedeki satırın updatedAt değeri (bilgi için) */
    extUpdatedAt: text("ext_updated_at"),
    /** Son eşitlemede ne oldu: zil ve bildirim metni buradan */
    lastEvent: text("last_event", { enum: ["created", "confirmed", "cancelled", "changed"] }),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    /** Panelde verilen ek süre (dakika) */
    extraMinutes: integer("extra_minutes").notNull().default(0),
    /** Erken bitirildi ya da süre dolunca "haber verdim" denildi: alarm susar */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: text("ended_by"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("karaoke_sessions_external_uq").on(t.externalId),
    index("karaoke_sessions_starts_idx").on(t.startsAt),
    index("karaoke_sessions_date_idx").on(t.date),
  ],
);

// ---------------------------------------------------------------- Anlık bildirim (Web Push)
/**
 * Tarayıcı bildirim abonelikleri (cihaz başına bir satır). Gönderim yalnız aktif kullanıcıya ve aboneliği alırken
 * geçerli olan oturum sürümüyle yapılır: parola, rol ya da erişim değişince eski cihazlara bildirim gitmez. Bildirimin
 * içeriği (başlık, kısa metin) uçtan uca şifreli gider (RFC 8291); tutar ya da kişisel veri konmaz.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh"),
    auth: text("auth"),
    /** "Chrome · Windows" gibi; cihaz listesinde gösterilir */
    label: text("label"),
    sessionVersion: integer("session_version").notNull(),
    /** Yeni karaoke rezervasyonu, iptal ve saat değişikliği */
    karaoke: boolean("karaoke").notNull().default(true),
    /** Sabahları bugünün kişisel hatırlatıcıları */
    reminders: boolean("reminders").notNull().default(true),
    /**
     * laffogato.net'ten gelen yeni uygulama siparişi (bar ekranı, docs/SITE-SIPARIS.md). Boş: kişinin rolüne göre
     * (personel cihazında açık, yöneticininkinde kapalı); cihazda değiştirilince açık ya da kapalı yazılır.
     */
    orders: boolean("orders"),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    failures: integer("failures").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint), index("push_subscriptions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------- Gün sonu kasa raporu
/**
 * Personelin her akşam ModPOS'un Z raporuna ve kasaya bakıp girdiği gün sonu raporu (iş günü başına bir satır; yeniden
 * gönderilince güncellenir, revision artar). Tutarlar TL. Olması gereken nakit = açılış + nakit satış − gün içinde
 * çıkan; kasa farkı = sayılan − olması gereken (eksi: eksik, artı: fazla). Hesap src/lib/cash-report.ts'te; farkı
 * liste ve özet için ayrıca saklanır. Ayrıntı: docs/KASA-RAPORU.md.
 */
export const cashReports = pgTable(
  "cash_reports",
  {
    id: serial("id").primaryKey(),
    /** İş günü (YYYY-MM-DD, Türkiye); gece yarısından sonra kapanan gün bir önceki güne yazılır */
    date: text("date").notNull(),
    zNo: text("z_no"),
    receipts: integer("receipts"),
    /** Z raporundaki toplam satış ve ödeme türleri */
    zTotal: doublePrecision("z_total").notNull().default(0),
    cash: doublePrecision("cash").notNull().default(0),
    card: doublePrecision("card").notNull().default(0),
    mealCard: doublePrecision("meal_card").notNull().default(0),
    online: doublePrecision("online").notNull().default(0),
    other: doublePrecision("other").notNull().default(0),
    /** Kasa: açılış (dünden devir), gün içinde çıkan (harcama, teslim), akşam sayılan, sayımdan sonra teslim edilen */
    openingCash: doublePrecision("opening_cash").notNull().default(0),
    cashOut: doublePrecision("cash_out").notNull().default(0),
    cashOutNote: text("cash_out_note"),
    countedCash: doublePrecision("counted_cash").notNull().default(0),
    handedOver: doublePrecision("handed_over").notNull().default(0),
    /** Banka POS cihazının gün sonu toplamı (ModPOS'taki kartla karşılaştırılır) */
    bankPos: doublePrecision("bank_pos"),
    /** Z raporundaki ödenmez / ikram tutarı (ciroya girmez; panelde kayıtlı ikramla karşılaştırılır) */
    offRevenue: doublePrecision("off_revenue"),
    note: text("note"),
    cashDiff: doublePrecision("cash_diff").notNull().default(0),
    submittedBy: integer("submitted_by").references(() => users.id, { onDelete: "set null" }),
    submittedByName: text("submitted_by_name").notNull(),
    revision: integer("revision").notNull().default(1),
    /** Son gönderimin e-postası: gitti, gitmedi (hata metniyle) ya da kapalı */
    emailStatus: text("email_status", { enum: ["sent", "failed", "off"] }),
    emailError: text("email_error"),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("cash_reports_date_uq").on(t.date)],
);

// ---------------------------------------------------------------- Zayi ve ikram
/**
 * Personelin gün içinde girdiği zayi (atılan, dökülen, bozulan) ve ikram (ödenmez: müşteriye, personele, tadım)
 * kayıtları. Ya bir menü ürünü (adet; malzemesi reçeteden) ya da bir hammadde (sayım ya da kendi biriminde; factor ile
 * malzemenin kendi birimine) olur; ad kayıt anında saklanır (ürün sonra silinse de okunur). Tutarlılık ekranı bunları
 * satıştan ayrı tüketim olarak gösterir, kasa raporu günün özetini taşır. Ayrıntı: docs/ZAYI-IKRAM.md.
 */
export const wasteEntries = pgTable(
  "waste_entries",
  {
    id: serial("id").primaryKey(),
    /** İş günü (YYYY-MM-DD, Türkiye) */
    date: text("date").notNull(),
    kind: text("kind", { enum: ["zayi", "ikram"] }).notNull(),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    ingredientId: integer("ingredient_id").references(() => ingredients.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    qty: doublePrecision("qty").notNull(),
    /** "adet" (ürün) ya da hammaddenin girildiği birim (KG, LT, ADET, DİLİM, gr, ml…) */
    unit: text("unit").notNull(),
    /** qty × factor = hammaddenin kendi birimi (KG → gr: 1000); ürün için 1 */
    factor: doublePrecision("factor").notNull().default(1),
    reason: text("reason"),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("waste_entries_date_idx").on(t.date)],
);
