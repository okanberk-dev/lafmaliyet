import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Yalnız tip (derlemede silinir): drizzle-kit'in okuduğu şemaya uygulama kodu girmez
import type { AdoptPrev, LinkPrev } from "../../lib/cari/account";
import { DEFAULT_BRANCH_ID, type BranchKind, type BranchPosSource } from "../../lib/branches";
import { ESKI_KASA_KAYNAGI, KASA_YAZARI, OTOMATIK_YAZAR } from "../../lib/asilpos/eski-adlar";
import type { CashRevisionData } from "../../lib/cash-report";
import type { ChecklistAnswerVersion, ChecklistItemSnap } from "../../lib/checklists";
import type { InvoiceReading } from "../../lib/invoice-reading";
import type {
  BankPos,
  PosCashMove,
  PosCollection,
  PosCorrection,
  PosDayPush,
  PosDayZ,
  PosDiscountLine,
  PosIkram,
  PosIptal,
  PosOffDevice,
  PosOkc,
  PosPayment,
  PosRefund,
  PosShiftCount,
} from "../../lib/asilpos/day";
import type { AsilposPhotoCheck } from "../../lib/asilpos/foto";
import { photoCheckFromDb, photoCheckToDb } from "../../lib/asilpos/foto-kayit";
import type { KasaFoyu } from "../../lib/modpos/foy";
import type { ModposSheetPrevious } from "../../lib/modpos/z";
import type { OkcVatLine } from "../../lib/okc-z";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
/** İkili veri (belge dosyaları); postgres.js Buffer olarak okur ve yazar */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
/**
 * Satırın şubesi (dalga 2, docs/SUBE.md). Ciro, kasa, satış, stok ve personelde BOŞ KALAMAZ; eski satırlar
 * 'tuzla' ile doldurulur (sahibin kararı, 4 Kasım 2026). Varsayılan bilerek duruyor: şube yazmayan eski bir
 * kod yolu kalırsa satır kaybolmaz, Tuzla'ya düşer.
 */
const branchId = () => text("branch_id").notNull().default(DEFAULT_BRANCH_ID).references(() => branches.id);
/** Ortak gider: null = "işletme geneli" (muhasebeci, yazılım); yalnız expense_entries'te geçerli */
const branchIdNullable = () => text("branch_id").references(() => branches.id);

// ---------------------------------------------------------------- Kullanıcılar
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** Rol (docs/ROLLER.md, src/lib/roles.ts): yönetici, müdür, personel, muhasebeci; users_role_ck */
    role: text("role", { enum: ["admin", "manager", "staff", "accountant"] }).notNull().default("staff"),
    /**
     * Personelin ve müdürün şubesi (docs/SUBE.md › Personel hesabının şubesi): doluysa paneli bu şubede kilitli açılır
     * (kasa raporu, kontrol listeleri o şubenin). Personelde boş: bütün şubeler, seçici serbest. Müdürde ZORUNLU
     * (users_manager_branch_ck). Yöneticide ve muhasebecide kullanılmaz.
     */
    branchId: text("branch_id").references(() => branches.id),
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
  },
  (t) => [
    // Tanınmayan rol yazılamaz (oturum da tanımaz: src/server/auth/session.ts)
    check("users_role_ck", sql`${t.role} in ('admin','manager','staff','accountant')`),
    // Müdür şubesine kilitli: şubesiz müdür olmaz (src/server/auth/dal.ts › managerWithoutBranch)
    check("users_manager_branch_ck", sql`${t.role} <> 'manager' or ${t.branchId} is not null`),
  ],
);

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

/**
 * Çıkışta kapatılan oturumlar (src/server/auth/dal.ts › endSession): oturum çerezindeki rastgele kimlik (jti). Çerezin
 * bir kopyası alınmış olsa da çıkıştan sonra geçmez; kişinin öteki cihazları etkilenmez. Aynı tarayıcıda yerine yeni
 * oturum açılınca (ad değişikliği, sıradaki kişinin girişi) eskisi de buraya yazılır. Satır çerezin süresiyle
 * (`expires_at`) gereksizleşir ve silinir. Kişiye yabancı anahtarla bağlı değil: silinmiş bir hesabın çerezi de
 * kapatılabilsin. Yedeğe girmez (geri yükleme bütün oturumları zaten kapatır; src/lib/backup/format.ts).
 */
export const revokedSessions = pgTable("revoked_sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- Ayarlar (anahtar → değer)
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

/**
 * Ay bazlı ayarların sürümleri (docs/AYARLAR.md; src/lib/month-settings.ts): parayı etkileyen oranlar ve tutarlar (KDV,
 * POS komisyonu, kartlı oran, fire, dört SGK oranı, yemek kartı, alış KDV'leri; şubede POS oranı) "şu aydan itibaren"
 * saklanır, hesap her ayı kendi değeriyle yapar. Ayda geçerli değer `from_month` ≤ ay olan en son sürüm; sürümü olmayan
 * anahtar `settings` satırını (yoksa varsayılanı), şubenin POS oranı `branches.pos_rate`'i okur. Bu anahtarlar yalnız
 * src/server/setting-versions.ts ile yazılır: settings satırına doğrudan yazmak ilk sürümün arkasında kalır.
 * `branch_id` genel ayarda boş metin (şube kimliği yalnız POS oranında). Göç 0101 bugünkü değerleri "2000-01"den geçerli
 * ilk sürüm olarak yazdı (hiçbir ayın rakamı değişmedi)
 */
export const settingVersions = pgTable(
  "setting_versions",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    branchId: text("branch_id").notNull().default(""),
    /** YYYY-MM: bu aydan itibaren (sonraki sürüme kadar) */
    fromMonth: text("from_month").notNull(),
    value: doublePrecision("value").notNull(),
    note: text("note"),
    /** Değiştiren kişinin adı (geçmişte görünür) */
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("setting_versions_key_month_uq").on(t.key, t.branchId, t.fromMonth),
    check("setting_versions_month_ck", sql`${t.fromMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);

// ---------------------------------------------------------------- Şubeler ve kanallar
/**
 * Şube ve kanal kütüğü (docs/SUBE.md): fiziksel şubeler (Tuzla, Marina) ile laffogato.net'in online kanalı tek
 * listede. Ciro, kasa ve gider bu kimliğe göre ayrılır; menü, reçete, hammadde ve tedarikçi ORTAKTIR (sahibin
 * kararı, 4 Kasım 2026). Kimlik elle verilen kısa bir metindir (adreste ve çerezde geçer, veriye yazılır):
 * değişmez, kayıtlar ona bağlanır. Kurallar ve etiketler src/lib/branches.ts'te (saf, testli).
 */
/**
 * Kasa kaynağı sütunu (ad değişikliği, AsilPOS; plan A1): veritabanına AsilPOS'un eski değeri yazılır (ESKI_KASA_KAYNAGI;
 * canlıdaki eski sürüm ve geri dönüş onu okur), okunurken yenisine ("asilpos") çevrilir. Karşılaştırmalar (eq, inArray)
 * da çevrilir. CHECK iki değeri de kabul eder (migration 0098)
 */
const posSourceText = customType<{ data: BranchPosSource; driverData: string }>({
  dataType: () => "text",
  toDriver: (v) => (v === "asilpos" ? ESKI_KASA_KAYNAGI : v),
  fromDriver: (v) => (v === ESKI_KASA_KAYNAGI ? "asilpos" : v) as BranchPosSource,
});
/**
 * Kasanın yazdığı satırların yazar adı (kasa raporu, sürümü, kasadan çıkan ve harcama kaydı, işlem geçmişi; ad
 * değişikliği, plan A1): veritabanına eski ad yazılır (OTOMATIK_YAZAR, KASA_YAZARI; canlıdaki eski sürüm ve geri dönüş
 * onunla karşılaştırır), okunurken ekranda yeni ad görünür. Yalnız bu iki ad çevrilir; kişilerin adları olduğu gibi
 */
const AUTHOR_NEW: Readonly<Record<string, string>> = { [OTOMATIK_YAZAR]: "AsilPOS (otomatik)", [KASA_YAZARI]: "AsilPOS" };
const AUTHOR_OLD: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(AUTHOR_NEW).map(([eski, yeni]) => [yeni, eski]));
const authorText = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  toDriver: (v) => AUTHOR_OLD[v] ?? v,
  fromDriver: (v) => AUTHOR_NEW[v] ?? v,
});

/**
 * Gün sonu fotoğrafının karşılaştırması (asilpos_day_ends.photo_check; ad değişikliği, plan A1): satırlarda AsilPOS'taki
 * değer eski adlı alanla yazılır (canlıdaki eski sürüm ve geri dönüş onu okur), okunurken yeni alana çevrilir
 * (src/lib/asilpos/foto-kayit.ts). Sütun yine jsonb
 */
const photoCheckJson = customType<{ data: AsilposPhotoCheck; driverData: unknown }>({
  dataType: () => "jsonb",
  toDriver: (v) => JSON.stringify(photoCheckToDb(v)),
  fromDriver: (v) => photoCheckFromDb(typeof v === "string" ? JSON.parse(v) : v),
});

/** CHECK'in kabul ettiği kasa kaynakları: yeni ad ve veritabanındaki eski ad */
const POS_SOURCE_SQL = sql.raw(["modpos", ESKI_KASA_KAYNAGI, "asilpos", "yok"].map((v) => `'${v}'`).join(","));

export const branches = pgTable(
  "branches",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** "fiziksel" (şube) ya da "online" (laffogato.net kanalı) */
    kind: text("kind").$type<BranchKind>().notNull(),
    /** Gün sonu hangi sistemden gelir: ModPOS, AsilPOS ya da yok (online kanal) */
    posSource: posSourceText("pos_source").notNull().default("yok"),
    active: boolean("active").notNull().default(true),
    /** Açılış günü (YYYY-MM-DD); boşsa "başından beri" (Tuzla) */
    openedOn: text("opened_on"),
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * Banka POS komisyon oranı (0,02 = %2; sahibin kararı 23 Kasım 2026: iki şube %2, Şubeler'den yönetici değiştirir).
     * Banka POS komisyonu = Σ şube (kart × bu oran) (src/lib/calc/engine.ts posCommission); Ayarlar'daki genel oran
     * yalnız kasa kartı olmayan eski aylarda
     */
    posRate: doublePrecision("pos_rate").notNull().default(0.02),
    /**
     * Şubenin açık özellikleri (şube kapsamı B6; src/lib/branch-features.ts): "karaoke", "siparis" (uygulama siparişi),
     * "garson" (masa çağrısı), "yemek_karti" (komisyon & hakediş). Yeni şube bugünkü davranışla, karaokesiz başlar
     * (karaoke tek şubede); Tuzla'ya karaoke migration 0085'te. Online kanalda anlamı yok (boş)
     */
    features: text("features").array().notNull().default(sql`'{siparis,garson,yemek_karti}'::text[]`),
    /**
     * Şubenin e-postası (şube kurulumu, docs/ASILPOS.md › Şube kurulumu): şubenin panel hesabı bu adresle açılır, AsilPOS
     * kurulum bağlantısı buraya gider. Boşsa kurulum bağlantısı gönderilmez (eski şubeler)
     */
    email: text("email"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("branches_active_idx").on(t.active, t.sortOrder),
    check("branches_kind_ck", sql`${t.kind} in ('fiziksel','online')`),
    check("branches_pos_source_ck", sql`${t.posSource} in (${POS_SOURCE_SQL})`),
    // Online kanalın kasası olmaz, fiziksel şube kasasız kalmaz (src/lib/branches.ts branchSourceError)
    check(
      "branches_source_kind_ck",
      sql`(${t.kind} = 'online' and ${t.posSource} = 'yok') or (${t.kind} = 'fiziksel' and ${t.posSource} <> 'yok')`,
    ),
  ],
);

// ---------------------------------------------------------------- AsilPOS şube kurulumu
/**
 * Şubeye özel AsilPOS kurulum kodu (docs/ASILPOS.md › Şube kurulumu): indirme bağlantısında ve kurucunun içinde durur;
 * kasa ilk açılışta bir kez verir, karşılığında şubesini ve bağlantı bilgilerini alır. `tokenHash` (sha256) ile
 * bulunur; ham kod yalnız şube hesabına bağlantıyı yeniden göstermek için mühürlü durur (`tokenSealed`, secret-box
 * KURULUM_SIFRE_AMACI, eski adla). Kullanılınca (`usedAt`) ya da süresi dolunca bir daha geçmez; yenisi eskisini iptal eder.
 * Ad değişikliği (migration 0098): tablo eski adından taşındı, eski adla görünüm (view) kaldı (ESKI_TABLOLAR; canlıdaki
 * eski sürüm onu okur ve yazar); görünüm temizlik PR'ında (A3) kalkar
 */
export const asilposInstalls = pgTable(
  "asilpos_installs",
  {
    id: serial("id").primaryKey(),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenSealed: text("token_sealed").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** İndirme sayısı (bilgi için) */
    downloads: integer("downloads").notNull().default(0),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("asilpos_installs_branch_idx").on(t.branchId, t.createdAt)],
);

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
     * ESKİ: kasada duran eski fiyat ve kasanın geri kaldığı an, şubeler öncesi tek kasa. 24 Kasım 2026'dan beri kasanın
     * durumu şube başına `pos_stale`'de (göç 0079 bu değerleri oraya kopyaladı); bu iki sütun ne okunur ne yazılır, bir
     * sürüm geri dönüş güvenliği için durur, sonraki göçle kalkar (tests/fiyatlar.test.ts kaynakta arar).
     */
    posStalePrice: doublePrecision("pos_stale_price"),
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
/** Ayın şube başına özeti (dalga 2: anahtar month -> (month, branch_id)) */
export const months = pgTable(
  "months",
  {
    month: text("month").notNull(), // YYYY-MM
    branchId: branchId(),
    openDays: integer("open_days"),
    posRevenue: doublePrecision("pos_revenue"),
    discounts: doublePrecision("discounts"),
    offRevenue: doublePrecision("off_revenue"),
    /** Kartlı satış oranı (0–1), elle; boşsa o ayın kasa raporlarından, o da yoksa Ayarlar › kartlı satış oranı */
    cardShare: doublePrecision("card_share"),
    note: text("note"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.month, t.branchId] })],
);

export const salesLines = pgTable(
  "sales_lines",
  {
    id: serial("id").primaryKey(),
    month: text("month").notNull(),
    branchId: branchId(),
    posName: text("pos_name").notNull(),
    qty: doublePrecision("qty").notNull().default(0),
    revenue: doublePrecision("revenue").notNull().default(0),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    isService: boolean("is_service").notNull().default(false),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("sales_lines_month_idx").on(t.month, t.branchId),
    // Ay artık şubeyle birlikte anahtar: satır ayın O ŞUBEDEKİ kaydına bağlı
    foreignKey({
      columns: [t.month, t.branchId],
      foreignColumns: [months.month, months.branchId],
      name: "sales_lines_month_branch_fk",
    }).onDelete("cascade"),
  ],
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
    /** Faturanın nereden geldiği: elle, ilk kurulumdaki içe aktarım (`excel`; ekranda "İçe aktarılmış (eski)") ya da Paraşüt eşitlemesi */
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
     * kişi kartının `tax_number`'ı, gelen e-faturada `from_vkn`, UBL'de satıcının kimliği. Elle girilen ve içe aktarılmış
     * faturada boş. Tedarikçiler aynı (geçerli) vergi nolu faturaları tek tedarikçide toplar (logic.ts supplierResolver).
     * Kontrol hanesi tutmayan ya da yer tutucu numara saklanır ama eşleşmede kullanılmaz (taxKey).
     */
    supplierTaxNumber: text("supplier_tax_number"),
    /**
     * Bu faturaya sayılan cari ödemelerin toplamı (supplier_allocations; KDV dahil). Yalnız src/server/cari/settle.ts
     * yazar, her yazışta SUM ile yeniden (docs/TEDARIKCILER.md "Hesap hareketleri")
     */
    allocated: doublePrecision("allocated").notNull().default(0),
    /**
     * Panel takibi (cari): boşsa kalan bugünkü kuraldır (Paraşüt'ün `outstanding`'i); doluysa kalan = Ödenecek − bu −
     * `allocated`. Kart ilk ödeme kaydını alınca grubun faturalarına Paraşüt'ün o ana kadar ödendi gösterdiği kısım
     * yazılır, sonradan gelen faturaya 0 (src/lib/cari/balance.ts openBalance). Eşitleme yazmaz.
     */
    ledgerBase: doublePrecision("ledger_base"),
    /** Faturayı cari ödemelerin dağıtımı kapattı (ödendi): karşılık düşerse defter yeniden açar; elle ✓'ye dokunulmaz */
    paidByLedger: boolean("paid_by_ledger").notNull().default(false),
    /**
     * Vergi: "Demirbaş olabilir" listesinde "Gider (demirbaş değil)" denildi; yalnız vergi hesabı okur, Paraşüt eşitlemesi
     * dokunmaz (docs/VERGI.md)
     */
    taxNotAsset: boolean("tax_not_asset").notNull().default(false),
    /**
     * Elle eklenen faturanın istemci anahtarı (Fatura ekle penceresinin ürettiği UUID): kısayolun ikinci basışı ya da
     * yanıtı yolda kalan isteğin tekrarı ikinci fatura açmaz, var olan döner (denetim UI-03). Eşitleme ve içe aktarım yazmaz
     */
    clientKey: text("client_key"),
    /**
     * Faturanın geldiği Paraşüt hesabı (sahibi şube; docs/PARASUT.md › Şube başına Paraşüt hesabı): Paraşüt'e bağlı her
     * kayıtta dolu (gider faturası ya da e-fatura kimliği varsa), elle girilende ve içe aktarılmışta boş. Paraşüt kimlikleri hesap
     * içinde benzersizdir; eşitleme yalnız kendi hesabının faturalarını görür, kaldırır
     */
    parasutAccount: text("parasut_account").references(() => branches.id),
    /**
     * Faturanın şubesi (sahibin kararı, 25 Kasım 2026; docs/SUBE.md › Faturanın şubesi): seçilen şube; boşsa
     * `companyWide`'a bakılır. Eşitleme yalnız yeni açtığı faturaya yazar (ayrı Paraşüt hesabı → o şube, yoksa
     * tedarikçinin varsayılan şubesi). Tahmini stoğun "Marina'ya gelen faturalar"ı da bunu okur (tek kaynak)
     */
    branchId: branchIdNullable(),
    /**
     * Bilinçli "İşletme geneli" seçimi (muhasebe, ortak hizmet): şubesi boş ve bu kapalıysa fatura "Şubesi seçilmemiş"
     * kutusundadır; tek şube seçiliyken görünmez (src/lib/invoice-branch.ts)
     */
    companyWide: boolean("company_wide").notNull().default(false),
    /**
     * Kapalı dönem kararı (docs/DONEM-KAPANISI.md): ay kapandıktan sonra o aya tarihli gelen fatura hesaplara girmez
     * ("Kapalı döneme düşenler" kutusu), ta ki yönetici karar verene kadar. Karar bu sütuna yazılır: faturanın hesaplarda
     * sayılacağı gün (YYYY-MM-DD). Kendi tarihiyse kapalı aya bilerek işlendi; başka bir günse o günün ayında sayılır
     * (belgenin tarihi `date` değişmez). Boş: karar yok. Eşitleme dokunmaz
     */
    periodDate: text("period_date"),
    createdAt: createdAt(),
  },
  (t) => [
    index("invoices_date_idx").on(t.date),
    check("invoices_company_wide_ck", sql`not (${t.companyWide} and ${t.branchId} is not null)`),
    // Paraşüt kimlikleri hesap içinde benzersiz. Hesabı boş Paraşüt faturası varsayılan hesabındır (invoiceAccountWhere;
    // eski yedekten ya da "Geri al" kopyasından gelebilir): boş hesap "tuzla" sayılır, aynı kimlik iki kez yazılamaz.
    // Elle girilen faturanın kimlikleri boş: çakışmaz
    uniqueIndex("invoices_external_id_uq").on(sql`coalesce(${t.parasutAccount}, 'tuzla')`, t.externalId),
    uniqueIndex("invoices_e_invoice_id_uq").on(sql`coalesce(${t.parasutAccount}, 'tuzla')`, t.eInvoiceId),
    uniqueIndex("invoices_client_key_uq").on(t.clientKey),
    index("invoices_branch_idx").on(t.branchId),
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
    /**
     * Faturalarının varsayılan şubesi (docs/SUBE.md › Faturanın şubesi): Paraşüt'ten gelen yeni fatura bunu alır
     * (ayrı Paraşüt hesabının faturası hesabın şubesini). Boşsa ve `defaultCompanyWide` kapalıysa yeni fatura "Şubesi
     * seçilmemiş" gelir
     */
    defaultBranchId: text("default_branch_id").references(() => branches.id),
    /** Varsayılan: işletme geneli (muhasebeci, ortak hizmet) */
    defaultCompanyWide: boolean("default_company_wide").notNull().default(false),
    note: text("note"),
    /**
     * Listeden kaldırıldığı gün (YYYY-MM-DD, Türkiye). Faturası olan tedarikçi silinmez, listeden kalkar; ödenmemiş
     * faturası olunca ya da bu günden sonraki tarihli faturası gelince listeye kendiliğinden döner.
     */
    hiddenOn: text("hidden_on"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("suppliers_key_uq").on(t.key),
    check("suppliers_default_branch_ck", sql`not (${t.defaultCompanyWide} and ${t.defaultBranchId} is not null)`),
  ],
);

/**
 * Cari hesabın elle kayıtları (docs/TEDARIKCILER.md "Hesap hareketleri"): borç (faturasız ya da elden alım, eski borç)
 * ve ödeme (hesaba, kısmi, toptan, kasadan). Kayıt tedarikçi kartına bağlıdır (kartsız gruba ilk kayıtta görünen
 * adıyla kart açılır). Ödemenin hangi faturaya ya da borca sayıldığı supplier_allocations'ta; ödeme hiçbir zaman gider
 * ya da KDV değildir. Borcun gideri `cost_mode`'a göre: fatura gelince fatura, "gider" bir Aylık harcamalar kaydı
 * (expense_entries.supplier_entry_id), "mevcut" var olan bir kayıt, "devir" hiç.
 */
export const supplierEntries = pgTable(
  "supplier_entries",
  {
    id: serial("id").primaryKey(),
    supplierId: integer("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ["borc", "odeme"] }).notNull(),
    /** Alım ya da ödeme günü (YYYY-MM-DD) */
    date: text("date").notNull(),
    /** KDV dahil, kuruşa yuvarlanmış (> 0) */
    amount: doublePrecision("amount").notNull(),
    /** Borçta ne alındı */
    description: text("description"),
    note: text("note"),
    // borç
    costMode: text("cost_mode", { enum: ["fatura", "gider", "mevcut", "devir"] }),
    categoryId: integer("category_id").references(() => expenseCategories.id, { onDelete: "set null" }),
    dueDate: text("due_date"),
    /** "Faturası geldi": bağlandığı fatura (n borç → 1 fatura); bağlıyken kalanı 0 */
    invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    /** Bağlanmadan önceki hâli: bağ kaldırılınca ya da fatura silinince geri gelir */
    linkPrev: jsonb("link_prev").$type<LinkPrev>(),
    /**
     * "Gideri zaten girildi": sahiplenilen Aylık harcamalar kaydının sahiplenmeden önceki günü ve tutarı (kayıt borca
     * eşitlenir; sahiplik kalkınca bu değerler geri yazılır)
     */
    adoptPrev: jsonb("adopt_prev").$type<AdoptPrev>(),
    /** "Faturası 45 gündür gelmedi" uyarısı bu günden sonra (Beklemeye devam) */
    remindAfter: text("remind_after"),
    /** "Ayrı alım" denmiş faturalar: bu borcun faturası değil */
    dismissedInvoiceIds: jsonb("dismissed_invoice_ids").$type<number[]>().notNull().default([]),
    /**
     * Borç ekle'nin Kasa denetiminde "Ayrı alım" denmiş Teslim satırları: bu alımın ödemesi değil (satır işlenmemiş
     * kalır, Ödeme ekle › Kasadan seçilebilir; yalnız bu borcu "Kasadan ödenmiş olabilir" diye sessize almaz)
     */
    dismissedCashOutIds: jsonb("dismissed_cash_out_ids").$type<number[]>().notNull().default([]),
    // ödeme
    method: text("method", { enum: ["kasa", "elden", "havale", "kart", "cek", "diger"] }),
    /** Kasadan ödemenin Kasa satırı (Teslim) */
    cashOutId: integer("cash_out_id").references(() => cashOuts.id, { onDelete: "restrict" }),
    /** Kasa satırını bu ödeme açtı (silinince o da silinir); değilse var olan satıra bağlandı */
    cashOutCreated: boolean("cash_out_created").notNull().default(false),
    // ortak
    photoId: integer("photo_id").references(() => photos.id, { onDelete: "set null" }),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("supplier_entries_supplier_idx").on(t.supplierId, t.date),
    index("supplier_entries_invoice_idx").on(t.invoiceId),
    uniqueIndex("supplier_entries_cash_out_uq").on(t.cashOutId),
    uniqueIndex("supplier_entries_photo_uq").on(t.photoId),
    check("supplier_entries_amount_ck", sql`${t.amount} > 0`),
    check(
      "supplier_entries_kind_ck",
      sql`(${t.kind} = 'borc' and ${t.costMode} is not null and ${t.method} is null and ${t.cashOutId} is null) or (${t.kind} = 'odeme' and ${t.method} is not null and ${t.costMode} is null and ${t.invoiceId} is null and ${t.dueDate} is null and ${t.categoryId} is null)`,
    ),
    check("supplier_entries_kasa_ck", sql`${t.kind} <> 'odeme' or ((${t.method} = 'kasa') = (${t.cashOutId} is not null))`),
    // Faturaya bağlı borcun gider kaydı silinmiştir (önceki hâli link_prev'de): kategorisi silinebilir, bağ kalkınca
    // borç "Faturası gelecek" olur
    check("supplier_entries_gider_ck", sql`${t.costMode} is distinct from 'gider' or ${t.categoryId} is not null or ${t.invoiceId} is not null`),
  ],
);

/**
 * Ödemenin dağıtımı: ödeme kaydının ne kadarı hangi faturaya ya da borca sayıldı. Dağıtılmayan kısım ödemenin
 * hesabında durur ("hesapta sayılmamış ödeme"). `origin_debt_id`: borca sayılmışken "Faturası geldi" ile faturaya
 * taşınan dağıtımın borcu (bağ kaldırılınca geri döner). Yalnız src/server/cari/settle.ts yazar.
 */
export const supplierAllocations = pgTable(
  "supplier_allocations",
  {
    id: serial("id").primaryKey(),
    paymentId: integer("payment_id")
      .notNull()
      .references(() => supplierEntries.id, { onDelete: "cascade" }),
    invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
    debtId: integer("debt_id").references(() => supplierEntries.id, { onDelete: "cascade" }),
    originDebtId: integer("origin_debt_id").references(() => supplierEntries.id, { onDelete: "set null" }),
    amount: doublePrecision("amount").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("supplier_allocations_payment_idx").on(t.paymentId),
    index("supplier_allocations_invoice_idx").on(t.invoiceId),
    index("supplier_allocations_debt_idx").on(t.debtId),
    check("supplier_allocations_amount_ck", sql`${t.amount} > 0`),
    check("supplier_allocations_target_ck", sql`num_nonnulls(${t.invoiceId}, ${t.debtId}) = 1`),
  ],
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
  /** Kişinin şubesi (dalga 2): maaşı o şubenin gideri (sahibin kararı, 4 Kasım 2026) */
  branchId: branchId(),
  name: text("name").notNull(),
  netSalary: doublePrecision("net_salary").notNull().default(0),
  extras: doublePrecision("extras").notNull().default(0),
  /**
   * Yemek kartı (Faz 5, sahibin kararı 11): işaretliyse işveren maliyetine Ayarlar'daki günlük tutar × gün eklenir,
   * brütleştirilmez (src/lib/calc/engine.ts staffCost). Taban değer: sürüm (staff_versions) aydan itibaren değiştirir
   */
  mealCard: boolean("meal_card").notNull().default(false),
  /**
   * Tam zamanlı ya da part-time (Faz 5, sahibin kararı 12). Part-time: günlük ücret × Vardiya'da o şubede çağrıldığı gün
   * (shifts.kind = work), SGK brütleştirmesi yok; net maaş kullanılmaz
   */
  kind: text("kind", { enum: ["full_time", "part_time"] }).notNull().default("full_time"),
  /** Part-time günlük ücret (₺; işletmenin gün başına maliyeti). Taban değer: sürüm aydan itibaren değiştirir */
  dailyWage: doublePrecision("daily_wage").notNull().default(0),
  /**
   * Vardiya / hesap bağlantısı (Faz 5; sahibin kararı 2): bu maaş satırının panel hesabı. Yalnız yönetici, açıkça bağlar;
   * kendiliğinden bağlanmaz. Bir hesap aynı ayda tek satıra (benzersiz; aralığı çakışmayan eski satırı, ör. "devam ettir"in
   * açtığı yeni kayıttan önceki, kendi geçmişiyle bağlı kalır: src/lib/staff-link.ts). Vardiya anahtarı "u:<id>"
   */
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  /** Hesabı olmayan Vardiya kişisi: "n:<küçük harfli ad>" (src/lib/vardiya.ts nameRef); user_id varken boş */
  personRef: text("person_ref"),
  active: boolean("active").notNull().default(true),
  startMonth: text("start_month"),
  endMonth: text("end_month"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  index("staff_user_idx").on(t.userId),
  check("staff_kind_ck", sql`${t.kind} in ('full_time','part_time')`),
  check("staff_link_ck", sql`${t.userId} is null or ${t.personRef} is null`),
]);

/** Personel maaş değişiklikleri: fromMonth ayından itibaren geçerli net maaş, ek ödemeler ve yemek kartı */
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
    /** Yemek kartı bu aydan itibaren (Faz 5) */
    mealCard: boolean("meal_card").notNull().default(false),
    /** Part-time günlük ücret bu aydan itibaren (Faz 5) */
    dailyWage: doublePrecision("daily_wage").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("staff_versions_staff_month_uq").on(t.staffId, t.fromMonth)],
);

/**
 * Personel belgeleri (docs/PERSONEL-BELGE.md): hijyen eğitimi, sağlık raporu, SGK işe giriş bildirgesi ve öteki
 * belgeler; kişi başına birden çok, geçerlilik bitişi isteğe bağlı. Dosya özel depoda (src/server/storage/staff-docs.ts;
 * fotoğraf deposuyla aynı sürücü), yalnız yöneticiye /api/personel/belge/{id}'den verilir; dosyasız belge de girilir
 * (yalnız tarih takibi). Bitişe 30 gün kala ve bitince yöneticinin zili ve e-postası (src/lib/staff-docs.ts). Kişi
 * silinince belgeleri de silinir (dosyalarını eylem siler).
 */
export const staffDocuments = pgTable(
  "staff_documents",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    /** "hijyen" | "saglik" | "sgk" | "diger" (src/lib/staff-docs.ts DOC_KINDS; yeni tür migration istemez) */
    kind: text("kind").notNull(),
    /** "diger" türünde belgenin adı; ötekilerde isteğe bağlı ek ad */
    label: text("label"),
    /** Düzenlenme günü (YYYY-MM-DD); bilinmiyorsa boş */
    issuedOn: text("issued_on"),
    /** Geçerliliğin son günü (YYYY-MM-DD); süresiz belgede boş (hatırlatma yok) */
    validUntil: text("valid_until"),
    note: text("note"),
    /** Depodaki yol ("personel-belge/2026/11/<uuid>.pdf"); dosyasız belgede boş */
    storageKey: text("storage_key"),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes"),
    fileName: text("file_name"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name"),
    createdAt: createdAt(),
  },
  (t) => [index("staff_documents_staff_idx").on(t.staffId), index("staff_documents_valid_idx").on(t.validUntil), uniqueIndex("staff_documents_storage_key_uq").on(t.storageKey)],
);

/**
 * Personel avansları (docs/PERSONEL-BELGE.md): `avans` kişiye verilen para, `kesinti` maaşından düşülen. Tutar hep
 * artı; kişinin bakiyesi (maaşından düşülecek kalan) = avansların toplamı − kesintilerin toplamı
 * (src/lib/staff-advances.ts). Avans gider değildir: maaş zaten işveren maliyetinde; avans onun erken ödenen parçasıdır,
 * kâr-zarara ikinci kez girmez.
 */
export const staffAdvances = pgTable(
  "staff_advances",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    /** Paranın verildiği / maaştan düşüldüğü gün (YYYY-MM-DD) */
    date: text("date").notNull(),
    kind: text("kind", { enum: ["avans", "kesinti"] }).notNull(),
    amount: doublePrecision("amount").notNull(),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name"),
    createdAt: createdAt(),
  },
  (t) => [
    index("staff_advances_staff_idx").on(t.staffId, t.date),
    check("staff_advances_kind_ck", sql`${t.kind} in ('avans','kesinti')`),
    check("staff_advances_amount_ck", sql`${t.amount} > 0`),
  ],
);

export const fixedExpenses = pgTable("fixed_expenses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  section: text("section", { enum: ["personel", "faturalar", "kira", "genel"] }).notNull(),
  period: text("period", { enum: ["aylik", "gunluk", "haftalik", "yillik"] }).notNull().default("aylik"),
  /** KDV hariç (gelir-gider bu tutarla) */
  amount: doublePrecision("amount").notNull().default(0),
  /**
   * Faturasındaki KDV oranı (0, 0,01, 0,1, 0,2): nakit planı gideri KDV dahil öder (src/lib/cash-plan.ts). Boşsa
   * bölümün varsayılanı: personel KDV'siz, ötekiler %20 (FIXED_SECTION_VAT)
   */
  vatRate: doublePrecision("vat_rate"),
  note: text("note"),
  active: boolean("active").notNull().default(true),
  startMonth: text("start_month"),
  endMonth: text("end_month"),
  sortOrder: integer("sort_order").notNull().default(0),
  /**
   * Vergi: giderin belgesi (boş = sınıflandırılmadı). `bordro` yalnız personel bölümünde, `yok` personel bölümünde değil
   * (eylem denetler; docs/VERGI.md)
   */
  taxDoc: text("tax_doc", { enum: ["fatura", "belgeli", "yok", "bordro"] }),
  /** Vergi: ödemeden kesilen stopaj ya da sorumlu sıfatıyla KDV (boş = seçilmedi; muhtasar "en az" sayar) */
  taxWithholding: text("tax_withholding", {
    enum: ["yok", "kira", "serbest_meslek", "internet_reklam", "internet_reklam_yurtdisi", "yurt_disi_hizmet"],
  }),
  /**
   * Kira: resmi (sözleşmedeki) aylık kira; boşsa yok. Gelir-gider "Kira stopajı" = resmi brüt × kira stopajı oranı;
   * vergide kira gideri yalnız resmi brüt (src/lib/calc/engine.ts officialRentGross; docs/VERGI.md)
   */
  officialAmount: doublePrecision("official_amount"),
  /** Resmi kira brüt mü net mi (net: brüt = net ÷ 0,8) */
  officialBasis: text("official_basis", { enum: ["brut", "net"] }),
  /**
   * Kira: ev sahibi şahıs mı şirket mi (Faz 5; boş = seçilmedi, bugünkü kural). Şahıs: KDV yok, stopaj %20 resmi kiradan;
   * şirket: %20 KDV, stopaj yok, belgesi fatura (src/lib/constants.ts fixedVatRate; docs/VERGI.md)
   */
  landlordType: text("landlord_type", { enum: ["sahis", "sirket"] }),
  /** Açık güne göre oranla; false: biten ayda tam ay (kira varsayılanı) */
  prorate: boolean("prorate").notNull().default(true),
  /**
   * Şube (docs/SUBE.md, dalga 3): null = işletme geneli (muhasebe, abonelik; her şubenin görünümünde de görünür).
   * Mevcut kalemler işletme geneli başlar (sahibin kararı, 4 Kasım 2026); kira gibi şubeye ait olanı yönetici taşır
   */
  branchId: branchIdNullable(),
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
  /** Vergi: kategorideki harcamaların belgesi (boş = sınıflandırılmadı; docs/VERGI.md) */
  taxDoc: text("tax_doc", { enum: ["fatura", "belgeli", "yok"] }),
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
    branchId: branchIdNullable(),
    date: text("date").notNull(), // YYYY-MM-DD
    categoryId: integer("category_id")
      .notNull()
      .references(() => expenseCategories.id, { onDelete: "restrict" }),
    description: text("description"),
    amount: doublePrecision("amount").notNull(),
    paymentMethod: text("payment_method", { enum: ["nakit", "kart", "havale", "diger"] }),
    note: text("note"),
    /** Yazan kişinin adı; kasadan gelen satırda AsilPOS (veritabanında eski adla, authorText) */
    createdBy: authorText("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Fişin fotoğrafı (kasadan çıkan satırıyla aynı fotoğraf) */
    photoId: integer("photo_id").references(() => photos.id, { onDelete: "set null" }),
    /** Fişteki toplam KDV: yalnız bilgi (tutar KDV dahil kalır; KDV tahmini perakende fişin KDV'sini düşmez) */
    vat: doublePrecision("vat"),
    /** Bu kaydı yazan kasadan çıkan satırı */
    cashOutId: integer("cash_out_id").references(() => cashOuts.id, { onDelete: "set null" }),
    /**
     * Kaydın sahibi olan cari borç ("Faturası yok · gider yaz" ya da "Gideri zaten girildi"): tutarı, günü ve kategorisi
     * Tedarikçiler'de düzeltilir, burada kilitli
     */
    supplierEntryId: integer("supplier_entry_id").references(() => supplierEntries.id, { onDelete: "set null" }),
    /** Kapalı dönem kararı: harcamanın hesaplarda sayılacağı gün (faturalardaki `periodDate` ile aynı kural) */
    periodDate: text("period_date"),
  },
  (t) => [
    index("expense_entries_date_idx").on(t.date),
    index("expense_entries_category_idx").on(t.categoryId),
    uniqueIndex("expense_entries_photo_uq").on(t.photoId),
    uniqueIndex("expense_entries_cash_out_uq").on(t.cashOutId),
    uniqueIndex("expense_entries_supplier_entry_uq").on(t.supplierEntryId),
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
    /** Hücre notu (ör. "makine servisi"): elle düzeltmenin açıklaması */
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
    branchId: branchId(),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    qty: doublePrecision("qty").notNull(),
    /** Sayıldığı andaki birim çarpanı (KG/LT = 1000, ADET/DİLİM = 1); sayım birimi sonradan değişse de eski değer korunur */
    factor: doublePrecision("factor"),
    countedBy: text("counted_by"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("stock_counts_month_ingredient_uq").on(t.month, t.branchId, t.ingredientId)],
);

/**
 * Sayımın "Listede olmayanlar"ı. Şube başına (docs/SUBE.md › Stok ve sayım; migration 0059): Tuzla'nın ve Marina'nın
 * ay sonu ek kalemleri ayrı listedir, "Tümü" ikisini toplar. Eski satırlar Tuzla'nın (21 Kasım denetimi #19/#24)
 */
export const stockExtras = pgTable("stock_extras", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(),
  branchId: branchId(),
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

// ---------------------------------------------------------------- Tahmini stok (docs/STOK-TAHMINI.md)
/**
 * Kritik stok eşiği, şube ve malzeme başına (bugün yalnız Marina: tahmin AsilPOS'un şubesinindir). Miktar malzemenin
 * kendi biriminde (gr, ml, adet, dilim): sayım birimi sonradan değişse de anlamı değişmez; ekran sayım biriminde
 * yazdırır. Tahmini stok eşiğe eşit ya da altındaysa Tahmini stok listesi, Genel bakış ve Bugün uyarır. Satır yoksa
 * eşik yoktur, uyarı da yok. Stok sayımı, değerleme ve mal maliyeti bunu okumaz.
 */
export const stockThresholds = pgTable(
  "stock_thresholds",
  {
    branchId: branchId(),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    qty: doublePrecision("qty").notNull(),
    updatedByName: text("updated_by_name"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.ingredientId] }), check("stock_thresholds_qty_ck", sql`${t.qty} >= 0`)],
);

export const findings = pgTable(
  "findings",
  {
    id: serial("id").primaryKey(),
    section: text("section").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    resolved: boolean("resolved").notNull().default(false),
    /** Bulgu ekle penceresinin istemci anahtarı: kısayolun ikinci basışı ikinci bulgu açmaz (denetim UI-03) */
    clientKey: text("client_key"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("findings_client_key_uq").on(t.clientKey)],
);

/** Kim, ne zaman, neyi değiştirdi */
export const activityLog = pgTable(
  "activity_log",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    userName: authorText("user_name"),
    /**
     * İşlemi yapan hesap (eski kayıtlarda ve "Sistem"de boş). Ad serbest metindir ve kişi kendi adını değiştirebilir:
     * İşlem geçmişi hesabın e-postasını da gösterir, başkasının adını alan kayıt sahibini taklit edemez
     */
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    detail: text("detail"),
    /**
     * Kaydın aracı: "asistan" = kullanıcı panel asistanının onay kartında Onayla'ya bastı (docs/ASISTAN-ISLEMLER.md
     * › İşlem geçmişi); boş = kişi ekrandan kendisi yaptı. İşlem geçmişi "… (asistan aracılığıyla)" diye gösterir
     */
    via: text("via"),
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
    /** Eşitlenen Paraşüt hesabı (sahibi şube; eski kayıtlar varsayılan şubenin tek hesabı) */
    account: text("account").notNull().default(DEFAULT_BRANCH_ID),
  },
  (t) => [index("parasut_sync_runs_started_idx").on(t.startedAt), index("parasut_sync_runs_account_idx").on(t.account, t.startedAt)],
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
    /**
     * Ödemenin şubesi (docs/SUBE.md › Ödemeler): null = işletme geneli (vergi, muhasebe; her şubenin Ödemeler'inde de
     * görünür). Var olan hatırlatıcılar işletme geneli kaldı; şubeye ait olanı (kira, aidat) yönetici taşır
     */
    branchId: branchIdNullable(),
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
  /**
   * Adresin şubeleri (şube kapsamı C P1-11; docs/BILDIRIMLER.md › Sabah e-postası): boş = bütün şubeler (bugünkü gibi
   * tek e-posta). Doluysa sabah e-postası bu şubelerin başlığıyla ayrı gider: şubenin ve işletme genelinin ödemeleri,
   * şubenin onay bekleyen istekleri ve kontrol listeleri; öbür şubenin satırı girmez. Yabancı anahtar yok (dizi): silinen
   * şube kimliği gönderimde yok sayılır
   */
  branchIds: text("branch_ids").array().notNull().default(sql`'{}'::text[]`),
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
    /** "kontrol": kontrol listesi ve karaoke personel e-postaları (src/lib/job-health.ts RunJobKey); düz metin sütun, göç yok */
    job: text("job", { enum: ["parasut", "gunluk", "kontrol"] }).notNull(),
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

// ---------------------------------------------------------------- Hata kaydı
/**
 * Canlıdaki hataların kısa ömürlü kaydı (docs/HATA-KAYDI.md): sunucu hataları (`src/instrumentation.ts` ›
 * onRequestError), sunucu eylemlerinin beklenmeyen hataları (`attempt()`), tarayıcı hataları (`/api/hata`) ve CSP ihlal
 * raporları (`/api/csp-rapor`). Aynı hata tek satırdır (`fingerprint`): sayısı, ilk ve son görülüşü. Kişisel veri ve
 * anahtar taşımaz (istek gövdesi, çerez, başlık, sorgu dizgesi yok; metinler kısaltılıp temizlenir: src/lib/error-log.ts).
 * Kaynak başına günde en çok sınırlı sayıda yeni satır açılır; 30 günden eski satırları sabah işi siler. Yedeğe girmez.
 */
export const errorLog = pgTable(
  "error_log",
  {
    id: serial("id").primaryKey(),
    /** Hatanın özeti (kaynak, ad, sayıları atılmış ileti, yol): aynı hata aynı satırı artırır */
    fingerprint: text("fingerprint").notNull(),
    source: text("source", { enum: ["server", "action", "client", "csp"] }).notNull(),
    level: text("level", { enum: ["error", "warning"] }).notNull().default("error"),
    /** Hatanın adı (TypeError, PostgresError…) ya da CSP yönergesi */
    name: text("name"),
    message: text("message").notNull(),
    /** Sayfanın ya da yolun adresi (sorgu dizgesi yok) */
    path: text("path"),
    /** Bağlam: sayfa / API yolu / eylem, tarayıcı, CSP kaynağı */
    detail: text("detail"),
    /** Next'in hata kodu (hata ekranındaki "Hata kodu") */
    digest: text("digest"),
    /** Yığının ilk satırları (dosya yolları kısaltılmış) */
    stack: text("stack"),
    count: integer("count").notNull().default(1),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    /** Yönetici "Çözüldü" dedi; hata yeniden görülürse boşalır */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("error_log_fingerprint_uq").on(t.fingerprint),
    index("error_log_last_seen_idx").on(t.lastSeen),
    index("error_log_source_first_idx").on(t.source, t.firstSeen),
    check("error_log_source_ck", sql`${t.source} in ('server','action','client','csp')`),
    check("error_log_level_ck", sql`${t.level} in ('error','warning')`),
    check("error_log_count_ck", sql`${t.count} > 0`),
  ],
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
    /**
     * Personel öneriyi her güncellediğinde artar: yönetici yalnız ekranda gördüğü sürümü onaylar (seenVersion;
     * docs/ONAYLAR.md). Eski satırlar 1
     */
    version: integer("version").notNull().default(1),
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

/**
 * Reçete geçmişi (docs/DONEM-KAPANISI.md › Reçete geçmişi): reçeteyi (satırlar ya da hazırlama notu) değiştiren her
 * kayıtta bir satır: kim, ne zaman, nereden, önceki ve sonraki reçete. Satır adları anlık görüntüde saklanır (malzeme
 * sonra silinse de okunur). Yalnız eklenir; ürün silinince geçmişi de gider.
 */
export const recipeVersions = pgTable(
  "recipe_versions",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** edit: ürün kartından; approval: personelin onaylanan önerisi; create: ürün açılırken yazılan ilk reçete */
    source: text("source", { enum: ["edit", "approval", "create"] }).notNull().default("edit"),
    before: jsonb("before").$type<RecipeSnapshot>().notNull(),
    after: jsonb("after").$type<RecipeSnapshot>().notNull(),
    /** Farkın tek satırlık özeti (summarizeDiff): liste bunu gösterir, ayrıntı açılınca fark hesaplanır */
    summary: text("summary").notNull(),
    changedBy: integer("changed_by").references(() => users.id, { onDelete: "set null" }),
    changedByName: text("changed_by_name").notNull(),
    /** Onaylanan öneride öneren personelin adı */
    requestedByName: text("requested_by_name"),
    createdAt: createdAt(),
  },
  (t) => [index("recipe_versions_product_idx").on(t.productId, t.createdAt)],
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
    /**
     * Tekrarın saati ("HH:MM"; saatsizse boş): "1 saat sonra hatırlat" yalnız bu dönemin `dueTime`'ını kaydırır,
     * "Yaptım" sıradaki döneme bu saatle geçer. Önceden erteleme saati serinin saati oluyordu: 09:00'daki günlük
     * hatırlatma bir kez ertelenince her gün 10:05'te çalıyordu (denetim 21 Kasım #15). Eski satırlar `due_time` ile
     * dolduruldu (migration 0059)
     */
    anchorTime: text("anchor_time"),
    repeat: text("repeat", { enum: ["none", "daily", "weekly", "monthly"] }).notNull().default("none"),
    /**
     * Bilgisayarda çalan uyarı (4 Kasım 2026): "tek" bugünkü davranış (bir zil), "surekli" durdurulana kadar
     * (karaoke alarmı gibi), "yok" sessiz — bildirim yine çıkar. Eski satırlar "tek" ile gelir.
     */
    sound: text("sound", { enum: ["tek", "surekli", "yok"] }).notNull().default("tek"),
    /**
     * Hatırlatıcıyı kim kurdu: başkasına atanmışsa yöneticinin kimliği, kendi kurduysa boş. Sahibi `userId`'dir
     * ve yalnız o görür / tamamlar; atayan yalnız ekranda "Yönetici kurdu" diye görünür.
     */
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name"),
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
    /**
     * İptalin iade tutarı (kuruş; sitenin `refundMinor`'ı, 29 Ekim 2026): 0 hiçbir şey geri gitmedi, toplamdan küçük bir
     * kısmı, boş tamamı ya da bilinmiyor. Tutar gibi yalnız yönetici görür; personel ekranı yalnız türünü yazar
     */
    refundMinor: integer("refund_minor"),
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

/**
 * Elle eklenen karaoke rezervasyonunun "bir gün kaldı" hatırlatma e-postası (docs/KARAOKE.md › Hatırlatma e-postası).
 * Misafirin adresi panelde yalnız burada, şifreli (AES-256-GCM, secret-box "karaoke-reminder") ve yalnız hatırlatma
 * gidene kadar durur: gönderilince, rezervasyon kaldırılınca / iptal edilince ya da gönderilemeden saati yaklaşınca adres
 * silinir, satır yalnız sonucuyla kalır (birkaç gün sonra o da silinir). Rezervasyonun kendisi sitededir: saat, ad ve
 * durum gönderim anında `karaoke_sessions`'tan (sitenin kimliğiyle) okunur. Yedeğe girmez (TABLE_RULES).
 */
export const karaokeReminders = pgTable(
  "karaoke_reminders",
  {
    /** Sitenin rezervasyon kimliği (`karaoke_sessions.external_id`); satır, kopya eşitlenmeden önce de yazılabilir */
    externalId: text("external_id").primaryKey(),
    /** Misafirin e-posta adresi, şifreli; iş bitince (gönderildi, vazgeçildi) boşalır */
    emailSealed: text("email_sealed"),
    status: text("status", { enum: ["pending", "sent", "skipped", "failed"] }).notNull().default("pending"),
    /** Vazgeçmenin ya da hatanın nedeni (adres taşımaz) */
    detail: text("detail"),
    attempts: integer("attempts").notNull().default(0),
    /** Bir çalışmanın gönderimi sahiplendiği an (iki tetikleyici aynı iletiyi iki kez göndermesin) */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    /** Gönderildiği ya da vazgeçildiği an */
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("karaoke_reminders_status_idx").on(t.status)],
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
    /**
     * Onay bildirimleri: yöneticiye personelin yeni açtığı istek (src/server/staff-requests/push.ts; docs/ONAYLAR.md).
     * Cihazdaki "Onay bildirimleri" anahtarı (yalnız yönetici) bunu yazar
     */
    approvals: boolean("approvals").notNull().default(true),
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
 * gönderilince güncellenir, revision artar). Tutarlar TL. Olması gereken nakit = açılış + nakit satış + gün içinde
 * giren − gün içinde çıkan; kasa farkı = sayılan − olması gereken (eksi: eksik, artı: fazla). Hesap
 * src/lib/cash-report.ts'te; farkı liste ve özet için ayrıca saklanır. Ayrıntı: docs/KASA-RAPORU.md.
 */
export const cashReports = pgTable(
  "cash_reports",
  {
    id: serial("id").primaryKey(),
    /** İş günü (YYYY-MM-DD, Türkiye); gece yarısından sonra kapanan gün bir önceki güne yazılır */
    date: text("date").notNull(),
    branchId: branchId(),
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
    /**
     * Gün içinde kasaya giren: nakit satış dışında çekmeceye konan (bozuk para, nakit tahsilat, nakit bahşiş; AsilPOS'un
     * `cashIn`'i). Sonradan geldi: önceki raporlarda 0
     */
    cashIn: doublePrecision("cash_in").notNull().default(0),
    cashOut: doublePrecision("cash_out").notNull().default(0),
    cashOutNote: text("cash_out_note"),
    countedCash: doublePrecision("counted_cash").notNull().default(0),
    handedOver: doublePrecision("handed_over").notNull().default(0),
    /**
     * Sayımdan sonra teslim edileni alan ("Kime"; Teslim defteri, docs/KASA-RAPORU.md › Teslim defteri): yönetici
     * kullanıcının adı, "Banka" ya da elle yazılan ad (en çok 60). Teslim yoksa boş; alan gelmeden önceki raporlarda boş
     */
    handedTo: text("handed_to"),
    /** Teslimi alan yönetici hesabıysa kimliği (adı handedTo'da kalır, hesap silinse de okunur) */
    handedToUserId: integer("handed_to_user_id").references(() => users.id, { onDelete: "set null" }),
    /**
     * Banka gün sonu fişinin net toplamı (yazarkasa Z'sinin kart satırı değil); yazarkasa kartı yoksa ModPOS'taki kartla
     * karşılaştırılır. Yazarkasa bölümünden (dalga 13) önceki raporlarda tek kart kanıtı: o günlerde Z'nin kart satırını
     * da tutabilir, anlam iddia edilmez
     */
    bankPos: doublePrecision("bank_pos"),
    /**
     * Yazarkasanın (banka POS, yeni nesil ÖKC) mali Z raporu (docs/planlar/okc-z.md §6.1); bölüm isteğe bağlı, eski
     * raporlarda hepsi boş. Z no metindir (baştaki sıfırlar korunur); tutarlar KDV dahil
     */
    okcZNo: text("okc_z_no"),
    okcReceipts: integer("okc_receipts"),
    okcTotal: doublePrecision("okc_total"),
    okcVatTotal: doublePrecision("okc_vat_total"),
    /** Oran oran KDV dökümü {rate, total, vat}[]: sıfır gruplar yazılmaz, orana göre sıralı (src/lib/okc-z.ts normalizeVat) */
    okcVat: jsonb("okc_vat").$type<OkcVatLine[]>(),
    okcCash: doublePrecision("okc_cash"),
    /** K.KARTI / KREDİ satırı (altındaki banka satırları hariç) */
    okcCard: doublePrecision("okc_card"),
    okcMealCard: doublePrecision("okc_meal_card"),
    /** Diğer ve tanınmayan ödeme satırları */
    okcOther: doublePrecision("okc_other"),
    /**
     * Sunucu sütunları (formdan gelmez, personel yazmaz; yalnız yöneticinin DTO'sunda): rapora bağlı yazarkasa Z
     * fotoğrafının okumasından writeCashReport'ta yazılır. Kümülatif (KÜM. TOPLAM / KÜM. KDV) yalnız inandırıcıysa
     * saklanır; zincir son saklanan kümülatife bağlanır, yönetici temizleyebilir (src/lib/okc-z.ts okcCumulativeToStore)
     */
    okcCumTotal: doublePrecision("okc_cum_total"),
    okcCumVat: doublePrecision("okc_cum_vat"),
    /** Yazarkasa toplamı dışındaki tahsilatlar (faturalı satış, bilgi fişi…); 1 ₺'yi geçerse */
    okcOutside: doublePrecision("okc_outside"),
    /** Z raporundaki ödenmez / ikram tutarı (ciroya girmez; panelde kayıtlı ikramla karşılaştırılır) */
    offRevenue: doublePrecision("off_revenue"),
    /** Z raporundaki indirim toplamı (isteğe bağlı; girilmediyse null: ayın indirimine yalnız girilen günler gider) */
    discounts: doublePrecision("discounts"),
    note: text("note"),
    cashDiff: doublePrecision("cash_diff").notNull().default(0),
    submittedBy: integer("submitted_by").references(() => users.id, { onDelete: "set null" }),
    submittedByName: authorText("submitted_by_name").notNull(),
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
  (t) => [uniqueIndex("cash_reports_date_uq").on(t.date, t.branchId)],
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
    submittedByName: authorText("submitted_by_name").notNull(),
    /** O sürümün gönderildiği an (raporun o andaki updated_at'i) */
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    /** Yerine yenisinin geldiği an */
    createdAt: createdAt(),
  },
  (t) => [index("cash_report_revisions_report_idx").on(t.reportId)],
);

/**
 * Kör sayım (docs/KASA-RAPORU.md › Kör sayım; şube ayarı kasa.kor): personel çekmecedeki nakdi önce sayıp kilitler,
 * olması gereken ve kasa farkı ancak ondan sonra görünür. Sayım başına bir satır, yalnız eklenir: ilk satır kör sayımdır
 * (neden yok), sonrakiler değişikliktir (neden zorunlu) ve yöneticiye görünür. Günün geçerli sayımı en son satırdır;
 * personelin raporundaki sayılan nakit ona eşit olmak zorundadır (src/server/cash/blind-count.ts). Rapordan bağımsızdır:
 * rapor silinse de sayım geçmişi kalır.
 */
export const cashCounts = pgTable(
  "cash_counts",
  {
    id: serial("id").primaryKey(),
    branchId: branchId(),
    /** Kasanın iş günü (YYYY-MM-DD) */
    date: text("date").notNull(),
    /** Sayılan nakit (TL) */
    amount: doublePrecision("amount").notNull(),
    /** Değişikliğin nedeni; ilk (kör) sayımda boş */
    reason: text("reason"),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    userName: text("user_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("cash_counts_day_idx").on(t.date, t.branchId)],
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
    kind: text("kind", { enum: ["kasa-z", "kasa-pos", "kasa-okc"] }).notNull(),
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
    branchId: branchId(),
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
    createdByName: authorText("created_by_name").notNull(),
    /**
     * AsilPOS'un kasa hareketinin kimliği (ULID; Faz 3, docs/ASILPOS.md › Kasadan çıkanlar AsilPOS'tan): satır AsilPOS'tan
     * geldi ya da elle girilmiş eşi AsilPOS'a bağlandı. Tutar, tür ve gün AsilPOS'undur (src/lib/asilpos/cash-moves.ts
     * asilposCashOutChange); fotoğraf, yer, belge ve kategori panelden. Elle girilen satırda null. Ad değişikliği
     * (migration 0098): veritabanında eski adlı sütun da durur (ESKI_SUTUNLAR), tetikleyici ikisini eşit tutar; canlıdaki
     * eski sürüm onu yazar. Eski sütun ve benzersiz dizini temizlik PR'ında (A3) kalkar
     */
    asilposId: text("asilpos_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("cash_outs_date_idx").on(t.date), uniqueIndex("cash_outs_photo_uq").on(t.photoId), uniqueIndex("cash_outs_asilpos_uq").on(t.asilposId)],
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
    branchId: branchId(),
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
    /**
     * Zayi formunun istemci anahtarı (her başarılı kayıttan sonra yenilenir): Enter'a ikinci basış ya da yanıtı yolda
     * kalan isteğin tekrarı ikinci kayıt açmaz, var olan döner (denetim UI-01). Onaylanan geç kayıtta boş
     */
    clientKey: text("client_key"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("waste_entries_date_idx").on(t.date), uniqueIndex("waste_entries_client_key_uq").on(t.clientKey)],
);

// ---------------------------------------------------------------- Mal siparişi ve hızlı sayım (kaldırıldı)
// Hızlı sayım ve mal siparişi 26 Eki 2026'da panelden kaldırıldı (sahibin isteği: "normal sayım olsun"; aylık Stok
// sayımı kalır). Üç tablo geçmiş için duruyor: migration yok, veri silinmez (Instant Rollback eski sürümü açabilsin).
// Hiçbir ekran ve iş bunları okumaz ya da yazmaz; jsonb kolonlarının eski biçimleri git geçmişinde
// (src/lib/reorder/types.ts, docs/MAL-SIPARISI.md).
/**
 * (Kaldırıldı, geçmiş için) Hızlı sayımda sayılan ve sipariş önerilen kalemler (10–15 kritik hammadde). Boş alanlar verilerden gelir: hedef
 * kullanımdan, tedarikçi son alınan Paraşüt faturasından, sipariş birimi ve adı o tedarikçinin son fatura kaleminden
 * (eskiden src/server/data/reorder.ts). Miktarlar malzemenin kendi biriminde (gr, ml, adet, dilim): sayım birimi sonradan
 * değişse de anlamı değişmez.
 */
export const reorderItems = pgTable("reorder_items", {
  ingredientId: integer("ingredient_id")
    .primaryKey()
    .references(() => ingredients.id, { onDelete: "cascade" }),
  /** Hedef stok (siparişle tamamlanacak miktar); boş = günlük kullanımdan önerilen */
  parBase: doublePrecision("par_base"),
  /** Teslim süresi (gün); boş = aynı tedarikçinin diğer kalemleri ya da genel ayar */
  leadDays: integer("lead_days"),
  /** Tercih edilen tedarikçinin adı (Tedarikçiler'deki gibi adla eşleşir); boş = son alınan */
  supplier: text("supplier"),
  /** Mesajda yazılacak ad (tedarikçinin ürün adı); boş = son fatura kalemi / paket açıklaması */
  orderName: text("order_name"),
  /** Sipariş birimi ("koli", "paket") ve 1 biriminin içeriği (kendi biriminde); boş = son faturadaki birim ve çarpan */
  orderUnit: text("order_unit"),
  orderUnitSize: doublePrecision("order_unit_size"),
  updatedBy: text("updated_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * (Kaldırıldı, geçmiş için) Haftalık hızlı sayım (ay sonu stok sayımından ayrı): kalem başına iş günü başına bir satır; aynı gün yeniden
 * kaydedilince güncellenir. Eldeki stok = en yeni hızlı sayım ya da ay sonu sayımı (hangisi yeniyse). Personel de yazar.
 */
export const quickCounts = pgTable(
  "quick_counts",
  {
    id: serial("id").primaryKey(),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    /** İş günü (YYYY-MM-DD, Türkiye; 05:00'te döner) */
    day: text("day").notNull(),
    /** Sayım birimindeki miktar ve sayıldığı andaki çarpanı (KG/LT = 1000) */
    qty: doublePrecision("qty").notNull(),
    factor: doublePrecision("factor").notNull(),
    countedAt: timestamp("counted_at", { withTimezone: true }).notNull().defaultNow(),
    countedBy: integer("counted_by").references(() => users.id, { onDelete: "set null" }),
    countedByName: text("counted_by_name").notNull(),
  },
  (t) => [uniqueIndex("quick_counts_ingredient_day_uq").on(t.ingredientId, t.day), index("quick_counts_counted_idx").on(t.countedAt)],
);

/**
 * (Kaldırıldı, geçmiş için) Tedarikçiye gönderilen mal siparişi (WhatsApp ya da kopyalanan metin). Kalemler gönderim anının kopyası (jsonb):
 * hammadde sonradan değişse de siparişte ne istendiği okunur. Paraşüt faturası gelince eşitleme faturayı bağlar ve
 * kalem kalem karşılaştırır (delivery_check); fark yoksa sipariş kendiliğinden kapanır. Fiyatlar yalnız yöneticiye
 * gösterilir.
 */
export const supplierOrders = pgTable(
  "supplier_orders",
  {
    id: serial("id").primaryKey(),
    /** İstemcinin ürettiği istek kimliği (UUID): çift dokunuş ya da yeniden deneme ikinci sipariş açmaz */
    requestId: text("request_id").notNull(),
    /** Tedarikçinin adı (gönderim anında; Tedarikçiler'deki gibi adla, varsa vergi noyla eşleşir) */
    supplier: text("supplier").notNull(),
    /** Mesajın gittiği numara (E.164, cep); boş: kişi WhatsApp'ta seçildi ya da metin kopyalandı */
    phone: text("phone"),
    channel: text("channel", { enum: ["whatsapp", "kopya"] }).notNull(),
    /** Açılan (ya da kopyalanan) mesajın kendisi */
    message: text("message").notNull(),
    note: text("note"),
    /** Gönderim anının kalemleri (eski biçim: ReorderLine, git geçmişinde) */
    lines: jsonb("lines").$type<Record<string, unknown>[]>().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    sentBy: integer("sent_by").references(() => users.id, { onDelete: "set null" }),
    sentByName: text("sent_by_name").notNull(),
    /** Beklenen teslim günü (YYYY-MM-DD): gönderim günü + kalemlerin en uzun teslim süresi */
    expectedOn: text("expected_on").notNull(),
    status: text("status", { enum: ["open", "closed", "cancelled"] }).notNull().default("open"),
    /**
     * Mal geldi: elle "Geldi" (dokunuş anı; sayımın gününe kadar beklenen sipariş sayımdan sonra işaretlendiyse sayımın
     * hemen öncesi) ya da eşleşen faturanın günü; sayımdan sonra gelen sipariş listede "siparişte" sayılır
     */
    receivedAt: timestamp("received_at", { withTimezone: true }),
    receivedBy: integer("received_by").references(() => users.id, { onDelete: "set null" }),
    receivedByName: text("received_by_name"),
    /** Eşleşen Paraşüt / elle fatura; silinirse boşalır ve eşitleme yeniden arar */
    invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    /** Fatura elle seçildi ya da eşleşme elle kaldırıldı: eşitleme dokunmaz */
    manualMatch: boolean("manual_match").notNull().default(false),
    /** Faturayla karşılaştırmanın sonucu (eski biçim: DeliveryCheck, git geçmişinde) */
    deliveryCheck: jsonb("delivery_check").$type<Record<string, unknown>>(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    /** Kapanış (iptal) anı; yeniden açılan siparişte son kapanış kalır: eşitleme onu kendiliğinden kapatmaz */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByName: text("closed_by_name"),
    closeNote: text("close_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("supplier_orders_request_uq").on(t.requestId),
    // Bir fatura en çok bir siparişe bağlanır
    uniqueIndex("supplier_orders_invoice_uq").on(t.invoiceId).where(sql`invoice_id is not null`),
    index("supplier_orders_status_idx").on(t.status, t.sentAt),
  ],
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
    /** "kasa-z" | "kasa-pos" | "kasa-okc" | "fis" | "kontrol" (src/lib/photo-rules.ts; yeni tür migration istemez) */
    kind: text("kind", { enum: ["kasa-z", "kasa-pos", "kasa-okc", "fis", "kontrol"] }).notNull(),
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
    /**
     * Belge taranarak yüklendiyse (docs/FOTOGRAF.md › Belge tarama) asıl fotoğrafın depodaki yolu: `storage_key`
     * taranmış hâldir (okunan ve gösterilen), bu küçültülmüş asıl hâl ("Orijinal" düğmesi, GET /api/foto/{id}?v=asil).
     * Tür uzantıdan; fotoğrafla birlikte silinir. Taranmadan yüklenen fotoğrafta boş
     */
    originalKey: text("original_key"),
    originalSize: integer("original_size"),
    /** Taramanın bilgisi (src/lib/photo-scan.ts ScanInfo: köşeler 0–1000, mod, yöntem, güven, çeyrek dönüş) */
    scan: jsonb("scan"),
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
    /**
     * "kasa-z" | "kasa-pos" | "kasa-okc" | "fis" | "fatura" | "vardiya" (yazarak doldurma; okuma sınırına sayılmaz) |
     * "asistan" (panel asistanının sorusu, docs/ASISTAN.md; okuma sınırına sayılmaz, yönetici başına kendi sınırı var) |
     * "tarama" (belge taramada köşe ipucu, docs/FOTOGRAF.md › Belge tarama; okuma sınırına sayılmaz, kendi sınırı var)
     */
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
    /** İstenen efor ("low" | "medium"); eforu açıkça seçilen okumalarda (yazarkasa Z'si) ve asistanda, ötekilerde boş */
    effort: text("effort"),
    ms: integer("ms"),
    stopReason: text("stop_reason"),
    requestId: text("request_id"),
    result: jsonb("result"),
    error: text("error"),
  },
  (t) => [index("ai_calls_at_idx").on(t.at), index("ai_calls_photo_idx").on(t.photoId)],
);

/**
 * Panel asistanının onay kartları (docs/ASISTAN-ISLEMLER.md): asistanın önerdiği her işlem burada bir plan olarak durur.
 * Sohbet yalnız planı yazar (önizleme: kartın metni ve önceki değerler); asıl eylem yalnız kartın Onayla düğmesinin
 * sunucu eyleminde çalışır. Onay tek kullanımlıktır: `pending` → `running` geçişi tek koşullu UPDATE'tir (sahibi,
 * süresi ve durumu birlikte denetlenir), ikinci dokunuş satır bulamaz ve hiçbir şey yazmaz. Kim, ne zaman, hangi kartı
 * onayladı: kaydın kendisi de denetim kaydıdır.
 */
export const assistantOps = pgTable(
  "assistant_ops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Aracın adı (src/lib/assistant/op-specs.ts) */
    tool: text("tool").notNull(),
    /** Modelin girdisi, zod'dan geçmiş hâli (onayda aynı şemayla yeniden ayrıştırılır) */
    input: jsonb("input").notNull(),
    /** Kartın içeriği, sunucunun çözdüğü bağımsız değişkenler ve önizlemede okunan önceki değerler (bayatlık denetimi) */
    preview: jsonb("preview").notNull(),
    /** Yazımın şube kapsamı (şube kimliği ya da "hepsi"); şubesiz işte boş */
    branch: text("branch"),
    status: text("status", { enum: ["pending", "running", "done", "failed", "unknown", "cancelled", "expired", "undoing", "undone"] })
      .notNull()
      .default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Eylemin sonucu ya da hata metni (ekranda gösterilen) */
    result: jsonb("result"),
    /** Geri al için sunucuda saklanan anlık görüntü (yalnız katalogda geri alması tanımlı işlemlerde) */
    undo: jsonb("undo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    doneAt: timestamp("done_at", { withTimezone: true }),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [index("assistant_ops_user_idx").on(t.userId, t.createdAt)],
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

// ---------------------------------------------------------------- Komisyon ve hakediş
/**
 * Komisyon kanalının bir satış ayı (yemek kartı şirketi ya da sipariş platformu): yöneticinin yazdığı aylık satış
 * (kanalın ekstresinden) ve gelen hakediş. Banka hesabı panele bağlı olmadığı için hakediş elle işaretlenir. Satır
 * yalnız yönetici bir şey yazınca açılır, her şey boşalınca silinir; ekran faturalardan ve kasa raporlarından hesaplar.
 * Faturalara değil kanal ve aya bağlı: faturalar yeniden yüklense de (db:reset) işaret yerinde kalır. Ayrıntı:
 * docs/KOMISYON.md.
 */
export const commissionMonths = pgTable(
  "commission_months",
  {
    id: serial("id").primaryKey(),
    /** Kanal anahtarı (pluxee, multinet, …, trendyol; src/lib/commission/channels.ts) */
    channel: text("channel").notNull(),
    /** Satış ayı (YYYY-MM): faturanın kapsadığı ay */
    month: text("month").notNull(),
    /** Elle yazılan satış, KDV dahil (kanalın ekstresinden); boş = Z raporlarından ya da bilinmiyor */
    sales: doublePrecision("sales"),
    /** Hakedişin geldiği gün (YYYY-MM-DD); boş = gelmedi */
    receivedOn: text("received_on"),
    /** Gelen tutar (₺); receivedOn ile birlikte dolu ya da boş */
    received: doublePrecision("received"),
    note: text("note"),
    updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedByName: text("updated_by_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("commission_months_channel_month_uq").on(t.channel, t.month),
    check("commission_months_received_pair", sql`(${t.receivedOn} is null) = (${t.received} is null)`),
  ],
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
    /** Listenin şubesi; boş: bütün şubeler (docs/KONTROL-LISTELERI.md › Şubeler) */
    branchId: branchIdNullable(),
    schedule: text("schedule", { enum: ["daily", "event"] }).notNull().default("daily"),
    /** "HH:MM" Türkiye saati; "event"te boş */
    opensAt: text("opens_at"),
    dueAt: text("due_at"),
    /** İş gününün haftanın günü: 1 = Pazartesi … 7 = Pazar */
    weekdays: jsonb("weekdays").$type<number[]>().notNull().default([1, 2, 3, 4, 5, 6, 7]),
    /** Personel doldurabilir (kapalı: yalnız yönetici görür ve doldurur) */
    staffAllowed: boolean("staff_allowed").notNull().default(true),
    /**
     * Personele son açıldığı an (staffAllowed false → true): personel geçmişte yalnız bu andan sonraki kayıtları görür.
     * Boş: baştan beri personelin (docs/KONTROL-LISTELERI.md)
     */
    staffSince: timestamp("staff_since", { withTimezone: true }),
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

// ---------------------------------------------------------------- Satış tahmini
/**
 * Yöneticinin tahmine eklediği özel günler (derbi, AVM etkinliği, kampanya, kafe kapalı). effect −0,30 … +0,30
 * (kapalı −1). Geçmiş günler de girilebilir: o gün normal günlerin ortalamasına katılmaz. Ayrıntı: docs/OZEL-GUNLER.md.
 */
export const specialDays = pgTable(
  "special_days",
  {
    id: serial("id").primaryKey(),
    /** İş günü (YYYY-MM-DD), iki uç dahil */
    dateFrom: text("date_from").notNull(),
    dateTo: text("date_to").notNull(),
    kind: text("kind", { enum: ["derbi", "avm", "kampanya", "kapali", "diger"] }).notNull(),
    title: text("title").notNull(),
    effect: doublePrecision("effect").notNull().default(0),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    /** Personel ekledi (/panel/ozel-gunler): etkisi 0 olan personel satırı yalnız nottur, günü tabandan çıkarmaz */
    byStaff: boolean("by_staff").notNull().default(false),
    /** Son düzenleyen (ilk kayıtta boş): yöneticinin dokunduğu satırı personel artık değiştiremez */
    updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedByName: text("updated_by_name"),
    /**
     * Kapalı günün şubesi (denetim 13 Kasım KP-05; docs/SUBE.md › Kapalı gün): boş = işletme geneli (bütün şubeler
     * kapalı; bayram, eski satırlar). Yalnız `kapali` satırında dolu olur; öteki özel günler şubesizdir
     */
    branchId: branchIdNullable(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("special_days_from_idx").on(t.dateFrom),
    check("special_days_range_ck", sql`${t.dateFrom} <= ${t.dateTo}`),
    check("special_days_effect_ck", sql`${t.effect} >= -1 and ${t.effect} <= 1`),
  ],
);

/**
 * Kasada bekleyen fiyat, şube başına (docs/FIYATLAR.md › Kasaya işle; şube kapsamı A3, 24 Kasım 2026): satır varsa o
 * şubenin kasasında ürünün eski fiyatı duruyor ("Fiyatlar › Kasaya işle"), yoksa kasa panelle aynı. Fiyat değişince
 * her etkin fiziksel şubenin satırı açılır ya da güncellenir (src/server/prices/record.ts), kasada işaretlenince yalnız o
 * şubeninki silinir (src/server/prices/pos-marks.ts); fiyat kasadaki fiyata geri dönerse kendiliğinden silinir. Tuzla'da
 * işaretlemek Marina'nın listesini değiştirmez. Okuyucular seçili şubenin kasasına bakar (src/server/data/till-scope.ts).
 * Şube silinince satırları da gider (durumdur, geçmiş değil; geçmiş pos_marks'ta): bu yüzden şube silme sayımına girmez.
 */
export const posStale = pgTable(
  "pos_stale",
  {
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Kasada duran eski fiyat (TL, KDV dahil) */
    stalePrice: doublePrecision("stale_price").notNull(),
    /** Kasanın panelden geri kaldığı an (işlenmemiş ilk değişiklik) */
    staleSince: timestamp("stale_since", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.productId] }), index("pos_stale_product_idx").on(t.productId)],
);

export const posMarks = pgTable(
  "pos_marks",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** İşaretin kasası (şube); şubeler öncesi işaretler Tuzla'nındır */
    branchId: branchId(),
    /** Kasada işlenen fiyat (TL, KDV dahil) */
    price: doublePrecision("price").notNull(),
    /** İşaretlenmeden önce kasada duran fiyat ve kasanın geri kaldığı an (geri almada ürüne yazılır) */
    stalePrice: doublePrecision("stale_price").notNull(),
    staleSince: timestamp("stale_since", { withTimezone: true }).notNull(),
    markedBy: integer("marked_by").references(() => users.id, { onDelete: "set null" }),
    markedByName: text("marked_by_name").notNull(),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneByName: text("undone_by_name"),
  },
  (t) => [
    index("pos_marks_marked_idx").on(t.markedAt),
    index("pos_marks_user_idx").on(t.markedBy, t.markedAt),
    index("pos_marks_product_idx").on(t.productId, t.markedAt),
    index("pos_marks_branch_product_idx").on(t.branchId, t.productId),
  ],
);

// ---------------------------------------------------------------- Personel istekleri (ortak onay kuyruğu)
/**
 * Personelin yöneticinin onayına giden istekleri (docs/ONAYLAR.md): kasa düzeltmesi ve silmesi, geç kasa raporu,
 * kasadan çıkan, fotoğraf kaldırma, kapalı gün, geç zayi / ikram, zayi silme ve karaoke sayacı silme (eski
 * `mal-taslak`: mal siparişi taslağı, 26 Eki 2026'da kaldırıldı; tür eski satırlar için enumda kalır, kuyruklar onu
 * okumaz; `karaoke-sil` 28 Eki 2026'da eklendi, denetim E-15). Kayıt onaya kadar
 * değişmez; istek burada bekler, türe özel alanlar `payload` ve `result` içinde (zod ile her okumada çözülür). Kişi
 * başına konu başına tek bekleyen istek (yenisi onu günceller, `version` artar); yönetici yalnız gördüğü sürümü onaylar,
 * kimse kendi isteğini onaylayamaz. Reçete önerileri ayrı tablodadır (recipe_change_requests). Türler ve durumlar
 * src/lib/staff-requests.ts'te; çekirdek src/server/staff-requests/core.ts.
 */
export const staffRequests = pgTable(
  "staff_requests",
  {
    id: serial("id").primaryKey(),
    kind: text("kind", {
      enum: ["kasa-duzeltme", "kasa-silme", "kasa-gec", "kasa-cikan", "foto-kaldir", "kapali-gun", "zayi-gec", "zayi-sil", "mal-taslak", "karaoke-sil"],
    }).notNull(),
    /** İsteğin konusu: gun:<D>, cikan:<id>, cikan-yeni:<anahtar>, foto:<id>, zayi:<id>, zayi-yeni:<anahtar>, karaoke:<id>, tedarikci:<anahtar> */
    subject: text("subject").notNull(),
    /** Etkilenen iş günü (YYYY-MM-DD); günü olmayan istekte boş */
    day: text("day"),
    /** Tutarsız, kişisel veri taşımayan tek satır ("22 Ekim kasa düzeltmesi"): zil, işlem geçmişi, sabah e-postası */
    title: text("title").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** İsteyenin nedeni (en çok 500 karakter) */
    message: text("message"),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "withdrawn", "superseded", "expired", "done", "cancelled", "revoked"],
    })
      .notNull()
      .default("pending"),
    /** İsteyen her düzenlemede artırır; onay ekranda görülen sürümle yapılır */
    version: integer("version").notNull().default(1),
    /** İstemcinin ürettiği istek kimliği: çift dokunuş ya da yeniden deneme ikinci istek açmaz */
    clientKey: text("client_key"),
    /** İstek beklerken tutulan fotoğraflar (bağlanmaz, silinmez) */
    photoIds: integer("photo_ids").array().notNull().default(sql`'{}'::integer[]`),
    requestedBy: integer("requested_by").references(() => users.id, { onDelete: "set null" }),
    requestedByName: text("requested_by_name").notNull(),
    /** Yöneticinin notu (personele görünür; tutar yazılmaz) */
    reviewNote: text("review_note"),
    reviewedBy: integer("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Onayın ürettiği satır (rapor, gider, zayi, sipariş, özel gün); yabancı anahtar yok */
    resultId: integer("result_id"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    /** Bu andan sonra kendiliğinden "expired" olur (sabah işi; kasadan çıkan) */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Zil kimliği: istek güncellenince en çok 10 dakikada bir yenilenir (yeniden okunmamış olur) */
    bumpedAt: timestamp("bumped_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("staff_requests_status_idx").on(t.status, t.createdAt),
    index("staff_requests_requester_idx").on(t.requestedBy, t.status, t.updatedAt),
    index("staff_requests_day_idx").on(t.kind, t.day),
    index("staff_requests_result_idx").on(t.kind, t.resultId),
    // Kişi başına konu başına tek bekleyen istek (yenisi onu günceller)
    uniqueIndex("staff_requests_pending_uq").on(t.kind, t.subject, t.requestedBy).where(sql`status = 'pending'`),
    // Tedarikçi başına tek canlı mal siparişi taslağı (özellik kaldırıldı; indeks veritabanında durur, migration yok)
    uniqueIndex("staff_requests_live_draft_uq").on(t.subject).where(sql`kind = 'mal-taslak' and status in ('pending', 'approved')`),
    uniqueIndex("staff_requests_client_key_uq").on(t.clientKey),
  ],
);

// ---------------------------------------------------------------- AsilPOS (kafenin kasası)
/**
 * AsilPOS'un günlük ürün satışı (docs/ASILPOS.md): gün sonunda gelen satış listesi, sales_lines'ın günlük karşılığı.
 * Geçiş gününden itibaren aylık maliyet modeline ay toplamı olarak girer (src/server/data/asilpos-sales.ts); aynı gün
 * yeniden gelirse (düzeltme) günün satırları tek işlemde silinip yenisi yazılır. Ürün önce sitenin kalemi ve boyuyla
 * (products.site_menu_id + site_menu_slot), yoksa POS eşleştirmesiyle (pos_mappings, posMatchKey) bulunur; bulunmazsa
 * boş kalır ve sonradan bağlanınca (site bağı ya da Satışlar'daki eşleştirme) yeniden gönderim olmadan dolar
 * (src/server/asilpos/rematch.ts).
 */
export const posDailySales = pgTable(
  "pos_daily_sales",
  {
    id: serial("id").primaryKey(),
    /** İş günü (YYYY-MM-DD; 05:00 kuralı, Kasa raporuyla aynı) */
    date: text("date").notNull(),
    branchId: branchId(),
    /** AsilPOS'taki POS adı (posName ya da "AD BOY") */
    posName: text("pos_name").notNull(),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    /** AsilPOS'un gönderdiği sitenin kalemi ve boyu (yoksa null): ürün sonradan siteye bağlanınca satır bununla bulunur */
    siteMenuId: text("site_menu_id"),
    slot: text("slot", { enum: ["M", "L"] }),
    qty: doublePrecision("qty").notNull(),
    /** TL, KDV dahil */
    revenue: doublePrecision("revenue").notNull(),
    /**
     * Satırın liste değeri, indirimden önce (TL, KDV dahil; Faz 2, 23 Kasım 2026): `revenue` indirimden sonradır, fark
     * satırın indirim payı. Eski AsilPOS göndermez: null
     */
    gross: doublePrecision("gross"),
    /** Birleşen satırda içeceğin seçeneğinden ayrılan ek parçası var (EXTRA SHOT, SYRUP, ALTERNATIF SÜT; Faz 2) */
    isAddon: boolean("is_addon").notNull().default(false),
    /** Hizmet satırı (karaoke): ürün değil, reçetesi yok */
    isService: boolean("is_service").notNull().default(false),
    /**
     * AsilPOS'un gönderdiği hizmet işareti: satır her gün sonunda (düzeltme gönderimi dahil) HİZMET yazılır, eşleştirme
     * onu değiştiremez (resolvePosLine). isService bunu ve HİZMET eşleştirmesini birlikte taşır. Ad değişikliği
     * (migration 0098): eski adlı sütun da durur, tetikleyici ikisini eşit tutar (temizlik PR'ında kalkar)
     */
    asilposService: boolean("asilpos_service").notNull().default(false),
    /**
     * Satılan parçaların dondurulan liste birim fiyatları (TL) ve adetleri (AsilPOS `lines[].listPrices`, şube fiyatı;
     * 24 Kasım 2026). "Eski fiyattan satılanlar" ve fiyat değişikliğinin durumu buradan (src/lib/prices/branch.ts). Eski
     * AsilPOS ve hizmet satırı: null ("Bilinmiyor"; ciro / adetten çıkarılmaz)
     */
    listPrices: jsonb("list_prices").$type<{ price: number; qty: number }[]>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pos_daily_sales_date_pos_name_uq").on(t.date, t.branchId, t.posName)],
);

/**
 * AsilPOS'un gün sonu özeti, gün başına bir satır (docs/ASILPOS.md): Z ve kasa alanları (Kasa raporunun "AsilPOS'tan
 * doldur"u), ödeme kanalları (komisyon anahtarlarıyla) ve ikramlar (menü değeri ve nedeni). Personele yalnız `z` gider.
 */
export const posDayReports = pgTable(
  "pos_day_reports",
  {
    date: text("date").notNull(),
    branchId: branchId(),
    z: jsonb("z").$type<PosDayZ>().notNull(),
    payments: jsonb("payments").$type<PosPayment[]>().notNull(),
    ikram: jsonb("ikram").$type<PosIkram[]>().notNull(),
    /** Banka POS (Pavo) karşılaştırması (src/lib/asilpos/day.ts bankPosSchema); gelmediyse null */
    bankPos: jsonb("bank_pos").$type<BankPos>(),
    /**
     * Faz 2 (23 Kasım 2026; docs/ASILPOS.md › Faz 2 alanları): mali fişi yazarkasada kesilmeyen ödemeler, günün iptal edilen
     * ödemeleri ve kalemleri. Son gövdeninkiler; eski AsilPOS göndermez: null
     */
    offDevice: jsonb("off_device").$type<PosOffDevice>(),
    refunds: jsonb("refunds").$type<PosRefund[]>(),
    iptal: jsonb("iptal").$type<PosIptal[]>(),
    /**
     * Günün son düzeltmesi (yeniden açılış ya da sayım; nedeniyle). AsilPOS onu yalnız düzeltmeden sonraki ilk gövdeyle
     * yollar: alanı taşımayan sonraki gönderim (Pavo sonucu) silmez. Düzeltilmemiş günde null
     */
    correction: jsonb("correction").$type<PosCorrection>(),
    /**
     * Faz 3: günün kasa hareketleri (harcama, teslim, giriş; son gövdeninkiler). Harcama ve teslim ayrıca "Kasadan
     * çıkanlar"a satır olur (cash_outs.asilpos_id); giriş yalnız burada. Eski AsilPOS göndermez ya da okunamadıysa null
     */
    cashMoves: jsonb("cash_moves").$type<PosCashMove[]>(),
    /**
     * Gün sonu tam (24 Kasım 2026; docs/ASILPOS.md › Gün sonu otomasyonu): yazarkasanın cihaz belgelerinden rakamları (kasa
     * raporunun yazarkasa alanları bundan), siparişsiz tahsilatlar, vardiya devri sayımları ve indirim satırları. Son
     * gövdeninkiler; eski AsilPOS göndermez ya da okunamadıysa null
     */
    okc: jsonb("okc").$type<PosOkc>(),
    collections: jsonb("collections").$type<PosCollection[]>(),
    shiftCounts: jsonb("shift_counts").$type<PosShiftCount[]>(),
    discountLines: jsonb("discount_lines").$type<PosDiscountLine[]>(),
    /** AsilPOS'un son kabul edilen gövdesinin gönderim sırası (1'den); eski AsilPOS göndermez: null */
    revision: integer("revision"),
    /**
     * LM-4b (personel bağlantısı; docs/ASILPOS.md › Personel bağlantısı): o gün çalışanların lafmaliyet personel kimlikleri
     * (`s:<staff.id>`, tekil, sayı sırasıyla; ad yok). Gövde alanı taşıdıysa yazılır, taşımayan gönderim (eski AsilPOS ya da
     * bağlı kullanıcı kalmadı) öncekini silmez. Hiç gelmediyse null: o günün çalışanları bilinmez (yemek kartı varsayılan
     * günle; src/lib/asilpos/personel.ts asilposWorkedDays)
     */
    workedStaff: jsonb("worked_staff").$type<string[]>(),
    /** Gönderen sistem ("asilpos") */
    source: text("source").notNull(),
    /** Son gönderimin geldiği an (düzeltme yeniden gönderince değişir) */
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.date, t.branchId] })],
);

/**
 * AsilPOS gün sonlarının sürüm geçmişi (23 Kasım 2026; docs/ASILPOS.md › Sürüm geçmişi): kabul edilen (200) HER gövdenin
 * okunmuş hâli, geliş sırasıyla. pos_day_reports günün son hâlidir (yeniden gönderim öncekinin yerine geçer); öncekiler
 * burada kalır: neyin ne zaman, hangi sırayla ve hangi düzeltmeyle geldiği. Yalnız eklenir, aynı işlemde (gün sonunun
 * danışma kilidi altında) yazılır; reddedilen gövde yazılmaz. Günün kaydını silmek (z_conflict'in çözümü, src/server/asilpos/
 * admin.ts removeAsilposDay) geçmişi silmez: silinen Z'nin gövdeleri de denetim için kalır. Gövde kişisel veri taşımaz
 * (beyaz liste: src/lib/asilpos/day.ts)
 */
export const posDayRevisions = pgTable(
  "pos_day_revisions",
  {
    id: serial("id").primaryKey(),
    date: text("date").notNull(),
    branchId: branchId(),
    /** AsilPOS'un gönderim sırası (gövdenin `revision`'ı); eski AsilPOS göndermez: null */
    revision: integer("revision"),
    /** Gövdenin AsilPOS Z no'su (silinen Z'nin gövdeleri de kalır) */
    zNo: integer("z_no").notNull(),
    /** Gövdenin düzeltmesi (yeniden açılış ya da sayım); yoksa null */
    correction: jsonb("correction").$type<PosCorrection>(),
    /** Gövdenin okunmuş hâli (posDaySchema çıktısı) */
    body: jsonb("body").$type<PosDayPush>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pos_day_revisions_day_idx").on(t.date, t.branchId)],
);

/**
 * AsilPOS gün sonunun otomasyonu, (gün, şube) başına bir satır (docs/ASILPOS.md › Gün sonu otomasyonu; src/server/asilpos/gun-sonu.ts):
 * Kasa raporuna kendiliğinden yazılan rapor ve yazdığı değerler (elle düzeltilen alanı ezmemek için), eksik alanlar ve gün
 * sonu e-postasının durumu (aynı içerik iki kez gitmez; düzeltilen gün "düzeltildi" notuyla bir kez daha gider).
 * Ad değişikliği (migration 0098): tablo eski adından taşındı, eski adla görünüm kaldı (canlıdaki eski sürüm yazar).
 */
export const asilposDayEnds = pgTable(
  "asilpos_day_ends",
  {
    date: text("date").notNull(),
    branchId: branchId(),
    /** Otomatik yazılan kasa raporu (rapor silinirse boşalır) */
    reportId: integer("report_id").references(() => cashReports.id, { onDelete: "set null" }),
    /** Son otomatik yazımın alan değerleri; elle girilmiş raporda null (hiç dokunulmaz) */
    autoValues: jsonb("auto_values").$type<Record<string, unknown>>(),
    /**
     * Eksikler: cihaz boşlukları ("bankPos", "okc", "okcZNo"; sayım yoksa "countedCash") ve personelin gün sonu fotoğrafı
     * eklenene kadar "photo" (src/lib/asilpos/gun-sonu.ts autoMissing)
     */
    missing: jsonb("missing").$type<string[]>().notNull().default([]),
    /**
     * Gün sonu fotoğrafının AsilPOS'la karşılaştırması (src/lib/asilpos/foto.ts asilposPhotoCheck): fotoğraf eklenince ya da
     * AsilPOS yeniden gönderince yenilenir; yalnız yönetici görür. Fotoğraf yokken null
     */
    photoCheck: photoCheckJson("photo_check"),
    /**
     * Rapor yokken (AsilPOS'ta sayım yok) personelin eklediği gün sonu fotoğrafları: rapor yazılınca ona bağlanır
     * (src/server/asilpos/foto.ts)
     */
    pendingPhotos: jsonb("pending_photos").$type<number[]>().notNull().default([]),
    /** Son işlenen gün sonunun içerik özeti (Z, ödemeler, ikram) */
    dayHash: text("day_hash"),
    /** Gün sonu e-postası: gönderilen içerik özeti, gönderim sayısı, son hata, gönderim anı */
    emailedHash: text("emailed_hash"),
    emailCount: integer("email_count").notNull().default(0),
    emailError: text("email_error"),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    /** Gönderim sürerken konan işaret (aynı anda ikinci gönderim olmasın; 5 dakikadan eskisi yok sayılır) */
    sendingAt: timestamp("sending_at", { withTimezone: true }),
    /** Pavo karşılaştırmasının e-postayla giden içerik özeti (tam gün sonu e-postasında ya da kısa e-postada) */
    pavoEmailedHash: text("pavo_emailed_hash"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.date, t.branchId] })],
);

// ---------------------------------------------------------------- ModPOS kasa föyü (docs/MODPOS-API.md)
/**
 * ModPOS'un (Gafdigi) kasa föyü, kasa günü başına bir satır: panel her sabah dünün föyünü API'den çeker (günde 2 hak;
 * src/server/modpos/sync.ts). `sheet` föyün okunmuş hâlidir (src/lib/modpos/foy.ts KasaFoyu): kişi adları (personel,
 * müşteri; sahibin kararı, 3 Kasım 2026) ve kitapçıkta olmayan alanlar dahil, `raw` ham XML'i. Aynı gün yeniden çekilince içerik aynıysa yalnız `fetched_at` (ve kesinleştiyse `final`) değişir;
 * farklıysa `revision` artar, önceki özet `previous`'a yazılır. Yalnız yöneticinin ekranlarına gider.
 */
export const modposCashSheets = pgTable(
  "modpos_cash_sheets",
  {
    /** Kasa günü (YYYY-MM-DD): kasanın açıldığı gün */
    day: text("day").notNull(),
    branchId: branchId(),
    sheet: jsonb("sheet").$type<KasaFoyu>().notNull(),
    /** KAPALI: bütün kasalar kapandı; ACIK: en az biri açık; BOS: o gün kasa açılmamış */
    state: text("state", { enum: ["KAPALI", "ACIK", "BOS"] }).notNull(),
    /** Kesin: kasalar kapalı ve föy ertesi sabah 07:00'den (TR) sonra alındı (belge §8) */
    final: boolean("final").notNull().default(false),
    /** Föyün içeriğinin özeti (sha256; hazırlanma anı ve kota hariç): aynıysa yeniden yazılmaz */
    fingerprint: text("fingerprint").notNull(),
    revision: integer("revision").notNull().default(1),
    /** İçerik değişince önceki sürümün kısa özeti (yalnız sonuncusu) */
    previous: jsonb("previous").$type<ModposSheetPrevious>(),
    /** Föyün ModPOS'ta hazırlandığı an (olusturulma) */
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    /** Son çekildiği an (içerik değişmese de) */
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    /** İçeriğin son değiştiği an */
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * ModPOS'un gönderdiği ham XML (son çekimin; kitapçıkta olmayan alan da kaybolmasın): yalnız günün görünümü okur,
     * ay listeleri okumaz. Bu sütundan önce saklanan föylerde boş
     */
    raw: text("raw"),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.branchId] }),
    check("modpos_cash_sheets_revision_pos", sql`${t.revision} >= 1`),
  ],
);

// ---------------------------------------------------------------- Vergi (docs/VERGI.md)
/** Demirbaş ve özel maliyet: vergi amortismanı; faturaya bağlanan maliyet o faturanın giderinden düşer */
export const taxAssets = pgTable(
  "tax_assets",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    /** Bağlandığı anki fatura künyesi ("XND Teknoloji · 13.07.2026 · 338.169,58"); fatura silinince uyarı ve aday arama için */
    invoiceLabel: text("invoice_label"),
    /** YYYY-MM-DD */
    acquiredOn: text("acquired_on").notNull(),
    /** KDV hariç */
    cost: doublePrecision("cost").notNull(),
    kind: text("kind", { enum: ["demirbas", "ozel_maliyet", "diger"] }).notNull().default("demirbas"),
    method: text("method", { enum: ["amortisman", "dogrudan_gider"] }).notNull().default("amortisman"),
    /** Boş = girilmedi (amortisman 0) */
    lifeYears: integer("life_years"),
    note: text("note"),
    createdByName: text("created_by_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tax_assets_invoice_idx").on(t.invoiceId),
    check("tax_assets_cost_pos", sql`${t.cost} > 0`),
    check("tax_assets_life_range", sql`${t.lifeYears} is null or ${t.lifeYears} between 1 and 50`),
  ],
);

/** Muhasebecinin beyanname / tahakkuk rakamları: dönem başına bir kayıt; tahminin yerine geçer, matrahı varsa sonraki tahminin çapasıdır */
export const taxFilings = pgTable(
  "tax_filings",
  {
    id: serial("id").primaryKey(),
    kind: text("kind", { enum: ["gecici", "kv", "mphb", "kdv_matrah"] }).notNull(),
    /** "2026-Q3" | "2026" | "2026-09" */
    period: text("period").notNull(),
    /** Ödenecek vergi; kdv_matrah'ta 0 (KDV ödemesi nakit planında) */
    payable: doublePrecision("payable").notNull(),
    /** Beyanname damgası */
    stamp: doublePrecision("stamp").notNull().default(0),
    /** Türüne göre değerler (src/lib/tax/corporate.ts, muhtasar.ts, pnl.ts) */
    values: jsonb("values").$type<Record<string, unknown>>().notNull().default({}),
    note: text("note"),
    enteredBy: integer("entered_by").references(() => users.id, { onDelete: "set null" }),
    enteredByName: text("entered_by_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("tax_filings_kind_period_uq").on(t.kind, t.period)],
);

/** Panelin bilemediği gelir ve gider: kafe dışı, indirilemeyen gider, indirim (ay başına çok kayıt) */
export const taxAdjustments = pgTable(
  "tax_adjustments",
  {
    id: serial("id").primaryKey(),
    /** YYYY-MM (çeyrekse çeyreğin son ayı) */
    month: text("month").notNull(),
    span: text("span", { enum: ["ay", "ceyrek"] }).notNull().default("ay"),
    kind: text("kind", {
      enum: ["gelir_kafe_disi", "gelir_diger", "gider_kafe_disi", "gider_belgeli", "kkeg", "indirim"],
    }).notNull(),
    amount: doublePrecision("amount").notNull(),
    label: text("label").notNull(),
    note: text("note"),
    createdByName: text("created_by_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tax_adjustments_month_idx").on(t.month),
    check("tax_adjustments_amount_pos", sql`${t.amount} > 0`),
    check("tax_adjustments_span_kind", sql`${t.span} = 'ay' or ${t.kind} in ('gelir_kafe_disi', 'gider_kafe_disi')`),
  ],
);

// ---------------------------------------------------------------- Vardiya planı
/**
 * Vardiya planı (docs/VARDIYA.md): şube, gün ve kişi başına tek satır. Kişi panel kullanıcısıysa `userId` dolu ve
 * `personRef` "u:<id>"; hesabı olmayan çalışan yalnız adıyla yazılır (`personRef` "n:<küçük harfli ad>"). `kind` "work":
 * `startMin`–`endMin` günün başından dakika (gece yarısını geçen vardiyada `endMin` 1440'tan büyük, en çok 1800 =
 * ertesi gün 06:00); "off": izin (saat yok). Satır yoksa o gün için kişi planlanmamıştır. Karaoke personel e-postaları
 * (src/server/karaoke/staff-mail.ts) o gün çalışanları buradan okur.
 */
export const shifts = pgTable(
  "shifts",
  {
    id: serial("id").primaryKey(),
    branchId: branchId(),
    /** Vardiyanın başladığı gün (Türkiye), YYYY-MM-DD */
    date: text("date").notNull(),
    /** Kişinin anahtarı: "u:<kullanıcı kimliği>" ya da "n:<ad>" */
    personRef: text("person_ref").notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Planda ve PDF'te görünen ad (kullanıcıda kaydedildiği andaki adı) */
    personName: text("person_name").notNull(),
    kind: text("kind", { enum: ["work", "off"] }).notNull().default("work"),
    startMin: integer("start_min"),
    endMin: integer("end_min"),
    /** Kısa not: görev ya da yer (ör. "kasa", "bar") */
    note: text("note"),
    updatedByName: text("updated_by_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("shifts_branch_date_person_uq").on(t.branchId, t.date, t.personRef),
    index("shifts_date_idx").on(t.date),
    check("shifts_time_ck", sql`(${t.kind} = 'off' and ${t.startMin} is null and ${t.endMin} is null) or (${t.kind} = 'work' and ${t.startMin} >= 0 and ${t.startMin} < 1440 and ${t.endMin} > ${t.startMin} and ${t.endMin} <= 1800)`),
  ],
);

// ---------------------------------------------------------------- Şube başına ayarlar
/**
 * Şube başına ayarlar (docs/SUBE.md › Şube başına ayarlar; gruplar src/lib/branch-settings/groups.ts): şube başına
 * grup başına bir satır. `same_as` doluysa şube kendi değerini tutmaz (`value` boş, `secrets` yok), bağlandığı şubenin
 * değerini kullanır ("Tuzla ile aynı"). Bağ tek adımlıdır: hedef başka şubeye bağlı olamaz (sunucu denetler,
 * src/server/branch-settings.ts). Satırı olmayan şube eski genel kayıttan (integration_state) ya da varsayılandan okur;
 * "aynı" sunulan grupta varsayılan şube dışındaki şube örtük olarak varsayılan şubeye bağlıdır. Şifreli alanlar
 * `secrets`'ta (alan → secret-box mühürü); yedeğe girmez (src/lib/backup/format.ts).
 */
export const branchSettings = pgTable(
  "branch_settings",
  {
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    /** Grup kimliği ("kasa.rapor", "kasa.calisan") */
    grp: text("grp").notNull(),
    /** Grubun şifresiz alanları; bağlı satırda boş */
    value: jsonb("value").notNull().default({}),
    /** Şifreli alanlar (alan → mühür); yedeğe girmez, bağlı satırda boş */
    secrets: jsonb("secrets"),
    /** Değerin okunduğu şube ("diğer şubeyle aynı"); bağlı şubeler varken o şube kapatılamaz, silinemez */
    sameAs: text("same_as").references(() => branches.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.grp] }),
    index("branch_settings_same_as_idx").on(t.sameAs),
    check("branch_settings_not_self_ck", sql`${t.sameAs} is null or ${t.sameAs} <> ${t.branchId}`),
    check("branch_settings_linked_empty_ck", sql`${t.sameAs} is null or (${t.value} = '{}'::jsonb and ${t.secrets} is null)`),
  ],
);

// ---------------------------------------------------------------- Mutabakat (banka ve tedarikçi ekstresi)
/**
 * Yüklenen ekstre (docs/MUTABAKAT.md): banka hesabının ya da tedarikçinin cari ekstresi. DOSYA SAKLANMAZ (KVKK, veri
 * en azı): yalnız okunan satırlar recon_lines'ta durur ve `expires_on`'dan sonra günlük işte silinir (yüklendiği gün +
 * 90; src/lib/mutabakat/match.ts KEEP_DAYS). Panel kaydına hiçbir şey yazılmaz: mutabakat bir karşılaştırmadır.
 */
export const reconStatements = pgTable(
  "recon_statements",
  {
    id: serial("id").primaryKey(),
    kind: text("kind", { enum: ["banka", "tedarikci"] }).notNull(),
    /** Banka: yöneticinin yazdığı hesap adı ("Garanti TL"); tedarikçi: tedarikçinin yükleme anındaki adı */
    account: text("account").notNull(),
    /** Tedarikçi ekstresinin kartı (kartsız tedarikçide boş; o zaman `supplierNames`'ten bulunur) */
    supplierCardId: integer("supplier_card_id").references(() => suppliers.id, { onDelete: "set null" }),
    /** Tedarikçinin ad anahtarları (faturalardaki adlar, kartın adları): kartsız tedarikçiyi bulmak için */
    supplierNames: jsonb("supplier_names").$type<string[]>().notNull().default([]),
    /** Yüklenen dosyanın adı (yalnız ekranda; içeriği saklanmaz) */
    fileName: text("file_name"),
    /** Ekstrenin ilk ve son hareket günü (YYYY-MM-DD) */
    periodFrom: text("period_from").notNull(),
    periodTo: text("period_to").notNull(),
    /** Yazılan satır sayısı; dosyada olup önceki yüklemede yazılmış (aynı) satırlar `duplicates`'ta */
    lineCount: integer("line_count").notNull().default(0),
    duplicates: integer("duplicates").notNull().default(0),
    /** Yüklendiği gün (Türkiye) ve satırların saklandığı son gün (ertesi gün silinir) */
    uploadedOn: text("uploaded_on").notNull(),
    expiresOn: text("expires_on").notNull(),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("recon_statements_expires_idx").on(t.expiresOn),
    check("recon_statements_period_ck", sql`${t.periodFrom} <= ${t.periodTo}`),
    check("recon_statements_supplier_ck", sql`${t.kind} = 'tedarikci' or (${t.supplierCardId} is null and ${t.supplierNames} = '[]'::jsonb)`),
  ],
);

/**
 * Ekstrenin satırı ve yöneticinin kararı. Eşleşme okuma anında hesaplanır (saklanmaz); yalnız karar durur: `elle`
 * (bu kayıtla eşleşir: `match_kind` + `match_id`), `yoksay`, `ayir` (kendiliğinden eşleşmez), `pos` (POS hakedişi say).
 * Tutar işaretlidir: banka + giren / − çıkan; tedarikçi + fatura / − ödeme. Açıklamadaki IBAN, kart ve uzun numaralar
 * yazılmadan örtülür (src/lib/mutabakat/parse.ts maskSensitive). `scope` + `fingerprint`: aynı hesabın aynı hareketi
 * ikinci yüklemede yeniden yazılmaz.
 */
export const reconLines = pgTable(
  "recon_lines",
  {
    id: serial("id").primaryKey(),
    statementId: integer("statement_id")
      .notNull()
      .references(() => reconStatements.id, { onDelete: "cascade" }),
    /** Hesabın kimliği: "banka:<hesap adı>" ya da "tedarikci:<kart ya da ad>" */
    scope: text("scope").notNull(),
    fingerprint: text("fingerprint").notNull(),
    /** Dosyadaki satır (1'den) */
    rowNo: integer("row_no").notNull(),
    date: text("date").notNull(),
    description: text("description").notNull().default(""),
    amount: doublePrecision("amount").notNull(),
    balance: doublePrecision("balance"),
    ref: text("ref"),
    decision: text("decision", { enum: ["elle", "yoksay", "ayir", "pos"] }),
    matchKind: text("match_kind", { enum: ["harcama", "odeme", "fatura-odeme", "teslim", "fatura"] }),
    matchId: integer("match_id"),
    decidedByName: text("decided_by_name"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    index("recon_lines_statement_idx").on(t.statementId, t.date),
    uniqueIndex("recon_lines_fingerprint_uq").on(t.scope, t.fingerprint),
    check("recon_lines_amount_ck", sql`${t.amount} <> 0`),
    check("recon_lines_match_ck", sql`(${t.decision} is not distinct from 'elle') = (${t.matchKind} is not null and ${t.matchId} is not null)`),
  ],
);
