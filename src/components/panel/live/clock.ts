"use client";

import { useEffect, useState } from "react";

import { liveNow } from "./store";

/**
 * Sunucu saatiyle (store.ts liveNow) ilerleyen saat: `ms`'de bir yenilenir. İlk çizimde (sunucuda da) 0 döner; saat
 * tarayıcıda hemen ardından gelir (çizim sırasında Date.now okunmaz, sunucu ve tarayıcı aynı HTML'i üretir).
 */
export function useClock(ms: number): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(liveNow());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, ms);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [ms]);
  return now;
}
