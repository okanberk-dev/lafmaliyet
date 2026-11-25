/**
 * Fatura kategorisi ile Paraşüt kalemlerinin hammaddeye bağlanması arasındaki kurallar; istemci de kullanır
 * (sync.ts "server-only" olduğu için fatura penceresi oradan alamaz). Saf modül; tests/fatura-kalem-baglama.test.ts.
 */
import { COMMISSION_CATEGORY, GOODS_CATEGORIES, SEPARATE_CATEGORIES } from "./constants";

/**
 * Kalemi hammaddeye bağlıysa stoğa girip gelir-gidere girmeyen kategori (denetim 26 Eki, E-07). Böyle faturanın bağlı
 * kalemi alınan miktara, FIFO partisine ve hammadde fiyatına girer ama gelir-gider mal alışını saymaz; satılan malın
 * maliyeti eksik, kâr fazla görünür. 25 Kasım 2026'dan beri faturalar kalem kalem sayılır (src/lib/invoice-split.ts):
 * "Diğer", "Hizmet", "Temizlik & Sarf" faturasının bağlı kalemi mal alışıdır; bölünmeyen yalnız komisyon faturası kaldı
 * (kafe dışı faturanın kalemi stoğa girmez). Sunucudaki sorgu src/server/data/stock-only-invoices.ts
 */
export function stockOnlyCategory(category: string): boolean {
  return category === COMMISSION_CATEGORY;
}

const GOODS_LIST = `${GOODS_CATEGORIES.slice(0, -1).join(", ")} ya da ${GOODS_CATEGORIES.at(-1)}`;

/**
 * Fatura penceresinin, listenin ve kategori sayfasının uyarısı (kalemi hammaddeye bağlı, kategorisi mal alışı değil).
 * Kategori Aylık harcamalar'da bir gidere bağlıysa (`expenseLinks`: fatura kategorisi → giderin adı) fatura gelir-gidere
 * o giderde girer, yalnız mal maliyetine girmez: uyarı bunu söyler, faturanın tamamını mal alışı yaptırmaya zorlamaz
 * (deterjanlı market faturası mal maliyetine taşınmasın)
 */
export function stockOnlyText(category: string, expenseLinks?: Record<string, string>): string {
  const linked = expenseLinks?.[category];
  return linked
    ? `Bu fatura mal alışı (mal maliyeti) sayılmıyor: kalemleri hammaddeye bağlı, stoğa ve fiyata giriyor; gelir-giderde Aylık harcamalar'daki “${linked}” giderinde sayılıyor. Faturanın tamamı mal alışıysa kategorisini ${GOODS_LIST} yapın.`
    : `Bu fatura mal alışı sayılmıyor: kalemleri hammaddeye bağlı, stoğa ve fiyata giriyor ama gelir-gidere girmiyor. Kategorisini ${GOODS_LIST} yapın.`;
}

/**
 * Hammaddeye bağlanmaya aday kalemlerin geldiği fatura kategorileri: mal alışları, Temizlik & Sarf ve "Diğer". Komisyon, kira,
 * demirbaş, yazılım, reklam ve hizmet faturalarının kalemleri listeyi doldurmasın. Paraşüt sayfasının "Bekleyen"
 * listesi (sync.ts) de bu listeyi kullanır.
 */
// "Temizlik & Sarf" da (25 Kasım 2026): karışık faturanın (Avansas) gıda kalemi bağlanınca mal alışı sayılır
export const LINKABLE_CATEGORIES = [...GOODS_CATEGORIES, "Temizlik & Sarf", "Diğer"];

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
