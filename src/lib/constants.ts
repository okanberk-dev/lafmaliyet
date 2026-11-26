import type { CountUnit, FixedPeriod, FixedSection, LandlordType, Settings, Size, Unit } from "./calc/types";

export const DEFAULT_SETTINGS: Settings = {
  kdv: 0.1,
  kdvHizmet: 0.2,
  komisyon: 0.025,
  kartOrani: 0.856,
  hedefMaliyet: 0.3,
  fire: 0.05,
  shotTek: 11,
  shotCift: 18,
  pompa: 10,
  pompaPure: 30,
  potGr: 105,
  potMl: 1800,
  dondurmaTop: 70,
  tkGr: 7,
  acikGun: 30,
  isciSgk: 0.14,
  isciIssizlik: 0.01,
  isverenSgk: 0.1575,
  isverenIssizlik: 0.02,
  // Personel yemek kartı (sahibin kararı 11, 23 Kasım 2026): kişi başı günlük 330 ₺ × ayda 26 gün
  mealCardDaily: 330,
  mealCardDays: 26,
  // Sayım gruplarının olağan alış KDV'si: ambalaj %20, gıda %1 (Ayarlar › Oranlar; groupVatRate)
  alisKdvAmbalaj: 0.2,
  alisKdvGida: 0.01,
  fireExcludesPackaging: false,
  suBirimLTOverride: null,
  publicMenu: false,
  // FIFO Ekim 2026'dan: önceki kapanmış ayların stok değeri ve kârı değişmez (docs/STOK-DEGERLEME.md)
  stokFifoBaslangic: "2026-10",
  // LafPOS'a geçiş günü: boş = kasa ModPOS, LafPOS'un günleri hiçbir hesaba girmez (docs/LAFPOS.md › Geçiş günü)
  lafposGecisGunu: null,
};

/**
 * Reçete / menü maliyetinin dayanağı (Satışlar, ürün listesi, reçete kartı): son alış fiyatı. Kâr-zararın mal
 * maliyeti ise sayımdan, FIFO ile (docs/STOK-DEGERLEME.md)
 */
export const RECIPE_COST_NOTE =
  "Reçete maliyeti son alış fiyatıyla (yenileme maliyeti): fiyat kararı için. Kâr-zararın mal maliyeti FIFO ile değerlenen sayımdan.";

/** Stok değerleme ayarının veritabanındaki "kapalı" değeri (satır silinirse varsayılan ay geri gelir) */
export const FIFO_OFF = "kapali";

/** LafPOS'a geçiş günü bundan önce olamaz (bağlantı 26 Ekim 2026'da yayına girdi; öncesinde LafPOS günü yok) */
export const LAFPOS_SWITCH_MIN = "2026-10-01";

/** Takvimde olan bir gün mü ("2026-02-30" değil) */
export function isCalendarDay(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/**
 * Kayıtlı LafPOS geçiş gününün okunması: takvimde olan ve LAFPOS_SWITCH_MIN'den önce olmayan gün; başka her şey
 * (bozuk, boş, başka biçim) null, yani kasa ModPOS. Üst sınır yalnız kaydederken denetlenir (src/lib/lafpos/switch.ts).
 */
export function readLafposSwitchDay(v: unknown): string | null {
  return isCalendarDay(v) && v >= LAFPOS_SWITCH_MIN ? v : null;
}

/**
 * Veritabanındaki ayar satırlarından hesap ayarları (loadSettings). Satırı olmayan anahtar varsayılanı okur: sonradan
 * eklenen bir ayar (ör. püre pompası) eski veritabanında kayıt gerektirmez. Bilinmeyen (eski) anahtarlar yok sayılır.
 */
export function settingsFromRows(rows: Iterable<{ key: string; value: unknown }>): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (Object.hasOwn(DEFAULT_SETTINGS, r.key)) out[r.key] = r.value;
  // FIFO başlangıcı: geçerli bir ay ya da "kapali" (eski yöntem); bozuk değer de eski yöntem sayılır
  if (out.stokFifoBaslangic !== null && !(typeof out.stokFifoBaslangic === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(out.stokFifoBaslangic))) out.stokFifoBaslangic = null;
  // LafPOS'a geçiş günü: bozuk değer ModPOS sayılır (null)
  out.lafposGecisGunu = readLafposSwitchDay(out.lafposGecisGunu);
  // Sayım gruplarının alış KDV'si: 0 ile 1 arası sayı değilse varsayılan (bozuk değer sayımın değerini NaN yapmasın)
  for (const k of ["alisKdvAmbalaj", "alisKdvGida"] as const) {
    const v = out[k];
    if (!(typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)) out[k] = DEFAULT_SETTINGS[k];
  }
  return out as unknown as Settings;
}

/** Reçete miktar formüllerinde kullanılabilen ayarlar (formülde adıyla yazılır: "2 * ShotTek"). */
export const RECIPE_PARAMS: { name: string; key: keyof Settings; label: string; unit: string }[] = [
  { name: "ShotTek", key: "shotTek", label: "Tek shot kahve", unit: "gr" },
  { name: "ShotCift", key: "shotCift", label: "Çift shot kahve", unit: "gr" },
  { name: "Pompa", key: "pompa", label: "1 pompa şurup", unit: "ml" },
  { name: "PurePompa", key: "pompaPure", label: "1 pompa püre", unit: "ml" },
  { name: "DondurmaTop", key: "dondurmaTop", label: "1 top dondurma", unit: "ml" },
  { name: "TKGr", key: "tkGr", label: "Türk kahvesi 1 fincan", unit: "gr" },
  { name: "PotGr", key: "potGr", label: "Filtre kahve tam pot", unit: "gr" },
  { name: "PotMl", key: "potMl", label: "Tam pottan çıkan", unit: "ml" },
];

export const UNITS: Unit[] = ["gr", "ml", "adet", "dilim"];
export const SIZES: Size[] = ["M", "L", "Tek"];
export const SIZE_LABELS: Record<Size, string> = { M: "Medium", L: "Large", Tek: "Tek boy" };
export const COUNT_UNITS: CountUnit[] = ["KG", "LT", "ADET", "DİLİM"];

export const INGREDIENT_CATEGORIES = [
  "Kahve",
  "Süt",
  "Sos & Şurup",
  "Püre",
  "Toz",
  "Dondurma",
  "Tatlı",
  "Atıştırmalık",
  "Şişe İçecek",
  "Ambalaj",
  "Diğer",
];

/** Fireden hariç tutulabilecek ambalaj kategorisi */
export const PACKAGING_CATEGORY = "Ambalaj";

export const COUNT_GROUPS = [
  "AMBALAJ MALZEMELERİ",
  "KAHVE & ÇAY",
  "SÜT ÜRÜNLERİ & DONDURMA",
  "SOS / ŞURUP / PÜRE",
  "TOZ ÜRÜNLER",
  "TATLILAR",
  "SANDVİÇ & ATIŞTIRMALIK",
  "İÇECEKLER (şişe)",
  "DİĞER GIDA ÜRÜNLERİ",
];

export const INVOICE_CATEGORIES = [
  "Hammadde & İçecek",
  "Tatlı & Hazır Ürün",
  "Ambalaj",
  "Kira & AVM",
  "Kuruluş & Demirbaş",
  "Yazılım & POS",
  "Reklam & Tabela",
  "Hizmet",
  "Komisyon",
  "Karaoke box",
  "Alp Koç",
  // Temizlik ve sarf malzemesi (25 Kasım 2026): "Diğer" yalnız sınıflanmamış faturaların bekleme kutusu
  "Temizlik & Sarf",
  "Diğer",
];

/**
 * Kafe dışı (ayrı hesap) fatura kategorileri: aynı Paraşüt hesabına gelen karaoke box faturaları (MaviBahçe AVM) ve
 * ortak Alp Koç'un hesabına alınanlar (kola ile Damla suyun birlikte geldiği Pruva faturaları). Kafenin fatura
 * toplamlarına, gelir-giderine, mal maliyetine ve ürün bağlamaya girmez; Faturalar'da ayrı satırda.
 */
export const SEPARATE_CATEGORIES = ["Karaoke box", "Alp Koç"];

/** Mal maliyeti sayılan fatura kategorileri (Gelir-gider › Mal alışları) */
export const GOODS_CATEGORIES = ["Hammadde & İçecek", "Tatlı & Hazır Ürün", "Ambalaj"];
/** Platform / yemek kartı komisyon faturaları (Gelir-gider › Komisyon giderleri) */
export const COMMISSION_CATEGORY = "Komisyon";

/**
 * Sabit gider aylık girişe çevrilince başlangıç ayına yazılan tahmini harcamanın açıklaması (denetim E-60). Tutar sabit
 * giderin KDV hariç tutarıdır, ödeme değildir: nakit planı bunu ödenmiş saymaz (E-13); tutarı ya da günü düzeltilince
 * açıklama kalkar, kayıt gerçek ödeme olur (saveExpenseEntry)
 */
export const FIXED_ESTIMATE_DESCRIPTION = "Sabit giderdeki KDV hariç tutar (tahmini): ödediğiniz tutarı yazın";

export const FIXED_SECTIONS: { key: FixedSection; label: string }[] = [
  { key: "personel", label: "Personel giderleri" },
  { key: "faturalar", label: "Faturalar" },
  { key: "kira", label: "Kira" },
  { key: "genel", label: "İşletme genel giderleri" },
];

/**
 * Sabit giderin faturasındaki KDV, bölümün varsayılanı (kalemde boşsa): personel KDV'siz (maaş, yemek), kira, faturalar
 * ve genel giderler %20. Yalnız nakit planı kullanır (gider KDV dahil ödenir); gelir-gider KDV hariç kalır.
 */
export const FIXED_SECTION_VAT: Record<FixedSection, number> = { personel: 0, faturalar: 0.2, kira: 0.2, genel: 0.2 };
/** Sabit gider formundaki KDV seçenekleri */
export const FIXED_VAT_RATES: { value: number; label: string }[] = [
  { value: 0, label: "KDV yok" },
  { value: 0.01, label: "%1" },
  { value: 0.1, label: "%10" },
  { value: 0.2, label: "%20" },
];

/**
 * Kalemin KDV oranı: girilmişse o, yoksa bölümünün varsayılanı. Kira kaleminde ev sahibi türü seçildiyse o karar verir
 * (Faz 5): şahsa kirada KDV yok (kalemde %20 yazılı olsa da), şirkete kirada %20
 */
export function fixedVatRate(f: { section: FixedSection; vatRate?: number | null; landlordType?: LandlordType | null }): number {
  if (f.section === "kira" && f.landlordType === "sahis") return 0;
  if (f.section === "kira" && f.landlordType === "sirket") return LANDLORD_COMPANY_VAT;
  return f.vatRate ?? FIXED_SECTION_VAT[f.section];
}

/** Şirkete kiranın KDV'si (Faz 5) */
export const LANDLORD_COMPANY_VAT = 0.2;

/** Ev sahibi türü seçenekleri (Sabit giderler › kira kalemi; Faz 5) */
export const LANDLORD_TYPES: { value: LandlordType; label: string; hint: string }[] = [
  { value: "sahis", label: "Şahıs (KDV yok, stopaj %20)", hint: "KDV yok; stopaj %20 resmi kiradan (resmi kira yoksa tutardan, ödemeden kesilir), muhtasarla ödenir." },
  { value: "sirket", label: "Şirket (%20 KDV, stopaj yok)", hint: "Faturalı: %20 KDV, stopaj yok; resmi kira stopaja girmez." },
];

export const FIXED_PERIODS: { key: FixedPeriod; label: string; hint: string }[] = [
  { key: "aylik", label: "Aylık", hint: "Her ay aynı tutar" },
  { key: "gunluk", label: "Günlük", hint: "Açık gün sayısıyla çarpılır" },
  { key: "haftalik", label: "Haftalık", hint: "× 52 ÷ 12" },
  { key: "yillik", label: "Yıllık", hint: "÷ 12" },
];

/** Gelir-gider tablosunda elle girilen aylık satırlar */
export const MANUAL_PNL_ROWS: { key: string; section: FixedSection | "mal"; label: string; hint?: string }[] = [
  { key: "manual:diger_mal", section: "mal", label: "DİĞER (market / nakit alımlar)", hint: "Faturasız, nakit veya marketten alınan malzemeler." },
  { key: "manual:personel_extra", section: "personel", label: "PERSONEL EXTRA (prim, mesai)" },
  { key: "manual:su", section: "faturalar", label: "SU GİDERİ", hint: "Su faturasını (KDV hariç) yazın. Su + buzun litre maliyeti buradan otomatik hesaplanır; bunun için o ayın ürün satış listesi de yüklenmiş olmalı (litre satışlardan bulunur)." },
  { key: "manual:dogalgaz", section: "faturalar", label: "DOĞALGAZ" },
  { key: "manual:ciro_kirasi", section: "kira", label: "CİRO KİRASI" },
  { key: "manual:sigorta", section: "genel", label: "İŞYERİ SİGORTASI" },
  { key: "manual:harici", section: "genel", label: "HARİCİ GİDERLER (bakım, tamir, temizlik, kırtasiye)" },
  { key: "manual:diger", section: "genel", label: "DİĞER" },
];

/** Genel bakış'ın "Para nereye gitti?" kartındaki sabit gider grupları */
export type PanelFixedGroup = "kira" | "personel" | "reklam" | "diger";

export const PANEL_FIXED_GROUPS: { key: PanelFixedGroup; label: string; hint: string }[] = [
  { key: "kira", label: "Kira", hint: "Sabit Giderler'deki kira satırı. Ortak gider / aidat Diğer'de sayılır." },
  {
    key: "personel",
    label: "Personel (maaş + SGK, part-time, yemek)",
    hint: "Maaşlar'daki işveren maliyeti + part-time + personel yemeği. Muhasebeci Diğer'de sayılır.",
  },
  { key: "reklam", label: "Reklam (Instagram, influencer)", hint: "Reklam, Instagram, influencer gibi tanıtım giderleri." },
  { key: "diger", label: "Diğer sabit giderler", hint: "Elektrik, muhasebe, güvenlik, yazılım, ortak gider…" },
];

/**
 * Sabit gider adından Panel grubunu bulmak için anahtar kelimeler. Ad Türkçe küçük harfe çevrilip
 * aksanları atılarak aranır ("İlaçlama" → "ilaclama", "Müşavir" → "musavir").
 */
export const PANEL_GROUP_KEYWORDS = {
  reklam: /reklam|instagram|influencer|sosyal medya|tanitim|sponsor|tiktok|facebook|google ads|meta ads/,
  /** Personel bölümünde olup "Diğer" grubunda sayılanlar (dışarıdan hizmet) */
  notPersonel: /muhasebe|musavir|avukat|hukuk|danisman/,
  kira: /kira/,
  /** Kira bölümünde olup kira sayılmayanlar */
  notKira: /ortak gider|aidat|avans/,
};

/** Ambalaj sayım grubu: olağan alış KDV'si Ayarlar'daki ambalaj oranı (öteki gruplar gıda oranı) */
export const PACKAGING_COUNT_GROUP = "AMBALAJ MALZEMELERİ";

/**
 * Sayım grubunun olağan alış KDV'si (Ayarlar › Oranlar): ambalaj grubu ambalaj oranı (%20), öteki gruplar, grupsuz
 * malzeme ve sayımda listede olmayan kalemler gıda oranı (%1). Hammaddeler yeni malzemeye bunu önerir; sayım her
 * malzemenin kendi Alış KDV'sini kullanır, oranı gruptan ayrılan malzeme sayımda bilgi olarak yazılır.
 */
export function groupVatRate(settings: Pick<Settings, "alisKdvAmbalaj" | "alisKdvGida">, group: string | null | undefined): number {
  return group === PACKAGING_COUNT_GROUP ? settings.alisKdvAmbalaj : settings.alisKdvGida;
}

/** Satış listesinde ürün sayılmaması gereken satırlar (toplam / başlık) */
// "Genel / ara / alt toplam …" her zaman özet; yalın "Toplam" yalnızca ardından tutar sözcükleri geliyorsa
// ("Toplam KDV dahil", "Toplam tutar"): "Toplam Kahve Paketi" gibi gerçek bir ürün adı özet sayılmaz.
export const SALES_SUMMARY_PATTERNS = [
  /^(genel|ara|alt)\s*toplam(lar|i)?(\s.*)?$/,
  /^toplam(lar|i)?\s*[:=]?(\s*(kdv|dahil|haric|tutar|tutari|ciro|cirosu|satis|satislar|adet|tl|try|net|brut|genel|[\d.,]+|₺))*$/,
  /^(grand\s+|sub\s*)?totals?$/,
];
export const SALES_HEADER_NAMES = ["urun", "urun adi", "urunler", "urun ismi", "stok adi", "stok", "ad", "adi", "isim", "product", "product name", "item", "kalem"];

export const MONTH_NAMES = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

/**
 * Hesap rolleri (docs/ROLLER.md). Yönetici her şey; Müdür şubesinin günlük işletmesi (şubesine kilitli); Personel
 * günün işleri; Muhasebeci salt okunur muhasebe ekranları. Hangi rolün neyi açtığı TEK KAYNAKTA: src/lib/roles.ts.
 */
export const ROLES = { admin: "Yönetici", manager: "Müdür", staff: "Personel", accountant: "Muhasebeci" } as const;
export type Role = keyof typeof ROLES;
/** Rollerin sırası (seçici, süzgeç, tablo): yetkisi geniş olandan dara */
export const ROLE_ORDER: readonly Role[] = ["admin", "manager", "staff", "accountant"];
