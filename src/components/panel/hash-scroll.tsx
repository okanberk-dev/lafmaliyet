"use client";

import { useEffect } from "react";

/** Çapanın hedefine konan işaret: hedefi vurgulayan ekran bununla çizer (tarayıcının :target'ı boş kalabilir) */
export const HASH_HIT_ATTR = "data-hash-hit";

/**
 * Başka sayfadan gelen çapalı bağlantı (zil, e-posta, Bugün, ⌘K: /panel/gelir-gider#kar-zarar, Komisyon'un
 * ?ay=…#pluxee) hedefine iner. Sayfa sunucudan sonradan aktığı için Next'in (ya da tarayıcının) çapa kaydırması hedefe ulaşamayabilir: içerik
 * çizilince bir kez kaydırılır. Akan içeriğin içine konur. Next önceki sayfaların gizli kopyalarını tuttuğu için görünen
 * çapa seçilir. Dönem değişince yeniden bağlanır (key).
 *
 * Hedef `data-hash-hit` ile de işaretlenir: Next adresi pushState ile değiştirdiği için uygulamanın içinden gelince
 * tarayıcının :target'ı boş kalır (hedefin vurgusu çıkmazdı). Aynı sayfada başka çapaya geçilince (⌘K tarayıcının
 * çapa gezinmesini kullanır, geri / ileri) işaret yeni hedefe taşınır; ⌘K'nın elle gönderdiği olayda (zaten o çapadayken)
 * tarayıcı kaydırmadığı için kaydırılır.
 */
export function HashScroll() {
  useEffect(() => {
    let hit: HTMLElement | undefined;
    const mark = () => {
      hit?.removeAttribute(HASH_HIT_ATTR);
      const id = decodeURIComponent(window.location.hash.slice(1));
      hit = id ? [...document.querySelectorAll<HTMLElement>(`#${CSS.escape(id)}`)].find((el) => el.getClientRects().length > 0) : undefined;
      hit?.setAttribute(HASH_HIT_ATTR, "");
      return hit;
    };
    const frame = requestAnimationFrame(() => mark()?.scrollIntoView({ block: "start" }));
    const onHash = (e: HashChangeEvent) => {
      const el = mark();
      if (!e.isTrusted) el?.scrollIntoView({ block: "start" });
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", onHash);
      hit?.removeAttribute(HASH_HIT_ATTR);
    };
  }, []);
  return null;
}
