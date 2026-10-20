"use client";

import { useEffect, useState, type RefObject } from "react";

/** Yüzen düğmenin örtmemesi gereken öğeler (ör. "Adres ekle", bölüm başlıklarının açma oku) */
export const FAB_AVOID = { "data-fab-avoid": "" } as const;

/**
 * Yüzen "Ekle" düğmesi `[data-fab-avoid]` bir öğenin üstüne geliyorsa true: düğme o sırada çekilir (yanyana iki
 * "Ekle" ya da örtülen bir açma oku olmasın). Düğmenin yeri offset* ile ölçülür; gizlenirken uygulanan kaydırma
 * (translate) ölçüyü bozmaz.
 */
export function useFabBlocked(fab: RefObject<HTMLElement | null>): boolean {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let raf = 0;
    const check = () => {
      const el = fab.current;
      // lg'den itibaren düğme yok (display: none → genişlik 0)
      if (!el || !el.offsetWidth) return setBlocked(false);
      const pad = 8;
      const top = el.offsetTop - pad;
      const bottom = el.offsetTop + el.offsetHeight + pad;
      const left = el.offsetLeft - pad;
      const right = el.offsetLeft + el.offsetWidth + pad;
      const hit = Array.from(document.querySelectorAll<HTMLElement>("[data-fab-avoid]")).some((a) => {
        const r = a.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > top && r.top < bottom && r.right > left && r.left < right;
      });
      setBlocked(hit);
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Katlanır bölüm açılıp kapanınca düzen değişir (toggle kabarcıklanmaz; yakalama evresinde dinlenir)
    document.addEventListener("toggle", schedule, true);
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("toggle", schedule, true);
      ro.disconnect();
    };
  }, [fab]);
  return blocked;
}
