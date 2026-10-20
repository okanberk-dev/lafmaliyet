/**
 * Bellekte kayan pencereli sayaç: "bu anahtar son `windowMs` içinde en fazla `limit` kez". Sunucusuz ortamda her
 * örnek kendi sayacını tutar; kaba kuvvete karşı ilk savunmadır (asıl sınırlar veritabanındadır: bağlantı başına
 * deneme sayısı, kişi başına saatlik sıfırlama bağlantısı).
 */
export function createLimiter({ limit, windowMs, maxKeys = 5000 }: { limit: number; windowMs: number; maxKeys?: number }) {
  const hits = new Map<string, number[]>();

  function prune(now: number) {
    for (const [key, list] of hits) {
      const fresh = list.filter((t) => now - t < windowMs);
      if (fresh.length) hits.set(key, fresh);
      else hits.delete(key);
    }
  }

  return {
    /** Denemeyi sayar; sınır aşıldıysa false (deneme sayılmaz) */
    hit(key: string, now = Date.now()): boolean {
      if (hits.size > maxKeys) prune(now);
      const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (list.length >= limit) {
        hits.set(key, list);
        return false;
      }
      list.push(now);
      hits.set(key, list);
      return true;
    },
    /** Sayacı sıfırlar (testler için) */
    reset() {
      hits.clear();
    },
  };
}

/** İstemci adresi: Vercel'de x-forwarded-for'un ilk değeri; bilinmiyorsa "?" (hepsi tek kovada sayılır) */
export function clientIp(h: { get(name: string): string | null }): string {
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip")?.trim() || "?";
}
