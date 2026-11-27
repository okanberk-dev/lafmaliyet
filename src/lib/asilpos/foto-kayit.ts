import { FOTO_SATIR_ALANI } from "./eski-adlar";
import type { AsilposPhotoCheck } from "./foto";

/**
 * Gün sonu fotoğrafının karşılaştırmasının veritabanındaki biçimi (asilpos_day_ends.photo_check; ad değişikliği, plan
 * A1). Satırlarda AsilPOS'taki değer eski adlı alanda saklanır (FOTO_SATIR_ALANI): 24 Kasım 2026'dan beri yazılan
 * satırlar ve canlıdaki eski sürüm (geri dönüş) onu okur. Okurken yeni alana (`asilpos`) çevrilir; yeni adlı alan da
 * okunur (temizlik PR'ı A3 yazarsa o geçer). Yazılan eski addır. Şema (src/server/db/schema.ts) iki yönde de bunları
 * çağırır; özetler (photoCheckHash) satırın değerlerinden hesaplandığı için önceki e-postaların kayıtlarıyla aynı kalır.
 * Saf: tests/asilpos-adi.test.ts
 */

const YENI_ALAN = "asilpos";

/** Alanın adını değiştirir, sırayı korur; yeni ad zaten varsa eski alan düşer (yeni ad geçer) */
function renameField(row: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
  if (!Object.hasOwn(row, from)) return row;
  const keep = !Object.hasOwn(row, to);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k !== from) out[k] = v;
    else if (keep) out[to] = v;
  }
  return out;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function mapRows(check: unknown, from: string, to: string): unknown {
  if (!isObject(check) || !Array.isArray(check.rows)) return check;
  return { ...check, rows: check.rows.map((r) => (isObject(r) ? renameField(r, from, to) : r)) };
}

/** Veritabanından gelen karşılaştırma: satırların eski adlı alanı yeni ada çevrilir */
export function photoCheckFromDb(stored: unknown): AsilposPhotoCheck {
  return mapRows(stored, FOTO_SATIR_ALANI, YENI_ALAN) as AsilposPhotoCheck;
}

/** Veritabanına yazılan karşılaştırma: satırların alanı eski adla (canlıdaki eski sürüm ve geri dönüş okur) */
export function photoCheckToDb(check: AsilposPhotoCheck): unknown {
  return mapRows(check, YENI_ALAN, FOTO_SATIR_ALANI);
}
