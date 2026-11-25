// Ayarlar formunun alan tanımları ve metin ↔ değer dönüşümleri (saf; istemci formu ve testler kullanır).

import { formatPercentInput, parseNumberTR, parsePercentInput } from "@/lib/calc/expr";
import type { Settings } from "@/lib/calc/types";
import { num } from "@/lib/format";

export type NumericKey =
  | "kdv"
  | "kdvHizmet"
  | "komisyon"
  | "kartOrani"
  | "hedefMaliyet"
  | "fire"
  | "shotTek"
  | "shotCift"
  | "pompa"
  | "pompaPure"
  | "dondurmaTop"
  | "tkGr"
  | "potGr"
  | "potMl"
  | "mealCardDaily"
  | "mealCardDays"
  | "alisKdvAmbalaj"
  | "alisKdvGida";

export type FieldDef = {
  key: NumericKey;
  label: string;
  hint: string;
  kind: "pct" | "num" | "int";
  /** Reçete formüllerindeki adı (ShotTek …) */
  formula?: string;
  /** Varsayım: ölçülüp yazılması gereken tahmini değer (alanda "Varsayım" rozeti) */
  assumption?: boolean;
  /** %0,5'in altı (0 hariç) gerçekçi değil: "0,1" yanlışlıkla binde bir olarak yazılmış olabilir */
  sane?: boolean;
  /** 0 olamaz */
  positive?: boolean;
  max?: number;
};

export const RATE_FIELDS: FieldDef[] = [
  { key: "kdv", label: "Satış KDV oranı", hint: "Kafe satışlarında %10", kind: "pct", sane: true },
  { key: "kdvHizmet", label: "Hizmet satışı KDV oranı", hint: "Satışlar'da HİZMET işaretli satırlar (karaoke odası): %20", kind: "pct", sane: true },
  { key: "komisyon", label: "Banka / POS komisyon oranı", hint: "Kasa raporu olmayan aylarda; kasa raporu olan ayda her şubenin oranı Şubeler'de", kind: "pct", sane: true },
  {
    key: "kartOrani",
    label: "Kartlı satış oranı",
    hint: "Kredi kartı + yemek kartı ÷ ciro. Kasa raporu olan aylarda o ayın gerçek oranı kullanılır; bu değer ürün fiyat hesabında ve raporu olmayan aylarda geçer.",
    kind: "pct",
  },
  { key: "hedefMaliyet", label: "Hedef maliyet oranı (food cost)", hint: "Kafeler için ideal %25–35", kind: "pct", sane: true, positive: true },
  { key: "fire", label: "Fire / kayıp payı", hint: "Dökülen süt, atılan kahve; yalnız ürün kartında zayi oranı boş ürünlere uygulanır", kind: "pct" },
  {
    key: "alisKdvAmbalaj",
    label: "Ambalajın alış KDV'si",
    hint: "Sayımın Ambalaj grubu (bardak, kapak, peçete): Hammaddeler'de yeni malzemeye önerilen KDV, %20",
    kind: "pct",
  },
  {
    key: "alisKdvGida",
    label: "Gıdanın alış KDV'si",
    hint: "Sayımın öteki grupları ve listede olmayan kalemler: yeni malzemeye önerilen KDV, %1",
    kind: "pct",
  },
];

export const MEASURE_FIELDS: FieldDef[] = [
  { key: "shotTek", label: "Tek shot kahve (gr)", hint: "Solo espresso", formula: "ShotTek", kind: "num" },
  { key: "shotCift", label: "Çift shot kahve (gr)", hint: "Double espresso", formula: "ShotCift", kind: "num" },
  { key: "pompa", label: "1 pompa şurup (ml)", hint: "Şurup pompasının bir basışı", formula: "Pompa", kind: "num" },
  { key: "pompaPure", label: "1 pompa püre (ml)", hint: "Püre pompasının bir basışı", formula: "PurePompa", kind: "num" },
  { key: "dondurmaTop", label: "1 top dondurma (ml)", hint: "Varsayım: ~70 ml. Ölçüp yazın.", formula: "DondurmaTop", kind: "num", assumption: true },
  { key: "tkGr", label: "Türk kahvesi 1 fincan (gr)", hint: "Varsayım: 7 gr. Ölçüp yazın.", formula: "TKGr", kind: "num", assumption: true },
  { key: "potGr", label: "Filtre kahve tam pot (gr)", hint: "Bir pota konan çekilmiş kahve", formula: "PotGr", kind: "num" },
  { key: "potMl", label: "Tam pottan çıkan (ml)", hint: "Varsayım: ~1.800 ml. Makinenizin değerini ölçüp yazın.", formula: "PotMl", kind: "num", assumption: true, positive: true },
];
// Ayda kaç gün açık (acikGun) 25 Kasım 2026'dan beri şube başına: Şube ayarları › Çalışma takvimi (şube ayarı
// isletme.takvim; docs/SUBE.md › Şube başına ayarlar)

/**
 * Personel yemek kartı (Faz 5, sahibin kararı 11): Maaşlar'da yemek kartı işaretli kişinin işveren maliyetine günlük
 * tutar × gün eklenir, brütleştirilmez (Gelir-gider'de "PERSONEL YEMEK KARTI" satırı)
 */
export const PERSONNEL_FIELDS: FieldDef[] = [
  { key: "mealCardDaily", label: "Yemek kartı günlük tutar (₺)", hint: "Kişi başı, günlük; Maaşlar'da yemek kartı işaretli personel için", kind: "num" },
  { key: "mealCardDays", label: "Yemek kartı ayda gün", hint: "Ayda kaç gün yüklenir (26); brütleştirilmez", kind: "int", positive: true, max: 31 },
];

export const ALL_FIELDS = [...RATE_FIELDS, ...MEASURE_FIELDS, ...PERSONNEL_FIELDS];

export const toText = (v: number, kind: FieldDef["kind"]) => (kind === "pct" ? formatPercentInput(v, 2) : num(v, kind === "int" ? 0 : 2));
export const textsOf = (settings: Settings) => Object.fromEntries(ALL_FIELDS.map((f) => [f.key, toText(Number(settings[f.key]), f.kind)])) as Record<NumericKey, string>;
export const waterText = (v: number | null) => (v === null ? "" : num(v, 4));
/** Yüzde alanı yüzde puanı okur: "10", "%10", "10%" → 0,1; "0,1" → 0,001 (parsePercentInput zaten 100'e böler) */
export const parseField = (text: string, kind: FieldDef["kind"]) => (kind === "pct" ? parsePercentInput(text) : parseNumberTR(text));
/** Alanın gösterim biçimi: "%10", "1.800", "30" */
export const shown = (v: number, f: FieldDef) => (f.kind === "pct" ? `%${formatPercentInput(v, 4)}` : num(v, f.kind === "int" ? 0 : 2));

/** Okunan değerin sorunu (kayıttan önce alanın altında; sunucu aynı sınırları ayrıca denetler) */
export function problemOf(f: FieldDef, text: string): string | null {
  if (text.trim() === "") return "Bir sayı girin";
  const v = parseField(text, f.kind);
  if (v === null) return f.kind === "pct" ? "Bir yüzde girin (ör. 10 ya da 2,5)" : "Bir sayı girin (ondalık için virgül: 2,5)";
  if (v < 0) return "Negatif olamaz";
  if (f.kind === "pct" && v > 1) return "%100'den büyük olamaz";
  if (f.positive && v === 0) return "0'dan büyük olmalı";
  if (f.sane && v > 0 && v < 0.005) return `%${formatPercentInput(v, 4)} okundu; yüzde olarak yazın (ör. %10 için 10)`;
  if (f.kind === "int" && !Number.isInteger(v)) return "Tam sayı girin";
  if (f.max !== undefined && v > f.max) return `En fazla ${f.max}`;
  return null;
}

/**
 * Alan kayıtlı değerden farklı mı? Biçim farkı ("10" / "10,00") ve ekranda yuvarlanan ondalıklar
 * değişiklik sayılmaz; kayıttan sonra yazılan değer kayıtlı değere eşitse de temiz sayılır.
 */
export function isClean(text: string, baseText: string, current: number | null, kind: FieldDef["kind"] = "num") {
  if (text.trim() === baseText.trim()) return true;
  const v = parseField(text, kind);
  if (v === null) return text.trim() === "" && current === null;
  const b = parseField(baseText, kind);
  if (b !== null && Math.abs(v - b) < 1e-9) return true;
  return current !== null && Math.abs(v - current) < 1e-9;
}
