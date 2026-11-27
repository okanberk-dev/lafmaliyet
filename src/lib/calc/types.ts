// Hesaplama motorunun kullandığı saf veri tipleri.
// Veritabanı satırlarıyla aynı şekle sahiptir ama hiçbir sunucu bağımlılığı yoktur;
// hem sunucuda hem tarayıcıda (canlı hesap) kullanılabilir.

import type { SiteSalesMonth } from "../site-sales/schema";
import type { TaxDoc, Withholding } from "../tax/rules";

import type { AsilposIkramData } from "../asilpos/ikram";
import type { AsilposWorked } from "../asilpos/personel";
import type { PosFroms, SwitchDays } from "../pos/tills";

import type { PurchaseLot } from "./fifo";

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
  /**
   * Personel yemek kartı (Faz 5, sahibin kararı 11): yemek kartı işaretli kişinin günlük tutarı (₺) ve ayda kaç gün
   * (Ayarlar). İşveren maliyetine günlük × gün eklenir, brütleştirilmez (engine.ts staffCost; docs/VARDIYA.md › Maaş satırının bağlantısı ve part-time)
   */
  mealCardDaily: number;
  mealCardDays: number;
  /**
   * Sayım gruplarının olağan alış KDV'si (Ayarlar › Oranlar): ambalaj grubu (bardak, kapak, peçete) ve gıda grupları.
   * Hammaddeler'de yeni malzemenin önerilen KDV'si, sayımda listede olmayan kalemlerin KDV dahil değeri (gıda oranı) ve
   * Alış KDV'si grubun olağan oranından ayrılan malzemelerin uyarısı bununla (constants.ts groupVatRate). %20 ve %1
   */
  alisKdvAmbalaj: number;
  alisKdvGida: number;
  /** true: fire payı ambalaj (bardak, kapak, peçete) hariç malzemelere uygulanır */
  fireExcludesPackaging: boolean;
  /** Su + buz birim maliyeti (₺/litre). null = su faturasından otomatik hesapla */
  suBirimLTOverride: number | null;
  /** Herkese açık QR menü yayında mı */
  publicMenu: boolean;
  /**
   * Stok değerlemede ilk giren ilk çıkar (FIFO) başlangıç ayı (YYYY-MM). Bu aydan itibaren ay sonu stoğu ve kâr-zararın
   * mal maliyeti faturaların sırasıyla değerlenir; önceki aylar ay sonu fiyatıyla kalır. null = eski yöntem (her ay ay
   * sonu fiyatı). docs/STOK-DEGERLEME.md
   */
  stokFifoBaslangic: string | null;
  /**
   * AsilPOS'a geçiş günü (iş günü, YYYY-MM-DD): bu günden itibaren kasanın kaynağı AsilPOS. null = kasa ModPOS, AsilPOS'un
   * gönderdiği günler saklanır ama hiçbir hesaba girmez. Okuyanlar src/lib/asilpos/switch.ts'ten geçer; docs/ASILPOS.md
   */
  asilposGecisGunu: string | null;
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
  /** Sayım listesine girdiği ay (YYYY-MM): önceki aylarda, o ay sayılmadıysa listede çıkmaz; boşsa (ilk aktarımdan gelenler) her ayda */
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
   * bununla ürüne eşlenir (docs/SITE-SATIS.md). İlk aktarımın verisinde yok.
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
  /** Rapor girilen gün (iki şube aynı gün rapor girdiyse bir gün) */
  reported: number;
  /** Satış olan (Z toplamı > 0) gün; "Tümü"de günde bir kez (iki şube aynı gün açıkken bir gün) */
  openDays: number;
  /**
   * Ayın cirosu: KDV dahil, indirimler düşülmüş, ödenmezler hariç (Patron › Ciro ile aynı anlam). Z toplamlarının
   * toplamından, Z toplamının içinde olduğu ödeme dökümüyle anlaşılan ödenmez / ikram düşülür
   * (src/lib/cash-revenue.ts dayRevenue; docs/KASA-RAPORU.md › Ciro ve ödenmez)
   */
  posRevenue: number;
  /** Z toplamlarının çıplak toplamı (ödenmez düşülmeden). Yoksa (eski kayıt, test) posRevenue ile aynı sayılır */
  zTotalSum?: number;
  /** posRevenue'ya girmeyen, Z toplamlarının içinden düşülen ödenmez / ikram (0: düşülen yok) */
  offInPos?: number;
  /** İndirim ve ödenmez: yalnız girildiği günlerin toplamı (hiç girilmediyse null) ve o gün sayısı */
  discounts: number | null;
  discountDays: number;
  /**
   * İndirimin AsilPOS günlerindeki kısmı (AsilPOS'un şubesinin, AsilPOS satışlarının sayıldığı ilk günden itibaren): AsilPOS'un
   * satırları indirimden sonradır, satış listesinden bir daha düşülmez (cash-month.ts listDiscountOf). Yalnız tillMonths'a
   * AsilPOS'un ilk günü verildiyse; yoksa alan yok (geçiş günü yok: bütün günler ModPOS listesi)
   */
  asilposDiscounts?: number;
  offRevenue: number | null;
  offDays: number;
  /** (Kart + yemek kartı) ÷ Z toplamı; Z toplamı 0 ise null */
  cardShare: number | null;
  /**
   * Yalnız banka kartı ÷ Z toplamı (yemek kartı hariç; Z toplamı 0 ise null): Gelir-gider'in banka POS komisyonu bununla
   * (engine.ts bankShareOf; denetim E-43). Yoksa (eski kayıt, test) yemek kartı payı ayrılamaz, kartlı oran geçer
   */
  bankShare?: number | null;
  /**
   * Banka kartı ve yemek kartı tutarları (KDV dahil). Banka POS komisyonu banka kartından, şubenin oranıyla (engine.ts
   * posCommission; hesap sözleşmesi §10): yemek kartının komisyonu kendi faturasıyla. Yoksa (eski kayıt, test) oran yolu
   */
  card?: number;
  mealCard?: number;
  /** Banka kartı şube şube (satırların hepsi şubeliyse): "Tümü"de her şube kendi oranıyla */
  cardByBranch?: Record<string, number>;
  /**
   * AsilPOS'un şubesinin günlerinin KDV'si (23 Kasım 2026; src/lib/cash-month.ts dayVatOf, engine.ts posNet): `known`
   * AsilPOS'un KDV dökümü günün cirosunu tutan günler (matrah ve KDV oradan), `days` dökümü olmayan günlerin cirosu (ModPOS
   * günleri; her biri günün oranıyla ayrı ayrı). Yalnız satırlar şubeliyse ve AsilPOS'un şubesinin satırı varsa; yoksa alan
   * yok, KDV ay toplamından (bugünkü gibi)
   */
  dayVat?: { known: { days: number; revenue: number; base: number; vat: number }; days: number[] };
  /**
   * Ayın satışlı günlerinin KDV kaynağı (KDV tahmini; src/lib/cash-month.ts vatDaysOf, src/lib/kdv.ts; Dalga 2, 26 Kasım
   * 2026). `asilpos`: KDV'si AsilPOS'un dökümünden gelen günler (dayVat.known ile aynı günler). `z`: kasa raporunda
   * yazarkasa Z'sinin KDV'si girilmiş öteki günler: `revenue` günlerin cirosu, `covered` o cironun yazarkasadan geçen
   * kısmı (yazarkasa toplamıyla sınırlı), `vat` Z'lerin KDV toplamı. `estimate`: ikisi de olmayan günler (oranla).
   * Gün sayıları satırdır ("Tümü"de şube × gün). Yoksa (eski kayıt, test) bütün ay oranla
   */
  vatDays?: { z: { days: number; revenue: number; covered: number; vat: number }; asilpos: number; estimate: number };
  /**
   * [from, to] içinde raporu olmayan günler. Yalnız ilk kasa raporundan (ya da AsilPOS gün sonundan) itibaren aranır:
   * raporlar başlamadan önceki ModPOS föy günleri eksik değildir (docs/MODPOS-API.md › Ay rakamına yedek)
   */
  missing: string[];
  /**
   * Eksik günlerden personelin geç raporu onay bekleyenler (yalnız yükleyici verdiyse; docs/KASA-RAPORU.md › Geç rapor):
   * gün eksik sayılmaya devam eder, yanına "onay bekliyor" yazılır
   */
  pending?: string[];
  /**
   * Kapalı işaretli günler (özel günlerin `kapali` satırı, raporu olmayan; dalga 10 §2.9): eksik sayılmaz, ayrı bir
   * cümleyle yazılır ("2 gün kapalı işaretli: 3, 4 Kasım"). Yalnız yükleyici verdiyse
   */
  closed?: string[];
  /**
   * İlk satır (kasa raporu ya da yedek satır, ör. ModPOS föyü) bu ayın 1'inden sonraysa o gün: toplamlar ayın yalnız bir
   * kısmını kapsar, uygulanmaz
   */
  partialFrom: string | null;
  /** Son raporun günü (AsilPOS'un ve ModPOS'un yedek satırı da sayılır) */
  lastDate: string;
  /**
   * Kasa raporu olmayan ama rakamları AsilPOS'un gün sonundan sayılan günler (G6; yalnız geçiş gününden sonra): eksik
   * günlerin içindedir, yanına "AsilPOS'tan" yazılır. Yoksa alan yok
   */
  asilpos?: string[];
  /**
   * Kasa raporu (ve AsilPOS gün sonu) olmayan ama rakamları kapanmış ModPOS kasa föyünden sayılan günler (Ayarlar › ModPOS
   * › Ay rakamına yedek açıkken; yalnız AsilPOS'a geçiş gününden önce; docs/MODPOS-API.md › Ay rakamına yedek). İlk kasa
   * raporundan sonrakiler eksik günlerin içindedir ("ModPOS föyünden sayıldı"); öncekiler eksik aranmaz. O günlerin
   * indirimi bilinmez (föyde yok). Yoksa alan yok
   */
  modpos?: string[];
}

/**
 * Ayın bilgisi. Sunucudaki yükleyici (src/server/data/dataset.ts) burada etkin değeri verir: elle yazılan, yoksa kasa
 * raporlarından türeyen, o da yoksa varsayılan. Hesapların hepsi (Gelir-gider, Genel bakış, dışa aktarım) bu değerle çalışır.
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
  /** Alanların kaynağı (yalnız sunucudaki yükleyici doldurur; testlerde ve ilk aktarımın verisinde yok) */
  sources?: Record<MonthField, FieldSource>;
  /** Kasa raporlarından türeyen değerler (uygulanmayan alan null) ve kapsamı; ayın raporu yoksa null */
  kasa?: { values: Record<MonthField, number | null>; till: TillMonth } | null;
  /**
   * "Tümü"de şube şube ay bilgisi (src/lib/cash-month.ts resolveBranchMonths): Tümü bunların toplamıdır. Yazan ekran
   * (Satışlar'ın ay formu) yazdığı şubenin elle yazılanını buradan gösterir; motor şubeye bağlı personeli ve sabit gideri
   * şubenin günüyle oranlar. Tek şube seçiliyken yok
   */
  byBranch?: Record<string, Month>;
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
  /**
   * Listenin şubesi (veri kümesi; yoksa Tuzla): AsilPOS'a geçiş günü yalnız AsilPOS'un şubesinin ModPOS listesini düşürür,
   * ModPOS'ta kalan şubenin (Tuzla) listesi her ay sayılır (src/lib/asilpos/sales.ts mergeSalesSources)
   */
  branchId?: string;
  /**
   * AsilPOS'un günlük satışlarından kurulan ay toplamı (src/lib/asilpos/sales.ts; geçiş gününden itibaren): `days` satırın
   * geçtiği gün sayısı. Yalnız okunur: kimliği eksi, sales_lines'ta satırı yok, eşleştirmesi POS adıyla yapılır.
   * Yoksa Satışlar'a yüklenen ModPOS listesinin satırı.
   */
  asilpos?: { days: number };
  /**
   * AsilPOS satırının indirimden önceki liste değeri (Faz 2; `revenue` AsilPOS'ta indirimden sonradır). Bir günü eski
   * AsilPOS'tan gelmişse null (bilinmez). ModPOS listesinin satırında yok: liste zaten indirimden öncedir
   */
  gross?: number | null;
  /** AsilPOS satırında içeceğin seçeneğinden ayrılan ek parçası var (EXTRA SHOT, SYRUP, ALTERNATIF SÜT; Faz 2) */
  isAddon?: boolean;
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
   * Faturanın KDV toplamı, tevkifat düşülmemiş (Paraşüt `total_vat`). İçe aktarılmışlarda 0. KDV tahmini indirilecek
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
  /** Bu faturaya sayılan cari ödemeler (src/lib/cari/balance.ts; kalan borcu openBalance hesaplar) */
  allocated?: number;
  /** Panel takibinin tabanı (cari); boşsa takipsiz: kalan Paraşüt'ün kalanı */
  ledgerBase?: number | null;
  /** Fatura cari ödemelerin dağıtımıyla kapandı */
  paidByLedger?: boolean;
  /** Paraşüt'teki gelen e-fatura kimliği (içeri alınmamış e-faturalar da buradan gelir; belge PDF'i için) */
  eInvoiceId?: string | null;
  /** Eşitlemenin kategorisini tahmin ettiği, kullanıcının henüz onaylamadığı fatura */
  needsReview?: boolean;
  /** Ödeme günü (ödendi işaretlenirken girilen; hesaplarda kullanılmaz) */
  paidAt?: string | null;
  /** Ödemesi istendiği gün: ödenmemiş faturada "Talep edildi" (hesaplarda kullanılmaz) */
  paymentRequestedAt?: string | null;
  /**
   * Komisyon faturasının kanalının aranacağı adlar, faturadaki ad bir kanala bağlanmıyorsa: faturadaki ad, tedarikçi
   * kartının adı ve diğer adları (Komisyon & hakediş'in kuralı, channelNameResolver; dataset.ts). Yalnız Gelir-gider'in
   * POS komisyonu uyarısı okur ("kanalı bulunamayan" fatura iki ekranda aynı)
   */
  channelNames?: string[];
  /** Vergi: "Demirbaş olabilir" listesinde "Gider (demirbaş değil)" denildi (yalnız vergi hesabı; docs/VERGI.md) */
  taxNotAsset?: boolean;
  /** Tedarikçinin VKN / TCKN'si (dışa aktarımın Faturalar sekmesi; hesaplarda kullanılmaz) */
  supplierTaxNumber?: string | null;
  /** E-faturanın ETTN'si (dışa aktarımın Faturalar sekmesi; hesaplarda kullanılmaz) */
  eInvoiceUuid?: string | null;
  /**
   * Faturanın şubesi (docs/SUBE.md › Faturanın şubesi): şube, bilinçli işletme geneli (`companyWide`) ya da ikisi de
   * boş (şubesi seçilmemiş; tek şube görünümüne gelmez). Ayrı Paraşüt hesabına bağlı şubenin faturası o şubenindir.
   * `companyWide` yoksa (içe aktarılmış veri, testler) şubesiz fatura işletme geneli sayılır
   */
  branchId?: string | null;
  companyWide?: boolean;
  /**
   * Kalem kalem sınıflandırma (src/lib/invoice-split.ts): yalnız bir kalemin payı faturanın kendi payından ayrılıyorsa
   * (kategorisi mal alışı olmayan faturada hammaddeye bağlı kalem, nedenli "hammadde değil" kalem). Yoksa fatura bütün
   */
  lines?: { net: number; to: string | null }[] | null;
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
  /**
   * Yemek kartı (Faz 5): işaretliyse işveren maliyetine Ayarlar'daki günlük tutar × gün eklenir, brütleştirilmez. Taban
   * değer (sürümle değişir). Yoksa false
   */
  mealCard?: boolean;
  /**
   * Çalışma biçimi (Faz 5, sahibin kararı 12): tam zamanlı (net maaştan brüt, SGK) ya da part-time (günlük ücret ×
   * Vardiya'da çağrıldığı gün; brütleştirme yok). Yoksa tam zamanlı
   */
  kind?: StaffKind;
  /** Part-time: işletmenin çağrılan gün başına maliyeti (₺; SGK brütleştirmesi yok). Taban değer (sürümle değişir) */
  dailyWage?: number;
  /**
   * Vardiya bağlantısı (Faz 5): panel hesabı (yalnız yönetici bağlar; bir hesap tek satıra). Vardiya anahtarı "u:<id>".
   * Kendiliğinden bağlanmaz
   */
  userId?: number | null;
  /** Hesabı olmayan Vardiya kişisi: "n:<küçük harfli ad>" (src/lib/vardiya.ts nameRef); userId varken boş */
  personRef?: string | null;
  /** Geriye dönük uyumluluk: endMonth boş ya da bu aydan sonra → true. Hesap aralığa (MonthRange) bakar. */
  active: boolean;
  /** Çalıştığı şube (docs/SUBE.md): maaşı o şubenin gideri */
  branchId?: string;
}

/** Kira kaleminin ev sahibi (Faz 5): şahıs ya da şirket */
export type LandlordType = "sahis" | "sirket";

/** Tam zamanlı ya da part-time (Faz 5) */
export type StaffKind = "full_time" | "part_time";

/** Vardiya planında bir çalışma günü (shifts.kind = work): şube, kişinin anahtarı ("u:<id>" / "n:<ad>"), gün */
export interface ShiftDay {
  branchId: string;
  personRef: string;
  /** YYYY-MM-DD */
  date: string;
}

/** "fromMonth ayından itibaren" geçerli maaş (bir sonraki sürüme kadar) */
export interface StaffVersion {
  id: number;
  staffId: number;
  fromMonth: string;
  netSalary: number;
  extras: number;
  /** Yemek kartı (yoksa false) */
  mealCard?: boolean;
  /** Part-time günlük ücret (yoksa 0) */
  dailyWage?: number;
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
  /** Vergi belgesi ve stopaj profili (yalnız vergi hesabı ve nakit planı; boş = seçilmedi; docs/VERGI.md) */
  taxDoc?: TaxDoc | null;
  taxWithholding?: Withholding | null;
  /**
   * Kira: resmi (sözleşmedeki) aylık kira; boşsa yok. Gelir-gider'de "Kira stopajı" satırı = resmi brüt × kira stopajı
   * oranı; vergide kira gideri yalnız resmi brüt (gerçek kira + stopaj − resmi brüt belgesiz). Tutar geçmişi yok: bütün
   * aylar için geçerli
   */
  officialAmount?: number | null;
  /** Resmi kira brüt mü net mi; net ise brüt = net ÷ (1 − stopaj oranı) */
  officialBasis?: "brut" | "net" | null;
  /**
   * Kira: ev sahibi şahıs mı şirket mi (Faz 5; boş = bugünkü kural). Şahıs: KDV yok, stopaj %20 resmi kiradan (resmi
   * kira yoksa tutardan, ödemeden kesilir). Şirket: %20 KDV, stopaj yok, belgesi fatura (src/lib/constants.ts
   * fixedVatRate, engine.ts officialRentGross, cash-plan.ts, tax/muhtasar.ts)
   */
  landlordType?: LandlordType | null;
  /** Açık güne göre oranla (varsayılan); false: biten ayda tam ay (süren ayda bugüne kadarki pay) */
  prorate?: boolean;
  /** Şube; null = işletme geneli (docs/SUBE.md, dalga 3) */
  branchId?: string | null;
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
  /** Hücre notu (elle düzeltmenin açıklaması) */
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
  /** Sayan şube (sayım şube başınadır; "Tümü"de aynı malzemenin her şubeden satırı gelir). Yoksa tek şube */
  branchId?: string | null;
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

/**
 * Çarpanı şüpheli (fiyatı onay bekleyen ya da reddedilen) Paraşüt kalemi olan alış: alınan miktara ve stok partilerine
 * girmedi (src/server/data/purchase-lots-query.ts queryHeldPurchases). Tutarlılık o ayın sapmasını, ayın alımı elle
 * yazılmadıkça hesaplamaz.
 */
export interface HeldPurchase {
  month: string;
  ingredientId: number;
  /** Bu ay o hammaddeye düşen, fiyatı onay bekleyen bağlantının fatura sayısı */
  invoices: number;
  /** Yalnız fiyatı reddedildiği için dışarıda kalan fatura sayısı (bekleyen öneri yok; miktar elle yazılır) */
  rejected: number;
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
  /** Vergi belgesi: kategorinin kayıtları vergide nasıl sayılır (boş = seçilmedi; docs/VERGI.md) */
  taxDoc?: Exclude<TaxDoc, "bordro"> | null;
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
  /** Kasadan çıkan bir satırdan geldiyse onun kimliği ve belgesi (vergide kaydın belgesi; docs/VERGI.md) */
  cashOutId?: number | null;
  docType?: "fis" | "e_arsiv" | "fatura" | "yok" | null;
  /** Cari hesaptaki faturasız bir borca aitse onun kimliği (dalga 11; vergide "belgesi yok") */
  supplierEntryId?: number | null;
  /** Şube; null = işletme geneli (aynı gider iki kez: sabit giderin şubesiyle karşılaştırılır) */
  branchId?: string | null;
}

/**
 * Personelin girdiği zayi ya da ikram (src/server/db/schema.ts wasteEntries): menü ürünü (malzemesi reçeteden) ya da
 * hammadde (qty × factor = malzemenin kendi birimi). Motorun saydığı kayıtlarda (Model.countedWaste) geçiş gününden
 * itibaren AsilPOS'un ikramı da bulunur: `source: "asilpos"`, AsilPOS'taki ad ve menü değeriyle.
 */
export interface WasteEntry {
  date: string;
  kind: "zayi" | "ikram";
  productId: number | null;
  ingredientId: number | null;
  qty: number;
  factor: number;
  /**
   * Panel kaydının şubesi (veri kümesi): AsilPOS'un gün sonu gelen günde yalnız AsilPOS'un şubesinin ürün ikramı düşer,
   * ModPOS'ta kalan şubeninki sayılır (src/lib/asilpos/ikram.ts panelWasteCounts). Yoksa Tuzla'nın
   */
  branchId?: string;
  /** AsilPOS'un ikram satırı (yalnız motorun saydığı kayıtlarda; paneldekilerde yok) */
  source?: "asilpos";
  /** AsilPOS'taki ad (ürünü bulunamasa da gösterilir) */
  name?: string;
  /** AsilPOS'un menü değeri, KDV dahil */
  menuValue?: number;
  /**
   * AsilPOS'un hazırlanmış iptalinden gelen zayi (Faz 2; src/lib/asilpos/ikram.ts iptalWasteLines): tüketimdir ama Z'nin
   * ödenmez tutarında (offRevenue) yoktur, onunla karşılaştırılan kayıtlı değere girmez (recordedOffRevenue)
   */
  iptal?: boolean;
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
  /**
   * Vardiya planının çalışma günleri (shifts.kind = work; Faz 5): part-time kişinin çağrıldığı gün bunlardan sayılır
   * (şube + kişi anahtarı + ay). Şube seçiliyken o şubenin. Yoksa boş
   */
  shifts?: ShiftDay[];
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
  /**
   * Paraşüt faturalarından hammaddeye düşen alışlar (src/server/data/purchase-lots.ts; yoksa boş: sayım ay sonu
   * fiyatıyla). Ayarlar'daki FIFO başlangıcından itibaren ay sonu stoğu bunlarla değerlenir (engine.ts stockSheet)
   */
  purchaseLots?: PurchaseLot[];
  stockExtras: StockExtra[];
  purchaseQuantities: PurchaseQty[];
  /** Çarpanı şüpheli alışlar (alınan miktara girmedi; yoksa boş): Tutarlılık işaretler, sapmayı hesaplamaz */
  heldPurchases?: HeldPurchase[];
  /** Fiyatı onay bekleyen hammaddeler (yoksa boş): fiyatsızsa uyarı onaya götürür, "paket fiyatını girin" demez */
  pendingPriceHolds?: number[];
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
   * Şube görünümü (docs/SUBE.md, dalga 3): tek şube seçiliyken o şube (veri yükleyici süzdü); "Tümü"de yok. Tek şubede
   * mal maliyeti şubenin satışından reçeteye göredir (faturalar ve sayım işletme geneli; engine.ts stockFlow)
   */
  branchView?: { id: string; name: string; kind: "fiziksel" | "online" } | null;
  /**
   * Şube görünümünde "Tümü"nün ay bilgisi (Faz 5; src/server/data/dataset.ts): işletme geneli giderlerin günü
   * işletmeninkidir, "İşletme geneli payı (bilgi)" satırı Tümü'nün saydığı tutarı gösterir. "Tümü"de ve testlerde yok
   */
  companyMonths?: Month[];
  /**
   * "Tümü" birden çok kasanın (etkin fiziksel şubenin) toplamı ya da online kanal seçili: Gelir-gider'in aylık ciro ve
   * açık gün hücresi yazılmaz (src/lib/branches.ts monthWriteLock). Yoksa yazılır
   */
  monthTotalsLocked?: boolean;
  /** Ay hücreleri yazılamıyorsa nedeni (src/lib/branches.ts monthWriteLock; online kanalda kanalın metni) */
  monthLockText?: string | null;
  /**
   * Su + buz litre fiyatının işletme geneli satışı (denetim 21 Kasım #4): tek şube seçiliyken SU GİDERİ girilmiş ayların
   * bütün şubelerdeki satış satırları (AsilPOS dahil, "Tümü"deki gibi) ve laffogato.net online satışları. SU GİDERİ
   * işletmenin faturasıdır (`manual:su` her şubede görünür); yalnız şubenin litresine bölünseydi su ve buz içeren her
   * ürünün maliyeti seçili şubeye göre şişerdi. "Tümü"de yok: veri kümesinin kendi satışları zaten işletme genelidir
   * (engine.ts waterUsage)
   */
  waterSales?: { salesLines: SalesLine[]; siteSales: SiteSalesMonth[] };
  /**
   * Süren ayda yüklenen satış listesinin son günü ve o güne kadarki kasa raporları (src/lib/sales-coverage.ts; yoksa
   * liste ayın tamamıdır). Listeye dayanan hesaplar listenin günleriyle yapılır (engine.ts listPeriod)
   */
  salesCoverage?: { month: string; through: string; till: TillMonth | null }[];
  /**
   * Yalnız "Tümü": dönemi kısaltan şube, ay ay (src/lib/asilpos/sales.ts mergeSalesSources › short; bulgu 62). ModPOS'ta
   * kalan şubenin listesi ayın öteki satırlarından önce bitiyorsa (`through`) ayın dönemi o gün, AsilPOS'un sonraki günleri
   * sayılmaz; listesi yoksa (`through` null) ayın satırları "Tümü"de sayılmaz. `branch` şubenin adı
   */
  commonLists?: { month: string; branch: string; through: string | null }[];
  /**
   * Satışlar'ın içe aktarmasının yazdığı şubenin (currentWriteBranch: seçili şube, "Tümü"de Tuzla) listelerinin son günü,
   * ay ay (src/lib/sales-coverage.ts readCoverage; ay yoksa liste ayın tamamı): içe aktarma kartının "… tarihine kadar"ı
   * yeni yüklemenin değiştireceği ya da ekleneceği listenin günüdür. "Tümü"de Marina'nın listesinin günü ya da son
   * yükleyenin ortak kaydı değil
   */
  writeCoverage?: Record<string, string>;
  /**
   * AsilPOS'a geçiş günü seçiliyse satış kaynaklarının özeti (src/lib/asilpos/sales.ts): geçiş ayından itibaren her ayın
   * ModPOS listesi ve AsilPOS günleri. Yoksa (varsayılan) kasa ModPOS'tur, satışlar yalnız sales_lines'tan
   */
  asilposSales?: {
    switchDay: string;
    /** Kasaların en erken sayılma günü (metinler) */
    countFrom: string;
    /** Kasa başına AsilPOS satışlarının sayıldığı ilk gün (çok şube; para hesapları bunu okur: listDiscountOf) */
    froms: PosFroms;
    months: AsilposSalesMonth[];
  };
  /**
   * AsilPOS kasaları (çok şube; kütükten: kasa kaynağı AsilPOS olan fiziksel şubeler, src/lib/pos/tills.ts) ve geçiş
   * günleri. "Tümü"de her kasa kendi geçiş günüyle; okunmamışsa (test verisi) yok
   */
  posTills?: readonly string[];
  posSwitchDays?: SwitchDays;
  /**
   * AsilPOS'a geçiş günü seçiliyse o günden itibaren AsilPOS'un ikramları ve gün sonu gelen günler
   * (src/lib/asilpos/ikram.ts): ikram satırları kayıtlı tüketime girer, o günlerde paneldeki ürün ikramı sayılmaz. Yoksa
   * (varsayılan) ikram yalnız Zayi & ikram'dan
   */
  asilposIkram?: AsilposIkramData;
  /**
   * AsilPOS personel bağlantısı (LM-4b): AsilPOS'un şubesinin geçiş gününden itibaren gelen gün sonları ve her günün
   * çalışan kimlikleri (pos_day_reports.worked_staff). Yemek kartının günü bundan (src/lib/asilpos/personel.ts
   * asilposWorkedDays): ayın her sayılan günü liste taşıyorsa AsilPOS'ta çalıştığı gün, yoksa Ayarlar'daki gün. Geçiş günü
   * yoksa (ya da görünüm AsilPOS'un şubesini içermiyorsa) yok
   */
  asilposWorked?: AsilposWorked;
  /**
   * Kafe kapalı işaretli günler (Özel günler'in `kapali` satırı, kasa raporu olmayan; geçmiş ve ileri tarihli,
   * YYYY-MM-DD, sıralı). Süren ayın ay sonu öngörüsü bu günleri açık saymaz (denetim E-41). Yoksa boş
   */
  closedDays?: string[];
  /**
   * Şubelerin banka POS oranı (Şubeler › POS oranı, branches.pos_rate; sahibin kararı 23 Kasım 2026: iki şube %2):
   * banka POS komisyonu = Σ şube (kart × şubenin oranı) (engine.ts posCommission). Kütükte olmayan şube (testler,
   * dışa aktarım) Ayarlar'daki eski genel orandan (`settings.komisyon`); kasa kartı olmayan ay eski formülle
   */
  branchRates?: { id: string; name: string; posRate: number }[];
}

/**
 * Geçiş gününden itibaren bir ayın satış kaynakları (src/lib/asilpos/sales.ts › asilposMonthStatus; Satışlar okur). Her
 * gün tek kaynaktan sayılır: geçiş ayında ModPOS listesi kendi son gününe kadar, AsilPOS `from`'dan; sonraki aylarda
 * yalnız AsilPOS (yüklü ModPOS listesi sayılmaz, silinmez).
 */
export interface AsilposSalesMonth {
  month: string;
  /** gecis: geçiş günü ayın ortasında; asilpos: ayın tamamı geçiş gününden sonra */
  source: "gecis" | "asilpos";
  /** AsilPOS satışlarının sayıldığı ilk gün; bu ay AsilPOS sayılmıyorsa null (geçiş ayının listesi ayın sonuna kadar) */
  from: string | null;
  /** Gelen AsilPOS gün sonları (sayılan ve kasa raporunu bekleyen): kaç gün geldi, son gün; hiç gelmediyse null */
  asilpos: { days: number; last: string } | null;
  /**
   * Süren ayda gelmiş ama kasa raporu girilmediği için henüz sayılmayan AsilPOS günleri (kasa raporlarının son gününden
   * sonra; docs/ASILPOS.md › Kapsam); yoksa null ya da yok
   */
  held?: { from: string; to: string } | null;
  /**
   * AsilPOS'un sayılması gereken (`from`'dan dünden önceye) ama gün sonu gelmemiş, kasa raporu olan günler: o günlerin
   * satışı hiçbir kaynakta yok; yoksa alan yok
   */
  missing?: string[];
  /**
   * Ayın Satışlar'a yüklenmiş ModPOS listesi: satır sayısı, ciro toplamı, son günü (kapsam kaydı yoksa ayın sonu) ve
   * hesaba girip girmediği (geçiş ayında evet, sonraki aylarda hayır); liste yoksa null
   */
  modpos: { lines: number; revenue: number; through: string; counted: boolean; /** Listenin günlerinin ilk kasa raporu (yoksa yok: ayın 1'i) */ from?: string } | null;
  /** Geçiş ayında listenin günlerinin (ayın 1'i → son günü) kasa raporlarındaki Z toplamı; rapor yoksa null */
  modposZ: number | null;
  /**
   * Aynı günlerin kasa raporlarındaki indirim (girilmemiş gün 0): liste indirimden öncedir, Z ile liste − indirim
   * karşılaştırılır (modposOverZText). Z yoksa null; eski kayıtta (test) yok
   */
  modposDiscounts?: number | null;
  /** Hiçbir kaynakta olmayan geçmiş günler: geçiş ayında liste geçiş gününden önce bitiyor ya da hiç yok */
  gap: { from: string; to: string } | null;
  /** Liste geçiş gününü aştığı için sayılmayan AsilPOS günleri (aynı gün iki kez sayılmasın diye) */
  overlap: { from: string; to: string } | null;
  /**
   * AsilPOS günlerinin ürün satırları ↔ Z (hesap sözleşmesi: Σ ciro = zTotal; 23 Kasım 2026): denetlenen gün sayısı ve
   * tutmayan günler (satırların toplamı, Z). Yükleyici vermediyse (test, eski çağıran) yok
   */
  zCheck?: { days: number; off: { date: string; lines: number; z: number }[] };
}
