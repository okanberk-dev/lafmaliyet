import type { CountUnit, FixedPeriod, FixedSection, Settings, Size, Unit } from "./calc/types";

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
  potGr: 105,
  potMl: 1800,
  dondurmaTop: 70,
  tkGr: 7,
  acikGun: 30,
  isciSgk: 0.14,
  isciIssizlik: 0.01,
  isverenSgk: 0.1575,
  isverenIssizlik: 0.02,
  fireExcludesPackaging: false,
  suBirimLTOverride: null,
  publicMenu: false,
};

/** Reçete miktar formüllerinde kullanılabilen ayarlar (Excel'deki adlandırılmış hücreler). */
export const RECIPE_PARAMS: { name: string; key: keyof Settings; label: string; unit: string }[] = [
  { name: "ShotTek", key: "shotTek", label: "Tek shot kahve", unit: "gr" },
  { name: "ShotCift", key: "shotCift", label: "Çift shot kahve", unit: "gr" },
  { name: "Pompa", key: "pompa", label: "1 pompa şurup", unit: "ml" },
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
  "Diğer",
];

/**
 * Kafe dışı (ayrı hesap) fatura kategorileri: aynı Paraşüt hesabına gelen karaoke box faturaları (MaviBahçe AVM) ve
 * ortak Alp Koç'un hesabına alınanlar (kola ile Damla suyun birlikte geldiği Pruva faturaları). Kafenin fatura
 * toplamlarına, gelir-giderine, mal maliyetine ve ürün bağlamaya girmez; Faturalar'da ayrı satırda.
 */
export const SEPARATE_CATEGORIES = ["Karaoke box", "Alp Koç"];

/** Mal maliyeti sayılan fatura kategorileri (Genel Maliyet > Mal alışları) */
export const GOODS_CATEGORIES = ["Hammadde & İçecek", "Tatlı & Hazır Ürün", "Ambalaj"];
/** Platform / yemek kartı komisyon faturaları (Genel Maliyet > Komisyon giderleri) */
export const COMMISSION_CATEGORY = "Komisyon";

export const FIXED_SECTIONS: { key: FixedSection; label: string }[] = [
  { key: "personel", label: "Personel giderleri" },
  { key: "faturalar", label: "Faturalar" },
  { key: "kira", label: "Kira" },
  { key: "genel", label: "İşletme genel giderleri" },
];

export const FIXED_PERIODS: { key: FixedPeriod; label: string; hint: string }[] = [
  { key: "aylik", label: "Aylık", hint: "Her ay aynı tutar" },
  { key: "gunluk", label: "Günlük", hint: "Açık gün sayısıyla çarpılır" },
  { key: "haftalik", label: "Haftalık", hint: "× 52 ÷ 12" },
  { key: "yillik", label: "Yıllık", hint: "÷ 12" },
];

/** Genel Maliyet tablosunda elle girilen aylık satırlar */
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

/** Excel Panel'in "Para nereye gitti?" bloğundaki sabit gider grupları (B9–B12) */
export type PanelFixedGroup = "kira" | "personel" | "reklam" | "diger";

export const PANEL_FIXED_GROUPS: { key: PanelFixedGroup; label: string; hint: string }[] = [
  { key: "kira", label: "Kira", hint: "Sabit Giderler'deki kira satırı. Ortak gider / aidat Diğer'de sayılır (Excel Panel B9)." },
  {
    key: "personel",
    label: "Personel (maaş + SGK, part-time, yemek)",
    hint: "Personel sayfasındaki işveren maliyeti + part-time + personel yemeği. Muhasebeci Diğer'de sayılır (Excel Panel B10).",
  },
  { key: "reklam", label: "Reklam (Instagram, influencer)", hint: "Reklam, Instagram, influencer gibi tanıtım giderleri (Excel Panel B11)." },
  { key: "diger", label: "Diğer sabit giderler", hint: "Elektrik, muhasebe, güvenlik, yazılım, ortak gider… (Excel Panel B12)." },
];

/**
 * Sabit gider adından Panel grubunu bulmak için anahtar kelimeler. Ad Türkçe küçük harfe çevrilip
 * aksanları atılarak aranır ("İlaçlama" → "ilaclama", "Müşavir" → "musavir").
 */
export const PANEL_GROUP_KEYWORDS = {
  reklam: /reklam|instagram|influencer|sosyal medya|tanitim|sponsor|tiktok|facebook|google ads|meta ads/,
  /** Personel bölümünde olup Excel Panel'de "Diğer" sayılanlar (dışarıdan hizmet) */
  notPersonel: /muhasebe|musavir|avukat|hukuk|danisman/,
  kira: /kira/,
  /** Kira bölümünde olup kira sayılmayanlar */
  notKira: /ortak gider|aidat|avans/,
};

/**
 * Excel Sayım sayfasındaki grup KDV oranı (M sütunu): ambalaj %20, diğer bütün gruplar ve listede olmayanlar %1.
 * Panel her malzemenin kendi Alış KDV'sini kullanır; bu tablo yalnızca karşılaştırma içindir.
 */
export const COUNT_GROUP_VAT: Record<string, number> = { "AMBALAJ MALZEMELERİ": 0.2 };
export const COUNT_GROUP_VAT_DEFAULT = 0.01;

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

export const ROLES = { admin: "Yönetici", staff: "Personel" } as const;
export type Role = keyof typeof ROLES;
