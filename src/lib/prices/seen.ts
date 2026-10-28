import { money } from "@/lib/format";
import { toMinor } from "@/lib/site-menu/slot";

/**
 * Açık kalmış kartın satış fiyatı (`seenPrice`; denetim E-11, docs/planlar/senkron.md › P1.4). Reçete kartı ve
 * listedeki fiyat hücresi kayıtta, kart açılırken (ya da hücre son yazıldığında) gördüğü fiyatı da gönderir. Fiyatlar
 * kuruşla karşılaştırılır (sitenin kuralı, Math.round(TL * 100)):
 *
 * - **Dokunulmadı** (gönderilen = görülen): veritabanındaki güncel fiyat kalır. Bu arada sitede, siteyle eşitlemede,
 *   toplu Fiyatlar'da ya da başka bir sekmede yazılan fiyat geri alınmaz, siteye eski fiyat gitmez, fiyat geçmişine ve
 *   Kasaya işle listesine sahte kayıt düşmez. `moved`: fiyat görülenden beri değişmiş (bildirim söyler).
 * - **Dokunuldu, veritabanı aynı:** yeni fiyat yazılır.
 * - **Dokunuldu, veritabanı da aynı yeni fiyata değişti:** yazılacak bir şey yok (çakışma değil).
 * - **Dokunuldu, veritabanı başka bir fiyata değişti:** iki değişiklik çakışır; hiçbir şey yazılmaz, kullanıcı hangisinin
 *   kalacağını seçer (priceMovedText).
 *
 * `seen` yoksa (eski sekmedeki istemci göndermez) gönderilen yazılır: bugünkü davranış. Saf modül: eylem
 * (src/server/actions/products.ts) ve testler paylaşır.
 */
export type SeenPrice =
  | { kind: "keep"; price: number; moved: boolean }
  | { kind: "write"; price: number }
  | { kind: "conflict"; current: number; seen: number };

export function seenPriceDecision(sent: number, seen: number | null | undefined, current: number): SeenPrice {
  if (seen === null || seen === undefined) return { kind: "write", price: sent };
  const moved = toMinor(current) !== toMinor(seen);
  if (toMinor(sent) === toMinor(seen)) return { kind: "keep", price: current, moved };
  if (toMinor(sent) === toMinor(current)) return { kind: "keep", price: current, moved: false };
  return moved ? { kind: "conflict", current, seen } : { kind: "write", price: sent };
}

/** Reçete kartının çakışma metni: kayıt yapılmadı; kart fiyat alanının altında iki seçenek gösterir */
export function priceMovedText(current: number, seen: number): string {
  return `Fiyat bu arada başka bir yerde değişti: şimdi ${money(current)} (kart açıldığında ${money(seen)}); değişiklikler kaydedilmedi. Fiyat alanının altından hangisinin kalacağını seçip yeniden kaydet.`;
}

/** Toplu Fiyatlar'ın (ve önizlemeden yazan her yolun) çakışma metni: liste yenilenmedi */
export function priceChangedText(current: number): string {
  return `Fiyat bu sırada değişti (şimdi ${money(current)}); listeyi yenileyip tekrar dene`;
}

/** Listedeki fiyat hücresinin ve zam önerisinin çakışma metni: eylem sayfayı yeniledi, hücre güncel fiyatı aldı */
export function priceRefusedText(current: number): string {
  return `Fiyat bu arada başka bir yerde ${money(current)} oldu; yazılmadı. Liste güncellendi, istersen yeniden değiştir.`;
}

/**
 * Reçete kartının metni: ürün kart açıkken laffogato.net menüsüne bağlandı (ya da bağlantısı değişti). Satış alanı
 * yalnız panele yazılsaydı site ile panel ayrışırdı; kayıt yapılmadı, sayfa yenilendi, yeniden kayıt siteye de gider
 */
export const LINK_CHANGED_TEXT = "Ürün bu arada laffogato.net menüsüne bağlandı ya da bağlantısı değişti; değişiklikler kaydedilmedi. Sayfa yenilendi, yeniden kaydet.";
