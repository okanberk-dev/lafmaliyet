"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

import { SPRING_PANEL } from "@/components/akmanos/lib/motion-ease";
import { cn } from "@/lib/utils";

/**
 * İçerik alanının altında yüzen beyaz kapsül: kaydedilmemiş değişiklikler, sayım kaydı.
 * Masaüstünde kenar çubuğunun (17.5rem) sağında ortalanır; telefonda alt menünün (--mobile-nav-h) üstünde,
 * ekran klavyesi açıkken klavyenin hemen üstünde durur (globals.css, .floating-bar).
 * Açıkken sayfanın altına çubuğun yüksekliği kadar boşluk eklenir (globals.css, [data-floating-bar] ve
 * --floating-bar-h): telefonda iki satıra sarılan çubuk da son satırları örtmez.
 */
export function FloatingBar({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = region.current;
    if (!open || !el) return;
    const root = document.documentElement;
    const write = () => root.style.setProperty("--floating-bar-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    write();
    const observer = new ResizeObserver(write);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--floating-bar-h");
    };
  }, [open]);
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? undefined : { opacity: 0, y: 24, scale: 0.98 }}
          transition={reduce ? { duration: 0 } : SPRING_PANEL}
          data-floating-bar
          className="floating-bar no-print pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] lg:left-[17.5rem]"
        >
          <div
            ref={region}
            role="region"
            aria-label="Kaydetme çubuğu"
            className={cn(
              "pointer-events-auto flex w-full max-w-2xl flex-wrap items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.14)] ring-1 ring-line-strong",
              className,
            )}
          >
            {children}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
