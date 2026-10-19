// Hesaplama motorunun kullandığı saf veri tipleri.
// Veritabanı satırlarıyla aynı şekle sahiptir ama hiçbir sunucu bağımlılığı yoktur;
// hem sunucuda hem tarayıcıda (canlı hesap) kullanılabilir.

export type Unit = "gr" | "ml" | "adet" | "dilim";
export type CountUnit = "KG" | "LT" | "ADET" | "DİLİM";
export type Size = "M" | "L" | "Tek";
export type FixedSection = "personel" | "faturalar" | "kira" | "genel";
export type FixedPeriod = "aylik" | "gunluk" | "haftalik" | "yillik";
export type PriceSource = "manual" | "water";

export interface Settings {
  /** Satış KDV oranı (menü fiyatları KDV dahil) */
  kdv: number;
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
  pompa: number;
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
  unpaid: boolean;
  note: string | null;
  /** Nereden geldi (hesaplarda kullanılmaz) */
  source?: "manual" | "excel" | "parasut";
  /** Paraşüt gider faturası kimliği */
  externalId?: string | null;
  /** Vade (son ödeme) tarihi */
  dueDate?: string | null;
}

export interface Staff {
  id: number;
  name: string;
  netSalary: number;
  extras: number;
  active: boolean;
}

export interface FixedExpense {
  id: number;
  name: string;
  section: FixedSection;
  period: FixedPeriod;
  amount: number;
  note: string | null;
  active: boolean;
  sortOrder: number;
}

export interface PnlEntry {
  month: string;
  rowKey: string;
  amount: number;
}

export interface StockCount {
  month: string;
  ingredientId: number;
  qty: number;
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
  fixedExpenses: FixedExpense[];
  pnlEntries: PnlEntry[];
  stockCounts: StockCount[];
  stockExtras: StockExtra[];
  purchaseQuantities: PurchaseQty[];
}
