"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Yalnız kaydı varken çizilen bölümün boş hâli (denetim UI-08): Yardım'daki, zildeki ya da e-postadaki çapalı bağlantı
 * (/panel/hammaddeler#fiyat-onayi, /panel/hatirlaticilar#son-odenenler, /panel/urunler#zamlar) sayfanın başına
 * düşmesin, bölümün neden olmadığını söyleyen kısa satıra insin. Sayfa sunucudan sonradan aktığı için tarayıcının (ya da
 * Next'in) çapa kaydırması satıra ulaşamayabilir: çizilince bir kez kaydırılır (list-anchor.tsx gibi).
 */
export function AnchorNote({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (window.location.hash !== `#${id}`) return;
    const frame = requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [id]);
  return (
    <p ref={ref} id={id} className={cn("scroll-mt-[calc(var(--mobile-top-h)+1.5rem)] text-sm text-ink-mute lg:scroll-mt-4", className)}>
      {children}
    </p>
  );
}
