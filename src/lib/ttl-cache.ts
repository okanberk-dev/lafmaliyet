/**
 * Tek değerlik, süreli önbellek (işlev örneği başına bellekte; saf: tests/canli-yoklama.test.ts). Sağlık ucu
 * (/api/health) bununla dış izleme servisinin her yoklamasında veritabanını uyandırmaz: Neon beş dakika boşta kalınca
 * uyur, sık bir yoklama onu hiç uyutmaz ve ücretsiz planın aylık kotasını yer (docs/BILDIRIMLER.md › İki iş birden
 * durursa).
 */
export function createTtlCache<T>(ttlMs: number) {
  let entry: { at: number; value: T } | null = null;
  return {
    /** Süresi geçmemiş değer; yoksa null */
    get(now = Date.now()): T | null {
      return entry && now - entry.at < ttlMs ? entry.value : null;
    },
    set(value: T, now = Date.now()): void {
      entry = { at: now, value };
    },
    clear(): void {
      entry = null;
    },
  };
}
