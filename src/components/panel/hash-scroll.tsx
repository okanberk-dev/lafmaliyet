"use client";

import { useEffect } from "react";

/**
 * Başka sayfadan gelen çapalı bağlantı (zil, e-posta, Bugün, ⌘K: /panel/vergi#kdv, Komisyon'un ?ay=…#pluxee) hedefine
 * iner. Sayfa sunucudan sonradan aktığı için Next'in (ya da tarayıcının) çapa kaydırması hedefe ulaşamayabilir: içerik
 * çizilince bir kez kaydırılır. Akan içeriğin içine konur. Next önceki sayfaların gizli kopyalarını tuttuğu için görünen
 * çapa seçilir. Dönem değişince yeniden bağlanır (key).
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
