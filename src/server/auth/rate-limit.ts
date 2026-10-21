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
    /** Sınıra ulaşıldı mı (deneme sayılmaz) */
    blocked(key: string, now = Date.now()): boolean {
      return (hits.get(key) ?? []).filter((t) => now - t < windowMs).length >= limit;
    },
    /**
     * Son sayılan denemeyi geri alır. Deneme doğrulamadan önce sayılır (eşzamanlı denemeler sınırı aşamasın);
     * başarılı çıkarsa geri alınır: kafenin ortak IP'si başarılı girişlerle dolmasın.
     */
    undo(key: string) {
      const list = hits.get(key);
      if (!list?.length) return;
      list.pop();
      if (!list.length) hits.delete(key);
    },
    /** Sayacı sıfırlar (testler için) */
    reset() {
      hits.clear();
    },
  };
}

/**
 * Bellekte hesap kilidi: veritabanındaki kilitle aynı kural (`max`. hatada `lockMs` kilit, kilitlenince sayaç sıfır,
 * kilit bitince yeniden `max` hak). Girişte kayıtsız e-postaya da aynı kilit mesajı verilsin (hesap var mı yok mu
 * anlaşılmasın) ve bilinen cihazın kendi hata payı tutulsun diye. Örnek başına sayılır; yaklaşık eşitlik yeterli.
 */
export function createLockout({ max, lockMs, maxKeys = 5000 }: { max: number; lockMs: number; maxKeys?: number }) {
  const state = new Map<string, { fails: number; until: number; at: number }>();

  function prune(now: number) {
    for (const [key, v] of state) if (v.until <= now && now - v.at >= lockMs) state.delete(key);
    // Hâlâ çoksa en eski dokunulanlar gider (Map ekleme sırasını korur, fail() anahtarı sona taşır)
    for (const key of state.keys()) {
      if (state.size <= maxKeys) break;
      state.delete(key);
    }
  }

  /** Kilit sürüyorsa bitişi, yoksa null */
  function lockedUntil(key: string, now = Date.now()): Date | null {
    const v = state.get(key);
    return v && v.until > now ? new Date(v.until) : null;
  }

  /** Hatayı sayar; bu hatayla kilitlendiyse kilidin bitişi, yoksa null */
  function fail(key: string, now = Date.now()): Date | null {
    if (state.size > maxKeys) prune(now);
    const prev = state.get(key);
    const fails = (prev?.fails ?? 0) + 1;
    const locked = fails >= max;
    state.delete(key);
    state.set(key, { fails: locked ? 0 : fails, until: locked ? now + lockMs : (prev?.until ?? 0), at: now });
    return locked ? new Date(now + lockMs) : null;
  }

  return {
    lockedUntil,
    fail,
    /**
     * Denemeyi doğrulamadan önce sayar: kilit sürüyorsa `{ ok: false, until }` (deneme değerlendirilmez), yoksa sayılır
     * ve `{ ok: true, locked }` (bu denemeyle kilitlendiyse bitişi). Denetim ve sayım arasında await olmadığı için
     * eşzamanlı denemeler kilidi aşamaz. Başarılı denemede clear() ya da refund().
     */
    attempt(key: string, now = Date.now()): { ok: true; locked: Date | null } | { ok: false; until: Date } {
      const until = lockedUntil(key, now);
      if (until) return { ok: false, until };
      return { ok: true, locked: fail(key, now) };
    },
    /**
     * attempt() ile sayılan son denemeyi geri alır (parola doğru, iki adımlı kod bekleniyor): bu deneme kilitlediyse
     * kilit kalkar ve sayaç bir eksikte kalır.
     */
    refund(key: string, now = Date.now()) {
      const v = state.get(key);
      if (!v) return;
      if (v.fails > 0) v.fails--;
      else if (v.until > now) state.set(key, { fails: max - 1, until: 0, at: v.at });
    },
    /** Başarılı girişte sayaç ve kilit kalkar */
    clear(key: string) {
      state.delete(key);
    },
    /** Hepsini sıfırlar (testler için) */
    reset() {
      state.clear();
    },
  };
}

/** İstemci adresi: Vercel'de x-forwarded-for'un ilk değeri; bilinmiyorsa "?" (hepsi tek kovada sayılır) */
export function clientIp(h: { get(name: string): string | null }): string {
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip")?.trim() || "?";
}
