/**
 * Stok sayımı › "Listeye ekle": sayım listesine yeni kalem (yönetici ve personel). Kalem bir hammaddedir; fiyatı
 * bilinmediği için paket fiyatı 0 ve "Tahmini" açılır, yönetici Hammaddeler'den girer. Saf kurallar: ad anahtarı
 * (Türkçe büyük/küçük harf), aynı ad denetimi, sayım biriminden malzeme birimi, grubun varsayılan kategori ve KDV'si,
 * zildeki "fiyatı girilmemiş" metni. Sunucu eylemi (src/app/panel/sayim/actions.ts), sayım formu ve
 * tests/sayim-ekle.test.ts aynı kuralı kullanır; burada veritabanı ya da tarayıcı yok.
 */

import type { CountUnit, Unit } from "./calc/types";
import { num } from "./format";

/** Kayıtlı ad: baştaki / sondaki boşluk gider, aradaki boşluklar teke iner */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Aynı ad denetiminin anahtarı: Türkçe küçük harf (İ → i, I → ı) ve boşluklar sadeleşir. Türkçe olmayan klavyede
 * yazılan "VANILYA" da "Vanilya" ile aynı sayılsın diye ı da i'ye iner (anlamı ı/i farkıyla ayrılan iki kalem yok).
 * Migration'daki SQL karşılığı: lower(translate(ad, 'ÇĞİIÖŞÜı', 'çğiiöşüi')) (drizzle/*_sayim_yeni_kalemler.sql).
 */
export function nameKey(name: string): string {
  return cleanName(name).toLocaleLowerCase("tr-TR").replace(/ı/g, "i");
}

export const COUNT_ITEM_NAME_MIN = 2;
export const COUNT_ITEM_NAME_MAX = 120;

/** Sayım biriminden malzemenin kendi birimi (stok değeri ve reçete bu birimle hesaplanır) */
export const BASE_UNIT: Record<CountUnit, Unit> = { KG: "gr", LT: "ml", ADET: "adet", "DİLİM": "dilim" };

/** Paket içeriğinin önerilen değeri: KG ve LT'de 1000 (gr / ml), ADET ve DİLİM'de 1 */
export function defaultPackageSize(countUnit: CountUnit): number {
  return countUnit === "KG" || countUnit === "LT" ? 1000 : 1;
}

export interface ExistingIngredient {
  name: string;
  active: boolean;
  countUnit: string | null;
}

/** counted: aktif ve sayım listesinde; uncounted: aktif ama "Sayılmaz"; inactive: pasif */
export type CountItemDuplicate = { kind: "counted" | "uncounted" | "inactive"; name: string };

/**
 * Aynı adlı hammadde (anahtar eşleşmesi). Birden çok eşleşme varsa sayım listesindeki önce, sonra aktif, en son pasif
 * olan döner (kullanıcıya en işe yarar yönlendirme).
 */
export function findDuplicate(name: string, existing: ExistingIngredient[]): CountItemDuplicate | null {
  const key = nameKey(name);
  const same = existing.filter((e) => nameKey(e.name) === key);
  const counted = same.find((e) => e.active && e.countUnit);
  if (counted) return { kind: "counted", name: counted.name };
  const active = same.find((e) => e.active);
  if (active) return { kind: "uncounted", name: active.name };
  return same[0] ? { kind: "inactive", name: same[0].name } : null;
}

/** Aynı ad bulununca gösterilen metin; yönetici ne yapacağını, personel kime yazacağını okur */
export function duplicateMessage(dup: CountItemDuplicate, role: "admin" | "staff"): string {
  const n = `“${dup.name}”`;
  if (dup.kind === "counted") return `${n} zaten sayım listesinde.`;
  if (dup.kind === "uncounted")
    return role === "admin" ? `${n} hammaddelerde var ama sayılmıyor; Hammaddeler'den sayım birimini seçin.` : `${n} hammaddelerde var ama sayılmıyor; yöneticiye yazın.`;
  return role === "admin" ? `${n} pasif; Hammaddeler'den yeniden açabilirsiniz.` : `${n} pasif; yönetici Hammaddeler'den yeniden açabilir.`;
}

export const COUNT_ITEM_FALLBACK_CATEGORY = "Diğer";
/** ingredients.vat_rate sütununun varsayılanı (%1) */
export const COUNT_ITEM_FALLBACK_VAT = 0.01;

/** En sık değer; eşitlikte listede önce gelen (çağıran sayım sırasıyla verir) */
function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  let best: T | undefined;
  let bestN = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/**
 * Yeni kalemin kategorisi ve Alış KDV'si: sayım grubundaki (önce aktif) malzemelerin en sık kategorisi ve oranı;
 * grupta malzeme yoksa "Diğer" ve %1. Yönetici sonra Hammaddeler'den değiştirebilir.
 */
export function groupDefaults(
  rows: { countGroup: string | null; category: string; vatRate: number; active: boolean }[],
  group: string,
): { category: string; vatRate: number } {
  const inGroup = rows.filter((r) => r.countGroup === group);
  const pool = inGroup.some((r) => r.active) ? inGroup.filter((r) => r.active) : inGroup;
  return {
    category: mostCommon(pool.map((r) => r.category)) ?? COUNT_ITEM_FALLBACK_CATEGORY,
    vatRate: mostCommon(pool.map((r) => r.vatRate)) ?? COUNT_ITEM_FALLBACK_VAT,
  };
}

/**
 * "Listeye ekle"deki grup seçenekleri, sayım listesindeki sırayla (`order`), her grubun olağan sayım birimiyle
 * (gruptaki aktif sayılan kalemlerin en sık birimi; pencere bu birimle açılır). Hiçbir hammaddede yazılı olmayan grup
 * (sayım grubu boş kalemlerin toplandığı "DİĞER") seçilemez: sunucu yalnız var olan grubu kabul eder.
 */
export function countGroupOptions(
  order: string[],
  rows: { countGroup: string | null; countUnit: CountUnit | null; active: boolean }[],
): { name: string; unit: CountUnit }[] {
  return order.flatMap((name) => {
    const inGroup = rows.filter((r) => r.countGroup === name);
    if (!inGroup.length) return [];
    const units = inGroup.filter((r) => r.active && r.countUnit).map((r) => r.countUnit as CountUnit);
    return [{ name, unit: mostCommon(units) ?? "ADET" }];
  });
}

/** Kalemin yeni sırası: bütün malzemelerin en büyük sırasından sonra (sayım listesinde grubunun sonuna düşer) */
export function nextSortOrder(rows: { sortOrder: number }[]): number {
  return rows.reduce((m, r) => Math.max(m, r.sortOrder), 0) + 1;
}

/**
 * Fiyatı girilmemiş hammadde: aktif, fiyatı elle girilen (su ve buz su faturasından gelir) ve paket fiyatı 0.
 * Zil ve Hammaddeler'deki "Fiyat yok" süzgeci bu kuralı kullanır (zilin SQL'i: src/server/data/unpriced.ts).
 */
export function isUnpriced(i: { active: boolean; priceSource: string; packagePrice: number }): boolean {
  return i.active && i.priceSource === "manual" && i.packagePrice === 0;
}

/** Zil: "Fiyatı girilmemiş 2 hammadde" / "Çilek şurubu, Böğürtlen püre · Hammaddeler'den paket fiyatını girin." */
export function unpricedNotice(count: number, names: string[], max = 3): { title: string; body: string } {
  const shown = names.slice(0, max);
  const rest = count - shown.length;
  const list = rest > 0 ? `${shown.join(", ")} ve ${num(rest)} hammadde daha` : shown.join(", ");
  return { title: `Fiyatı girilmemiş ${num(count)} hammadde`, body: `${list} · Hammaddeler'den paket fiyatını girin.` };
}
