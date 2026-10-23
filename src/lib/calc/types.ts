// Hesaplama motorunun kullandığı saf veri tipleri.
// Veritabanı satırlarıyla aynı şekle sahiptir ama hiçbir sunucu bağımlılığı yoktur;
// hem sunucuda hem tarayıcıda (canlı hesap) kullanılabilir.

import type { SiteSalesMonth } from "../site-sales/schema";

export type Unit = "gr" | "ml" | "adet" | "dilim";
export type CountUnit = "KG" | "LT" | "ADET" | "DİLİM";
export type Size = "M" | "L" | "Tek";
export type FixedSection = "personel" | "faturalar" | "kira" | "genel";
export type FixedPeriod = "aylik" | "gunluk" | "haftalik" | "yillik";
export type PriceSource = "manual" | "water";

export interface Settings {
  /** Satış KDV oranı (menü fiyatları KDV dahil) */
  kdv: number;
  /** Hizmet satışı KDV oranı: Satışlar'da HİZMET işaretli satırlar (karaoke odası); ciro bu satırlar kadar bu oranla ayrılır */
  kdvHizmet: number;
  /** Banka / POS komisyon oranı */
  komisyon: number;
  /** Kartlı satışların ciroya oranı (kredi kartı + yemek kartı) */
  kartOrani: number;
  /** Hedef maliyet oranı (food cost) */
  hedefMaliyet: number;
  /** Genel fire / zayi payı */
  fire: number;
  shotTek: number;
  shotCift: number;
  /** Şurup (ve sos) pompasının bir basışı, ml: formüllerde Pompa */
  pompa: number;
  /** Püre pompasının bir basışı, ml: formüllerde PurePompa */
  pompaPure: number;
  potGr: number;
  potMl: number;
  dondurmaTop: number;
  tkGr: number;
  /** Ayda kaç gün açık (başabaş ve günlük giderler için) */
  acikGun: number;
  isciSgk: number;
  isciIssizlik: number;
  isverenSgk: number;
  isverenIssizlik: number;
  /** true: fire payı ambalaj (bardak, kapak, peçete) hariç malzemelere uygulanır */
  fireExcludesPackaging: boolean;
  /** Su + buz birim maliyeti (₺/litre). null = su faturasından otomatik hesapla */
  suBirimLTOverride: number | null;
  /** Herkese açık QR menü yayında mı */
  publicMenu: boolean;
}

export interface Ingredient {
  id: number;
  name: string;
  category: string;
  supplier: string | null;
  packageDesc: string | null;
  packagePrice: number;
  packageSize: number;
  unit: Unit;
  vatRate: number;
  note: string | null;
  isEstimate: boolean;
  priceSource: PriceSource;
  countUnit: CountUnit | null;
  countGroup: string | null;
  /** Sayım listesine girdiği ay (YYYY-MM): önceki aylarda, o ay sayılmadıysa listede çıkmaz; boşsa (Excel'den gelenler) her ayda */
  countFrom?: string | null;
  sortOrder: number;
  active: boolean;
}

export interface Category {
  id: number;
  name: string;
  sortOrder: number;
}

export interface Product {
  id: number;
  categoryId: number;
  name: string;
  size: Size;
  price: number;
  fireOverride: number | null;
  note: string | null;
  active: boolean;
  showOnMenu: boolean;
  sortOrder: number;
  /**
   * laffogato.net menüsündeki kalem (mnu-0011) ve yuvası (M / L); bağlı değilse boş. Online satışların kafe satırları
   * bununla ürüne eşlenir (docs/SITE-SATIS.md). Excel verisinde yok.
   */
  siteMenuId?: string | null;
  siteMenuSlot?: "M" | "L" | null;
}

export interface RecipeItem {
  id: number;
  productId: number;
  ingredientId: number;
  qty: number;
  /** Ayarlara bağlı miktar formülü, ör. "2*ShotCift". null ise qty kullanılır. */
  qtyExpr: string | null;
  note: string | null;
  sortOrder: number;
}

/** Ay bilgisinin kasa raporlarından dolabilen alanları (src/lib/cash-month.ts) */
export type MonthField = "openDays" | "posRevenue" | "discounts" | "offRevenue" | "cardShare";
/** Alanın değeri nereden: elle yazıldı, kasa raporlarından, hiçbiri (varsayılan: boş ya da 0) */
export type FieldSource = "manual" | "kasa" | "none";

/** Bir ayın kasa raporlarından çıkanlar (src/lib/cash-month.ts tillMonths) */
export interface TillMonth {
  /** "YYYY-MM" */
  month: string;
  /** Kapsanan aralık: ay başı (ilk rapor ay içindeyse o gün) → ay sonu (süren ayda dün; bugünün raporu girildiyse bugün) */
  from: string;
  to: string;
  /** Rapor girilen gün */
  reported: number;
  /** Satış olan (Z toplamı > 0) gün */
  openDays: number;
  /** Z toplamlarının toplamı: KDV dahil, indirimler düşülmüş, ödenmezler hariç (Patron › Ciro ile aynı anlam) */
  posRevenue: number;
  /** İndirim ve ödenmez: yalnız girildiği günlerin toplamı (hiç girilmediyse null) ve o gün sayısı */
  discounts: number | null;
  discountDays: number;
  offRevenue: number | null;
  offDays: number;
  /** (Kart + yemek kartı) ÷ Z toplamı; Z toplamı 0 ise null */
  cardShare: number | null;
  /** [from, to] içinde raporu olmayan günler */
  missing: string[];
  /** İlk rapor bu ayın 1'inden sonra girildiyse o gün: toplamlar ayın yalnız bir kısmını kapsar, uygulanmaz */
  partialFrom: string | null;
  /** Son raporun günü */
  lastDate: string;
}

/**
 * Ayın bilgisi. Sunucudaki yükleyici (src/server/data/dataset.ts) burada etkin değeri verir: elle yazılan, yoksa kasa
 * raporlarından türeyen, o da yoksa varsayılan. Hesapların hepsi (Gelir-gider, Genel bakış, Excel) bu değerle çalışır.
 */
export interface Month {
  /** "YYYY-MM" */
  month: string;
  openDays: number | null;
  /** POS (Patron) ciro raporu, KDV dahil */
  posRevenue: number | null;
  /** Yönetici indirimleri, KDV dahil */
  discounts: number;
  /** Ciro dışı / ödenmez (ikram, sahip/personel tüketimi), KDV dahil */
  offRevenue: number;
  note: string | null;
  /** Kartlı satış oranı (0–1): elle ya da kasa raporlarından; yoksa Ayarlar › kartlı satış oranı geçer */
  cardShare?: number | null;
  /** Alanların kaynağı (yalnız sunucudaki yükleyici doldurur; testlerde ve Excel verisinde yok) */
  sources?: Record<MonthField, FieldSource>;
  /** Kasa raporlarından türeyen değerler (uygulanmayan alan null) ve kapsamı; ayın raporu yoksa null */
  kasa?: { values: Record<MonthField, number | null>; till: TillMonth } | null;
}

export interface SalesLine {
  id: number;
  month: string;
  posName: string;
  qty: number;
  /** Ciro, KDV dahil */
  revenue: number;
  productId: number | null;
  isService: boolean;
  note: string | null;
}

export interface Invoice {
  id: number;
  /** "YYYY-MM-DD" */
  date: string;
  supplier: string;
  description: string | null;
  invoiceNo: string | null;
  category: string;
  amount: number;
  discount: number;
  /** Ödenecek, KDV dahil */
  payable: number;
  /**
   * Faturanın KDV toplamı, tevkifat düşülmemiş (Paraşüt `total_vat`). Excel'den gelenlerde 0. KDV tahmini indirilecek
   * KDV'yi ve 2 No.lu beyannamenin tevkifatını bundan okur (src/lib/kdv.ts)
   */
  vat?: number;
  unpaid: boolean;
  note: string | null;
  /** Nereden geldi (hesaplarda kullanılmaz) */
  source?: "manual" | "excel" | "parasut";
  /** Paraşüt gider faturası kimliği */
  externalId?: string | null;
  /** Vade (son ödeme) tarihi */
  dueDate?: string | null;
  /** Kalan borç (Paraşüt kısmi ödeme; yoksa ödenmemişse ödenecek tutarın tamamı) */
  outstanding?: number | null;
  /** Paraşüt'teki gelen e-fatura kimliği (içeri alınmamış e-faturalar da buradan gelir; belge PDF'i için) */
  eInvoiceId?: string | null;
  /** Eşitlemenin kategorisini tahmin ettiği, kullanıcının henüz onaylamadığı fatura */
  needsReview?: boolean;
  /** Ödeme günü (ödendi işaretlenirken girilen; hesaplarda kullanılmaz) */
  paidAt?: string | null;
  /** Ödemesi istendiği gün: ödenmemiş faturada "Talep edildi" (hesaplarda kullanılmaz) */
  paymentRequestedAt?: string | null;
}

/**
 * Bir kalemin hangi aylarda hesaba girdiği (YYYY-MM, null = sınırsız).
 * İkisi de hiç verilmemişse (undefined, eski biçim veri) yalnızca `active` bakılır.
 */
export interface MonthRange {
  startMonth?: string | null;
  endMonth?: string | null;
}

export interface Staff extends MonthRange {
  id: number;
  name: string;
  /** Taban değer: ilk maaş değişikliğinden (StaffVersion) önceki aylarda geçerli */
  netSalary: number;
  extras: number;
  /** Geriye dönük uyumluluk: endMonth boş ya da bu aydan sonra → true. Hesap aralığa (MonthRange) bakar. */
  active: boolean;
}

/** "fromMonth ayından itibaren" geçerli maaş (bir sonraki sürüme kadar) */
export interface StaffVersion {
  id: number;
  staffId: number;
  fromMonth: string;
  netSalary: number;
  extras: number;
}

export interface FixedExpense extends MonthRange {
  id: number;
  name: string;
  section: FixedSection;
  /** Taban değerler: ilk tutar değişikliğinden (FixedExpenseVersion) önceki aylarda geçerli */
  period: FixedPeriod;
  /** KDV hariç */
  amount: number;
  /** Faturasındaki KDV oranı; boşsa bölümün varsayılanı (constants.ts fixedVatRate). Yalnız nakit planı kullanır */
  vatRate?: number | null;
  note: string | null;
  /** Geriye dönük uyumluluk: endMonth boş ya da bu aydan sonra → true. Hesap aralığa (MonthRange) bakar. */
  active: boolean;
  sortOrder: number;
}

/** "fromMonth ayından itibaren" geçerli dönem ve tutar (bir sonraki sürüme kadar) */
export interface FixedExpenseVersion {
  id: number;
  fixedExpenseId: number;
  fromMonth: string;
  period: FixedPeriod;
  amount: number;
}

export interface PnlEntry {
  month: string;
  rowKey: string;
  amount: number;
  /** Hücre notu (Excel'deki hücre açıklaması) */
  note?: string | null;
}

/** Hammadde fiyat geçmişinin bir satırı (ingredient_prices): o andan itibaren geçerli paket fiyatı ve boyu */
export interface IngredientPriceRow {
  ingredientId: number;
  packagePrice: number;
  packageSize: number;
  /** ISO an */
  changedAt: string;
}

export interface StockCount {
  month: string;
  ingredientId: number;
  /** Sayım birimindeki miktar (ör. 2,5 KG) */
  qty: number;
  /** Sayıldığı andaki birim çarpanı (KG/LT = 1000, ADET/DİLİM = 1). Yoksa malzemenin bugünkü sayım birimi kullanılır. */
  factor?: number | null;
}

export interface StockExtra {
  id: number;
  month: string;
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
}

export interface PurchaseQty {
  month: string;
  ingredientId: number;
  qty: number;
  note: string | null;
}

/** Aylık harcamanın Gelir-gider bölümü: mal (mal maliyeti) ya da sabit gider bölümlerinden biri */
export type ExpenseSection = FixedSection | "mal";
/** Genel bakış "Para nereye gitti" grubu (constants.ts PanelFixedGroup ile aynı) */
export type ExpensePanelGroup = "kira" | "personel" | "reklam" | "diger";
export type PaymentMethod = "nakit" | "kart" | "havale" | "diger";

/** Aylık harcama kategorisi (reklam, influencer, nakit alım…) */
export interface ExpenseCategory {
  id: number;
  name: string;
  section: ExpenseSection;
  panelGroup: ExpensePanelGroup;
  /** Bu fatura kategorisindeki faturalar da bu satırda sayılır; null: yalnız girilen harcamalar */
  invoiceCategory: string | null;
  /** Her ay girilmesi beklenir */
  monthly: boolean;
  active: boolean;
  sortOrder: number;
}

/** Aylık harcama kaydı: ödenen tutar gider sayılır (KDV ayrılmaz) */
export interface ExpenseEntry {
  id: number;
  date: string;
  categoryId: number;
  description: string | null;
  amount: number;
  paymentMethod: PaymentMethod | null;
  note: string | null;
}

/**
 * Personelin girdiği zayi ya da ikram (src/server/db/schema.ts wasteEntries): menü ürünü (malzemesi reçeteden) ya da
 * hammadde (qty × factor = malzemenin kendi birimi).
 */
export interface WasteEntry {
  date: string;
  kind: "zayi" | "ikram";
  productId: number | null;
  ingredientId: number | null;
  qty: number;
  factor: number;
}

export interface Dataset {
  settings: Settings;
  ingredients: Ingredient[];
  categories: Category[];
  products: Product[];
  recipeItems: RecipeItem[];
  months: Month[];
  salesLines: SalesLine[];
  invoices: Invoice[];
  staff: Staff[];
  /** Maaş değişiklikleri (yoksa her ay taban değer) */
  staffVersions?: StaffVersion[];
  fixedExpenses: FixedExpense[];
  /** Sabit gider tutar değişiklikleri (yoksa her ay taban değer) */
  fixedExpenseVersions?: FixedExpenseVersion[];
  pnlEntries: PnlEntry[];
  stockCounts: StockCount[];
  /**
   * Hammadde fiyat geçmişi (yoksa boş: sayımlar bugünkü fiyatla). Sayım, ayın sonunda geçerli fiyatla değerlenir; sonraki
   * bir zam kapanmış ayın devreden malını ve kârını değiştirmez (engine.ts stockSheet)
   */
  ingredientPrices?: IngredientPriceRow[];
  stockExtras: StockExtra[];
  purchaseQuantities: PurchaseQty[];
  /** Aylık harcama kategorileri ve kayıtları (yoksa boş) */
  expenseCategories?: ExpenseCategory[];
  expenseEntries?: ExpenseEntry[];
  /** Zayi ve ikram kayıtları (yoksa boş) */
  wasteEntries?: WasteEntry[];
  /**
   * laffogato.net'ten çekilen online satışlar, ay başına bir kayıt (yoksa boş). Kâr-zararda ayrı gelir satırları, kafe
   * satırları tüketimde ayrı bir kaynak (docs/SITE-SATIS.md). Hiç çekilmemiş ay yoktur (0 değil).
   */
  siteSales?: SiteSalesMonth[];
  /** "Bu ay" (YYYY-MM, Türkiye saati). Listelerdeki güncel tutar bu aya göre gösterilir; yoksa saatten okunur. */
  currentMonth?: string;
  /**
   * Süren ayda yüklenen satış listesinin son günü ve o güne kadarki kasa raporları (src/lib/sales-coverage.ts; yoksa
   * liste ayın tamamıdır). Listeye dayanan hesaplar listenin günleriyle yapılır (engine.ts listPeriod)
   */
  salesCoverage?: { month: string; through: string; till: TillMonth | null }[];
}
