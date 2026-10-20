/**
 * Fatura kategorisi ile Paraşüt kalemlerinin hammaddeye bağlanması arasındaki kurallar; istemci de kullanır
 * (sync.ts "server-only" olduğu için fatura penceresi oradan alamaz). Saf modül; tests/fatura-kalem-baglama.test.ts.
 */
import { GOODS_CATEGORIES, SEPARATE_CATEGORIES } from "./constants";

/**
 * Hammaddeye bağlanmaya aday kalemlerin geldiği fatura kategorileri: mal alışları ve "Diğer". Komisyon, kira,
 * demirbaş, yazılım, reklam ve hizmet faturalarının kalemleri listeyi doldurmasın. Paraşüt sayfasının "Bekleyen"
 * listesi (sync.ts) de bu listeyi kullanır.
 */
export const LINKABLE_CATEGORIES = [...GOODS_CATEGORIES, "Diğer"];

/** Kalemi "Hammaddeye bağla" ile Paraşüt sayfasına gönderilebilir mi (orada listelenir mi) */
export function isLinkableCategory(category: string): boolean {
  return LINKABLE_CATEGORIES.includes(category);
}

/**
 * Kategori değişikliği kafe içi ↔ kafe dışı (karaoke box, Alp Koç) sınırını geçiyor mu: applyProductLinks kafe dışı
 * faturaların kalemlerini alınan miktara ve fiyata saymaz; kafe içi kategoriler arası geçiş miktarı değiştirmez.
 */
export function crossesSeparate(from: string, to: string): boolean {
  return SEPARATE_CATEGORIES.includes(from) !== SEPARATE_CATEGORIES.includes(to);
}

/**
 * Alınan miktarı yeniden hesaplanacak aylar (YYYY-AA, tekrarsız): sınırı geçen ve kalemi okunmuş (`withLines`)
 * faturaların ayları. Kalemsiz faturanın (elle girilen, belgesi henüz okunmamış) hesaba katılacak kalemi yok.
 */
export function separateMoveMonths(moves: { id: number; date: string; from: string; to: string }[], withLines: ReadonlySet<number>): string[] {
  return [...new Set(moves.filter((m) => withLines.has(m.id) && crossesSeparate(m.from, m.to)).map((m) => m.date.slice(0, 7)))];
}
