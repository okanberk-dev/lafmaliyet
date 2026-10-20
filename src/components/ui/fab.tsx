"use client";

import { useEffect, useState, type ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Aşağı kaydırırken gizlenen, yukarı kaydırınca (ve sayfanın başında) görünen öğeler için. Kaydırma 6px'ten az
 * oynarsa durum değişmez (titreme olmasın).
 */
export function useHideOnScrollDown(threshold = 80): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        const dy = y - last;
        if (Math.abs(dy) < 6) return;
        last = y;
        setHidden(dy > 0 && y > threshold);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [threshold]);
  return hidden;
}

/**
 * Telefon ve tabletin yüzen ekleme düğmesi (lg altında): sağ altta, alt menünün (--mobile-nav-h) üstünde,
 * başparmak hizasında. Aşağı kaydırırken kaybolur: altındaki satırların anahtarı, tutarı ya da düğmesi örtülmez;
 * yukarı kaydırınca geri gelir. Ekran klavyesi açıkken gizlidir.
 */
export function Fab({ className, children, type = "button", ...props }: ComponentProps<"button">) {
  const hidden = useHideOnScrollDown();
  return (
    <button
      type={type}
      {...props}
      data-hidden={hidden || undefined}
      className={cn(
        "no-print fixed right-4 bottom-[calc(var(--mobile-nav-h,0px)+0.75rem)] z-30 flex h-14 cursor-pointer items-center gap-2 rounded-full bg-ink pr-5 pl-4 text-[15px] font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.25)] lg:hidden in-data-[keyboard=open]:hidden",
        "transition-[translate,scale,opacity] duration-200 active:scale-[0.96] motion-reduce:transition-none",
        "data-hidden:pointer-events-none data-hidden:translate-y-[calc(100%+1rem)] data-hidden:opacity-0",
        className,
      )}
    >
      {children}
    </button>
  );
}
