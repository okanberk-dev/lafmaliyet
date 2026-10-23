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
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Yalnız tip (derlemede silinir): drizzle-kit'in okuduğu şemaya uygulama kodu girmez
import type { CashRevisionData } from "../../lib/cash-report";
import type { ChecklistAnswerVersion, ChecklistItemSnap } from "../../lib/checklists";
import type { InvoiceReading } from "../../lib/invoice-reading";

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

/**
 * Bilinen cihazın giriş hata payı (cihaz + kişi; src/server/auth/login-locks.ts): hesap kilidi bilinen cihazı dışarıda
 * bırakmaz, o cihazın kendi denemeleri burada sayılır (10 hatada 15 dakika). Başarılı girişte satır silinir. Yedeğe
 * girmez (geçici sayaç; src/lib/backup/format.ts).
 */
export const loginDeviceLocks = pgTable(
  "login_device_locks",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Bilinen cihaz çerezindeki kimlik (çerez imzalı; kimlik tek başına giriş sağlamaz) */
    deviceId: text("device_id").notNull(),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceId] })],
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
  /**
   * Sayım listesine girdiği ay (YYYY-MM): sayımda "Listeye ekle" ve sayim_yeni_kalemler migration'ı yazar. Daha önceki
   * aylarda, o ay sayılmadıysa listede çıkmaz (sayımı bitmiş ay "kalem kaldı" demesin). Boşsa her ayda.
   */
  countFrom: text("count_from"),
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
    /**
     * Kasada (ModPOS) hâlâ duran eski fiyat: panelde ya da sitede fiyat değişince kasa elle güncellenene kadar dolu kalır
     * ("Fiyatlar › Kasaya işle"). Boşsa kasa panelle aynı sayılır. Fiyat kasadaki fiyata geri dönerse kendiliğinden boşalır.
     */
    posStalePrice: doublePrecision("pos_stale_price"),
    /** Kasanın panelden geri kaldığı an (işlenmemiş ilk değişiklik) */
    posStaleSince: timestamp("pos_stale_since", { withTimezone: true }),
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

/** Satış fiyatı geçmişi: her fiyat değişikliğinde bir satır (panel, toplu, site, yeni ürün). Ayrıntı: docs/FIYATLAR.md */
export const productPrices = pgTable(
  "product_prices",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Önceki fiyat (TL, KDV dahil); yeni üründe boş */
    priceBefore: doublePrecision("price_before"),
    price: doublePrecision("price").notNull(),
    source: text("source", { enum: ["manual", "suggestion", "bulk", "undo", "site", "create"] }).notNull(),
    /** Panelin değişikliği laffogato.net'e de yazıldı */
    onSite: boolean("on_site").notNull().default(false),
    /** Aynı toplu değişikliğin (ve geri almasının) satırları; uuid */
    batchId: text("batch_id"),
    /** Toplu kuralın özeti ("+%10 · 5 ₺'ye yukarı · Espresso Bazlı") */
    note: text("note"),
    changedBy: text("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("product_prices_product_idx").on(t.productId, t.changedAt),
    index("product_prices_changed_idx").on(t.changedAt),
    index("product_prices_batch_idx").on(t.batchId),
  ],
);

// ---------------------------------------------------------------- Aylar & satışlar
/**
 * Ay bilgisi: yalnız elle yazılan değerler. Boş alan kasa raporlarından dolar (src/lib/cash-month.ts; hiçbir şey buraya
 * kopyalanmaz, model yüklenirken hesaplanır). İndirim ve ödenmez bu yüzden boş bırakılabilir: boş = kasa raporlarından,
 * 0 elle yazılmış sıfırdır (eski ayların sıfırları elle yazılmış sayılır).
 */
export const months = pgTable("months", {
  month: text("month").primaryKey(), // YYYY-MM
  openDays: integer("open_days"),
  posRevenue: doublePrecision("pos_revenue"),
  discounts: doublePrecision("discounts"),
  offRevenue: doublePrecision("off_revenue"),
  /** Kartlı satış oranı (0–1), elle; boşsa o ayın kasa raporlarından, o da yoksa Ayarlar › kartlı satış oranı */
  cardShare: doublePrecision("card_share"),
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
    /**
     * Tedarikçinin VKN / TCKN'si (yalnız rakam, 10 ya da 11 hane): Paraşüt gider faturasında e-belgenin `from_vkn`'i ya da
     * kişi kartının `tax_number`'ı, gelen e-faturada `from_vkn`, UBL'de satıcının kimliği. Elle ve Excel'den girilen
     * faturada boş. Tedarikçiler aynı (geçerli) vergi nolu faturaları tek tedarikçide toplar (logic.ts supplierResolver).
     * Kontrol hanesi tutmayan ya da yer tutucu numara saklanır ama eşleşmede kullanılmaz (taxKey).
     */
    supplierTaxNumber: text("supplier_tax_number"),
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

/**
 * Aylık harcama kayıtları: ödenen tutar gider sayılır (KDV ayrılmaz). Kasadan çıkan bir fişten yazılan kayıt o satıra
 * (`cashOutId`) ve fişin fotoğrafına (`photoId`) bağlıdır; tutarı ve tarihi Kasa raporu'nda düzeltilir. Bağ bu yönde:
 * db:reset harcama kayıtlarını CASCADE ile boşaltır, kasadan çıkanlar kalır (docs/FOTOGRAF.md).
 */
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
    /** Fişin fotoğrafı (kasadan çıkan satırıyla aynı fotoğraf) */
    photoId: integer("photo_id").references(() => photos.id, { onDelete: "set null" }),
    /** Fişteki toplam KDV: yalnız bilgi (tutar KDV dahil kalır; KDV tahmini perakende fişin KDV'sini düşmez) */
    vat: doublePrecision("vat"),
    /** Bu kaydı yazan kasadan çıkan satırı */
    cashOutId: integer("cash_out_id").references(() => cashOuts.id, { onDelete: "set null" }),
  },
  (t) => [
    index("expense_entries_date_idx").on(t.date),
    index("expense_entries_category_idx").on(t.categoryId),
    uniqueIndex("expense_entries_photo_uq").on(t.photoId),
    uniqueIndex("expense_entries_cash_out_uq").on(t.cashOutId),
  ],
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
    /**
     * İşlemi yapan hesap (eski kayıtlarda ve "Sistem"de boş). Ad serbest metindir ve kişi kendi adını değiştirebilir:
     * İşlem geçmişi hesabın e-postasını da gösterir, başkasının adını alan kayıt sahibini taklit edemez
     */
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
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

/**
 * Paraşüt faturasından gelen, hammaddenin şimdiki birim fiyatından %40'tan fazla farklı fiyat: kendiliğinden uygulanmaz,
 * yönetici onaylar ya da reddeder (docs/PARASUT.md 5b). Yanlış çarpan (koli ↔ adet) ya da tek seferlik bir fatura bütün
 * reçete maliyetlerini sessizce değiştirmesin. Hammadde başına en çok bir bekleyen öneri olur.
 */
export const ingredientPriceHolds = pgTable(
  "ingredient_price_holds",
  {
    id: serial("id").primaryKey(),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    // Kaleme değil faturaya bağlı: kalemler her eşitlemede silinip yeniden yazılır (sync.ts, lines.ts)
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    productKey: text("product_key").notNull(),
    productName: text("product_name").notNull(),
    /** Bağlantının öneri anındaki çarpanı: bağlantı değişirse öneri geçersiz olur */
    factor: doublePrecision("factor").notNull(),
    /** Faturadaki kalemin miktarı, birimi ve KDV hariç net tutarı (öneri anındaki kopya; kalemler yeniden yazılır) */
    quantity: doublePrecision("quantity").notNull(),
    unit: text("unit"),
    netTotal: doublePrecision("net_total").notNull(),
    invoiceDate: text("invoice_date").notNull(),
    supplier: text("supplier").notNull(),
    invoiceNo: text("invoice_no"),
    /** Önerilen paket fiyatı ve boyu (= çarpan); onaylanınca hammaddeye yazılır */
    packagePrice: doublePrecision("package_price").notNull(),
    packageSize: doublePrecision("package_size").notNull(),
    /** Öneri anında (onaylanınca: değiştirilen) paket fiyatı, boyu ve "Tahmini" işareti; "Geri al" bunları yazar */
    prevPackagePrice: doublePrecision("prev_package_price").notNull(),
    prevPackageSize: doublePrecision("prev_package_size").notNull(),
    prevIsEstimate: boolean("prev_is_estimate").notNull().default(false),
    /** Aynı hammaddenin bir önceki faturadaki birim fiyatı (₺/gr, ₺/ml, ₺/adet), tarihi, tedarikçisi; yoksa boş */
    lastUnitPrice: doublePrecision("last_unit_price"),
    lastDate: text("last_date"),
    lastSupplier: text("last_supplier"),
    /** Arka arkaya kaç faturada benzer (±%10) fiyat geldi: 2+ ise fiyat büyük olasılıkla gerçek */
    repeats: integer("repeats").notNull().default(1),
    status: text("status", { enum: ["pending", "approved", "rejected", "superseded"] }).notNull().default("pending"),
    /** Geçersiz kalma nedeni ("Daha yeni fatura geldi", "Çarpan değişti") ya da yöneticinin red notu */
    note: text("note"),
    /** Reddederken bu ürünün fiyat güncellemesi kapatıldı (geri almada yeniden açılır) */
    stoppedUpdates: boolean("stopped_updates").notNull().default(false),
    decidedBy: integer("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedByName: text("decided_by_name"),
    /** Karar ya da geçersiz kalma anı ("Son kararlar" son 3 günü gösterir, "Geri al" 30 gün geçerli) */
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ingredient_price_holds_pending_uq").on(t.ingredientId).where(sql`status = 'pending'`),
    index("ingredient_price_holds_status_idx").on(t.status, t.createdAt),
  ],
);

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

// ---------------------------------------------------------------- Günlük işler (Vercel Cron)
/**
 * Zamanlanmış işlerin her çalışması: başlarken "running", biterken sonucu yazılır. Beklenen günde satır yoksa iş
 * çalışmamış, "running"de kaldıysa yarıda kesilmiştir (işlev süresi doldu); zil, Genel bakış ve e-posta bunu söyler
 * (src/lib/job-health.ts). 90 günden eski satırlar iş başlarken silinir.
 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: serial("id").primaryKey(),
    job: text("job", { enum: ["parasut", "gunluk"] }).notNull(),
    status: text("status", { enum: ["running", "ok", "partial", "error", "skipped"] }).notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Adımların kısa sonucu, ör. { sync: "today", digest: "sent", menu: "error" } (ekrandaki karşılıkları STEP_LABELS) */
    steps: jsonb("steps").$type<Record<string, string>>(),
    /** Hata ya da atlanma nedeni (en çok 500 karakter) */
    message: text("message"),
  },
  (t) => [index("job_runs_job_started_idx").on(t.job, t.startedAt)],
);

// ---------------------------------------------------------------- Reçete değişiklik önerileri
/** Önerideki ve öneri anındaki reçete: satır adları da saklanır (malzeme sonra silinse ya da adı değişse de okunur) */
export type RecipeSnapshot = {
  note: string | null;
  items: { ingredientId: number; name: string; unit: string; qty: number; qtyExpr: string | null; note: string | null }[];
};

/**
 * Yeni ürün önerisinde önerilen ürün (yönetici onaylarken adı ve kategoriyi değiştirebilir; boy sabit). `price`:
 * personelin yazdığı satış fiyatı (KDV dahil, isteğe bağlı); onayda fiyat alanı bununla dolu gelir. Eski önerilerde yok.
 */
export type ProposedProduct = { name: string; size: "M" | "L" | "Tek"; categoryId: number; price?: number | null };

/**
 * Personelin reçete defterinden önerdiği değişiklik: yönetici önceki ve önerilen reçeteyi yan yana görür, onaylarsa
 * reçete `after` ile değişir. Kişi başına ürün başına en çok bir bekleyen öneri olur (yenisi onu günceller).
 * Yeni ürün önerisi (`kind = 'new'`) boy başına bir satırdır: ürün onaylanana kadar yoktur (`productId` boş,
 * `proposed` ad / boy / kategori, `before` boş reçete); yönetici satış fiyatını yazıp onaylayınca ürün açılır ve
 * `productId` ona bağlanır.
 */
export const recipeChangeRequests = pgTable(
  "recipe_change_requests",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").references(() => products.id, { onDelete: "cascade" }),
    /** change: var olan ürünün reçetesi değişsin; new: menüde olmayan ürün eklensin */
    kind: text("kind", { enum: ["change", "new"] }).notNull().default("change"),
    /** Yalnız yeni ürün önerisinde */
    proposed: jsonb("proposed").$type<ProposedProduct>(),
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
    // Yeni ürün önerisinde productId boş: boşlar birbirini engellemez; aynı ad + boy kuralı eylemde, danışma kilidiyle
    uniqueIndex("recipe_change_requests_pending_uq").on(t.productId, t.requestedBy).where(sql`status = 'pending'`),
    check(
      "recipe_change_requests_kind_ck",
      sql`(${t.kind} = 'change' and ${t.productId} is not null) or (${t.kind} = 'new' and ${t.proposed} is not null)`,
    ),
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
    /** Sitede rezervasyonun yapıldığı an (sitenin createdAt'i): doluluk haritasının "kaç gün önceden"i. Sayaçta boş */
    bookedAt: timestamp("booked_at", { withTimezone: true }),
    /** İptal anı: eşitleme iptale geçişi görünce yazar (bilinmiyorsa boş); yeniden açılan rezervasyonda boşalır */
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
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
    /** Z raporundaki indirim toplamı (isteğe bağlı; girilmediyse null: ayın indirimine yalnız girilen günler gider) */
    discounts: doublePrecision("discounts"),
    note: text("note"),
    cashDiff: doublePrecision("cash_diff").notNull().default(0),
    submittedBy: integer("submitted_by").references(() => users.id, { onDelete: "set null" }),
    submittedByName: text("submitted_by_name").notNull(),
    /** Çekmeceyi sayan (formda seçilir, varsayılan gönderen) ve adı; eski raporlarda boş: gönderen saymış sayılır */
    countedBy: integer("counted_by").references(() => users.id, { onDelete: "set null" }),
    countedByName: text("counted_by_name"),
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

/**
 * Kasa raporunun önceki sürümleri: rapor yeniden gönderilince yerine yenisi gelen sürümün kopyası (yeniden gönderim
 * başına bir satır; kopya, rapor satırı kilitliyken aynı işlemde yazılır). Değişiklikler ardışık sürümler
 * karşılaştırılarak çıkarılır (src/lib/cash-report.ts revisionChanges); iş günü kapandıktan sonra kasa alanı değişen
 * düzeltme yöneticinin zilinde. Kopya jsonb: bütün formun arşivi, alanına göre sorgulanmaz, forma alan eklenince de
 * geçerli kalır. Rapor silinince geçmişi de gider (silme, değerleriyle işlem geçmişine yazılır).
 */
export const cashReportRevisions = pgTable(
  "cash_report_revisions",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id")
      .notNull()
      .references(() => cashReports.id, { onDelete: "cascade" }),
    /** Raporun iş günü (okuma kolaylığı) */
    date: text("date").notNull(),
    /** Yerine yenisi gelen sürümün numarası */
    revision: integer("revision").notNull(),
    /** O sürümün alanları, kasa farkı ve sayan */
    data: jsonb("data").$type<CashRevisionData>().notNull(),
    submittedBy: integer("submitted_by").references(() => users.id, { onDelete: "set null" }),
    submittedByName: text("submitted_by_name").notNull(),
    /** O sürümün gönderildiği an (raporun o andaki updated_at'i) */
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    /** Yerine yenisinin geldiği an */
    createdAt: createdAt(),
  },
  (t) => [index("cash_report_revisions_report_idx").on(t.reportId)],
);

/**
 * Raporla birlikte gönderilen Z raporu ve banka POS fişi fotoğrafları (kanıt). Yalnız eklenir: rapor yeniden
 * gönderilince eski fotoğraflar bağlı kalır; rapor silinince bağlar da silinir, fotoğraf 30 gün daha saklanır.
 */
export const cashReportPhotos = pgTable(
  "cash_report_photos",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id")
      .notNull()
      .references(() => cashReports.id, { onDelete: "cascade" }),
    photoId: integer("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["kasa-z", "kasa-pos"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("cash_report_photos_photo_uq").on(t.photoId), index("cash_report_photos_report_idx").on(t.reportId)],
);

/**
 * Gün içinde kasadan çıkan para, satır satır (market fişi, buz, tamirci; patrona ya da bankaya teslim). Rapor akşam
 * girilmeden önce de eklenir; akşamki raporun "Gün içinde kasadan çıkan" tutarı bunlardan dolar (rapor yine tek toplamı
 * saklar). Alışveriş satırı Aylık harcamalar'a da yazılabilir: o kayıt expense_entries.cash_out_id ile buna bağlanır.
 */
export const cashOuts = pgTable(
  "cash_outs",
  {
    id: serial("id").primaryKey(),
    /** Kasanın iş günü (YYYY-MM-DD) */
    date: text("date").notNull(),
    kind: text("kind", { enum: ["harcama", "teslim"] }).notNull().default("harcama"),
    /** Kasadan çıkan tutar (> 0, KDV dahil) */
    amount: doublePrecision("amount").notNull(),
    /** Alışverişte yer (ör. Migros), teslimde kime */
    store: text("store"),
    /** Ne alındı (ör. süt, buz) */
    description: text("description"),
    receiptDate: text("receipt_date"),
    receiptNo: text("receipt_no"),
    /** Fişteki toplam KDV: yalnız bilgi (KDV tahmini perakende fişin KDV'sini düşmez) */
    vat: doublePrecision("vat"),
    docType: text("doc_type", { enum: ["fis", "e_arsiv", "fatura", "yok"] }).notNull().default("yok"),
    photoId: integer("photo_id").references(() => photos.id, { onDelete: "set null" }),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("cash_outs_date_idx").on(t.date), uniqueIndex("cash_outs_photo_uq").on(t.photoId)],
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

// ---------------------------------------------------------------- Fotoğraflar ve fotoğraftan okuma
/**
 * Panelde çekilen fotoğraflar (Z raporu, banka POS fişi, kasadan çıkan fiş; kontrol listeleri). Dosya özel Vercel
 * Blob deposunda (yerelde .data/photos) durur, burada yalnız anahtarı: dosya yalnız /api/foto/[id]'den, yetki
 * denetlenerek verilir; Blob adresi hiçbir yerde görünmez. Her yükleme bağlanmamış başlar ve 2 günde silinir; onu
 * kullanan kayıt keepPhoto ile bağlar (kasa 180, fiş 400 gün). Süresi dolanları sabah işi siler (docs/FOTOGRAF.md).
 */
export const photos = pgTable(
  "photos",
  {
    id: serial("id").primaryKey(),
    /** "kasa-z" | "kasa-pos" | "fis" | "kontrol" (src/lib/photo-rules.ts; yeni tür migration istemez) */
    kind: text("kind", { enum: ["kasa-z", "kasa-pos", "fis", "kontrol"] }).notNull(),
    /** Depodaki yol, ör. "fis/2026/10/<uuid>.jpg" (rastgele, üzerine yazılmaz) */
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Yükleyenin adı (kullanıcı sonra silinse de okunur) */
    createdByName: text("created_by_name"),
    createdAt: createdAt(),
    /** Bu andan sonra silinir; null: süresiz */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Bir kayda bağlandığı an (null: bağlanmamış; yalnız yükleyen ve yönetici görür) */
    linkedAt: timestamp("linked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("photos_storage_key_uq").on(t.storageKey),
    index("photos_expires_idx").on(t.expiresAt),
    index("photos_created_by_idx").on(t.createdBy, t.createdAt),
  ],
);

/**
 * Fotoğraftan okuma (Claude) çağrıları: maliyet günlüğü, günlük sınırın sayacı ve sunucuda saklanan okuma. `result`
 * doğrulanmış ham okumadır (yalnız başarılıda); ekrandaki "fotoğraftan farklı" karşılaştırması bundan yapılır, istemcinin
 * gönderdiği okumaya güvenilmez. Görüntü ve istem saklanmaz; hata metni en çok 300 karakter.
 */
export const aiCalls = pgTable(
  "ai_calls",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** "kasa-z" | "kasa-pos" | "fis" | "fatura" */
    feature: text("feature").notNull(),
    /** İstenen model */
    model: text("model").notNull(),
    /** Yanıtı veren model (yedek model çalıştıysa farklı) */
    servedModel: text("served_model"),
    status: text("status", { enum: ["running", "ok", "refusal", "incomplete", "invalid", "error"] }).notNull(),
    /** src/server/ai/run.ts AiErrorCode */
    errorCode: text("error_code"),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    photoId: integer("photo_id").references(() => photos.id, { onDelete: "set null" }),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    /** Yedek model (server-side fallback) çalıştı */
    fallback: boolean("fallback").notNull().default(false),
    ms: integer("ms"),
    stopReason: text("stop_reason"),
    requestId: text("request_id"),
    result: jsonb("result"),
    error: text("error"),
  },
  (t) => [index("ai_calls_at_idx").on(t.at), index("ai_calls_photo_idx").on(t.photoId)],
);

/**
 * Fatura okumaları (Claude Haiku 5.5; docs/FATURA-OKUMA.md): onay bekleyen fiyatın ya da bağlanacak ürünün faturasında
 * kalemin paket boyu ("1 Adet = 150 adet"). Fatura ve ürün başına bir satır; "Yeniden oku" üzerine yazar. Yalnız
 * doğrulanmış JSON sonuç saklanır, PDF ve istem saklanmaz. Fatura silinince okuması da silinir.
 */
export const invoiceReadings = pgTable(
  "invoice_readings",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    /** Faturadaki kalemin ürün anahtarı (parasut_bill_lines.product_key) */
    productKey: text("product_key").notNull(),
    /** running: okunuyor (yarıda kalan okuma 90 sn sonra yeniden okunabilir); ok; error: okunamadı (nedeni `error`) */
    status: text("status", { enum: ["running", "ok", "error"] }).notNull(),
    /** Doğrulanmış okuma (src/lib/invoice-reading.ts); yalnız başarılıda */
    result: jsonb("result").$type<InvoiceReading>(),
    /** Okunamadıysa ekrandaki metin (en çok 300 karakter) */
    error: text("error"),
    model: text("model"),
    aiCallId: integer("ai_call_id").references(() => aiCalls.id, { onDelete: "set null" }),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Okumanın başladığı an */
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invoice_readings_invoice_product_uq").on(t.invoiceId, t.productKey)],
);

// ---------------------------------------------------------------- Kontrol listeleri
/**
 * Kontrol listesi şablonu (Açılış, Kapanış …): seçili günlerde bir kez, saat aralığıyla (iş günü 05:00'te döner,
 * 22:00–02:00 geçerli). activeFrom / inactiveFrom: bir günün listesi o günün aralığı açılırken etkinse beklenir (bugün
 * eklenen liste bugün "gecikti" demez). `schedule` "event" ("her seferinde": oda sıfırlama, mal kabul; `seq` ile günde
 * birden çok kayıt) sonraya ayrıldı; bugün yalnız "daily" yazılır. Ayrıntı: docs/KONTROL-LISTELERI.md.
 */
export const checklistTemplates = pgTable(
  "checklist_templates",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description"),
    schedule: text("schedule", { enum: ["daily", "event"] }).notNull().default("daily"),
    /** "HH:MM" Türkiye saati; "event"te boş */
    opensAt: text("opens_at"),
    dueAt: text("due_at"),
    /** İş gününün haftanın günü: 1 = Pazartesi … 7 = Pazar */
    weekdays: jsonb("weekdays").$type<number[]>().notNull().default([1, 2, 3, 4, 5, 6, 7]),
    /** Personel doldurabilir (kapalı: yalnız yönetici görür ve doldurur) */
    staffAllowed: boolean("staff_allowed").notNull().default(true),
    active: boolean("active").notNull().default(true),
    activeFrom: timestamp("active_from", { withTimezone: true }).notNull().defaultNow(),
    inactiveFrom: timestamp("inactive_from", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("checklist_templates_window_ck", sql`${t.schedule} = 'event' or (${t.opensAt} is not null and ${t.dueAt} is not null)`)],
);

/** Şablonun maddeleri; kaldırılan madde silinmez, active = false (geçmiş kayıtlar kendi kopyasını taşır) */
export const checklistItems = pgTable(
  "checklist_items",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id")
      .notNull()
      .references(() => checklistTemplates.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    type: text("type", { enum: ["check", "photo", "number", "text"] }).notNull().default("check"),
    section: text("section"),
    hint: text("hint"),
    required: boolean("required").notNull().default(true),
    /** Sayı maddesinin birimi ve izin verilen aralığı (aralık dışı değer not ister) */
    unit: text("unit"),
    min: doublePrecision("min"),
    max: doublePrecision("max"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("checklist_items_template_idx").on(t.templateId, t.sortOrder)],
);

/** Bir listenin bir iş günündeki kaydı (`seq` "her seferinde" listeler için ayrıldı; günlük listede 1). İlk yanıtta açılır */
export const checklistRuns = pgTable(
  "checklist_runs",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id")
      .notNull()
      .references(() => checklistTemplates.id, { onDelete: "restrict" }),
    /** İş günü (YYYY-MM-DD, 05:00'te döner) */
    date: text("date").notNull(),
    seq: integer("seq").notNull().default(1),
    /** Açıldığı andaki ad, aralık ve maddeler: şablon sonradan değişse de kayıt aynı kalır */
    name: text("name").notNull(),
    opensAt: text("opens_at"),
    dueAt: text("due_at"),
    items: jsonb("items").$type<ChecklistItemSnap[]>().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: integer("completed_by").references(() => users.id, { onDelete: "set null" }),
    completedByName: text("completed_by_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("checklist_runs_template_day_uq").on(t.templateId, t.date, t.seq), index("checklist_runs_date_idx").on(t.date)],
);

/** Maddenin yanıtı (kayıt başına madde başına bir satır); değişince önceki hâli history'ye geçer */
export const checklistAnswers = pgTable(
  "checklist_answers",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => checklistRuns.id, { onDelete: "cascade" }),
    /** runs.items içindeki madde kimliği (madde şablondan kaldırılsa da okunur; yabancı anahtar yok) */
    itemId: integer("item_id").notNull(),
    /** ok: yapıldı / değer aralıkta; issue: sorun bildirildi ya da değer aralık dışında (not zorunlu) */
    status: text("status", { enum: ["ok", "issue"] }).notNull().default("ok"),
    value: doublePrecision("value"),
    textValue: text("text_value"),
    note: text("note"),
    /** Fotoğraf (photos); saklama süresi (60 gün) dolup silinince boşalır */
    photoId: integer("photo_id").references(() => photos.id, { onDelete: "set null" }),
    /** Fotoğrafın çekildiği an: fotoğraf silinse de "çekildi" bilgisi kalır */
    photoAt: timestamp("photo_at", { withTimezone: true }),
    history: jsonb("history").$type<ChecklistAnswerVersion[]>().notNull().default([]),
    answeredBy: integer("answered_by").references(() => users.id, { onDelete: "set null" }),
    answeredByName: text("answered_by_name").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("checklist_answers_run_item_uq").on(t.runId, t.itemId), index("checklist_answers_photo_idx").on(t.photoId)],
);

// ---------------------------------------------------------------- Claude bağlantısı (MCP, salt okunur)
/**
 * OAuth istemcisi: Claude'un yayımlanmış kimliği (CIMD adresi) ya da otomatik kayıt (DCR). Gizli anahtar yok: bütün
 * istemciler açık (PKCE S256). Dönüş adresleri izinli listeden (claude.ai / claude.com; yerelde localhost) gelir,
 * başkası kaydedilmez. Ayrıntı: docs/CLAUDE-BAGLANTISI.md.
 */
export const mcpClients = pgTable(
  "mcp_clients",
  {
    id: serial("id").primaryKey(),
    /** "mcp_…" (DCR) ya da https://claude.ai/oauth/… (CIMD) */
    clientId: text("client_id").notNull(),
    kind: text("kind", { enum: ["dcr", "cimd"] }).notNull(),
    /** Kendi beyanı, temizlenmiş, en çok 100 karakter */
    name: text("name").notNull(),
    redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
    /** CIMD belgesinin son okunuşu */
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mcp_clients_client_id_uq").on(t.clientId), index("mcp_clients_created_idx").on(t.createdAt)],
);

/** Yetki kodu: onay ekranında verilir, 2 dakika, tek kullanım; ham kod yalnız Claude'a gider (burada sha256 özeti) */
export const mcpCodes = pgTable(
  "mcp_codes",
  {
    id: serial("id").primaryKey(),
    codeHash: text("code_hash").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => mcpClients.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    /** PKCE S256 */
    codeChallenge: text("code_challenge").notNull(),
    scope: text("scope").notNull(),
    resource: text("resource").notNull(),
    sessionVersion: integer("session_version").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    /** Kodla açılan bağlantı: kod ikinci kez kullanılırsa kapatılır */
    grantId: integer("grant_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mcp_codes_hash_uq").on(t.codeHash)],
);

/** Bağlantı: yöneticinin bir istemciye verdiği salt okunur erişim (Hesabım › Bağlı uygulamalar'daki satır) */
export const mcpGrants = pgTable(
  "mcp_grants",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => mcpClients.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    resource: text("resource").notNull(),
    /** Dönüş adresinin sunucusu, ör. "claude.ai" */
    redirectHost: text("redirect_host").notNull(),
    /** İzin anındaki oturum sürümü; kullanıcınınki değişince (parola, oturumları kapat…) bağlantı geçersiz */
    sessionVersion: integer("session_version").notNull(),
    createdAt: createdAt(),
    /** En geç 90 gün */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** kullanici | istemci (Claude anahtarı geri verdi) | yeniden-kullanim | kod-tekrari | oturum | suresi-doldu */
    revokedReason: text("revoked_reason"),
  },
  (t) => [index("mcp_grants_user_idx").on(t.userId)],
);

/** Erişim (1 saat) ve yenileme (30 gün, her kullanımda yenisiyle değişir) anahtarları; yalnız sha256 özeti */
export const mcpTokens = pgTable(
  "mcp_tokens",
  {
    id: serial("id").primaryKey(),
    grantId: integer("grant_id")
      .notNull()
      .references(() => mcpGrants.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["access", "refresh"] }).notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Yenileme anahtarı kullanıldı, yerine yenisi verildi */
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    /** Yerine verilen yenileme anahtarının satırı */
    replacedBy: integer("replaced_by"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mcp_tokens_hash_uq").on(t.tokenHash), index("mcp_tokens_grant_idx").on(t.grantId, t.kind)],
);

/** Claude'un her araç çağrısı (Hesabım › Son sorular). Yanıt saklanmaz; 180 gün tutulur */
export const mcpCalls = pgTable(
  "mcp_calls",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    grantId: integer("grant_id").references(() => mcpGrants.id, { onDelete: "set null" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    tool: text("tool").notNull(),
    /** Doğrulanmış girdi (kısa) */
    args: jsonb("args").$type<Record<string, unknown>>(),
    ok: boolean("ok").notNull(),
    error: text("error"),
    ms: integer("ms").notNull(),
    /** Yanıtın uzunluğu (karakter) */
    chars: integer("chars"),
  },
  (t) => [index("mcp_calls_at_idx").on(t.at), index("mcp_calls_user_idx").on(t.userId, t.at)],
);
