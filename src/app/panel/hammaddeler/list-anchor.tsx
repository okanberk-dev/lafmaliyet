"use client";

import { useEffect, type ReactNode } from "react";

import { LIST_ID } from "./breakdowns";

/**
 * Hammadde listesinin çapası (#hammadde-listesi): kart dökümündeki bağlantı süzülmüş listeye iner (telefonda liste
 * kartların çok altında). Liste sunucudan sonradan aktığı için Next'in (ya da tarayıcının) çapa kaydırması listeye
 * ulaşamayabilir; liste çizilince bir kez kaydırılır. Next önceki sayfaların gizli kopyalarını tuttuğu için görünen
 * çapa seçilir.
 */
export function ListAnchor({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (window.location.hash !== `#${LIST_ID}`) return;
    const id = requestAnimationFrame(() =>
      [...document.querySelectorAll<HTMLElement>(`#${LIST_ID}`)].find((el) => el.getClientRects().length > 0)?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div id={LIST_ID} className="scroll-mt-[calc(var(--mobile-top-h)+0.75rem)] lg:scroll-mt-4">
      {children}
    </div>
  );
}
