import type { CountUnit, FixedPeriod, FixedSection, Settings, Size, Unit } from "./calc/types";

export const DEFAULT_SETTINGS: Settings = {
  kdv: 0.1,
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
  "Diğer",
];

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
  { key: "manual:su", section: "faturalar", label: "SU GİDERİ", hint: "Su faturasını (KDV hariç) yazın. Su + buzun litre maliyeti buradan otomatik hesaplanır." },
  { key: "manual:dogalgaz", section: "faturalar", label: "DOĞALGAZ" },
  { key: "manual:ciro_kirasi", section: "kira", label: "CİRO KİRASI" },
  { key: "manual:sigorta", section: "genel", label: "İŞYERİ SİGORTASI" },
  { key: "manual:harici", section: "genel", label: "HARİCİ GİDERLER (bakım, tamir, temizlik, kırtasiye)" },
  { key: "manual:diger", section: "genel", label: "DİĞER" },
];

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
