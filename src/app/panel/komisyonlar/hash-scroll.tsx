"use client";

import { useEffect } from "react";

/**
 * Zilin, e-postanın ve Bugün'ün bağlantısı kanalın kartına iner (?ay=…#pluxee). Sayfa sunucudan sonradan aktığı için
 * Next'in (ya da tarayıcının) çapa kaydırması karta ulaşamayabilir: kartlar çizilince bir kez kaydırılır. Next önceki
 * sayfaların gizli kopyalarını tuttuğu için görünen çapa seçilir. Ay değişince yeniden bağlanır (key).
 */
export function HashScroll() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const frame = requestAnimationFrame(() =>
      [...document.querySelectorAll<HTMLElement>(`#${CSS.escape(id)}`)].find((el) => el.getClientRects().length > 0)?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, []);
  return null;
}
