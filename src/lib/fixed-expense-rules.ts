/**
 * Sabit giderin Gelir-gider hücresi kuralı (saf; sunucu ve testler kullanır; tests/hesap-uyumu-faz1.test.ts). Bitmiş
 * (bitiş ayı geçmiş) ya da silinmiş sabit giderin ayına YENİ tutar yazılmaz (23 Kasım 2026): bitmiş kalem kapanmış
 * sayılır, sonradan yazılan tutar kalemin bitişini delip giderin iki kez sayılmasına yol açardı (ör. haftalık
 * "Part-time çalışan" Kasım'da biter, Aralık'tan günlük modele geçilir). Var olan elle girişi düzeltmek ve silmek
 * serbesttir; motor eski değerleri saymaya devam eder (engine.ts pnlMonth).
 */

import { monthLabel } from "./format";

/** Sabit gider ve stopaj satırının anahtarı: "fixed:12", "stopaj:12" */
const FIXED_KEY = /^(fixed|stopaj):(\d+)$/;

/** Anahtarın sabit gideri (kimliği); başka satırda null */
export function fixedIdOfKey(key: string): number | null {
  const m = FIXED_KEY.exec(key);
  return m ? Number(m[2]) : null;
}

/**
 * Hücreye yazmanın reddi (Türkçe neden) ya da null. `item`: anahtarın sabit gideri (silinmişse null); `hasEntry`: o ay o
 * satırda kayıtlı elle giriş var; `amount` null ise silme (her zaman serbest)
 */
export function fixedCellRefusal(i: {
  key: string;
  month: string;
  item: { name: string; endMonth: string | null } | null;
  hasEntry: boolean;
  amount: number | null;
}): string | null {
  if (fixedIdOfKey(i.key) === null || i.amount === null || i.hasEntry) return null;
  if (!i.item) return "Bu sabit gider silinmiş: yeni tutar yazılmaz. Bu ayın gideri başka bir kalemse Sabit giderler'e ya da Aylık harcamalar'a ekleyin.";
  if (i.item.endMonth && i.month > i.item.endMonth) {
    return `${i.item.name} ${monthLabel(i.item.endMonth)} sonunda bitti: ${monthLabel(i.month)} için yeni tutar yazılmaz. Gider sürüyorsa Sabit giderler'de bitişini kaldırın; bu ay tek seferlik bir ödemeyse Aylık harcamalar'a yazın.`;
  }
  return null;
}

/**
 * Gelir-gider'de geçerlilik aralığının dışındaki (başlamamış ya da bitmiş) kalemin boş hücresi salt okunurdur: ipucu.
 * Önceden yazılmış tutar (overridden) düzenlenir ve silinir
 */
export const FIXED_LOCKED_CELL_TEXT = "Kalem bu ayda geçerli değil (Sabit giderler'deki başlangıç / bitiş ayı): yeni tutar yazılmaz.";
