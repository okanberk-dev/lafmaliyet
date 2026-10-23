/**
 * Komut paletinin (⌘K) sözcük eşleşmesi: 3 harfe kadar olan sözcük yalnız bir sözcüğün başında tutar ("süt" yazınca
 * "Paraşüt" gelmesin, "Süt %2,5" ve "Laktozsuz süt" gelsin); daha uzun sözcük her yerde. `hay` ve `w` önceden
 * katlanmış olmalı (fold: küçük harf, aksan yok). tests/arayuz-duzeltmeleri.test.ts sınar.
 */
export function wordHit(hay: string, w: string): boolean {
  if (w.length > 3) return hay.includes(w);
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}`, "u").test(hay);
}
